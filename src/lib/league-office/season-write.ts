// League Office — Season Config audited write path (server-only).
//
// Same trust mechanic as write.ts: every mutation captures a before-snapshot,
// performs the change via service-role PostgREST, and writes exactly ONE
// lo_audit_log row (domain 'seasons') carrying the mandatory reason.
//
// Two exceptions to "we write the audit row", both deliberate:
//   • season_config_promote() writes its own audit row inside the RPC — calling
//     writeAudit here too would double-log (spec §3).
//   • season_config_apply_due() is the cron actuator; it flips scheduled→active
//     with no staff actor, so the cron route logs a single system summary row.
//
// GUARDRAILS enforced HERE (not just in the UI), because the API is the fence:
//   • a locked season (seasons.locked_at) rejects every config mutation;
//   • only draft/scheduled configs are writable — active is clone-only;
//   • an optimistic-concurrency fingerprint must match or the save 409s.

import { type Svc } from "./service";
import { seasonDayCount } from "./generation-logic";
import {
  bundleFingerprint, getConfigBundle, getScopeSummary, loadGameCatalog, loadSeasonMemberships,
  pickFocusConfig, previewScope, rpc,
  type DifficultyMixRow, type ScopeResolution, type SeasonConfigRow, type SeasonGameRow,
  type ThemeMixRow,
} from "./seasons";
import {
  buildScopeRows, configSaveMessage, countOverCap, defaultDifficultyMix,
  defaultThemeMix, editability, findOverlappingSeason, normalizeDayMask, round2,
  sanitizeConfigPatch, slugify,
  type SeasonRange, type WizardScope,
} from "./season-config-logic";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

// ── low-level PostgREST (mirrors write.ts; kept local so write.ts is untouched)
async function rq(s: Svc, path: string, init: RequestInit): Promise<unknown[] | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { ...s.headers, Prefer: "return=representation", ...(init.headers || {}) },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j : [];
  } catch {
    return null;
  }
}
const insert = (s: Svc, table: string, body: unknown) =>
  rq(s, table, { method: "POST", body: JSON.stringify(body) });

/** Like `insert`, but PRESERVES the upstream PostgREST error instead of
 *  flattening it to null. A schema-level refusal (generated column, exclusion
 *  constraint, check) carries the only information that can tell a commissioner
 *  what to change — swallowing it turns every distinct failure into the same
 *  useless "nothing was written". */
async function insertOrError(
  s: Svc,
  table: string,
  body: unknown
): Promise<{ ok: true; rows: unknown[] } | { ok: false; status: number; message: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...s.headers, Prefer: "return=representation" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const detail =
        j && typeof j === "object"
          ? [
              (j as Record<string, unknown>).message,
              (j as Record<string, unknown>).details,
              (j as Record<string, unknown>).hint,
            ]
              .filter(Boolean)
              .join(" · ")
          : "";
      return { ok: false, status: r.status === 409 ? 409 : 400, message: detail || `Insert into ${table} failed (${r.status}).` };
    }
    return { ok: true, rows: Array.isArray(j) ? j : [] };
  } catch {
    return { ok: false, status: 500, message: "Network error — nothing was written." };
  }
}

/** Turn the `seasons` schema's refusals into something actionable. */
function seasonWriteMessage(raw: string): string {
  if (/seasons_no_overlap|exclusion constraint/i.test(raw))
    return "Those dates overlap an existing season. Seasons cannot overlap — pick a different window.";
  if (/seasons_slug_key|duplicate key/i.test(raw))
    return "That slug is already taken. Choose a different name or edit the slug.";
  if (/seasons_check/i.test(raw))
    return "The end date must be on or after the start date.";
  if (/generated column|428C9/i.test(raw))
    return "Free agency dates are derived from the end date and cannot be set directly. This is a bug — please report it.";
  return `Creating the season failed — nothing was written. (${raw})`;
}
const patch = (s: Svc, table: string, filter: string, body: Record<string, unknown>) =>
  rq(s, `${table}?${filter}`, { method: "PATCH", body: JSON.stringify(body) });
const del = (s: Svc, table: string, filter: string) =>
  rq(s, `${table}?${filter}`, { method: "DELETE" });

async function getOne<T = Record<string, unknown>>(s: Svc, path: string): Promise<T | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: s.headers, cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? ((j[0] ?? null) as T) : null;
  } catch {
    return null;
  }
}

async function writeAudit(
  s: Svc,
  row: {
    staff_email: string;
    action: string;
    reason: string;
    target_type: string | null;
    target_id: string | null;
    before: unknown;
    after: unknown;
    reversible: boolean;
  }
): Promise<string | null> {
  const out = await insert(s, "lo_audit_log", { domain: "seasons", ...row });
  return (out?.[0] as { id?: string } | undefined)?.id ?? null;
}

// ── result type ──────────────────────────────────────────────────────────────

export type WriteOk<T = Record<string, unknown>> = { ok: true; message: string; data?: T };
export type WriteErr = { ok: false; status: number; message: string; data?: Record<string, unknown> };
export type WriteResult<T = Record<string, unknown>> = WriteOk<T> | WriteErr;

const err = (status: number, message: string, data?: Record<string, unknown>): WriteErr => ({
  ok: false, status, message, ...(data ? { data } : {}),
});

