// CC-DC-GEN-SCHEDULE-FIELDS-1.0 — THE definition of "which games play on which
// dates".
//
// ── Why this module exists ──────────────────────────────────────────────────
// Four columns describe a season's calendar and, before this module, each was
// read by a different number of places — which is to say, mostly by none:
//
//   season_config.play_days_of_week   the season's play days (ISO 1=Mon…7=Sun)
//   season_config.games_per_day       how many games may land on one day
//   season_games.appears_on_days      a per-game narrowing of those play days
//   season_games.starts_on/.ends_on   a per-game window inside the season
//
// Validation computed targets as `dayCount × enabled games`, the generator
// built its slot list as the full `dates × types` product, and serving applied
// only the slate. A Monday-only game was therefore generated seven days a week
// and served seven days a week; a Mon–Fri season generated Saturdays. The
// commissioner could configure all four fields and change nothing.
//
// So validation, generation and serving now all answer the question here, and
// nowhere else.
//
// ── The rule, in one sentence ───────────────────────────────────────────────
// A game plays on a date iff the date is inside BOTH the season window and the
// game's own window, its ISO weekday is a season play day, and — when the game
// names any `appears_on_days` — one of those days too.
//
// ── Dates are plain calendar dates ──────────────────────────────────────────
// `starts_on`, `ends_on`, `go_live_date` and the generator's slot dates are all
// `YYYY-MM-DD` with no time and no zone: they are already CT serve days
// (CC-DC-SEASON-GOLIVE-1.0 owns that conversion). Weekday is therefore computed
// FROM THE STRING — parsed at UTC noon so no DST shift can round a day off —
// and never from a `Date` built out of the viewer's clock. Comparisons are
// lexicographic for the same reason: on ISO dates that IS chronological order,
// and it cannot drift by a timezone.
//
// Pure: no I/O, no clock, no randomness. Tests: `npm run test:schedule`.

// Relative, with the extension: this module's tests run under plain
// `node --test`, which does not read tsconfig `paths`. normalizeDayMask is
// imported rather than re-implemented — the day mask has one owner
// (season-config-logic), and a second copy of "1=Mon…7=Sun, drop anything
// else" is exactly the kind of near-duplicate this module exists to delete.
import { normalizeDayMask } from "../league-office/season-config-logic.ts";

export type ScheduleSeason = {
  starts_on?: string | null;
  ends_on?: string | null;
};

export type ScheduleConfig = {
  /** ISO weekdays the season plays. null/absent ⇒ every day (normalizeDayMask). */
  play_days_of_week?: unknown;
} | null | undefined;

export type ScheduleGame = {
  /**
   * Whatever the caller keys slots by: `game_catalog.runtime_key` for the
   * generator and the serve path, `season_games.game_id` for validation. This
   * module never interprets it.
   */
  type: string;
  /** null/empty ⇒ every season play day. */
  appears_on_days?: number[] | null;
  /** null ⇒ open on that side (the season's own bound applies). */
  starts_on?: string | null;
  ends_on?: string | null;
};

export type ScheduledSlot = { type: string; date: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A usable `YYYY-MM-DD`, or null. Rejects nonsense dates ("2026-02-30"), not
 *  just nonsense strings, so a bad column value never silently becomes day 1 of
 *  the next month. */
export function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const d = value.slice(0, 10);
  if (!ISO_DATE.test(d)) return null;
  const t = new Date(d + "T12:00:00Z");
  if (Number.isNaN(t.getTime())) return null;
  // `new Date("2026-02-30T12:00:00Z")` is NaN in V8, but be explicit rather
  // than depend on it.
  return t.toISOString().slice(0, 10) === d ? d : null;
}

/** ISO weekday of a plain calendar date: 1=Mon … 7=Sun. null when unusable. */
export function isoWeekday(date: unknown): number | null {
  const d = isoDate(date);
  if (!d) return null;
  const js = new Date(d + "T12:00:00Z").getUTCDay(); // JS Sun=0
  return js === 0 ? 7 : js;
}

/** The season's play days. Absent/null/not-an-array ⇒ all seven; `[]` ⇒ none
 *  (a configured empty mask is an instruction, not a missing value). */
export function playDays(config: ScheduleConfig): number[] {
  return normalizeDayMask(config?.play_days_of_week);
}

/** `[starts_on, ends_on]`, or null when either is missing/invalid or inverted —
 *  a season with no usable window schedules nothing. */
export function seasonWindow(season: ScheduleSeason | null | undefined): { from: string; to: string } | null {
  const from = isoDate(season?.starts_on);
  const to = isoDate(season?.ends_on);
  if (!from || !to || to < from) return null;
  return { from, to };
}

