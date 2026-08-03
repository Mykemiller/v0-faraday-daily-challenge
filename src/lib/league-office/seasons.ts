// League Office — Season Config readers (server-only).
//
// Same contract as data.ts: every export takes an already-verified Svc (see
// requireStaff) and returns plain, typed, view-ready objects. Reads are live
// (no-store) against ycadmmngkdhvpcsrcuaq.
//
// Schema note (verified against the live DB, do not "fix" from memory):
//   season_config      — versioned, effective-dated; ONE state='active' per
//                        season is enforced by a unique partial index.
//   season_games       — slate, FK game_catalog. Render from the CATALOG, never
//                        from a hardcoded list of seven.
//   season_theme_mix   — theater_id [+ sector_code/thread_code] allocation.
//   season_difficulty_mix — band allocation, optionally per game.
//   season_scopes      — platform (ref null = ALL) | league | conference.

import { q, type Svc } from "./service";
import { type Season } from "./data";
import {
  configFingerprint, type ConfigState, type Finding,
} from "./season-config-logic";
import {
  ASSIGNABLE_LIFECYCLE_STATES, type LifecycleState,
} from "./game-library-logic";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

// ── row types ────────────────────────────────────────────────────────────────

export type GameCatalogRow = {
  id: string;
  game_key: string;
  display_name: string;
  short_code: string | null;
  description: string | null;
  category: string | null;
  is_active: boolean;
  is_beta: boolean;
  default_points: number;
  supports_hints: boolean;
  max_hints: number;
  min_difficulty: string | null;
  max_difficulty: string | null;
  sort_order: number;
  launched_on: string | null;
  retired_on: string | null;
  lifecycle_state: LifecycleState;
};

export type SeasonConfigRow = {
  id: string;
  season_id: string;
  version: number;
  state: ConfigState;
  effective_from: string;
  effective_to: string | null;
  label: string | null;
  notes: string | null;
  max_teams_per_subscriber: number;
  min_team_size: number;
  max_team_size: number | null;
  allow_free_agency: boolean;
  allow_late_join: boolean;
  allow_mid_season_team_switch: boolean;
  registration_opens_on: string | null;
  registration_closes_on: string | null;
  roster_lock_on: string | null;
  games_per_day: number | null;
  play_days_of_week: number[];
  hints_enabled: boolean;
  max_hints_per_game: number;
  hint_penalty_pct: number;
  late_submission_grace_hours: number;
  scoring_profile: string;
  signals_per_correct: number;
  streak_bonus_enabled: boolean;
  drop_lowest_n_days: number;
  team_score_method: string;
  team_score_top_n: number | null;
  difficulty_curve: string;
  target_solve_rate_pct: number | null;
  publish_leaderboard: boolean;
  leaderboard_visibility: string;
  publish_standings_at: string | null;
  extras: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  applied_at: string | null;
};

export type SeasonGameRow = {
  id: string;
  season_config_id: string;
  game_id: string;
  is_enabled: boolean;
  weight: number;
  points_override: number | null;
  difficulty_floor: string | null;
  difficulty_ceiling: string | null;
  appears_on_days: number[] | null;
  starts_on: string | null;
  ends_on: string | null;
  sort_order: number;
  notes: string | null;
};

export type ThemeMixRow = {
  id: string;
  season_config_id: string;
  theater_id: string;
  sector_code: string | null;
  thread_code: string | null;
  target_pct: number;
  min_pct: number | null;
  max_pct: number | null;
  is_excluded: boolean;
  notes: string | null;
};

export type DifficultyMixRow = {
  id: string;
  season_config_id: string;
  difficulty_band: string;
  target_pct: number;
  min_pct: number | null;
  max_pct: number | null;
  applies_to_game_id: string | null;
};

/** CC-LO-SEASON-SCOPE-1.0: `team` joined the enum so the one exclusion the
 *  commissioner actually reached for — three TEAMS — can be expressed. */
export type ScopeRefType = "platform" | "league" | "conference" | "team";

export type ScopeRow = {
  id: string;
  season_id: string;
  scope_type: ScopeRefType;
  scope_ref_id: string | null;
  is_excluded: boolean;
};

export type ConferenceRow = {
  id: string;
  code: string;
  name: string;
  league_id: string | null;
  is_active: boolean;
  archived_at: string | null;
};

const CONFIG_COLS = "*";

// ── primitive loads ──────────────────────────────────────────────────────────