// ── shared guards ────────────────────────────────────────────────────────────

/** A locked season is frozen: every config mutation is refused at this layer,
 *  so a hand-rolled API call is stopped exactly like a UI click (spec §4). */
async function assertSeasonUnlocked(s: Svc, seasonId: string): Promise<WriteErr | null> {
  const season = await getOne<{ locked_at: string | null; name: string }>(
    s, `seasons?id=eq.${seasonId}&select=locked_at,name`
  );
  if (!season) return err(404, "Season not found.");
  if (season.locked_at)
    return err(423, `“${season.name}” is locked (${season.locked_at.slice(0, 10)}). Unlock it before changing its configuration.`);
  return null;
}

// ── create season (wizard submit) ────────────────────────────────────────────

export { type WizardScope };

export type CreateSeasonInput = {
  name: string;
  slug?: string;
  description?: string;
  tz?: string;
  starts_on: string;
  ends_on: string;
  /** free_agency_start / free_agency_notice_start are NOT accepted — they are
   *  GENERATED ALWAYS from ends_on (−3 / −7) and cannot be written. */
  roster_lock_on?: string | null;
  scope: WizardScope;
  startingPoint: { mode: "copy"; sourceSeasonId: string } | { mode: "defaults" };
  reason: string;
};

/** Creates the season, its scope rows, and its v1 draft config in that order.
 *  Nothing is written until this point — the wizard holds all four steps in
 *  client state and submits once (spec §2.2). */
