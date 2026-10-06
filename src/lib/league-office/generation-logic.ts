// Part D (CC-FARADAY-LEAGUE-1.0) — pure generation gating logic.
//
// THE single implementation of the GENERATABLE conditions (spec conditions 1–10),
// mapped onto the live season-config model: season_config + season_games (by
// game_id → game_catalog) + season_difficulty_mix + season_theme_mix. The UI
// never re-implements these rules — it renders exactly what this module returns.
//
// Taxonomy note: season_theme_mix rows are keyed Theater → Sector → Thread, and
// the SECTOR codes are the IDF domain codes (D1–D23) — build-calendar's relaxed
// floors name "D16"/"D18" as sectors. Spec condition 7 ("every theme_emphasis
// key is an Active domain code queried live") is therefore enforced against the
// sector_code axis, with the Active D-code set supplied by the caller from the
// live Domain Registry (fail-soft to the corpus-derived set — see
// generation-status.ts).
//
// v1 reconciliation (documented in docs/league-model/PART-D-REPORT.md): the live
// bank enforces a GLOBAL unique (puzzle_type, go_live_date) — one puzzle per game
// per day. DEC-2's "override upward for selection surplus" is not representable
// until that constraint becomes league-aware, so puzzle_count above the day
// count WARNS (and the worker generates exactly one per day); below it ERRORS.

// Relative, with the extension: generation-logic.test.ts runs under plain
// `node --test` (type stripping), which does not read tsconfig `paths`.
import { unfillableThemeQuotas } from "../generation/theme-allocation.js";
import {
  CANONICAL_BANDS, CURVE_CUSTOM_WARNING, effectiveTypeMix, mixVector, normalizeCurve,
} from "../generation/difficulty.js";
// CC-DC-GEN-SCHEDULE-FIELDS-1.0 — "which games play on which dates" has exactly
// one definition, and this file asks it rather than multiplying a day count by
// a game count. Validation, the generator and the serve path all read the same
// module; the rule itself lives in src/lib/seasons/schedule.ts.
import {
  overScheduledDates, scheduledDayCount,
  type ScheduleConfig, type ScheduleGame, type ScheduleSeason,
} from "../seasons/schedule.ts";

export type Finding = { severity: "error" | "warning"; code: string; message: string };

export type GenSeason = {
  id: string;
  league_id: string | null;
  starts_on: string | null;
  ends_on: string | null;
  playoff_starts_on: string | null;
  roster_freeze_on: string | null;
  locked_at: string | null;
  pilot_approved_at: string | null;
  generated_at: string | null;
};

export type GenCatalogGame = {
  id: string;
  game_key: string;
  display_name: string;
  lifecycle_state: string;
  runtime_key: string | null;
};

export type GenSlateGame = {
  game_id: string;
  is_enabled: boolean;
  puzzle_count: number | null;
  /**
   * CC-DC-GEN-DIFFICULTY-PERGAME-1.0 — `season_games.difficulty_floor` and
   * `.difficulty_ceiling`: the band window this game is generated inside.
   * Optional, and an absent bound is OPEN on that side, so a caller that does
   * not supply them gets exactly the pre-PERGAME behaviour.
   */
  difficulty_floor?: string | null;
  difficulty_ceiling?: string | null;
  /**
   * CC-DC-GEN-SCHEDULE-FIELDS-1.0 — `season_games.appears_on_days` (ISO
   * 1=Mon…7=Sun, null/empty ⇒ every season play day) and `.starts_on` /
   * `.ends_on` (a window inside the season; an absent bound is OPEN).
   * Optional, and absent means "plays whenever the season plays", so a caller
   * that does not supply them gets exactly the pre-SCHEDULE-FIELDS behaviour.
   */
  appears_on_days?: number[] | null;
  starts_on?: string | null;
  ends_on?: string | null;
};

export type GenThemeMixRow = {
  theater_id: string;
  sector_code: string | null;
  thread_code: string | null;
  target_pct: number;
  is_excluded: boolean;
};

export type GenDifficultyRow = {
  difficulty_band: string;
  target_pct: number;
  applies_to_game_id: string | null;
};

export type GenRun = {
  id: string;
  season_id: string | null;
  run_kind: string;
  status: string;
  target_count: number | null;
  written_count: number;
  failed_count: number;
  started_at: string;
  completed_at: string | null;
  superseded_at: string | null;
  last_heartbeat_at: string | null;
  /** jsonb — resume state + CC-DC-GEN-FAILURE-VISIBILITY-1.0 failure counts. */
  phase_cursor?: Record<string, unknown> | null;
};

