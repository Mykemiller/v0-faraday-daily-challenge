// League Office — Game Library audited writes (server-only).
//
// Every export here is called from executeAction() in write.ts, so the ONE
// audited funnel and its mandatory `reason` still hold. Nothing writes a table
// without also writing exactly one lo_audit_log row (domain='game_library').
//
// D5 note — how "edit the active season" actually works:
//   The ticket describes inserting a new season_config row already in state
//   `active` and demoting the incumbent. That would trip
//   season_config_one_active_uq (the exact failure recorded as "defect 3" for
//   migration 20260730000001). PR #120 reaches the SAME outcome through the
//   shipped state machine: season_config_clone() makes a v+1 DRAFT, we edit the
//   draft's slate, then season_config_promote() flips it live and supersedes the
//   incumbent with correct effective dating. Myke locked this reading 2026-07-30.
//   season_config_promote SELF-LOGS — never double-log it.

import { type Svc } from "./service";
import {
  checkTransition,
  planAssignment,
  sanitizeCatalogPatch,
  toGameKey,
  isLifecycleState,
  LIFECYCLE_LABEL,
  type ConfigState,
  type LifecycleState,
} from "./game-library-logic";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

export type Result = { ok: boolean; message: string };
export type LogFn = (
  action: string,
  targetId: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  reversible: boolean,
  /** defaults to "game" — the version row targets the season_config instead. */
  targetType?: string
) => Promise<string | null>;

// ── PostgREST plumbing ───────────────────────────────────────────────────────
// Unlike write.ts's helpers these surface the upstream error body, because the
// D9 trigger's message is the useful part of a rejected assignment.
type Res = { ok: true; rows: Record<string, unknown>[] } | { ok: false; message: string };

async function rq(s: Svc, path: string, init: RequestInit): Promise<Res> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { ...s.headers, Prefer: "return=representation", ...(init.headers || {}) },
      cache: "no-store",
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, message: dbMessage(body) };
    return { ok: true, rows: Array.isArray(body) ? body : [] };
  } catch {
    return { ok: false, message: "Network error — nothing was changed." };
  }
}

/** Postgres RAISE messages are the most useful thing we can show staff (the D9
 *  trigger explains exactly why an assignment was refused). Fall back to a
 *  generic line when PostgREST returns something shapeless. */
function dbMessage(body: unknown): string {
  const m = (body as { message?: unknown } | null)?.message;
  if (typeof m === "string" && m.trim()) return m;
  return "The database rejected that change.";
}

async function get<T>(s: Svc, path: string): Promise<T[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: s.headers, cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? (j as T[]) : [];
  } catch {
    return [];
  }
}

const one = async <T>(s: Svc, path: string): Promise<T | null> => (await get<T>(s, path))[0] ?? null;

async function rpc(s: Svc, fn: string, args: Record<string, unknown>): Promise<Res> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { ...s.headers, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, message: dbMessage(body) };
    return { ok: true, rows: Array.isArray(body) ? body : body ? [body] : [] };
  } catch {
    return { ok: false, message: "Network error — nothing was changed." };
  }
}

// ── row shapes ───────────────────────────────────────────────────────────────
type GameRow = {
  id: string;
  game_key: string;
  display_name: string;
  lifecycle_state: LifecycleState;
  runtime_key: string | null;
  is_active: boolean;
  retired_on: string | null;
  launched_on: string | null;
  sort_order: number;
};
type ConfigRow = { id: string; season_id: string; version: number; state: ConfigState };
type SeasonRow = { id: string; name: string; status: string; locked_at: string | null };

const GAME_COLS =
  "id,game_key,display_name,lifecycle_state,runtime_key,is_active,retired_on,launched_on,sort_order";

const loadGame = (s: Svc, id: string) =>
  one<GameRow>(s, `game_catalog?id=eq.${id}&select=${GAME_COLS}&limit=1`);