export async function createSeason(
  s: Svc,
  staffEmail: string,
  input: CreateSeasonInput
): Promise<WriteResult<{ seasonId: string; configId: string | null }>> {
  const name = (input.name || "").trim();
  if (!name) return err(422, "A season name is required.");

  const slug = slugify(input.slug || name);
  if (!slug) return err(422, "That name does not produce a valid slug — add some letters or numbers.");

  if (!input.starts_on || !input.ends_on) return err(422, "Both a start and an end date are required.");
  if (input.ends_on <= input.starts_on) return err(422, "The end date must be after the start date.");

  const clash = await getOne<{ id: string }>(s, `seasons?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
  if (clash) return err(409, `The slug “${slug}” is already taken. Choose a different name or edit the slug.`);

  // `seasons_no_overlap_per_league` EXCLUDEs overlapping daterange(starts_on,
  // ends_on, '[]') within one league (Part A). This pre-check stays GLOBAL
  // because the wizard only creates INDEPENDENT-league seasons today; it must
  // become league-scoped when a league picker exists. Pre-checked so the
  // message can NAME the clashing season; the constraint mapping below still
  // covers the race where one is created concurrently.
  const existing = await fetchJson<SeasonRange[]>(s, `seasons?select=id,name,starts_on,ends_on`);
  const overlap = findOverlappingSeason(input.starts_on, input.ends_on, existing ?? []);
  if (overlap)
    return err(
      409,
      `Those dates overlap “${overlap.name}” (${overlap.starts_on} → ${overlap.ends_on}). Seasons cannot overlap — pick a window outside it.`
    );

  // Part A (league model): seasons.league_id is NOT NULL. The wizard has no
  // league picker yet, so every LO-created season lands in INDEPENDENT —
  // resolved by code, never a hardcoded uuid.
  const league = await getOne<{ id: string }>(s, `leagues?code=eq.INDEPENDENT&select=id&limit=1`);
  if (!league) return err(500, "League INDEPENDENT not found — cannot create a season.");

  // NOTE: free_agency_start / free_agency_notice_start are GENERATED ALWAYS
  // (ends_on − 3 / ends_on − 7). Sending them — even as NULL — makes Postgres
  // reject the whole INSERT with 428C9, which is what made every season
  // creation fail. They are derived; never write them.
  const created = await insertOrError(s, "seasons", {
    slug,
    name,
    starts_on: input.starts_on,
    ends_on: input.ends_on,
    status: "upcoming",
    tz: (input.tz || "America/Chicago").trim(),
    league_id: league.id,
  });
  if (!created.ok) return err(created.status, seasonWriteMessage(created.message));

  const seasonId = (created.rows[0] as { id?: string } | undefined)?.id;
  if (!seasonId) return err(500, "Creating the season failed — nothing was written.");

  // Scope BEFORE the config, and roll the season back if it fails.
  //
  // createSeason spans two RPCs (the season INSERT and lo_set_season_scope) and
  // PostgREST cannot hold a transaction across them, so true atomicity is not
  // available. The failure that matters is a season that exists with the WRONG
  // scope — silently platform-wide when the commissioner asked for one league —
  // because nothing downstream would ever flag it. So: if the scope write is
  // refused, DELETE the season we just created and surface the refusal. The
  // config rows do not exist yet at this point, and season_scopes/season_config
  // are both ON DELETE CASCADE, so the delete is clean.
  const scoped = await setScope(s, seasonId, input.scope, staffEmail, input.reason);
  if (!scoped.ok) {
    await del(s, "seasons", `id=eq.${seasonId}`);
    return err(scoped.status, `${scoped.message} The season was not created.`);
  }

  // Starting point → the v1 draft config.
  const configId =
    input.startingPoint.mode === "copy"
      ? await copyConfigAcrossSeasons(s, input.startingPoint.sourceSeasonId, seasonId, staffEmail, input.roster_lock_on ?? null)
      : await createDefaultsConfig(s, seasonId, staffEmail, input.roster_lock_on ?? null);

  await writeAudit(s, {
    staff_email: staffEmail,
    action: "season.create",
    reason: input.reason,
    target_type: "season",
    target_id: seasonId,
    before: null,
    after: {
      slug, name, starts_on: input.starts_on, ends_on: input.ends_on,
      tz: input.tz || "America/Chicago",
      description: input.description || null,
      scope: input.scope,
      starting_point: input.startingPoint.mode,
      config_id: configId,
    },
    reversible: false,
  });

  return {
    ok: true,
    message: configId
      ? `“${name}” created with a v1 draft config.`
      : `“${name}” created — but its starting config could not be built. Open the season and clone a version.`,
    data: { seasonId, configId },
  };
}

/** CC-LO-SEASON-SCOPE-1.0 (D9): the ONE path that writes season_scopes.
 *
 *  Replaces the old `writeScopeRows` (DELETE + INSERT over PostgREST) AND the
 *  `-- 5. scopes` block inside season_config_save_bundle. Two writers to one
 *  table is how a slate save came to silently replace a season's whole scope
 *  with nothing in the audit log to show it.
 *
 *  The RPC writes its own lo_audit_log row (`season.set_scope`), so callers
 *  must NOT also call writeAudit — that would double-log, the same carve-out
 *  season_config_promote already has. */
async function setScope(
  s: Svc,
  seasonId: string,
  scope: WizardScope,
  staffEmail: string,
  reason: string
): Promise<
  | { ok: true; summary: ScopeResolution | null; warning: ScopeWarning | null }
  | { ok: false; status: number; message: string }
> {
  const r = await rpc<SetScopeResult | SetScopeResult[]>(s, "lo_set_season_scope", {
    p_season_id: seasonId,
    p_scopes: buildScopeRows(scope),
    p_staff_email: staffEmail,
    p_reason: reason,
  });

  if (!r.ok) return { ok: false, status: scopeErrStatus(r.code), message: r.message };

  const out = (Array.isArray(r.data) ? r.data[0] : r.data) ?? null;
  return { ok: true, summary: out?.summary ?? null, warning: out?.warning ?? null };
}

/** The RPC speaks in SQLSTATEs; the UI speaks in HTTP. P0001 is every one of its
 *  deliberate refusals (closed season, platform-plus-X, missing reason); 23514
 *  is the ref-validation trigger. Both are the commissioner's to fix, so 409 —
 *  never a 500, which would read as "try again". */
function scopeErrStatus(code: string | null): number {
  if (code === "P0002") return 404;
  if (code === "P0001" || code === "23514") return 409;
  return 400;
}

export type ScopeWarning = {
  kind: string;
  season: string;
  locked_at: string | null;
  entering: { id: string; name: string }[];
  leaving: { id: string; name: string }[];
  message: string;
};

type SetScopeResult = { ok: boolean; summary: ScopeResolution | null; warning: ScopeWarning | null };

/** The defaults starting point: full slate from the ASSIGNABLE game catalog, an
 *  even theme mix across the Theaters, and the 30/50/20 difficulty split. */
async function createDefaultsConfig(
  s: Svc,
  seasonId: string,
  staffEmail: string,
  rosterLockOn: string | null
): Promise<string | null> {
  const created = await insert(s, "season_config", {
    season_id: seasonId,
    version: 1,
    state: "draft",
    effective_from: new Date().toISOString(),
    label: "Initial configuration",
    created_by: staffEmail,
    roster_lock_on: rosterLockOn,
  });
  const configId = (created?.[0] as { id?: string } | undefined)?.id;
  if (!configId) return null;

  // Filter on lifecycle_state, NOT is_active/retired_on. Every catalog row is
  // is_active — including the 11 new_idea concepts — so the old filter emitted
  // 18 rows and trg_season_games_assignable rejected the whole INSERT, leaving a
  // brand-new season with an empty slate.
  const catalog = await loadGameCatalog(s);

  if (catalog.length)
    await insert(
      s,
      "season_games",
      catalog.map((g) => ({ season_config_id: configId, game_id: g.id, is_enabled: true, weight: 1, sort_order: g.sort_order }))
    );

  await insert(
    s,
    "season_theme_mix",
    defaultThemeMix().map((r) => ({ season_config_id: configId, ...r }))
  );
  await insert(
    s,
    "season_difficulty_mix",
    defaultDifficultyMix().map((r) => ({ season_config_id: configId, ...r }))
  );

  return configId;
}

/** Copy a config from ANOTHER season into a new season's v1 draft.
 *
 *  NOTE: this is deliberately NOT season_config_clone(). That RPC resolves the
 *  source from its own p_season_id and writes the copy back into that SAME
 *  season — pointing it at the source would add a stray draft version to the
 *  source season and return an id belonging to the wrong season. Cross-season
 *  copying is a read-then-insert here; same-season versioning still goes
 *  through the RPC (see cloneConfigVersion). */
async function copyConfigAcrossSeasons(
  s: Svc,
  sourceSeasonId: string,
  targetSeasonId: string,
  staffEmail: string,
  rosterLockOn: string | null
): Promise<string | null> {
  // Precedence must match season_config_clone's `order by (state='active') desc,
  // effective_from desc, version desc`. PostgREST cannot express that (ordering
  // by the enum would put `draft` FIRST, silently copying a stale draft over the
  // live config), so the pick happens in JS via the shared pickFocusConfig.
  const candidates = await fetchJson<SeasonConfigRow[]>(
    s,
    `season_config?season_id=eq.${sourceSeasonId}&select=*&order=version.asc`
  );
  const source = pickFocusConfig(candidates ?? []);
  if (!source) return createDefaultsConfig(s, targetSeasonId, staffEmail, rosterLockOn);

  const carried: Record<string, unknown> = {};
  for (const k of COPYABLE_CONFIG_FIELDS) carried[k] = (source as Record<string, unknown>)[k];

  const created = await insert(s, "season_config", {
    ...carried,
    season_id: targetSeasonId,
    version: 1,
    state: "draft",
    effective_from: new Date().toISOString(),
    label: `Copied from ${source.label ?? `v${source.version}`}`,
    created_by: staffEmail,
    // Dates that belong to the SOURCE season's calendar must not travel; they
    // would land outside the new window and trip roster_lock_outside_season.
    registration_opens_on: null,
    registration_closes_on: null,
    roster_lock_on: rosterLockOn,
    publish_standings_at: null,
  });
  const configId = (created?.[0] as { id?: string } | undefined)?.id;
  if (!configId) return null;

  const [games, theme, difficulty, assignable] = await Promise.all([
    fetchJson<SeasonGameRow[]>(s, `season_games?season_config_id=eq.${source.id}&select=*`),
    fetchJson<ThemeMixRow[]>(s, `season_theme_mix?season_config_id=eq.${source.id}&select=*`),
    fetchJson<DifficultyMixRow[]>(s, `season_difficulty_mix?season_config_id=eq.${source.id}&select=*`),
    loadGameCatalog(s),
  ]);

  // The source season may hold a game that has since been retired. Copying it
  // forward would be a NEW assignment, which trg_season_games_assignable
  // refuses — taking the whole slate insert down with it. Drop it instead.
  const assignableIds = new Set(assignable.map((g) => g.id));
  const carriedGames = (games ?? []).filter((g) => assignableIds.has(g.game_id));

  if (carriedGames.length)
    await insert(
      s,
      "season_games",
      carriedGames.map((g) => ({
        season_config_id: configId,
        game_id: g.game_id,
        is_enabled: g.is_enabled,
        weight: g.weight,
        points_override: g.points_override,
        difficulty_floor: g.difficulty_floor,
        difficulty_ceiling: g.difficulty_ceiling,
        appears_on_days: g.appears_on_days,
        // Per-game staggered dates are also source-calendar bound.
        starts_on: null,
        ends_on: null,
        sort_order: g.sort_order,
        notes: g.notes,
      }))
    );

  if (theme?.length)
    await insert(
      s,
      "season_theme_mix",
      theme.map((t) => ({
        season_config_id: configId,
        theater_id: t.theater_id, sector_code: t.sector_code, thread_code: t.thread_code,
        target_pct: t.target_pct, min_pct: t.min_pct, max_pct: t.max_pct,
        is_excluded: t.is_excluded, notes: t.notes,
      }))
    );

  if (difficulty?.length)
    await insert(
      s,
      "season_difficulty_mix",
      difficulty.map((d) => ({
        season_config_id: configId,
        difficulty_band: d.difficulty_band, target_pct: d.target_pct,
        min_pct: d.min_pct, max_pct: d.max_pct, applies_to_game_id: d.applies_to_game_id,
      }))
    );

  return configId;
}

/** Config columns that carry meaning across seasons (rules, not calendar). */
const COPYABLE_CONFIG_FIELDS = [
  "notes", "max_teams_per_subscriber", "min_team_size", "max_team_size",
  "allow_free_agency", "allow_late_join", "allow_mid_season_team_switch",
  "games_per_day", "play_days_of_week", "hints_enabled", "max_hints_per_game",
  "hint_penalty_pct", "late_submission_grace_hours", "scoring_profile",
  "signals_per_correct", "streak_bonus_enabled", "drop_lowest_n_days",
  "team_score_method", "team_score_top_n", "difficulty_curve",
  "target_solve_rate_pct", "publish_leaderboard", "leaderboard_visibility", "extras",
];

async function fetchJson<T>(s: Svc, path: string): Promise<T | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: s.headers, cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// ── save draft (the editor's PATCH) ──────────────────────────────────────────

export type ConfigSavePayload = {
  config?: Record<string, unknown>;
  games?: Record<string, unknown>[];
  themeMix?: Record<string, unknown>[];
  difficultyMix?: Record<string, unknown>[];
  /** REMOVED in CC-LO-SEASON-SCOPE-1.0 (D9). Scope is written only by
   *  updateSeasonScope → lo_set_season_scope. A `scope` key on this payload is
   *  now ignored rather than silently replacing the season's whole scope set. */
  fingerprint?: string;
  reason: string;
  /** Set once the commissioner has seen and accepted the over-cap warning. */
  acknowledgeCapWarning?: boolean;
};

export async function saveConfigDraft(
  s: Svc,
  staffEmail: string,
  configId: string,
  payload: ConfigSavePayload
): Promise<WriteResult> {
  const bundle = await getConfigBundle(s, configId);
  if (!bundle) return err(404, "Config not found.");

  const locked = await assertSeasonUnlocked(s, bundle.config.season_id);
  if (locked) return locked;

  const edit = editability(bundle.config.state);
  if (!edit.editable) return err(409, edit.reason ?? "This version is read-only.");

  // Optimistic concurrency — see the note in season-config-logic.
  if (payload.fingerprint && payload.fingerprint !== bundle.fingerprint)
    return err(409, "This configuration changed in another session since you opened it. Reload to pick up the latest, then re-apply your edits.", { conflict: true });

  const before = snapshot(bundle);

  // Guardrail: lowering the per-subscriber team cap below what existing
  // memberships already use. We WARN with a count and never auto-remove rows.
  const nextCap = Number(payload.config?.max_teams_per_subscriber ?? bundle.config.max_teams_per_subscriber);
  if (Number.isFinite(nextCap) && nextCap < bundle.config.max_teams_per_subscriber && !payload.acknowledgeCapWarning) {
    const memberships = await loadSeasonMemberships(s, bundle.config.season_id);
    const { over, worst } = countOverCap(memberships, nextCap);
    if (over > 0)
      return err(
        409,
        `${over} subscriber${over === 1 ? "" : "s"} already hold more than ${nextCap} team${nextCap === 1 ? "" : "s"} this season (highest: ${worst}). No memberships will be removed — confirm to save this cap anyway.`,
        { capWarning: true, over, worst, cap: nextCap }
      );
  }

  // ONE transaction for all five tables (CC-LO-SLATE-FILTER-1.0 FIX 3). These
  // used to be five separate PostgREST calls, which is how config 667c488f ended
  // up with its mixes committed and its slate deleted: a mid-sequence refusal
  // left the earlier writes already durable. A NULL argument means "leave that
  // set alone", matching the PATCH semantics the editor already relies on.
  const r = await rpc<SaveBundleResult | SaveBundleResult[]>(s, "season_config_save_bundle", {
    p_config_id: configId,
    p_config: payload.config ? sanitizeConfigPatch(payload.config) : null,
    p_games: payload.games
      ? payload.games
          .map((g) => normalizeGameRow(configId, g))
          .filter((g): g is Record<string, unknown> => g !== null)
      : null,
    p_theme: payload.themeMix
      ? payload.themeMix
          .map((t) => normalizeThemeRow(configId, t))
          .filter((t): t is Record<string, unknown> => t !== null)
      : null,
    p_difficulty: payload.difficultyMix
      ? payload.difficultyMix
          .map((d) => normalizeDifficultyRow(configId, d))
          .filter((d): d is Record<string, unknown> => d !== null)
      : null,
    // CC-LO-SEASON-SCOPE-1.0 (D9): ALWAYS null. The RPC raises on a non-null
    // p_scopes and points at lo_set_season_scope. This used to send whatever
    // Section B happened to hold, which meant an ordinary slate save replaced
    // the season's entire scope set — invisibly, because snapshot() below
    // records config/games/themeMix/difficultyMix and never scopes.
    p_scopes: null,
  });

  if (!r.ok) {
    // The bundle's `catalog` is filtered to assignable games, so it cannot name
    // the game a lifecycle refusal is about. Read the WHOLE catalog — only on
    // the failure path, and only to turn a uuid into a name.
    const all =
      (await fetchJson<{ id: string; display_name: string }[]>(
        s, `game_catalog?select=id,display_name`
      )) ?? [];
    const mapped = configSaveMessage(r.code, r.message, all);
    return err(mapped.status, mapped.message);
  }

  const written = (Array.isArray(r.data) ? r.data[0] : r.data) ?? null;

  const after = await getConfigBundle(s, configId);
  await writeAudit(s, {
    staff_email: staffEmail,
    action: "config.save",
    reason: payload.reason,
    target_type: "season_config",
    target_id: configId,
    before,
    after: after ? snapshot(after) : null,
    reversible: false,
  });

  return {
    ok: true,
    message: "Draft saved — logged to Audit Log.",
    data: {
      fingerprint: after?.fingerprint ?? null,
      findings: after?.findings ?? [],
      slate: written?.games ?? null,
    },
  };
}

type SaveBundleResult = {
  config_id: string;
  games: number;
  theme: number;
  difficulty: number;
  scopes: number;
  dropped_games: string[];
};

function snapshot(b: {
  config: SeasonConfigRow;
  games: SeasonGameRow[];
  themeMix: ThemeMixRow[];
  difficultyMix: DifficultyMixRow[];
}) {
  return {
    config: b.config,
    games: b.games.map(({ game_id, is_enabled, weight, points_override, sort_order }) => ({
      game_id, is_enabled, weight, points_override, sort_order,
    })),
    themeMix: b.themeMix.map(({ theater_id, sector_code, thread_code, target_pct, is_excluded }) => ({
      theater_id, sector_code, thread_code, target_pct, is_excluded,
    })),
    difficultyMix: b.difficultyMix.map(({ difficulty_band, target_pct, applies_to_game_id }) => ({
      difficulty_band, target_pct, applies_to_game_id,
    })),
  };
}

function normalizeGameRow(configId: string, g: Record<string, unknown>): Record<string, unknown> | null {
  const gameId = String(g.game_id ?? "");
  if (!gameId) return null;
  return {
    season_config_id: configId,
    game_id: gameId,
    is_enabled: g.is_enabled === true || g.is_enabled === "true",
    weight: clampNum(g.weight, 1, 0, 999.999),
    points_override: intOrNull(g.points_override),
    difficulty_floor: strOrNull(g.difficulty_floor),
    difficulty_ceiling: strOrNull(g.difficulty_ceiling),
    appears_on_days: g.appears_on_days == null ? null : normalizeDayMask(g.appears_on_days),
    starts_on: strOrNull(g.starts_on),
    ends_on: strOrNull(g.ends_on),
    sort_order: intOrNull(g.sort_order) ?? 100,
    notes: strOrNull(g.notes),
  };
}

function normalizeThemeRow(configId: string, t: Record<string, unknown>): Record<string, unknown> | null {
  const theater = String(t.theater_id ?? "");
  if (!theater) return null;
  return {
    season_config_id: configId,
    theater_id: theater,
    sector_code: strOrNull(t.sector_code),
    thread_code: strOrNull(t.thread_code),
    target_pct: clampNum(t.target_pct, 0, 0, 100),
    min_pct: numOrNull(t.min_pct),
    max_pct: numOrNull(t.max_pct),
    is_excluded: t.is_excluded === true || t.is_excluded === "true",
    notes: strOrNull(t.notes),
  };
}

function normalizeDifficultyRow(configId: string, d: Record<string, unknown>): Record<string, unknown> | null {
  const band = String(d.difficulty_band ?? "").trim();
  if (!band) return null;
  return {
    season_config_id: configId,
    difficulty_band: band,
    target_pct: clampNum(d.target_pct, 0, 0, 100),
    min_pct: numOrNull(d.min_pct),
    max_pct: numOrNull(d.max_pct),
    applies_to_game_id: strOrNull(d.applies_to_game_id),
  };
}

const strOrNull = (v: unknown) => (v === "" || v === null || v === undefined ? null : String(v));
const intOrNull = (v: unknown) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
};
const numOrNull = (v: unknown) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? round2(n) : null;
};
function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return round2(Math.min(max, Math.max(min, n)));
}