const ASSIGNABLE_FILTER = `lifecycle_state=in.(${ASSIGNABLE_LIFECYCLE_STATES.join(",")})`;

/** THE season-slate catalog read. Filtered to assignable games, because every
 *  caller feeds a surface that ends in a `season_games` row: the editor's slate,
 *  the seasons index counts, the version diff, and `/api/lo/game-catalog`.
 *
 *  Still fully catalog-driven — promoting a game to live or in_test makes it
 *  appear here with no code change, and demoting it removes it. The Game Library
 *  console reads the WHOLE catalog through its own loader (game-library.ts); it
 *  is the surface that is supposed to show new_idea concepts. */
export const loadGameCatalog = (s: Svc) =>
  q<GameCatalogRow>(s, `game_catalog?${ASSIGNABLE_FILTER}&select=*&order=sort_order.asc`);

export const loadConfigs = (s: Svc, seasonId: string) =>
  q<SeasonConfigRow>(
    s,
    `season_config?season_id=eq.${seasonId}&select=${CONFIG_COLS}&order=version.asc`
  );

export const loadScopes = (s: Svc, seasonId: string) =>
  q<ScopeRow>(s, `season_scopes?season_id=eq.${seasonId}&select=*`);

export const loadConferences = (s: Svc) =>
  q<ConferenceRow>(s, `conferences?select=*&order=name.asc`);

/** Part B: leagues are the REAL `leagues` table rows (the old teams-as-leagues
 *  reading is retired along with teams.parent_id). */
export const loadLeagues = (s: Svc) =>
  q<{ id: string; code: string; name: string }>(
    s,
    `leagues?archived_at=is.null&select=id,code,name&order=name.asc`
  );

// ── RPC helper ───────────────────────────────────────────────────────────────

/** POST to a PostgREST RPC. Returns null on any failure (with the upstream
 *  message when there is one) so callers can degrade rather than throw.
 *
 *  `code` is the raw SQLSTATE. It is carried because the SQLSTATE — not string
 *  matching on the message — is what lets a caller tell a lifecycle refusal
 *  (23514) from a locked season (55P03) from anything else. */
export async function rpc<T = unknown>(
  s: Svc,
  name: string,
  args: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; message: string; code: string | null }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { ...s.headers, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const body = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
      const msg =
        (body.message !== undefined && String(body.message)) || `${name} failed (${r.status}).`;
      return {
        ok: false,
        message: msg,
        code: body.code === undefined || body.code === null ? null : String(body.code),
      };
    }
    return { ok: true, data: j as T };
  } catch {
    return { ok: false, message: `${name} failed — network error.`, code: null };
  }
}

/** THE authority on whether a config may be promoted. Errors block; warnings
 *  are shown and allowed (spec §4). */
export async function validateConfig(s: Svc, configId: string): Promise<Finding[]> {
  const r = await rpc<Finding[]>(s, "season_config_validate", { p_config_id: configId });
  if (!r.ok || !Array.isArray(r.data)) return [];
  return r.data.filter((f) => f && (f.severity === "error" || f.severity === "warning"));
}

// ── the config bundle (what the editor loads) ────────────────────────────────

export type ConfigBundle = {
  config: SeasonConfigRow;
  season: Season | null;
  games: SeasonGameRow[];
  catalog: GameCatalogRow[];
  themeMix: ThemeMixRow[];
  difficultyMix: DifficultyMixRow[];
  scopes: ScopeRow[];
  findings: Finding[];
  /** Optimistic-concurrency token — see season-config-logic.configFingerprint.
   *  Covers the children, which a row `updated_at` could not. */
  fingerprint: string;
};

export async function getConfigBundle(s: Svc, configId: string): Promise<ConfigBundle | null> {
  const configs = await q<SeasonConfigRow>(
    s,
    `season_config?id=eq.${configId}&select=${CONFIG_COLS}&limit=1`
  );
  const config = configs[0];
  if (!config) return null;

  const [games, catalog, themeMix, difficultyMix, seasons, scopes, findings] = await Promise.all([
    q<SeasonGameRow>(s, `season_games?season_config_id=eq.${configId}&select=*&order=sort_order.asc`),
    loadGameCatalog(s),
    q<ThemeMixRow>(s, `season_theme_mix?season_config_id=eq.${configId}&select=*`),
    q<DifficultyMixRow>(s, `season_difficulty_mix?season_config_id=eq.${configId}&select=*`),
    q<Season>(s, `seasons?id=eq.${config.season_id}&select=*&limit=1`),
    loadScopes(s, config.season_id),
    validateConfig(s, configId),
  ]);

  return {
    config,
    season: seasons[0] ?? null,
    games,
    catalog,
    themeMix,
    difficultyMix,
    scopes,
    findings,
    fingerprint: bundleFingerprint(config, games, themeMix, difficultyMix),
  };
}

