// League Office — CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0: is this setting a RULE?
//
// The Season Configurator writes 31 config columns and 10 slate columns. Some
// of them decide what the platform does; the rest are, today, notes the
// database happens to store in a typed column. Nothing on the surface told the
// commissioner which was which, so a season could be "configured" to drop its
// lowest two days and publish standings on a date, and neither would happen,
// and nobody would learn that until someone audited the scores.
//
// This module is the single answer to "is this field a rule yet?". It is PURE
// data plus three total functions, so the editor, the season detail page, the
// generation confirm modal and the guard test all read the SAME classification
// — and D3's test makes it impossible to add a column to the sanitize
// whitelist without classifying it.
//
// THE RULE THIS PACK ESTABLISHES, repeated in CLAUDE.md: wiring a field up is
// not done until its entry here flips, IN THE SAME PR. A field that became
// enforced while this table still says otherwise is worse than no table.
//
// `by` names the reader, so the claim is checkable: open that file and the
// enforcement is there, or the entry is wrong.
//
// Tests: `npm run test:config-enforcement`.

import { CONFIG_FIELDS, fieldLabel } from "./season-config-logic.ts";

export type EnforcementStatus = "enforced" | "partial" | "not_enforced";

export type EnforcementEntry = {
  status: EnforcementStatus;
  /** The reader that enforces it — a file, a DB function, or "—" for nothing. */
  by: string;
  /** One sentence the editor shows in a tooltip. Says what DOES happen. */
  note: string;
  /** Documentation, not a rule: a label or a note is never "enforced" and must
   *  never appear in the not-enforced count, or the count is all noise. */
  descriptive?: true;
};

/** `season_games` columns the editor writes — the whitelist in
 *  season-write.ts `normalizeGameRow`, minus the two key columns. The guard
 *  test asserts this list still matches that function. */
export const SLATE_FIELDS = [
  "is_enabled", "weight", "points_override",
  "difficulty_floor", "difficulty_ceiling",
  "appears_on_days", "starts_on", "ends_on",
  "sort_order", "notes",
] as const;

/** Slate and mix entries are namespaced so `notes` (which exists on both
 *  season_config and season_games) cannot collide. */
export const SLATE_PREFIX = "season_games.";