// ── clone / promote / cancel ─────────────────────────────────────────────────

/** Same-season versioning — this IS what season_config_clone() is for: it deep
 *  copies the season's active (else latest) config + slate + mixes into a new
 *  draft version and returns its id. */
export async function cloneConfigVersion(
  s: Svc,
  staffEmail: string,
  seasonId: string,
  opts: { effectiveFrom?: string | null; label?: string | null; reason: string }
): Promise<WriteResult<{ configId: string }>> {
  const locked = await assertSeasonUnlocked(s, seasonId);
  if (locked) return locked;

  const r = await rpc<string>(s, "season_config_clone", {
    p_season_id: seasonId,
    p_effective_from: opts.effectiveFrom || new Date().toISOString(),
    p_label: opts.label || null,
    p_created_by: staffEmail,
  });
  if (!r.ok) return err(400, r.message);

  const configId = typeof r.data === "string" ? r.data : String(r.data ?? "");
  if (!configId) return err(500, "Clone returned no new version.");

  await writeAudit(s, {
    staff_email: staffEmail,
    action: "config.clone",
    reason: opts.reason,
    target_type: "season_config",
    target_id: configId,
    before: null,
    after: { season_id: seasonId, effective_from: opts.effectiveFrom ?? null, label: opts.label ?? null },
    reversible: false,
  });

  return { ok: true, message: "New draft version created.", data: { configId } };
}