/** Never a game, never accepted, never surfaced (Phase 0 item 6). */
const DEAD_GAME_PATTERN = /logo[\s_-]*match/i;

export const STALL_MINUTES = 30;
export const BANK_MINIMUM_DAYS = 14;
export const RUN_SIZE_WARN = 2000;
export const THIN_CORPUS_SECTORS = ["D16", "D18"];
export const THIN_CORPUS_WARN_PCT = 15;
/** CC-DC-GEN-DIFFICULTY-PERGAME-1.0 D3 — how far, in percentage POINTS on any
 *  one band, the per-game rules may pull the season away from the configured
 *  mix before the commissioner is told. Five points is roughly "one band moved
 *  by a sixth"; Football moves expert by 21. */
export const DIFFICULTY_SHIFT_WARN_PTS = 5;

/** Inclusive day count of a season window; null when dates are missing/invalid. */
export function seasonDayCount(startsOn: string | null, endsOn: string | null): number | null {
  if (!startsOn || !endsOn) return null;
  const a = Date.parse(startsOn + "T12:00:00Z");
  const b = Date.parse(endsOn + "T12:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Every date of the window, inclusive, as YYYY-MM-DD. */
export function seasonDates(startsOn: string, endsOn: string): string[] {
  const out: string[] = [];
  const n = seasonDayCount(startsOn, endsOn) ?? 0;
  const t = new Date(startsOn + "T12:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

export type GenerationInput = {
  season: GenSeason;
  /** Enabled/disabled slate rows of the season's focus config (empty when no config). */
  slate: GenSlateGame[];
  catalog: GenCatalogGame[];
  themeMix: GenThemeMixRow[];
  difficultyMix: GenDifficultyRow[];
  /** Live Active D-codes from the Domain Registry (or the corpus fallback). */
  activeDomainCodes: string[];
  /**
   * CC-DC-GEN-THEME-ALLOCATION-1.0 D7 — corpus theme-row counts per
   * (theater, sector): `SELECT theater_id, sector_code, count(*) FROM
   * dc_daily_theme WHERE season_id IS NULL GROUP BY 1,2`. Condition 7 uses them
   * to say BEFORE a run is queued that an included Theater/Sector carries a
   * share no corpus row can serve. Optional: when the caller does not supply
   * them the pre-flight is skipped — the worker still refuses to redistribute
   * and fails the run with `theme:unfillable:<theater>`.
   */
  corpusThemeCounts?: { theater_id: string; sector_code: string | null; count: number }[];
  /** Runs for this season that are neither completed nor superseded. */
  inflightRuns: GenRun[];
  /**
   * CC-DC-GEN-DIFFICULTY-ALLOCATION-1.0 D3 — the focus config's
   * `difficulty_curve`. The generator places the season's difficulty bands
   * along this shape, so `custom` (which has no stored shape anywhere) has to
   * be reported rather than silently flattened. Optional: a caller that does
   * not supply it simply gets no curve warning.
   */
  difficultyCurve?: string | null;
  /**
   * CC-DC-GEN-SCHEDULE-FIELDS-1.0 — the focus config's
   * `play_days_of_week` (ISO 1=Mon…7=Sun). Optional: absent ⇒ every day, which
   * is what `normalizeDayMask` makes of a null column and what every season but
   * TEST SEASON 1 is configured with (measured 2026-10-06).
   */
  playDaysOfWeek?: number[] | null;
  /**
   * CC-DC-GEN-SCHEDULE-FIELDS-1.0 D2 — the focus config's `games_per_day`.
   * A VALIDATION rule, never a selector: when more games are scheduled on a
   * day than it allows, that is `games_per_day_below_scheduled` and the run is
   * blocked. Nothing anywhere picks which game to drop.
   */
  gamesPerDay?: number | null;
};

const isHundred = (n: number) => Math.abs(n - 100) < 0.001;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ── the season calendar, as this module asks for it ─────────────────────────

const scheduleSeason = (input: GenerationInput): ScheduleSeason => ({
  starts_on: input.season.starts_on,
  ends_on: input.season.ends_on,
});

const scheduleConfig = (input: GenerationInput): ScheduleConfig => ({
  play_days_of_week: input.playDaysOfWeek ?? null,
});

/** A slate row as the schedule module reads it. Keyed by `game_id` — the
 *  identifier this file joins on; the serve path keys the same shape by
 *  `runtime_key`. */
const scheduleGame = (row: GenSlateGame): ScheduleGame => ({
  type: row.game_id,
  appears_on_days: row.appears_on_days ?? null,
  starts_on: row.starts_on ?? null,
  ends_on: row.ends_on ?? null,
});

/**
 * How many dates each ENABLED game actually plays, by `game_id`.
 *
 * THE denominator for every per-game count in this file. It replaces
 * `seasonDayCount()` in the three places that used it as a stand-in for "days
 * this game is generated on" — targets, the puzzle_count floor, and the
 * difficulty weighting — and equals it exactly when no schedule field is set.
 */
export function scheduledDaysByGame(input: GenerationInput): Map<string, number> {
  const season = scheduleSeason(input);
  const config = scheduleConfig(input);
  const out = new Map<string, number>();
  for (const r of input.slate.filter((g) => g.is_enabled))
    out.set(r.game_id, scheduledDayCount({ season, config, game: scheduleGame(r) }));
  return out;
}

/** Per-game generation targets. v1: exactly one puzzle per game per SCHEDULED
 *  day (see the header note); requested surplus is reported so the UI can show
 *  the warning.
 *
 *  CC-DC-GEN-SCHEDULE-FIELDS-1.0 — `effective` is the game's own scheduled day
 *  count, not the season's length. A Monday-only game in a 119-day season is a
 *  17-puzzle target, and the panel, the confirm modal and the worker now all
 *  say 17. `dayCount` stays the season window's length: it is what the panel
 *  labels the season with, and it is the ceiling, not the target. */
export function computeTargets(input: GenerationInput): {
  dayCount: number | null;
  perGame: { game: GenCatalogGame; requested: number; effective: number }[];
  total: number;
} {
  const dayCount = seasonDayCount(input.season.starts_on, input.season.ends_on);
  const scheduled = scheduledDaysByGame(input);
  const byId = new Map(input.catalog.map((g) => [g.id, g]));
  const perGame = input.slate
    .filter((r) => r.is_enabled)
    .flatMap((r) => {
      const game = byId.get(r.game_id);
      if (!game) return [];
      const days = scheduled.get(r.game_id) ?? 0;
      const requested = r.puzzle_count ?? days;
      return [{ game, requested, effective: days }];
    });
  return { dayCount, perGame, total: sum(perGame.map((g) => g.effective)) };
}

/**
 * CC-DC-GEN-DIFFICULTY-PERGAME-1.0 D3 — what the season's difficulty mix is
 * going to COME OUT as, once every enabled game's own override rows and its
 * [floor, ceiling] window have been applied.
 *
 * The commissioner sets one season mix and then, several sections further down
 * the same editor, sets a floor per game. Nothing told them those two
 * interact. On the Football slate they interact to the tune of 21 points:
 * expert is configured at 55.77% and lands at 77.2%, because Rackl and Dark
 * Fiber are pinned expert-expert and The Brief and The Stack have their
 * foundational share clipped away (measured 2026-10-06, config
 * 3bf84bc8-f202-4a2d-9a89-9dcc38f36711).
 *
 * `realized` is the per-game effective mixes weighted by each game's SCHEDULED
 * DAYS — which is what computeTargets() says a game generates, one puzzle per
 * day (see the module header on why surplus is not representable in v1). A
 * game whose window is empty carries no weight here; it is a blocking
 * `difficulty_window_empty` error, not a shift.
 *
 * CC-DC-GEN-SCHEDULE-FIELDS-1.0 — "scheduled days" is now literally that
 * (schedule.ts), not the season's length standing in for it. A game that plays
 * two days a week pulls the season mix a fifth as hard as one that plays
 * seven, and this is the number that says so.
 *
 * Pure, and exported so the League Office panel, the confirm modal and the
 * tests all read one number.
 */
export function realizedDifficultyMix(input: GenerationInput): {
  /** The season mix as configured, normalized, in CANONICAL_BANDS order. */
  configured: number[];
  /** What the per-game rules actually produce, same order. */
  realized: number[];
  /** The largest single-band gap between the two, in percentage points. */
  maxDeviation: number;
  perGame: { game: GenCatalogGame; days: number; mix: number[] | null }[];
} {
  const scheduled = scheduledDaysByGame(input);
  const byId = new Map(input.catalog.map((g) => [g.id, g]));
  const globalDiff = input.difficultyMix.filter((d) => !d.applies_to_game_id);
  // An open window over the season mix IS the configured mix, normalized the
  // one way the editor normalizes — no second rounding rule in this file.
  const configured = mixVector(effectiveTypeMix({ seasonMix: globalDiff }));

  const perGame = input.slate
    .filter((r) => r.is_enabled)
    .flatMap((r) => {
      const game = byId.get(r.game_id);
      if (!game) return [];
      const rows = effectiveTypeMix({
        seasonMix: globalDiff,
        perGameRows: input.difficultyMix.filter((d) => d.applies_to_game_id === r.game_id),
        floor: r.difficulty_floor,
        ceiling: r.difficulty_ceiling,
      });
      return [{ game, days: scheduled.get(r.game_id) ?? 0, mix: rows ? mixVector(rows) : null }];
    });

  const weighted = perGame.filter((g): g is typeof g & { mix: number[] } => !!g.mix && g.days > 0);
  const totalDays = sum(weighted.map((g) => g.days));
  const realized =
    totalDays > 0
      ? CANONICAL_BANDS.map((_, b) => sum(weighted.map((g) => g.mix[b] * g.days)) / totalDays)
      : configured.slice();
  const maxDeviation = CANONICAL_BANDS.reduce(
    (worst, _b, i) => Math.max(worst, Math.abs(realized[i] - configured[i])),
    0
  );
  return { configured, realized, maxDeviation, perGame };
}

/** A mix vector as the commissioner reads it: whole points, deepest last. */
function formatMix(v: number[]): string {
  return v.map((n) => Math.round(n)).join("/");
}

/** Spec conditions 1–10 as blocking errors. `forFullRun` adds condition 10. */
export function generationFindings(input: GenerationInput, forFullRun: boolean): Finding[] {
  const out: Finding[] = [];
  const err = (code: string, message: string) => out.push({ severity: "error", code, message });
  const s = input.season;

  // 1 — identity + window
  if (!s.league_id) err("no_league", "The season has no league.");
  const dayCount = seasonDayCount(s.starts_on, s.ends_on);
  if (dayCount == null) err("no_window", "Season start and end dates are not set (or invalid).");

  // 2 — playoff + freeze dates ordered (Part A CHECKs re-stated as copy).
  // Playoffs are OPTIONAL (CC-LO-PLAYOFF-OPTIONAL-1.0): a season with no
  // playoff_starts_on runs as a regular season for its whole window — that is
  // already how league-playoffs/phase.ts reads a NULL date — and needs no
  // roster freeze. Its absence is surfaced as the `no_playoffs` WARNING in
  // generationWarnings(), never as a blocker. A playoff date that IS set still
  // requires the freeze, and both dates keep their ordering rules.
  if (s.playoff_starts_on) {
    if (!s.roster_freeze_on)
      err("no_freeze_date", "Roster freeze date is not set — it is required when the season has playoffs.");
    if (s.starts_on && s.ends_on && (s.playoff_starts_on <= s.starts_on || s.playoff_starts_on > s.ends_on))
      err("playoff_outside_window", "Playoff start must fall inside the season window.");
    if (s.roster_freeze_on && s.roster_freeze_on > s.playoff_starts_on)
      err("freeze_after_playoff", "Roster freeze must be on or before the playoff start.");
  }
  if (s.roster_freeze_on && s.starts_on && s.ends_on && dayCount != null) {
    const quarter = Math.floor((dayCount - 1) / 4);
    const t = new Date(s.starts_on + "T12:00:00Z");
    t.setUTCDate(t.getUTCDate() + quarter);
    if (s.roster_freeze_on < t.toISOString().slice(0, 10))
      err("freeze_too_early", "Roster freeze is earlier than a quarter of the way into the season.");
  }

  // 3 — at least one configured game
  const enabled = input.slate.filter((r) => r.is_enabled);
  if (enabled.length === 0) err("no_games", "No games are enabled for this season.");

  // 4 — every configured game is a LIVE catalog game; Logo Match is dead
  const byId = new Map(input.catalog.map((g) => [g.id, g]));
  for (const r of enabled) {
    const g = byId.get(r.game_id);
    if (!g) {
      err("unknown_game", "A configured game is not in the game catalog.");
      continue;
    }
    if (DEAD_GAME_PATTERN.test(g.game_key) || DEAD_GAME_PATTERN.test(g.display_name)) {
      err("dead_game", `"${g.display_name}" is not a game — Logo Match never shipped.`);
      continue;
    }
    if (g.lifecycle_state !== "live" || !g.runtime_key)
      err("game_not_live", `"${g.display_name}" is not a live game (lifecycle: ${g.lifecycle_state}).`);
  }

  // 5 — puzzle_count covers the game's SCHEDULED days (DEC-2; surplus handled
  // as a warning). CC-DC-GEN-SCHEDULE-FIELDS-1.0: the floor is one per day the
  // game actually plays, not one per day of the season — a Monday-only game
  // asking for 17 puzzles in a 119-day season is correctly configured, and
  // blocking it was the old rule's only possible answer.
  const scheduledDays = scheduledDaysByGame(input);
  if (dayCount != null) {
    for (const r of enabled) {
      const g = byId.get(r.game_id);
      const days = scheduledDays.get(r.game_id) ?? 0;
      if (r.puzzle_count != null && days > 0 && r.puzzle_count < days)
        err(
          "puzzle_count_short",
          `"${g?.display_name ?? r.game_id}" requests ${r.puzzle_count} puzzles for ${days} scheduled day${days === 1 ? "" : "s"} — never below one per day.`
        );
    }
  }

  // 5b — CC-DC-GEN-SCHEDULE-FIELDS-1.0 D2: `games_per_day` is a VALIDATION
  // rule, not a selector. When more games are scheduled on a day than the
  // config allows, the commissioner is told WHICH days and fixes the slate or
  // the cap. Nothing picks a game to drop: a season that silently serves four
  // of five configured games is the failure mode this rule exists to prevent,
  // and it would be invisible from every surface.
  const over = overScheduledDates({
    season: scheduleSeason(input),
    config: scheduleConfig(input),
    games: enabled.map(scheduleGame),
    gamesPerDay: input.gamesPerDay ?? null,
  });
  if (over.length > 0) {
    const first = over.slice(0, 3).map((d) => `${d.date} (${d.count})`).join(", ");
    err(
      "games_per_day_below_scheduled",
      `Games per day is ${input.gamesPerDay}, but more games than that are scheduled on ${over.length} date${over.length === 1 ? "" : "s"} — ${first}${over.length > 3 ? ", …" : ""}. Raise the cap or narrow the slate; generation never drops a game to fit.`
    );
  }

  // 6 — difficulty mix sums to exactly 100 (global rows; per-game overrides per game)
  const globalDiff = input.difficultyMix.filter((d) => !d.applies_to_game_id);
  if (globalDiff.length === 0) err("no_difficulty_mix", "No difficulty mix is configured.");
  else if (!isHundred(sum(globalDiff.map((d) => d.target_pct))))
    err("difficulty_mix_not_100", `Difficulty mix totals ${sum(globalDiff.map((d) => d.target_pct))}% (must be exactly 100%).`);
  const perGameDiff = new Map<string, number>();
  for (const d of input.difficultyMix)
    if (d.applies_to_game_id)
      perGameDiff.set(d.applies_to_game_id, (perGameDiff.get(d.applies_to_game_id) ?? 0) + d.target_pct);
  for (const [gid, pct] of perGameDiff)
    if (!isHundred(pct))
      err("game_difficulty_mix_not_100", `"${byId.get(gid)?.display_name ?? gid}" difficulty override totals ${pct}% (must be exactly 100%).`);

  // 6b — CC-DC-GEN-DIFFICULTY-PERGAME-1.0 D3: a game's [floor, ceiling] must
  // leave at least one band standing. A floor deeper than the ceiling is not a
  // mix the generator can round its way out of — there is nothing to generate
  // — so it blocks here rather than failing the run mid-slice.
  for (const r of enabled) {
    const g = byId.get(r.game_id);
    if (!g) continue;
    const eff = effectiveTypeMix({
      seasonMix: globalDiff,
      perGameRows: input.difficultyMix.filter((d) => d.applies_to_game_id === r.game_id),
      floor: r.difficulty_floor,
      ceiling: r.difficulty_ceiling,
    });
    if (!eff)
      err(
        "difficulty_window_empty",
        `"${g.display_name}" has a difficulty floor of ${r.difficulty_floor} above its ceiling of ${r.difficulty_ceiling} — no band is left to generate.`
      );
  }

  // 7 — theme emphasis: sector codes must be live Active domain codes; mix sums to 100
  const active = new Set(input.activeDomainCodes);
  const included = input.themeMix.filter((t) => !t.is_excluded);
  if (included.length === 0) err("no_theme_mix", "No theme mix is configured.");
  else if (!isHundred(sum(included.map((t) => t.target_pct))))
    err("theme_mix_not_100", `Theme mix totals ${sum(included.map((t) => t.target_pct))}% (must be exactly 100%).`);
  for (const t of input.themeMix) {
    if (t.sector_code && active.size > 0 && !active.has(t.sector_code))
      err("unknown_domain_code", `Theme mix references "${t.sector_code}", which is not an Active domain in the live registry.`);
  }
  // CC-DC-GEN-THEME-ALLOCATION-1.0 D7 — target_pct is authoritative for the
  // calendar, so an included share the corpus cannot serve is a BLOCKING fault,
  // not something the allocator quietly hands to a neighbouring Theater.
  for (const u of unfillableThemeQuotas({
    mixRows: input.themeMix,
    corpusCounts: input.corpusThemeCounts ?? [],
    dayCount: dayCount ?? 0,
  }))
    err(
      "theme_quota_unfillable",
      u.sector_code
        ? `Theme mix gives ${u.theater_id} / ${u.sector_code} a share of the season, but no corpus theme row matches it under the configured exclusions.`
        : `Theme mix gives ${u.theater_id} a share of the season, but no corpus theme row matches it under the configured exclusions.`
    );

  // 8 — lock
  if (s.locked_at) err("season_locked", "The season is locked — unlock it to change or generate anything.");

  // 9 — one run at a time
  if (input.inflightRuns.length > 0)
    err("run_in_flight", "A generation run is already in flight for this season.");

  // 10 — full runs require the approved pilot (DEC-5)
  if (forFullRun && !s.pilot_approved_at)
    err("pilot_not_approved", "The pilot has not been approved — review and approve it before the full run.");

  return out;
}

/** Non-blocking warnings for the confirm modal. */
export function generationWarnings(input: GenerationInput): Finding[] {
  const out: Finding[] = [];
  const warn = (code: string, message: string) => out.push({ severity: "warning", code, message });

  // No playoff date = no playoff phase. Visible, never blocking (condition 2).
  if (!input.season.playoff_starts_on)
    warn(
      "no_playoffs",
      "No playoff start date is set — this season runs as a regular season for its whole window, with no playoff phase."
    );

  for (const t of input.themeMix) {
    if (!t.is_excluded && t.sector_code && THIN_CORPUS_SECTORS.includes(t.sector_code) && t.target_pct > THIN_CORPUS_WARN_PCT)
      warn(
        "thin_corpus_emphasis",
        `${t.sector_code === "D16" ? "Cyber & Physical Security" : "Community Opposition"} carries ${t.target_pct}% emphasis — its corpus is thin (floor_relaxed) and will under-produce.`
      );
  }

  // CC-DC-GEN-DIFFICULTY-ALLOCATION-1.0 D3 — `custom` is a selectable curve
  // with nothing behind it: no per-day shape is stored for a season anywhere in
  // the schema, so the allocator can only place the mix as an even spread. The
  // totals are still exactly the configured mix; it is the SHAPE that is not
  // honoured, and the commissioner is told so instead of inferring it from a
  // sparkline that draws a flat line either way.
  if (typeof input.difficultyCurve === "string" && normalizeCurve(input.difficultyCurve) === "custom")
    warn(
      CURVE_CUSTOM_WARNING,
      'Difficulty curve is set to "custom", but no custom shape is stored — generation will spread the configured mix evenly across the season. The band totals still match the mix exactly.'
    );

  // CC-DC-GEN-DIFFICULTY-PERGAME-1.0 D3 — the season mix and the per-game
  // floors are set in two different sections of the editor and multiply into
  // each other. Say so BEFORE generating, in the two numbers the commissioner
  // configured and will measure the bank against.
  const shift = realizedDifficultyMix(input);
  if (shift.maxDeviation > DIFFICULTY_SHIFT_WARN_PTS)
    warn(
      "difficulty_mix_shifted_by_game_rules",
      `Per-game floors shift the season mix from ${formatMix(shift.configured)} to ` +
        `${formatMix(shift.realized)} (foundational/practitioner/expert) — the per-game ` +
        `floors, ceilings and overrides win, band for band.`
    );

  const targets = computeTargets(input);
  if (targets.total > RUN_SIZE_WARN)
    warn("large_run", `This run requests ${targets.total.toLocaleString()} puzzles in one go.`);

  // CC-DC-GEN-SCHEDULE-FIELDS-1.0 — measured against the game's own scheduled
  // days (`effective`), which is what the worker will generate.
  for (const g of targets.perGame)
    if (g.requested > g.effective)
      warn(
        "surplus_unsupported",
        `"${g.game.display_name}" requests ${g.requested} puzzles but the bank stores one per game per day — generating ${g.effective}.`
      );

  // CC-DC-GEN-SCHEDULE-FIELDS-1.0 — a game the calendar never reaches. Not an
  // error: an ended per-game window, or a season whose play days fall outside
  // the game's, is a legitimate (if usually accidental) configuration. It is
  // the SILENCE that was the bug — the slate showed the game as enabled and
  // the lobby served it anyway.
  for (const g of targets.perGame)
    if (targets.dayCount != null && g.effective === 0)
      warn(
        "game_never_scheduled",
        `"${g.game.display_name}" is enabled but plays on no date in this season — check its appears-on days and its start/end dates.`
      );

  return out;
}

/** Stall alarm: in-flight and silent for more than 30 minutes. */
export function isStalled(run: GenRun, nowIso: string): boolean {
  if (run.completed_at || run.superseded_at) return false;
  const last = run.last_heartbeat_at ?? run.started_at;
  const t = Date.parse(last);
  if (Number.isNaN(t)) return false;
  return Date.parse(nowIso) - t > STALL_MINUTES * 60_000;
}

/** Does the bank-minimum alarm apply to this season at all?
 *
 *  The alarm is a POST-generation operations alarm (AUTO-031's role): once a
 *  season's puzzles exist, the bank must never run dry under live players. A
 *  season that has not been generated has, by definition, nothing in the bank
 *  yet — "0 days of coverage" is not an alarm there, it is the starting state,
 *  and the GENERATABLE checklist is the surface that says what to do about it.
 *  Firing four amber banners on a freshly configured season (demo 2,
 *  2026-09-10) told the operator nothing and read as an error condition.
 *
 *  Deliberately keyed on `generated_at`, not `seasons.status`: an active but
 *  un-generated season would otherwise alarm for the same non-reason the day
 *  the nightly rollover flips it, and picking by status is what the
 *  season-resolve guard exists to stop. Trade-off: a season served only by
 *  platform (season_id NULL) rows and never generated is not watched from this
 *  panel — the platform bank has its own health surface. */
export function bankAlarmApplies(season: Pick<GenSeason, "generated_at">): boolean {
  return !!season.generated_at;
}

/** The serve dates the bank must cover: the next BANK_MINIMUM_DAYS days after
 *  `today`, clipped to the season window. Empty when the season has ended or
 *  starts more than BANK_MINIMUM_DAYS days out — there is nothing to cover yet.
 *  `required` is what "full coverage" means for this season right now: a
 *  season with 5 days left needs 5, not 14. */
export function bankCoverageWindow(
  today: string,
  startsOn: string | null,
  endsOn: string | null
): { from: string | null; to: string | null; required: number } {
  if (!startsOn || !endsOn) return { from: null, to: null, required: 0 };
  const horizonFrom = addDays(today, 1);
  const horizonTo = addDays(today, BANK_MINIMUM_DAYS);
  const from = horizonFrom > startsOn ? horizonFrom : startsOn;
  const to = horizonTo < endsOn ? horizonTo : endsOn;
  const required = seasonDayCount(from, to) ?? 0;
  return required > 0 ? { from, to, required } : { from: null, to: null, required: 0 };
}

/**
 * CC-DC-GEN-SCHEDULE-FIELDS-1.0 — how many days inside `[from, to]` each
 * ENABLED game is actually scheduled to serve, keyed by `runtime_key`.
 *
 * This is the per-game bar for the bank-minimum alarm. The window itself is
 * still bankCoverageWindow()'s; all this does is subtract, per game, the days
 * that game does not play — because "Circuit has 10 of the 14 days covered" is
 * a false alarm on a Mon–Fri season, and a weekly alarm nobody can clear is an
 * alarm everybody learns to ignore.
 *
 * Returns {} when the window is empty. Games sharing a runtime_key (there are
 * none; the catalog is unique on it) would take the larger bar.
 */
export function bankServeDays(
  input: GenerationInput,
  from: string | null,
  to: string | null
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!from || !to || to < from) return out;
  const season: ScheduleSeason = { starts_on: from, ends_on: to };
  const config = scheduleConfig(input);
  const byId = new Map(input.catalog.map((g) => [g.id, g]));
  for (const r of input.slate.filter((g) => g.is_enabled)) {
    const key = byId.get(r.game_id)?.runtime_key;
    if (!key) continue;
    const days = scheduledDayCount({ season, config, game: scheduleGame(r) });
    out[key] = Math.max(out[key] ?? 0, days);
  }
  return out;
}

function addDays(iso: string, n: number): string {
  const t = new Date(iso + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Bank-minimum alarm (AUTO-031 role, from the Puzzle Bank's own field docs):
 *  every configured game needs Published-or-Live coverage on every serve date
 *  in the window from bankCoverageWindow(). `coverage` = per runtime_key count
 *  of DISTINCT serve dates in that window that are Published or Live for THIS
 *  season (its own rows, or platform rows — season_id NULL — which serve as
 *  the fallback per CC-LO-CONCURRENT-SEASONS D6). `requiredDays` is the
 *  window's length (default: the full 14-day minimum).
 *
 *  CC-DC-GEN-SCHEDULE-FIELDS-1.0 — `requiredByKey` overrides that length PER
 *  GAME with the days that game is actually scheduled inside the window
 *  (bankServeDays). Without it a Mon–Fri season alarmed every week for the two
 *  days it never serves, and a Monday-only game alarmed permanently. Optional:
 *  a key it does not mention keeps `requiredDays`. */
export function bankMinimumFindings(
  configuredRuntimeKeys: string[],
  coverage: Record<string, number>,
  requiredDays: number = BANK_MINIMUM_DAYS,
  requiredByKey?: Record<string, number> | null
): Finding[] {
  const out: Finding[] = [];
  if (requiredDays <= 0) return out;
  for (const key of configuredRuntimeKeys) {
    const required = requiredByKey && typeof requiredByKey[key] === "number" ? requiredByKey[key] : requiredDays;
    if (required <= 0) continue;
    const days = coverage[key] ?? 0;
    if (days < required)
      out.push({
        severity: "warning",
        code: "bank_minimum",
        message:
          required === BANK_MINIMUM_DAYS
            ? `${key} has ${days} day${days === 1 ? "" : "s"} of Published/Live coverage ahead — below the ${BANK_MINIMUM_DAYS}-day bank minimum.`
            : `${key} has ${days} of the ${required} remaining serve day${required === 1 ? "" : "s"} covered (Published/Live) — the bank runs dry before the season ends.`,
      });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// CC-DC-GEN-DOMAIN-FIDELITY-1.0 — off-domain drafts, as the panel reads them
// ═══════════════════════════════════════════════════════════════════════════
//
// The worker files a drifted puzzle as `validation_status = 'review'` with ONE
// structural note, `{ key: "domain_fit_off", reason }` (puzzle-schema's
// deriveValidation is the only writer). This is the read side: it turns those
// rows into the list the commissioner sees, and it is DELIBERATELY blind —
// its input carries a date, a game and a jsonb note, and no puzzle content
// exists in the projection for it to leak. Approval is never blocked; a season
// may ship off-domain puzzles knowingly, it may not ship them unknowingly.

/** A draft the model itself reported as outside its day's sector. */
export type OffDomainFlag = { date: string; game: string; reason: string | null };

/** The content-free row shape generation-status projects for this. */
export type DomainFlagRow = {
  go_live_date: string;
  puzzle_type: string;
  validation_status?: string | null;
  validation_errors?: unknown;
};

const DOMAIN_FIT_OFF_KEY = "domain_fit_off";
/** The panel's own clamp. The writer already clamps to 120; a row written by
 *  anything else (a backfill, a hand edit) does not get to overflow the UI. */
const FLAG_REASON_MAX = 160;

/**
 * The `domain_fit_off` notes on `rows`, in date order then game order.
 * Tolerant by design: a null/!array `validation_errors`, an entry without the
 * key, or a non-string reason all read as "flagged, no reason given" rather
 * than throwing — the FLAG is the signal and must survive a malformed note.
 */
export function offDomainFlags(rows: DomainFlagRow[]): OffDomainFlag[] {
  const out: OffDomainFlag[] = [];
  for (const r of rows || []) {
    if (r?.validation_status !== "review") continue;
    const errors = Array.isArray(r.validation_errors) ? r.validation_errors : [];
    const hit = errors.find(
      (e) => e && typeof e === "object" && (e as { key?: unknown }).key === DOMAIN_FIT_OFF_KEY
    ) as { reason?: unknown } | undefined;
    if (!hit) continue;
    const raw = typeof hit.reason === "string" ? hit.reason.replace(/\s+/g, " ").trim() : "";
    out.push({
      date: r.go_live_date,
      game: r.puzzle_type,
      reason: raw ? raw.slice(0, FLAG_REASON_MAX) : null,
    });
  }
  return out.sort((a, b) => (a.date === b.date ? a.game.localeCompare(b.game) : a.date < b.date ? -1 : 1));
}