/** The single place the concurrency token is derived, so the reader and the
 *  writer's re-check can never drift apart. */
export function bundleFingerprint(
  config: Record<string, unknown>,
  games: Record<string, unknown>[],
  themeMix: Record<string, unknown>[],
  difficultyMix: Record<string, unknown>[]
): string {
  return configFingerprint({ config, games, themeMix, difficultyMix });
}

// ── season index summary ─────────────────────────────────────────────────────

export type ScopeSummary = {
  label: string;
  isPlatform: boolean;
  included: string[];
  excluded: string[];
};

export type SeasonSummary = {
  season: Season;
  scope: ScopeSummary;
  configs: SeasonConfigRow[];
  /** The version in force now (state='active'), if any. */
  activeConfig: SeasonConfigRow | null;
  /** The next future version waiting to apply, if any. */
  scheduledConfig: SeasonConfigRow | null;
  enabledGames: number;
  totalGames: number;
  warnings: number;
  errors: number;
};

/** The Seasons index: every season with its scope, config state and slate size.
 *  Loads the small dimension tables whole and joins in memory (same approach as
 *  data.ts — at 4 seasons / 7 games this is one round of small reads). */
export async function listSeasonSummaries(s: Svc): Promise<SeasonSummary[]> {
  const [seasons, catalog, allConfigs, allScopes, leagues, conferences] = await Promise.all([
    q<Season>(s, `seasons?select=*&order=starts_on.desc`),
    loadGameCatalog(s),
    q<SeasonConfigRow>(s, `season_config?select=${CONFIG_COLS}&order=version.asc`),
    q<ScopeRow>(s, `season_scopes?select=*`),
    loadLeagues(s),
    loadConferences(s),
  ]);

  const nameById = new Map<string, string>();
  for (const l of leagues) nameById.set(l.id, l.name);
  for (const c of conferences) nameById.set(c.id, c.name);

  // Enabled-game counts for the configs that matter (active, else latest).
  const focusIds = new Set<string>();
  const byseason = new Map<string, SeasonConfigRow[]>();
  for (const c of allConfigs) {
    const list = byseason.get(c.season_id) ?? [];
    list.push(c);
    byseason.set(c.season_id, list);
  }
  for (const [, list] of byseason) {
    const focus = pickFocusConfig(list);
    if (focus) focusIds.add(focus.id);
  }

  const [gameRows, findingsByConfig] = await Promise.all([
    focusIds.size
      ? q<{ season_config_id: string; is_enabled: boolean }>(
          s,
          `season_games?season_config_id=in.(${[...focusIds].join(",")})&select=season_config_id,is_enabled`
        )
      : Promise.resolve([]),
    // Validation is per-config; at this scale a handful of parallel RPCs is
    // cheaper than materializing a bespoke aggregate view.
    Promise.all(
      [...focusIds].map(async (id) => [id, await validateConfig(s, id)] as const)
    ).then((pairs) => new Map(pairs)),
  ]);

  const enabledByConfig = new Map<string, { enabled: number; total: number }>();
  for (const g of gameRows) {
    const cur = enabledByConfig.get(g.season_config_id) ?? { enabled: 0, total: 0 };
    cur.total++;
    if (g.is_enabled) cur.enabled++;
    enabledByConfig.set(g.season_config_id, cur);
  }

  return seasons.map((season) => {
    const configs = (byseason.get(season.id) ?? []).slice().sort((a, b) => a.version - b.version);
    const activeConfig = configs.find((c) => c.state === "active") ?? null;
    const scheduledConfig =
      configs.filter((c) => c.state === "scheduled").sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0] ?? null;
    const focus = pickFocusConfig(configs);
    const counts = focus ? enabledByConfig.get(focus.id) : undefined;
    const findings = focus ? findingsByConfig.get(focus.id) ?? [] : [];

    return {
      season,
      scope: summarizeScopes(allScopes.filter((sc) => sc.season_id === season.id), nameById),
      configs,
      activeConfig,
      scheduledConfig,
      enabledGames: counts?.enabled ?? 0,
      totalGames: counts?.total ?? catalog.length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      errors: findings.filter((f) => f.severity === "error").length,
    };
  });
}