/** Every date of the season window, inclusive, ascending. */
export function windowDates(season: ScheduleSeason | null | undefined): string[] {
  const w = seasonWindow(season);
  if (!w) return [];
  const out: string[] = [];
  const t = new Date(w.from + "T12:00:00Z");
  const end = new Date(w.to + "T12:00:00Z").getTime();
  while (t.getTime() <= end) {
    out.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

/**
 * Does `game` play on `date`? THE predicate — every other function here is a
 * loop around it.
 *
 * Order of the four tests is immaterial (they are a conjunction); they are
 * written window-first because that is the cheapest one to fail.
 */
export function isScheduled(input: {
  date: unknown;
  season: ScheduleSeason | null | undefined;
  config?: ScheduleConfig;
  game?: ScheduleGame | null;
}): boolean {
  const date = isoDate(input.date);
  if (!date) return false;

  const w = seasonWindow(input.season);
  if (!w || date < w.from || date > w.to) return false;

  // Per-game window: an absent bound is OPEN on that side, so a game that
  // configures neither is scheduled across the whole season.
  const gFrom = isoDate(input.game?.starts_on);
  const gTo = isoDate(input.game?.ends_on);
  if (gFrom && date < gFrom) return false;
  if (gTo && date > gTo) return false;

  const weekday = isoWeekday(date);
  if (weekday == null) return false;
  if (!playDays(input.config).includes(weekday)) return false;

  // appears_on_days NARROWS the season's play days; it can never widen them
  // (the conjunction above already ran). null or empty ⇒ no narrowing.
  const appears = Array.isArray(input.game?.appears_on_days)
    ? normalizeDayMask(input.game?.appears_on_days)
    : null;
  if (appears && appears.length > 0 && !appears.includes(weekday)) return false;

  return true;
}

/** Every date `game` plays, ascending. */
export function scheduledDates(input: {
  season: ScheduleSeason | null | undefined;
  config?: ScheduleConfig;
  game?: ScheduleGame | null;
}): string[] {
  return windowDates(input.season).filter((date) =>
    isScheduled({ date, season: input.season, config: input.config, game: input.game })
  );
}

/** How many dates `game` plays. The denominator for "one puzzle per day". */
export function scheduledDayCount(input: {
  season: ScheduleSeason | null | undefined;
  config?: ScheduleConfig;
  game?: ScheduleGame | null;
}): number {
  return scheduledDates(input).length;
}

/**
 * Every (game, date) the season actually plays.
 *
 * TYPE-MAJOR, dates ascending within a type — deliberately the same order the
 * generator's old `for (type) for (date)` product produced, so replacing that
 * product with this call reorders nothing.
 */
export function scheduledSlots(input: {
  season: ScheduleSeason | null | undefined;
  config?: ScheduleConfig;
  games?: readonly ScheduleGame[] | null;
}): ScheduledSlot[] {
  const games = Array.isArray(input.games) ? input.games : [];
  const dates = windowDates(input.season);
  const out: ScheduledSlot[] = [];
  for (const game of games) {
    if (!game || typeof game.type !== "string" || !game.type) continue;
    for (const date of dates)
      if (isScheduled({ date, season: input.season, config: input.config, game }))
        out.push({ type: game.type, date });
  }
  return out;
}

/** The types scheduled on one date, in the order `games` were given. */
export function scheduledTypesOn(input: {
  date: unknown;
  season: ScheduleSeason | null | undefined;
  config?: ScheduleConfig;
  games?: readonly ScheduleGame[] | null;
}): string[] {
  const games = Array.isArray(input.games) ? input.games : [];
  return games
    .filter(
      (g) =>
        g &&
        typeof g.type === "string" &&
        !!g.type &&
        isScheduled({ date: input.date, season: input.season, config: input.config, game: g })
    )
    .map((g) => g.type);
}

/** How many games land on each date of the window, ascending by date. */
export function dailyCounts(input: {
  season: ScheduleSeason | null | undefined;
  config?: ScheduleConfig;
  games?: readonly ScheduleGame[] | null;
}): { date: string; count: number }[] {
  const games = Array.isArray(input.games) ? input.games : [];
  return windowDates(input.season).map((date) => ({
    date,
    count: games.filter(
      (g) => g && typeof g.type === "string" && !!g.type &&
        isScheduled({ date, season: input.season, config: input.config, game: g })
    ).length,
  }));
}

/**
 * D2 — `games_per_day` is a VALIDATION rule, not a selector.
 *
 * It names a cap the commissioner set; it does NOT give the generator licence
 * to pick which games get dropped on a crowded day. Silently dropping a game
 * is how a season ends up serving a slate nobody configured. So the overflow is
 * reported here, by date, and the League Office blocks on it
 * (`games_per_day_below_scheduled`).
 *
 * null/≤0 `gamesPerDay` ⇒ no cap ⇒ no overflow.
 */
export function overScheduledDates(input: {
  season: ScheduleSeason | null | undefined;
  config?: ScheduleConfig;
  games?: readonly ScheduleGame[] | null;
  gamesPerDay?: number | null;
}): { date: string; count: number }[] {
  const cap = typeof input.gamesPerDay === "number" && Number.isFinite(input.gamesPerDay)
    ? Math.trunc(input.gamesPerDay)
    : null;
  if (cap == null || cap <= 0) return [];
  return dailyCounts(input).filter((d) => d.count > cap);
}