/** Promote (or schedule). The RPC re-runs validation server-side and refuses on
 *  any error — that check is the real gate; the UI's disabled button is only a
 *  courtesy. The RPC writes its own audit row, so we do NOT log here. */
export async function promoteConfigVersion(
  s: Svc,
  staffEmail: string,
  configId: string,
  reason: string
): Promise<WriteResult<{ state: string; effective_from: string }>> {
  const cfg = await getOne<{ season_id: string; state: string }>(
    s, `season_config?id=eq.${configId}&select=season_id,state`
  );
  if (!cfg) return err(404, "Config not found.");

  const locked = await assertSeasonUnlocked(s, cfg.season_id);
  if (locked) return locked;

  if (cfg.state === "active") return err(409, "This version is already live.");
  if (cfg.state === "superseded" || cfg.state === "cancelled")
    return err(409, `A ${cfg.state} version cannot be promoted. Clone it to a new draft first.`);

  const r = await rpc<SeasonConfigRow | SeasonConfigRow[]>(s, "season_config_promote", {
    p_config_id: configId,
    p_staff_email: staffEmail,
    p_reason: reason,
  });
  if (!r.ok) return err(400, promoteErrorMessage(r.message));

  const row = (Array.isArray(r.data) ? r.data[0] : r.data) as SeasonConfigRow | undefined;
  const state = row?.state ?? "active";
  return {
    ok: true,
    message:
      state === "scheduled"
        ? `Scheduled — this version takes effect ${formatWhen(row?.effective_from)}.`
        : "Promoted — this version is now live.",
    data: { state, effective_from: row?.effective_from ?? "" },
  };
}