// ── game.create ──────────────────────────────────────────────────────────────
export async function createGame(
  s: Svc,
  log: LogFn,
  input: { displayName?: string; category?: string; description?: string }
): Promise<Result> {
  const displayName = (input.displayName ?? "").trim();
  if (!displayName) return { ok: false, message: "A display name is required." };

  const game_key = toGameKey(displayName);
  if (!game_key)
    return { ok: false, message: "That name does not produce a usable game key — use letters or numbers." };

  const clash = await one<{ id: string }>(s, `game_catalog?game_key=eq.${game_key}&select=id&limit=1`);
  if (clash) return { ok: false, message: `A game with the key “${game_key}” already exists.` };

  // Park new concepts after the live slate so they never reorder the lobby.
  const tail = await one<{ sort_order: number }>(
    s, `game_catalog?select=sort_order&order=sort_order.desc&limit=1`
  );
  const sort_order = Math.max(1000, (tail?.sort_order ?? 0) + 10);

  const row = {
    game_key,
    display_name: displayName,
    category: (input.category ?? "").trim() || null,
    description: (input.description ?? "").trim() || null,
    lifecycle_state: "new_idea",
    is_active: false,
    is_beta: false,
    runtime_key: null,
    short_code: null,
    sort_order,
    idea_source: "League Office",
  };

  const res = await rq(s, "game_catalog", { method: "POST", body: JSON.stringify(row) });
  if (!res.ok) return { ok: false, message: res.message };

  const id = (res.rows[0] as { id?: string } | undefined)?.id ?? null;
  await log("game.create", id, null, row, false);
  return { ok: true, message: `“${displayName}” created as a new idea — logged to Audit Log.` };
}

// ── game.lifecycle_change ────────────────────────────────────────────────────
export async function changeLifecycle(
  s: Svc,
  log: LogFn,
  input: { gameId?: string; lifecycleTo?: string; reason: string }
): Promise<Result> {
  if (!input.gameId) return { ok: false, message: "Missing game." };
  const game = await loadGame(s, input.gameId);
  if (!game) return { ok: false, message: "Game not found." };

  // Assignment count feeds the retire guard: retiring an assigned game would
  // leave a slate the D9 trigger refuses to re-save.
  const assigned = await get<{ id: string }>(
    s, `season_games?game_id=eq.${input.gameId}&select=id`
  );

  const check = checkTransition({
    from: game.lifecycle_state,
    to: input.lifecycleTo,
    reason: input.reason,
    runtimeKey: game.runtime_key,
    assignmentCount: assigned.length,
  });
  if (!check.ok) return { ok: false, message: check.message };

  const to = input.lifecycleTo as LifecycleState;
  const before = {
    lifecycle_state: game.lifecycle_state,
    is_active: game.is_active,
    launched_on: game.launched_on,
    retired_on: game.retired_on,
  };

  // Keep the legacy flags coherent with the new state — they are kept, not
  // dropped (D2), so leaving them stale would mislead every other reader.
  const today = new Date().toISOString().slice(0, 10);
  const after: Record<string, unknown> = { lifecycle_state: to };
  if (to === "live") {
    after.is_active = true;
    after.retired_on = null;
    if (!game.launched_on) after.launched_on = today;
  } else if (to === "retired") {
    after.is_active = false;
    after.retired_on = today;
  } else {
    after.is_active = false;
  }

  const res = await rq(s, `game_catalog?id=eq.${game.id}`, {
    method: "PATCH",
    body: JSON.stringify(after),
  });
  if (!res.ok) return { ok: false, message: res.message };

  await log("game.lifecycle_change", game.id, before, after, true);
  return {
    ok: true,
    message: `“${game.display_name}” moved to ${LIFECYCLE_LABEL[to]} — logged to Audit Log.`,
  };
}

// ── game.update / game.reorder ───────────────────────────────────────────────
export async function updateGame(
  s: Svc,
  log: LogFn,
  input: { gameId?: string; patch?: unknown; action?: "game.update" | "game.reorder" }
): Promise<Result> {
  if (!input.gameId) return { ok: false, message: "Missing game." };
  const game = await loadGame(s, input.gameId);
  if (!game) return { ok: false, message: "Game not found." };

  const clean = sanitizeCatalogPatch(input.patch, game.lifecycle_state);
  if (!Object.keys(clean).length)
    return { ok: false, message: "Nothing to change — no editable fields were supplied." };

  // Belt and braces: the whitelist already excludes both, but these two are the
  // ones that would silently break the serving join and the catalog identity.
  delete clean.game_key;
  if (game.lifecycle_state === "live") delete clean.runtime_key;

  const before = await one<Record<string, unknown>>(
    s, `game_catalog?id=eq.${game.id}&select=${Object.keys(clean).join(",")}&limit=1`
  );

  const res = await rq(s, `game_catalog?id=eq.${game.id}`, {
    method: "PATCH",
    body: JSON.stringify(clean),
  });
  if (!res.ok) return { ok: false, message: res.message };

  const action = input.action === "game.reorder" ? "game.reorder" : "game.update";
  await log(action, game.id, before, clean, true);
  return { ok: true, message: `“${game.display_name}” updated — logged to Audit Log.` };
}