/** The config a season's summary should describe: the live one, else the next
 *  scheduled, else the newest draft. */
export function pickFocusConfig(configs: SeasonConfigRow[]): SeasonConfigRow | null {
  if (!configs.length) return null;
  return (
    configs.find((c) => c.state === "active") ??
    configs.filter((c) => c.state === "scheduled").sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0] ??
    configs.filter((c) => c.state === "draft").sort((a, b) => b.version - a.version)[0] ??
    configs[configs.length - 1]
  );
}

export function summarizeScopes(
  scopes: ScopeRow[],
  nameById: Map<string, string>
): ScopeSummary {
  const included = scopes.filter((s) => !s.is_excluded);
  const excluded = scopes.filter((s) => s.is_excluded);
  const isPlatform = included.some((s) => s.scope_type === "platform");

  const label = (rows: ScopeRow[]) =>
    rows.map((r) => (r.scope_ref_id ? nameById.get(r.scope_ref_id) ?? "Unknown" : "All Leagues"));

  const inc = label(included);
  return {
    isPlatform,
    included: inc,
    excluded: label(excluded),
    label: isPlatform ? "All Leagues" : inc.length ? inc.join(", ") : "No scope set",
  };
}

// ── season detail ────────────────────────────────────────────────────────────

export type SeasonConfigDetail = {
  season: Season | null;
  configs: SeasonConfigRow[];
  scopes: ScopeRow[];
  scope: ScopeSummary;
  /** `v_season_effective_config` — the values in force RIGHT NOW. Runtime read
   *  only; the editor never sources from this view. */
  effective: Record<string, unknown> | null;
  catalog: GameCatalogRow[];
  /** Slate rows keyed by config id, for the version diff. */
  gamesByConfig: Record<string, SeasonGameRow[]>;
};

export async function getSeasonConfigDetail(s: Svc, seasonId: string): Promise<SeasonConfigDetail> {
  const [seasons, configs, scopes, effective, catalog, leagues, conferences] = await Promise.all([
    q<Season>(s, `seasons?id=eq.${seasonId}&select=*&limit=1`),
    loadConfigs(s, seasonId),
    loadScopes(s, seasonId),
    q<Record<string, unknown>>(s, `v_season_effective_config?season_id=eq.${seasonId}&select=*&limit=1`),
    loadGameCatalog(s),
    loadLeagues(s),
    loadConferences(s),
  ]);

  const ids = configs.map((c) => c.id);
  const games = ids.length
    ? await q<SeasonGameRow>(
        s,
        `season_games?season_config_id=in.(${ids.join(",")})&select=*&order=sort_order.asc`
      )
    : [];

  const gamesByConfig: Record<string, SeasonGameRow[]> = {};
  for (const g of games) (gamesByConfig[g.season_config_id] ||= []).push(g);

  const nameById = new Map<string, string>();
  for (const l of leagues) nameById.set(l.id, l.name);
  for (const c of conferences) nameById.set(c.id, c.name);

  return {
    season: seasons[0] ?? null,
    configs,
    scopes,
    scope: summarizeScopes(scopes, nameById),
    effective: effective[0] ?? null,
    catalog,
    gamesByConfig,
  };
}

// ── scope options + resolution ───────────────────────────────────────────────

export type ScopeOptions = {
  leagues: { id: string; name: string; code: string }[];
  conferences: { id: string; name: string; code: string; league_id: string | null }[];
  /** Exclusion-only. Teams are never offered as an INCLUDE — a season is scoped
   *  by league or conference, and named teams are how you carve one out. */
  teams: { id: string; name: string; code: string; league_id: string | null; conference_id: string | null }[];
};

/** Every option is a live id read straight from `leagues` / `conferences` /
 *  `teams`, filtered to the not-archived rows. This is what makes the dangling
 *  ref structurally impossible: before Part B this read `teams?parent_id=is.null`
 *  and called the results "leagues", which is how a top-level team id
 *  (6346a188-…) ended up stored as a `league` scope and then orphaned when Part
 *  B deleted the row. */