/** The RPC raises bare postgres exceptions; turn the known shapes into something
 *  a commissioner can act on rather than a SQLSTATE. */
function promoteErrorMessage(raw: string): string {
  if (/blocking validation error/i.test(raw))
    return "This version has blocking validation errors — resolve them before promoting.";
  if (/not found/i.test(raw)) return "Config not found.";

  // The shipped season_config_promote() cannot cast its CASE result to the
  // season_config_state enum, so every call fails until migration
  // 20260730000001_season_config_effective_dating_fix.sql is applied. Name the
  // fix instead of leaking "42804" to the commissioner.
  if (/season_config_state|42804|is of type/i.test(raw))
    return "Promotion is blocked by a database defect: season_config_promote() needs migration 20260730000001_season_config_effective_dating_fix.sql applied. Nothing was changed.";

  if (/season_config_one_active_uq|duplicate key/i.test(raw))
    return "Another version is already active for this season. Reload and try again.";

  return raw;
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return "at its effective date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "at its effective date" : `on ${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export async function cancelConfigVersion(
  s: Svc,
  staffEmail: string,
  configId: string,
  reason: string
): Promise<WriteResult> {
  const cfg = await getOne<SeasonConfigRow>(s, `season_config?id=eq.${configId}&select=*`);
  if (!cfg) return err(404, "Config not found.");

  const locked = await assertSeasonUnlocked(s, cfg.season_id);
  if (locked) return locked;

  if (cfg.state === "active")
    return err(409, "The live version cannot be cancelled — promote a replacement instead.");
  if (cfg.state === "cancelled") return err(409, "That version is already cancelled.");
  if (cfg.state === "superseded") return err(409, "A superseded version is history — it cannot be cancelled.");

  const res = await patch(s, "season_config", `id=eq.${configId}`, { state: "cancelled" });
  if (!res) return err(400, "Cancel failed.");

  await writeAudit(s, {
    staff_email: staffEmail,
    action: "config.cancel",
    reason,
    target_type: "season_config",
    target_id: configId,
    before: { state: cfg.state },
    after: { state: "cancelled" },
    reversible: true,
  });

  return { ok: true, message: "Version cancelled — logged to Audit Log." };
}