export const CONFIG_ENFORCEMENT: Record<string, EnforcementEntry> = {
  // ── effective dating ───────────────────────────────────────────────────────
  effective_from: {
    status: "enforced",
    by: "v_season_effective_config · season_config_promote · /api/cron/season-config-apply",
    note: "Decides which version is in force: the view picks the latest version whose effective_from has passed, and the cron promotes a scheduled version when it arrives.",
  },
  effective_to: {
    status: "enforced",
    by: "v_season_effective_config · season_config_promote",
    note: "Closes a version. The effective-config view ignores any version whose effective_to has passed, so superseding a config really does stop it applying.",
  },
  label: {
    status: "not_enforced", descriptive: true,
    by: "—",
    note: "Names this version in the League Office version list. Descriptive by design.",
  },
  notes: {
    status: "not_enforced", descriptive: true,
    by: "—",
    note: "Commissioner's note on this version. Descriptive by design.",
  },

  // ── rosters ────────────────────────────────────────────────────────────────
  max_teams_per_subscriber: {
    status: "enforced",
    by: "/api/teams · seasons/team-rules.ts · team_join (DB)",
    note: "A join is refused once a player holds this many teams this season. Lowering it never removes a membership — a player already above it keeps their teams but cannot add another.",
  },
  min_team_size: {
    status: "not_enforced",
    by: "—",
    note: "No join, lock or scoring path reads it — a team below this size is never flagged and never blocked.",
  },
  max_team_size: {
    status: "enforced",
    by: "/api/teams · seasons/team-rules.ts · team_join (DB)",
    note: "A join into a team already holding this many distinct confirmed members this season is refused with team_full. Empty means unlimited.",
  },
  allow_free_agency: {
    status: "enforced",
    by: "fn_season_roster_move_block · league-playoffs/phase.ts canRosterMove",
    note: "Off removes the free-agency window from the set of windows a roster move may happen in, in the database and in the UI alike.",
  },
  allow_late_join: {
    status: "enforced",
    by: "team_join (DB) · fn_season_roster_move_block · league-playoffs/phase.ts",
    note: "Off blocks a first join after the late-join deadline. This is the one rule a first join answers to.",
  },
  allow_mid_season_team_switch: {
    status: "enforced",
    by: "fn_season_roster_move_block · league-playoffs/phase.ts · /free-agency",
    note: "Off is a hard stop on switching teams mid-season, enforced in the database and reflected on the free-agency page.",
  },
  registration_opens_on: {
    status: "not_enforced",
    by: "—",
    note: "Nothing reads it: registration is not gated on this date, and joining before it is neither blocked nor flagged. Use registration_closes_on, which is.",
  },
  registration_closes_on: {
    status: "enforced",
    by: "fn_season_roster_move_block · league-playoffs/phase.ts lateJoinDeadline",
    note: "The date after which a first join counts as late and answers to allow_late_join.",
  },
  roster_lock_on: {
    status: "enforced",
    by: "fn_season_roster_move_block · league-playoffs/phase.ts · /free-agency",
    note: "On and after this date every roster move is refused — one-way, and enforced in the database.",
  },

  // ── calendar ───────────────────────────────────────────────────────────────
  games_per_day: {
    status: "enforced",
    by: "generation-logic.ts §5b overScheduledDates (blocking)",
    note: "Generation is blocked, by date, when the slate schedules more games on a day than this allows. It is a cap you must resolve, never a silent drop of a game.",
  },
  play_days_of_week: {
    status: "enforced",
    by: "seasons/schedule.ts · generation/worker.ts · season-slate-server.ts resolveSeasonSchedule",
    note: "Puzzles are generated only for these weekdays, and /api/challenge/today serves nothing on a day outside the mask.",
  },

  // ── hints ──────────────────────────────────────────────────────────────────
  hints_enabled: {
    status: "enforced",
    by: "seasons/hint-rules.ts · /api/challenge/today rules.hintsEnabled · DailyChallenge HintControl · /challenge/hints",
    note: "Off hides the in-game Hint button and the Hints Today entries, both replaced by a one-line note.",
  },
  max_hints_per_game: {
    status: "enforced",
    by: "seasons/hint-rules.ts · /api/challenge/today rules.maxHints · DailyChallenge HintControl · /challenge/hints",
    note: "The daily hint budget per game, capped at the 3 hint tiers the puzzle bank stores — a higher number still serves 3.",
  },
  hint_penalty_pct: {
    status: "enforced",
    by: "scoring/season-scoring.ts seasonScore · /api/score",
    note: "Each hint revealed costs this much of the game's score, capped at 100%. Applied on the server when the completion is written, and shown on the score card.",
  },
  late_submission_grace_hours: {
    status: "not_enforced",
    by: "—",
    note: "There is no late-submission path to grant grace on — a day's games close at midnight CT regardless.",
  },

  // ── scoring ────────────────────────────────────────────────────────────────
  scoring_profile: {
    status: "not_enforced",
    by: "—",
    note: "No scoring path branches on the profile name; every season scores on the one standard path.",
  },
  signals_per_correct: {
    status: "not_enforced",
    by: "—",
    note: "Signal awards are not driven by this column.",
  },
  streak_bonus_enabled: {
    status: "enforced",
    by: "DailyChallenge.jsx calcScore (client, via /api/challenge/today rules.scoring)",
    note: "Off removes the Intelligence Readiness multiplier from the score. Enforced in the client, because the multiplier is folded into the raw score before the server ever sees it — a stale cached client keeps its multiplier until it reloads.",
  },
  drop_lowest_n_days: {
    status: "not_enforced",
    by: "—",
    note: "No standings or leaderboard read drops any day; every day a player scored still counts.",
  },
  team_score_method: {
    status: "not_enforced",
    by: "—",
    note: "Team totals are not computed from this column; only the editor's own validation reads it (top_n requires an N).",
  },
  team_score_top_n: {
    status: "not_enforced",
    by: "—",
    note: "Required by validation when the method is Top N, and read by nothing that computes a team score.",
  },

  // ── generation ─────────────────────────────────────────────────────────────
  difficulty_curve: {
    status: "enforced",
    by: "generation/difficulty.js curvePoints · generation/worker.ts",
    note: "The generator places the season's difficulty bands along this shape — the same curve the editor's sparkline draws.",
  },
  target_solve_rate_pct: {
    status: "not_enforced",
    by: "—",
    note: "Nothing targets it: generation does not tune difficulty to a solve rate, and no report measures against it.",
  },

  // ── publication ────────────────────────────────────────────────────────────
  publish_leaderboard: {
    status: "not_enforced",
    by: "—",
    note: "The leaderboard renders whatever this says — no read path is gated on it.",
  },
  leaderboard_visibility: {
    status: "not_enforced",
    by: "—",
    note: "Leaderboard reads are not scoped by this value; a 'private' season's leaderboard is as visible as a public one.",
  },
  publish_standings_at: {
    status: "not_enforced",
    by: "—",
    note: "Standings are not withheld until this moment — nothing reads the date.",
  },
  extras: {
    status: "not_enforced",
    by: "—",
    note: "A free-form bag for values with nowhere else to live. By definition nothing reads it.",
  },

  // ── slate (season_games) ───────────────────────────────────────────────────
  "season_games.is_enabled": {
    status: "enforced",
    by: "generation-logic.ts · season-slate-server.ts resolveSeasonSlate · season-slate.ts filterToSlate",
    note: "Only enabled games are generated, and /api/challenge/today serves only enabled games — a disabled game loses its tile.",
  },
  "season_games.weight": {
    status: "not_enforced",
    by: "—",
    note: "Nothing weights anything by it: generation allocates per the difficulty and theme mixes, and scoring uses points_override.",
  },
  "season_games.points_override": {
    status: "enforced",
    by: "scoring/season-scoring.ts seasonScore · /api/score",
    note: "This game's score ceiling for the season, in place of the platform's 150. Applied on the server when the completion is written, and shown on the score card.",
  },
  "season_games.difficulty_floor": {
    status: "enforced",
    by: "generation/difficulty.js effectiveTypeMix · generation-logic.ts §6b · generation/worker.ts",
    note: "The generator never produces a puzzle below this band for this game, and a floor above the ceiling blocks generation rather than failing mid-run.",
  },
  "season_games.difficulty_ceiling": {
    status: "enforced",
    by: "generation/difficulty.js effectiveTypeMix · generation-logic.ts §6b · generation/worker.ts",
    note: "The generator never produces a puzzle above this band for this game.",
  },
  "season_games.appears_on_days": {
    status: "enforced",
    by: "seasons/schedule.ts isScheduled · generation/worker.ts · season-slate-server.ts",
    note: "Narrows this game to these weekdays inside the season's play days — honoured by generation and by what is served each day.",
  },
  "season_games.starts_on": {
    status: "enforced",
    by: "seasons/schedule.ts isScheduled · generation/worker.ts · season-slate-server.ts",
    note: "This game is not generated or served before this date.",
  },
  "season_games.ends_on": {
    status: "enforced",
    by: "seasons/schedule.ts isScheduled · generation/worker.ts · season-slate-server.ts",
    note: "This game is not generated or served after this date.",
  },
  "season_games.sort_order": {
    status: "not_enforced",
    by: "—",
    note: "Orders this table in the League Office. The lobby orders its tiles its own way, so this changes nothing a player sees.",
  },
  "season_games.notes": {
    status: "not_enforced", descriptive: true,
    by: "—",
    note: "Commissioner's note on this game's row. Descriptive by design.",
  },

  // ── mixes (their own tables; listed so the Configurator can speak for the
  //    whole page rather than only its two flat tables) ───────────────────────
  "season_theme_mix.target_pct": {
    status: "enforced",
    by: "generation/theme-allocation.js allocateThemeCalendar · generation/worker.ts",
    note: "The season's theme calendar is allocated to this mix — it is no longer the corpus's own date spread with exclusions applied on top.",
  },
  "season_difficulty_mix.target_pct": {
    status: "enforced",
    by: "generation/difficulty.js effectiveTypeMix · generation/worker.ts",
    note: "Generated difficulty matches this mix, season-wide and per game, inside each game's floor/ceiling window.",
  },
};