export async function getScopeOptions(s: Svc): Promise<ScopeOptions> {
  const [leagues, conferences, teams] = await Promise.all([
    loadLeagues(s),
    loadConferences(s),
    q<{ id: string; name: string; code: string; league_id: string | null; conference_id: string | null }>(
      s,
      `teams?is_active=eq.true&archived_at=is.null&select=id,name,code,league_id,conference_id&order=name.asc`
    ),
  ]);
  return {
    leagues,
    conferences: conferences
      .filter((c) => c.is_active && !c.archived_at)
      .map((c) => ({ id: c.id, name: c.name, code: c.code, league_id: c.league_id })),
    teams,
  };
}

/** The resolved scope for a season, straight from the database. Replaces the
 *  hand-rolled `resolveScopeTeamCount`, which reimplemented resolution in
 *  TypeScript against `teams.conference_id` only — it had no idea conference
 *  membership is per-season, so it disagreed with the engine for any team that
 *  changed conference between seasons. One implementation, in SQL. */
export async function getScopeSummary(s: Svc, seasonId: string): Promise<ScopeResolution | null> {
  const r = await rpc<ScopeResolution>(s, "fn_season_scope_summary", { p_season_id: seasonId });
  return r.ok ? r.data : null;
}

/** What WOULD this rule set resolve to — no write. `seasonId` is null in the
 *  create wizard, where no season row exists yet. */
export async function previewScope(
  s: Svc,
  seasonId: string | null,
  scopes: Record<string, unknown>[]
): Promise<ScopeResolution | null> {
  const r = await rpc<ScopeResolution>(s, "fn_season_scope_preview", {
    p_season_id: seasonId,
    p_scopes: scopes,
  });
  return r.ok ? r.data : null;
}

export type ScopeResolution = {
  season_id: string | null;
  mode: string;
  included: { type: ScopeRefType; id: string | null; name: string | null }[];
  excluded: { type: ScopeRefType; id: string | null; name: string | null }[];
  league_count: number;
  conference_count: number;
  team_count: number;
  teams: { id: string; name: string }[];
};

// ── theme taxonomy (Theater → Sector → Thread) ───────────────────────────────

export type ThemeSector = { code: string; name: string; threads: { code: string; name: string }[] };
export type ThemeTheater = { theater_id: string; theater_name: string; sectors: ThemeSector[] };

/** The live Theater → Sector → Thread tree, derived from `dc_daily_theme` — the
 *  only place these public labels actually exist. Section D's expand caret
 *  allocates within whatever this returns; nothing is invented client-side, and
 *  IDF D-codes are never surfaced (repo-wide rule: public labels only). */
export async function loadThemeTaxonomy(s: Svc): Promise<ThemeTheater[]> {
  const rows = await q<{
    theater_id: string;
    theater_name: string | null;
    sector_code: string | null;
    sector_name: string | null;
    thread_codes: string[] | null;
    thread_names: string[] | null;
  }>(
    s,
    `dc_daily_theme?select=theater_id,theater_name,sector_code,sector_name,thread_codes,thread_names&order=theater_id.asc&limit=2000`
  );

  const theaters = new Map<string, { name: string; sectors: Map<string, ThemeSector> }>();

  for (const r of rows) {
    if (!r.theater_id) continue;
    const t = theaters.get(r.theater_id) ?? { name: r.theater_name ?? r.theater_id, sectors: new Map() };
    if (r.theater_name && t.name === r.theater_id) t.name = r.theater_name;

    if (r.sector_code) {
      const sector: ThemeSector = t.sectors.get(r.sector_code) ?? {
        code: r.sector_code,
        name: r.sector_name ?? r.sector_code,
        threads: [],
      };
      const seen = new Set(sector.threads.map((x) => x.code));
      const codes = r.thread_codes ?? [];
      const names = r.thread_names ?? [];
      codes.forEach((code, i) => {
        if (code && !seen.has(code)) {
          seen.add(code);
          sector.threads.push({ code, name: names[i] ?? code });
        }
      });
      t.sectors.set(r.sector_code, sector);
    }
    theaters.set(r.theater_id, t);
  }

  return [...theaters.entries()]
    .map(([theater_id, t]) => ({
      theater_id,
      theater_name: t.name,
      sectors: [...t.sectors.values()].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.theater_id.localeCompare(b.theater_id));
}

/** Raw membership rows for a season — feeds countOverCap() when the
 *  max_teams_per_subscriber cap is being reduced. */
export const loadSeasonMemberships = (s: Svc, seasonId: string) =>
  q<{ subscriber_id: string }>(
    s,
    `team_memberships?season_id=eq.${seasonId}&pending=eq.false&select=subscriber_id`
  );