// ── season row edits (name / dates / status / lock) ───────────────────────────

// free_agency_start / free_agency_notice_start are GENERATED ALWAYS and are
// deliberately ABSENT: Postgres rejects any write to them (428C9), so including
// them here would make every season PATCH that touched them fail outright.
const SEASON_FIELDS = [
  "name", "starts_on", "ends_on", "status", "tz",
  // Playoff + roster-freeze dates. The generation checklist (condition 2)
  // REQUIRES these before a season can generate, but nothing wrote them — they
  // had no editor. They live on `seasons`, not season_config.
  "playoff_starts_on", "roster_freeze_on",
] as const;

export type SeasonPatchInput = {
  patch?: Record<string, unknown>;
  /** `lock` freezes config mutations; `unlock` releases them; `close` ends the season. */
  op?: "lock" | "unlock" | "close";
  reason: string;
};

export async function updateSeason(
  s: Svc,
  staffEmail: string,
  seasonId: string,
  input: SeasonPatchInput
): Promise<WriteResult> {
  const before = await getOne<Record<string, unknown>>(s, `seasons?id=eq.${seasonId}&select=*`);
  if (!before) return err(404, "Season not found.");

  const body: Record<string, unknown> = {};
  for (const f of SEASON_FIELDS) {
    if (input.patch && f in input.patch) {
      const v = input.patch[f];
      body[f] = v === "" ? null : v;
    }
  }
  if (body.status && !["upcoming", "active", "closed"].includes(String(body.status)))
    delete body.status;
  if (typeof body.name === "string" && !body.name.trim())
    return err(422, "A season name cannot be empty.");

  let action = "season.update";
  if (input.op === "lock") {
    body.locked_at = new Date().toISOString();
    action = "season.lock";
  } else if (input.op === "unlock") {
    body.locked_at = null;
    action = "season.unlock";
  } else if (input.op === "close") {
    body.status = "closed";
    action = "season.close";
  }

  if (!Object.keys(body).length) return err(422, "Nothing to update.");

  // A locked season is frozen — EXCEPT the two scheduling dates (playoff start /
  // roster freeze). Those are scheduling metadata the generation checklist
  // requires, not roster/scoring config, so they stay editable while locked.
  // Any OTHER field edit still requires an unlock; lock/unlock itself (input.op)
  // is always allowed.
  const LOCK_EXEMPT_FIELDS = new Set(["playoff_starts_on", "roster_freeze_on"]);
  if (before.locked_at && !input.op) {
    const touchesFrozen = Object.keys(body).some((k) => !LOCK_EXEMPT_FIELDS.has(k));
    if (touchesFrozen)
      return err(
        423,
        "This season is locked. Unlock it before editing anything other than the playoff and roster-freeze dates."
      );
  }

  if (body.starts_on && body.ends_on && String(body.ends_on) <= String(body.starts_on))
    return err(422, "The end date must be after the start date.");

  // Playoff + roster-freeze ordering — the same rules the generation checklist
  // enforces (generation-logic condition 2), applied here so the API is the
  // fence and the commissioner gets the real reason, not a later silent block.
  // Validate against the EFFECTIVE window (a patch may touch only one field).
  const eff = (k: string) => (k in body ? body[k] : before[k]) as string | null;
  const startsOn = eff("starts_on");
  const endsOn = eff("ends_on");
  const playoff = eff("playoff_starts_on");
  const freeze = eff("roster_freeze_on");
  if (playoff && startsOn && endsOn && (playoff <= startsOn || playoff > endsOn))
    return err(422, "Playoff start must fall inside the season window.");
  if (freeze && playoff && freeze > playoff)
    return err(422, "Roster freeze must be on or before the playoff start.");
  if (freeze && startsOn && endsOn) {
    const dayCount = seasonDayCount(startsOn, endsOn);
    if (dayCount != null) {
      const quarter = Math.floor((dayCount - 1) / 4);
      const t = new Date(startsOn + "T12:00:00Z");
      t.setUTCDate(t.getUTCDate() + quarter);
      if (freeze < t.toISOString().slice(0, 10))
        return err(422, "Roster freeze must be at least a quarter of the way into the season.");
    }
  }

  const res = await patch(s, "seasons", `id=eq.${seasonId}`, body);
  if (!res) return err(400, "Update failed.");

  await writeAudit(s, {
    staff_email: staffEmail,
    action,
    reason: input.reason,
    target_type: "season",
    target_id: seasonId,
    before,
    after: body,
    reversible: true,
  });

  const msg =
    input.op === "lock" ? "Season locked — configuration is now frozen."
    : input.op === "unlock" ? "Season unlocked — configuration can be edited again."
    : input.op === "close" ? "Season closed."
    : "Season updated.";
  return { ok: true, message: `${msg} Logged to Audit Log.` };
}