/** Column defaults, verified against the live schema 2026-10-06. A field still
 *  sitting on its default was never "set", so saying it is not enforced is
 *  nagging about a decision nobody made. */
export const SYSTEM_DEFAULTS: Record<string, unknown> = {
  effective_to: null,
  label: null,
  notes: null,
  max_teams_per_subscriber: 1,
  min_team_size: 1,
  max_team_size: null,
  allow_free_agency: true,
  allow_late_join: true,
  allow_mid_season_team_switch: true,
  registration_opens_on: null,
  registration_closes_on: null,
  roster_lock_on: null,
  games_per_day: null,
  play_days_of_week: [1, 2, 3, 4, 5, 6, 7],
  hints_enabled: true,
  max_hints_per_game: 3,
  hint_penalty_pct: 25,
  late_submission_grace_hours: 0,
  scoring_profile: "standard",
  signals_per_correct: 1,
  streak_bonus_enabled: true,
  drop_lowest_n_days: 0,
  team_score_method: "sum",
  team_score_top_n: null,
  difficulty_curve: "flat",
  target_solve_rate_pct: null,
  publish_leaderboard: true,
  leaderboard_visibility: "public",
  publish_standings_at: null,
  extras: {},
  // slate
  "season_games.is_enabled": true,
  "season_games.weight": 1,
  "season_games.points_override": null,
  "season_games.difficulty_floor": null,
  "season_games.difficulty_ceiling": null,
  "season_games.appears_on_days": null,
  "season_games.starts_on": null,
  "season_games.ends_on": null,
  "season_games.sort_order": 100,
  "season_games.notes": null,
};