// ── game.season_assign / game.season_unassign ────────────────────────────────
export async function setSeasonAssignment(
  s: Svc,
  log: LogFn,
  staffEmail: string,
  input: { gameId?: string; seasonId?: string; reason: string; assign: boolean }
): Promise<Result> {
  if (!input.gameId || !input.seasonId) return { ok: false, message: "Missing game or season." };

  const [game, season] = await Promise.all([
    loadGame(s, input.gameId),
    one<SeasonRow>(s, `seasons?id=eq.${input.seasonId}&select=id,name,status,locked_at&limit=1`),
  ]);
  if (!game) return { ok: false, message: "Game not found." };
  if (!season) return { ok: false, message: "Season not found." };

  const configs = await get<ConfigRow>(
    s, `season_config?season_id=eq.${season.id}&select=id,season_id,version,state&order=version.asc`
  );
  const focus = pickConfig(configs);
  if (!focus) return { ok: false, message: `“${season.name}” has no configuration to edit.` };

  const plan = planAssignment({
    configState: focus.state,
    seasonStatus: season.status,
    seasonLocked: !!season.locked_at,
  });
  if (plan.kind === "refused") return { ok: false, message: plan.note };

  // D9 is enforced by the trigger; check here too so staff get a sentence rather
  // than a raised exception surfaced through PostgREST.
  if (input.assign && !["live", "in_test"].includes(game.lifecycle_state))
    return {
      ok: false,
      message: `“${game.display_name}” is ${LIFECYCLE_LABEL[game.lifecycle_state]} — only live or in-test games may be assigned to a season.`,
    };

  // ── the D5 path: a live season is edited by versioning, never in place ─────
  let targetConfigId = focus.id;
  let versioned = false;

  if (plan.kind === "clone_and_promote") {
    const cloned = await rpc(s, "season_config_clone", {
      p_season_id: season.id,
      p_label: `Game slate change — ${game.display_name}`,
      p_created_by: staffEmail,
    });
    if (!cloned.ok) return { ok: false, message: `Could not version the configuration: ${cloned.message}` };

    const newId = extractId(cloned.rows[0]);
    if (!newId) return { ok: false, message: "Could not version the configuration — no new version was returned." };
    targetConfigId = newId;
    versioned = true;
  }

  // Apply the single-row change. Deliberately NOT saveConfigBundle(), which
  // replaces a config's whole slate by DELETE + INSERT — a narrow write here
  // cannot disturb the other games, and never touches a closed or superseded
  // season's rows.
  const existing = await one<{ id: string; is_enabled: boolean }>(
    s,
    `season_games?season_config_id=eq.${targetConfigId}&game_id=eq.${game.id}&select=id,is_enabled&limit=1`
  );

  const before = existing ? { is_enabled: existing.is_enabled } : null;
  let after: Record<string, unknown> | null;
  let write: Res;

  if (input.assign) {
    if (existing && existing.is_enabled)
      return { ok: false, message: `“${game.display_name}” is already enabled for ${season.name}.` };
    after = { is_enabled: true };
    write = existing
      ? await rq(s, `season_games?id=eq.${existing.id}`, { method: "PATCH", body: JSON.stringify(after) })
      : await rq(s, "season_games", {
          method: "POST",
          body: JSON.stringify({
            season_config_id: targetConfigId,
            game_id: game.id,
            is_enabled: true,
            weight: 1,
            sort_order: game.sort_order,
          }),
        });
  } else {
    if (!existing) return { ok: false, message: `“${game.display_name}” is not on ${season.name}'s slate.` };
    // Disable rather than DELETE: the slate is a record of what was configured,
    // and a removed row loses its weight/overrides silently.
    after = { is_enabled: false };
    write = await rq(s, `season_games?id=eq.${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify(after),
    });
  }

  if (!write.ok) {
    if (versioned) await discardDraft(s, targetConfigId);
    return { ok: false, message: write.message };
  }

  // On the versioned path the draft must be promotable BEFORE we log anything —
  // promote() would otherwise fail after the audit row claimed success, and the
  // orphan draft would linger on the season's version history.
  if (versioned) {
    const blocking = await blockingFindings(s, targetConfigId);
    if (blocking.length) {
      await discardDraft(s, targetConfigId);
      return { ok: false, message: findingsMessage(blocking) };
    }
  }

  await log(
    input.assign ? "game.season_assign" : "game.season_unassign",
    game.id,
    before,
    { ...after, season_id: season.id, season_config_id: targetConfigId },
    true
  );

  if (versioned) {
    // The version row is its own fact, on its own target — a reader looking at
    // the season's history must see it without reading game rows.
    await log(
      "season.config_version_created",
      targetConfigId,
      { from_config_id: focus.id, from_version: focus.version, state: focus.state },
      { season_id: season.id, cloned_from: focus.id, reason_game_id: game.id },
      false,
      "season_config"
    );

    // Promote LAST: the draft must already carry the edit, or the live season
    // would briefly serve a version without it. season_config_promote writes
    // its own audit row — do not log it again here.
    const promoted = await rpc(s, "season_config_promote", {
      p_config_id: targetConfigId,
      p_staff_email: staffEmail,
      p_reason: `Game slate change — ${game.display_name}: ${input.reason}`,
    });
    if (!promoted.ok)
      return {
        ok: false,
        message: `The new version was created with your change but could not be promoted: ${promoted.message}. Review it in Seasons before retrying.`,
      };
  }

  const verb = input.assign ? "assigned to" : "removed from";
  const base = versioned
    ? `“${game.display_name}” ${verb} ${season.name} as a new configuration version — logged to Audit Log.`
    : `“${game.display_name}” ${verb} ${season.name} — logged to Audit Log.`;

  // A draft may legitimately be saved invalid (the season editor works the same
  // way and surfaces findings) — but say so, or the season silently becomes
  // un-promotable and nobody learns why until they try.
  if (!versioned) {
    const blocking = await blockingFindings(s, targetConfigId);
    if (blocking.length)
      return {
        ok: true,
        message: `${base} ⚠️ This configuration can no longer be promoted: ${blocking
          .map((f) => f.message)
          .join(" ")}`,
      };
  }

  return { ok: true, message: base };
}

/** Remove a clone we created but could not promote, so a failed edit does not
 *  leave a stray draft version on the season. season_games rows cascade. */
async function discardDraft(s: Svc, configId: string): Promise<void> {
  const row = await one<{ state: ConfigState }>(
    s, `season_config?id=eq.${configId}&select=state&limit=1`
  );
  // Only ever delete something still in draft — never touch a promoted version.
  if (row?.state !== "draft") return;
  await rq(s, `season_config?id=eq.${configId}`, { method: "DELETE" });
}

type Finding = { severity: string; code: string; message: string };

/** season_config_promote refuses a config with blocking findings and reports only
 *  a COUNT ("has 1 blocking validation error(s)"). Run the same validator here so
 *  staff get the actual reason.
 *
 *  This is not theoretical: every config ships games_per_day = 7 against exactly
 *  7 enabled games, so ANY unassign trips `games_per_day_exceeds_slate`. Lowering
 *  games_per_day belongs to the season config editor, not to this surface —
 *  silently rewriting it here would change how many games a season serves as a
 *  side effect of a slate toggle. */
async function blockingFindings(s: Svc, configId: string): Promise<Finding[]> {
  const res = await rpc(s, "season_config_validate", { p_config_id: configId });
  if (!res.ok) return [];
  return (res.rows as unknown as Finding[]).filter((f) => f?.severity === "error");
}

function findingsMessage(findings: Finding[]): string {
  const detail = findings.map((f) => f.message).join(" ");
  return `That change would leave the season invalid: ${detail} Adjust it in the season configuration editor first.`;
}

/** Same precedence as the season console: active, then scheduled, then the
 *  newest draft. Ordering by the enum in PostgREST would put `draft` first. */
function pickConfig(configs: ConfigRow[]): ConfigRow | null {
  if (!configs.length) return null;
  const rank = (c: ConfigRow) =>
    c.state === "active" ? 0 : c.state === "scheduled" ? 1 : c.state === "draft" ? 2 : 3;
  return [...configs].sort((a, b) => rank(a) - rank(b) || b.version - a.version)[0] ?? null;
}

/** season_config_clone returns either a bare uuid or a row wrapping one. */
function extractId(row: unknown): string | null {
  if (typeof row === "string") return row;
  if (row && typeof row === "object") {
    const r = row as Record<string, unknown>;
    for (const k of ["season_config_clone", "id", "config_id"]) {
      if (typeof r[k] === "string") return r[k] as string;
    }
  }
  return null;
}

export { isLifecycleState };