// ── scope-only update (Section B / wizard step 3 re-edit) ────────────────────

/** CC-LO-SEASON-SCOPE-1.0: routes to lo_set_season_scope. NO writeAudit here —
 *  the RPC writes its own `season.set_scope` row (D10), and logging again would
 *  double-count, the same carve-out season_config_promote already has.
 *
 *  Deliberately does NOT call assertSeasonUnlocked. Scope is a property of the
 *  SEASON, not of the frozen puzzle configuration, and `locked_at` is set the
 *  moment puzzles are approved — gating on it would make the feature unusable on
 *  exactly the seasons it exists for (`Hot summer Final Beta` is active AND
 *  locked). The RPC enforces the lifecycle rule that does matter: closed seasons
 *  are refused outright, and an active season returns a warning naming every
 *  team crossing the boundary. `locked_at` rides along in that warning so the
 *  UI can say so.
 *
 *  `confirmed` is the commissioner having seen and accepted that warning. The
 *  first call returns it and writes nothing further; the second commits. */
export async function updateSeasonScope(
  s: Svc,
  staffEmail: string,
  seasonId: string,
  scope: WizardScope,
  reason: string,
  confirmed = false
): Promise<WriteResult<{ summary: ScopeResolution | null; warning?: ScopeWarning }>> {
  if (!reason?.trim())
    return err(422, "A reason is required — it is the audit trail for this scope change.");

  const preview = await previewScope(s, seasonId, buildScopeRows(scope));
  const season = await getOne<{ status: string; name: string }>(
    s, `seasons?id=eq.${seasonId}&select=status,name`
  );
  if (!season) return err(404, "Season not found.");

  // Show the active-season warning BEFORE committing, not after. Computing the
  // delta here rather than from the RPC's response is what makes the second
  // confirm meaningful — by the time the RPC could tell us, it has written.
  if (!confirmed && season.status === "active") {
    const current = await getScopeSummary(s, seasonId);
    const before = new Set((current?.teams ?? []).map((t) => t.id));
    const after = new Set((preview?.teams ?? []).map((t) => t.id));
    const entering = (preview?.teams ?? []).filter((t) => !before.has(t.id));
    const leaving = (current?.teams ?? []).filter((t) => !after.has(t.id));

    if (entering.length || leaving.length)
      return err(
        409,
        `“${season.name}” is active. This change moves ${entering.length} team${entering.length === 1 ? "" : "s"} into scope and ${leaving.length} out. Standings will be recomputed against the new set — confirm to apply it.`,
        {
          scopeWarning: true,
          entering,
          leaving,
          summary: preview as unknown as Record<string, unknown>,
        }
      );
  }

  const res = await setScope(s, seasonId, scope, staffEmail, reason);
  if (!res.ok) return err(res.status, res.message);

  return {
    ok: true,
    message: `Scope updated — ${res.summary?.team_count ?? 0} team${res.summary?.team_count === 1 ? "" : "s"} in scope. Logged to Audit Log.`,
    data: { summary: res.summary, ...(res.warning ? { warning: res.warning } : {}) },
  };
}

export { bundleFingerprint };
