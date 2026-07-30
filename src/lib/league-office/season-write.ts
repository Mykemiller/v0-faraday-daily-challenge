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
import {
  bundleFingerprint, getConfigBundle, loadSeasonMemberships, pickFocusConfig, rpc,
  type DifficultyMixRow, type SeasonConfigRow, type SeasonGameRow, type ThemeMixRow,
} from "./seasons";
import {
  countOverCap, defaultDifficultyMix, defaultThemeMix, editability,
  normalizeDayMask, round2, sanitizeConfigPatch, slugify,
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

export type WizardScope = {
  mode: "platform" | "leagues" | "conferences";
  refIds?: string[];
  excludeIds?: string[];
};

export type CreateSeasonInput = {
  name: string;
  slug?: string;
  description?: string;
  tz?: string;
  starts_on: string;
  ends_on: string;
  free_agency_start?: string | null;
  free_agency_notice_start?: string | null;
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

  const created = await insert(s, "seasons", {
    slug,
    name,
    starts_on: input.starts_on,
    ends_on: input.ends_on,
    status: "upcoming",
    tz: (input.tz || "America/Chicago").trim(),
    free_agency_start: input.free_agency_start || null,
    free_agency_notice_start: input.free_agency_notice_start || null,
  });
  const seasonId = (created?.[0] as { id?: string } | undefined)?.id;
  if (!seasonId) return err(500, "Creating the season failed — nothing was written.");

  await writeScopeRows(s, seasonId, input.scope);

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

/** Replace a season's scope set. `platform` with a null ref means ALL (the DB
 *  CHECK enforces that pairing, so the shapes here are not optional). */
async function writeScopeRows(s: Svc, seasonId: string, scope: WizardScope): Promise<void> {
  await del(s, "season_scopes", `season_id=eq.${seasonId}`);

  const rows: Record<string, unknown>[] = [];
  if (scope.mode === "platform") {
    rows.push({ season_id: seasonId, scope_type: "platform", scope_ref_id: null, is_excluded: false });
  } else {
    const type = scope.mode === "leagues" ? "league" : "conference";
    for (const id of dedupe(scope.refIds))
      rows.push({ season_id: seasonId, scope_type: type, scope_ref_id: id, is_excluded: false });
    // A scope with no inclusions would silently match nothing; fall back to
    // platform so a half-filled wizard step can never produce a dead season.
    if (!rows.length)
      rows.push({ season_id: seasonId, scope_type: "platform", scope_ref_id: null, is_excluded: false });
  }

  for (const id of dedupe(scope.excludeIds)) {
    const type = scope.mode === "conferences" ? "conference" : "league";
    rows.push({ season_id: seasonId, scope_type: type, scope_ref_id: id, is_excluded: true });
  }

  if (rows.length) await insert(s, "season_scopes", rows);
}

const dedupe = (xs?: string[]) => [...new Set((xs ?? []).filter(Boolean))];

/** The defaults starting point: full slate from the ACTIVE game catalog, an even
 *  theme mix across the Theaters, and the 30/50/20 difficulty split. */
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

  const catalog = await fetchJson<{ id: string; sort_order: number; retired_on: string | null; is_active: boolean }[]>(
    s, `game_catalog?select=id,sort_order,retired_on,is_active&order=sort_order.asc`
  );
  const live = (catalog ?? []).filter((g) => g.is_active && !g.retired_on);

  if (live.length)
    await insert(
      s,
      "season_games",
      live.map((g) => ({ season_config_id: configId, game_id: g.id, is_enabled: true, weight: 1, sort_order: g.sort_order }))
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

  const [games, theme, difficulty] = await Promise.all([
    fetchJson<SeasonGameRow[]>(s, `season_games?season_config_id=eq.${source.id}&select=*`),
    fetchJson<ThemeMixRow[]>(s, `season_theme_mix?season_config_id=eq.${source.id}&select=*`),
    fetchJson<DifficultyMixRow[]>(s, `season_difficulty_mix?season_config_id=eq.${source.id}&select=*`),
  ]);

  if (games?.length)
    await insert(
      s,
      "season_games",
      games.map((g) => ({
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
  scope?: WizardScope;
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

  // 1. the config row itself
  if (payload.config) {
    const clean = sanitizeConfigPatch(payload.config);
    if (Object.keys(clean).length) {
      const res = await patch(s, "season_config", `id=eq.${configId}`, clean);
      if (!res) return err(400, "Saving the configuration failed — no changes were written.");
    }
  }

  // 2..4. children: replace the set, never partial-write a mix (spec §3).
  if (payload.games) {
    const rows = payload.games
      .map((g) => normalizeGameRow(configId, g))
      .filter((g): g is Record<string, unknown> => g !== null);
    await del(s, "season_games", `season_config_id=eq.${configId}`);
    if (rows.length) {
      const res = await insert(s, "season_games", rows);
      if (!res) return err(400, "Saving the game slate failed. Reload before editing further — the slate may be incomplete.");
    }
  }

  if (payload.themeMix) {
    const rows = payload.themeMix
      .map((t) => normalizeThemeRow(configId, t))
      .filter((t): t is Record<string, unknown> => t !== null);
    await del(s, "season_theme_mix", `season_config_id=eq.${configId}`);
    if (rows.length) {
      const res = await insert(s, "season_theme_mix", rows);
      if (!res) return err(400, "Saving the theme mix failed. Reload before editing further.");
    }
  }

  if (payload.difficultyMix) {
    const rows = payload.difficultyMix
      .map((d) => normalizeDifficultyRow(configId, d))
      .filter((d): d is Record<string, unknown> => d !== null);
    await del(s, "season_difficulty_mix", `season_config_id=eq.${configId}`);
    if (rows.length) {
      const res = await insert(s, "season_difficulty_mix", rows);
      if (!res) return err(400, "Saving the difficulty mix failed. Reload before editing further.");
    }
  }

  // 5. scope (lives on the season, edited from Section B)
  if (payload.scope) await writeScopeRows(s, bundle.config.season_id, payload.scope);

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
    data: { fingerprint: after?.fingerprint ?? null, findings: after?.findings ?? [] },
  };
}

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

const SEASON_FIELDS = [
  "name", "starts_on", "ends_on", "status", "tz",
  "free_agency_start", "free_agency_notice_start",
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

  // Editing the WINDOW of a locked season is refused for the same reason config
  // edits are; lock/unlock itself is obviously still allowed.
  if (before.locked_at && !input.op)
    return err(423, "This season is locked. Unlock it before editing its details.");

  if (body.starts_on && body.ends_on && String(body.ends_on) <= String(body.starts_on))
    return err(422, "The end date must be after the start date.");

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

export async function updateSeasonScope(
  s: Svc,
  staffEmail: string,
  seasonId: string,
  scope: WizardScope,
  reason: string
): Promise<WriteResult> {
  const locked = await assertSeasonUnlocked(s, seasonId);
  if (locked) return locked;

  const before = await fetchJson<unknown[]>(s, `season_scopes?season_id=eq.${seasonId}&select=*`);
  await writeScopeRows(s, seasonId, scope);
  const after = await fetchJson<unknown[]>(s, `season_scopes?season_id=eq.${seasonId}&select=*`);

  await writeAudit(s, {
    staff_email: staffEmail,
    action: "season.scope_update",
    reason,
    target_type: "season",
    target_id: seasonId,
    before,
    after,
    reversible: false,
  });

  return { ok: true, message: "Scope updated — logged to Audit Log." };
}

export { bundleFingerprint };