export function enforcementOf(field: string): EnforcementEntry | null {
  return CONFIG_ENFORCEMENT[field] ?? null;
}

/** The chip's text, or null for a field that needs no chip. */
export function enforcementChip(field: string): string | null {
  const e = enforcementOf(field);
  if (!e || e.status === "enforced") return null;
  return e.status === "partial" ? "Partly enforced" : "Not enforced yet";
}

export type NotEnforcedField = {
  field: string;
  label: string;
  value: unknown;
  note: string;
};

/**
 * The fields in THIS config that are saved but do nothing — and that the
 * commissioner actually set. A field still on its system default is skipped:
 * listing `scoring_profile: standard` on every season would bury the two or
 * three that are real. Descriptive fields (label, notes) are skipped outright.
 *
 * Pass a slate row's values under `season_games.`-prefixed keys to include
 * them; `notEnforcedSlateFields` below does that for you.
 */
export function notEnforcedFields(
  config: Record<string, unknown> | null | undefined
): NotEnforcedField[] {
  if (!config) return [];
  const out: NotEnforcedField[] = [];
  for (const [field, entry] of Object.entries(CONFIG_ENFORCEMENT)) {
    if (entry.status !== "not_enforced" || entry.descriptive) continue;
    if (!(field in config)) continue;
    const value = config[field];
    if (isDefaultValue(field, value)) continue;
    out.push({ field, label: fieldLabel(bareName(field)), value, note: entry.note });
  }
  return out;
}

/** The same question for one slate row, so the caller does not have to build
 *  the prefixed keys by hand. */
export function notEnforcedSlateFields(
  game: Record<string, unknown> | null | undefined
): NotEnforcedField[] {
  if (!game) return [];
  const prefixed: Record<string, unknown> = {};
  for (const col of SLATE_FIELDS) if (col in game) prefixed[SLATE_PREFIX + col] = game[col];
  return notEnforcedFields(prefixed);
}

/** "3 settings in this config are saved but not yet enforced" — the one line
 *  D5 puts on the detail page and in the generation confirm modal. Empty
 *  string when there is nothing to say, so the caller renders nothing.
 *
 *  Takes anything countable, so a caller that only has the LABELS (the
 *  generation panel is handed a resolved string[] by the server component)
 *  does not have to rebuild field objects to ask for one sentence. */
export function summarizeNotEnforced(fields: readonly unknown[]): string {
  if (!fields.length) return "";
  const n = fields.length;
  return `${n} setting${n === 1 ? " in this config is" : "s in this config are"} saved but not yet enforced`;
}

/** Strips the `season_games.` / `season_theme_mix.` namespace for display. */
export function bareName(field: string): string {
  const dot = field.indexOf(".");
  return dot === -1 ? field : field.slice(dot + 1);
}

function isDefaultValue(field: string, value: unknown): boolean {
  if (!(field in SYSTEM_DEFAULTS)) return false;
  const def = SYSTEM_DEFAULTS[field];
  // An absent value is the default by any reading.
  if (value === null || value === undefined) return def === null || def === undefined;
  if (Array.isArray(def) || Array.isArray(value)) return canonical(value) === canonical(def);
  if (typeof def === "object" || typeof value === "object") return canonical(value) === canonical(def);
  // Numerics arrive from PostgREST as strings ("10.00"); compare as numbers.
  if (typeof def === "number") return Number(value) === def;
  return value === def;
}

function canonical(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") {
    const e = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${e.map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Every key the guard test must see classified: the editor's config whitelist
 *  plus its slate whitelist, namespaced. */
export function classifiableFields(): string[] {
  return [...CONFIG_FIELDS, ...SLATE_FIELDS.map((c) => SLATE_PREFIX + c)];
}
