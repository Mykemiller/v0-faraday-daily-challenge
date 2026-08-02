// League Playoffs — season phase + roster freeze, as pure functions.
//
// THE single implementation of "what part of the season is it, and what date
// window scores it". Routes, RPC callers and UI all derive their state from
// here so the answer can never drift between surfaces.
//
// Two date columns on `seasons` drive everything, and until this module landed
// NOTHING read them for behavior (see docs/league-playoffs/PHASE-0-FINDINGS.md):
//
//   roster_freeze_on   — from this date on, players can no longer join or leave
//                        teams. Enforced server-side in the team_* RPCs and the
//                        player routes; the commissioner stays above it.
//   playoff_starts_on  — from this date to ends_on (inclusive) is the playoff
//                        window. Everything before it is the regular season.
//
// ⚠️ `season_config.roster_lock_on` is a DIFFERENT, unrelated column (versioned
// config, displayed as "Roster lock" in the League Office). The freeze keys on
// `seasons.roster_freeze_on` — the column the DB CHECKs and the generation gate
// already agree on. Do not conflate the two.

/** The subset of a `seasons` row this module needs. */
export type SeasonDates = {
  starts_on: string | null;
  ends_on: string | null;
  playoff_starts_on: string | null;
  roster_freeze_on: string | null;
  /** IANA zone from `seasons.tz`. Defaults to the DC serve zone. */
  tz?: string | null;
};

/** Where "now" sits relative to the season window. */
export type SeasonPhase = "pre" | "regular" | "playoff" | "post";

/** Which date window attributes score_events. `full` = the legacy whole-season
 *  behavior the existing RPCs implement, and stays the default everywhere. */
export type ScoringPhase = "full" | "regular" | "playoff";

/** A closed [from, to] date range, both inclusive, both YYYY-MM-DD. */
export type DateWindow = { from: string; to: string };

/** The Daily Challenge serve zone — the AUTO-128 rotation boundary, and the
 *  fallback whenever a season carries no `tz`. */
export const DEFAULT_TZ = "America/Chicago";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in `tz`, as YYYY-MM-DD. Mirrors the `centralDate()`
 *  helper the leaderboard routes already use, but honours the season's own zone
 *  instead of hardcoding Central. Falls back to the default zone if `tz` is not
 *  a zone Intl recognises, so a bad column value can never throw at request time. */
export function seasonToday(tz?: string | null, now: Date = new Date()): string {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  try {
    return fmt(tz || DEFAULT_TZ);
  } catch {
    return fmt(DEFAULT_TZ);
  }
}

/** Shift a YYYY-MM-DD by whole days. Noon-UTC anchored so DST can never move
 *  the result across a day boundary — the same trick the season pages use. */
export function addDays(date: string, n: number): string {
  const t = new Date(date + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). null on bad input. */
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!isDate(a) || !isDate(b)) return null;
  const ta = Date.parse(a + "T12:00:00Z");
  const tb = Date.parse(b + "T12:00:00Z");
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / 86_400_000);
}

function isDate(v: string | null | undefined): v is string {
  return typeof v === "string" && DATE_RE.test(v);
}

/**
 * Where the season sits on `today`.
 *
 * A season with no `playoff_starts_on` is `regular` for its whole run — that is
 * the pre-playoff status quo, and every season except Hot Summer is in it.
 */
export function seasonPhase(season: SeasonDates, today: string): SeasonPhase {
  const { starts_on, ends_on, playoff_starts_on } = season;
  if (!isDate(starts_on) || !isDate(ends_on)) return "pre";
  if (today < starts_on) return "pre";
  if (today > ends_on) return "post";
  if (isDate(playoff_starts_on) && today >= playoff_starts_on) return "playoff";
  return "regular";
}

/**
 * The date window that attributes score_events for a scoring phase.
 *
 * - `full`    — starts_on … ends_on. Byte-identical to what the three existing
 *               leaderboard RPCs already do, and the default for every caller.
 * - `regular` — starts_on … (playoff_starts_on − 1). With no playoff date set
 *               this is the whole season, so regular-season standings are
 *               unchanged for seasons that never configure playoffs.
 * - `playoff` — playoff_starts_on … ends_on.
 *
 * Returns null when the window cannot exist (no dates, or a playoff window
 * requested on a season that has no playoff date). Null means "no rows", never
 * "fall back to the whole season" — a caller that silently widened the window
 * would report regular-season points as playoff points.
 */
export function phaseWindow(season: SeasonDates, phase: ScoringPhase): DateWindow | null {
  const { starts_on, ends_on, playoff_starts_on } = season;
  if (!isDate(starts_on) || !isDate(ends_on) || ends_on < starts_on) return null;

  if (phase === "full") return { from: starts_on, to: ends_on };

  if (phase === "playoff") {
    if (!isDate(playoff_starts_on)) return null;
    // Clamp into the season: the seasons_playoff_window CHECK already enforces
    // this, but the column is nullable and app callers may pass unsaved input.
    const from = playoff_starts_on < starts_on ? starts_on : playoff_starts_on;
    if (from > ends_on) return null;
    return { from, to: ends_on };
  }

  // regular
  if (!isDate(playoff_starts_on)) return { from: starts_on, to: ends_on };
  const to = addDays(playoff_starts_on, -1);
  if (to < starts_on) return null; // playoffs open on day one — no regular season
  return { from: starts_on, to: to > ends_on ? ends_on : to };
}

/** True when `date` falls inside the window (inclusive both ends). */
export function windowContains(w: DateWindow | null, date: string): boolean {
  if (!w) return false;
  return date >= w.from && date <= w.to;
}

export type RosterFreezeState = {
  /** Whether roster changes are blocked right now. */
  frozen: boolean;
  /** The configured freeze date, or null when the season sets none. */
  freezeOn: string | null;
  /** Days until the freeze; 0 on the day itself, negative once past, null when unset. */
  daysUntilFreeze: number | null;
};

/**
 * Roster freeze state for a season on `today`.
 *
 * The rule is deliberately simple and one-way: once `today` reaches
 * `roster_freeze_on`, rosters are frozen for the rest of the season. A season
 * with no freeze date is never frozen — which is every season today except Hot
 * Summer, so this ships inert for them.
 *
 * Not a lock check: `seasons.locked_at` is a separate, additive gate the routes
 * already apply. A season can be locked, frozen, both, or neither.
 */
export function rosterFreezeState(season: SeasonDates, today: string): RosterFreezeState {
  const freezeOn = isDate(season.roster_freeze_on) ? season.roster_freeze_on : null;
  return {
    frozen: freezeOn != null && today >= freezeOn,
    freezeOn,
    daysUntilFreeze: freezeOn ? daysBetween(today, freezeOn) : null,
  };
}

/** Convenience predicate over `rosterFreezeState`. */
export function isRosterFrozen(season: SeasonDates, today: string): boolean {
  return rosterFreezeState(season, today).frozen;
}

/** The wire error code every frozen roster write returns. Stable contract —
 *  `/account`, the in-app picker and the team page all branch on it. */
export const ROSTER_FROZEN_CODE = "roster_frozen";

/** The one player-facing sentence for a blocked roster change. Kept here so the
 *  RPC message, the API message and the UI copy cannot drift apart. */
export const ROSTER_FROZEN_MESSAGE = "Rosters are frozen for the playoffs.";

export type PlayoffStatus = {
  phase: SeasonPhase;
  /** Configured playoff start, or null when the season runs no playoffs. */
  playoffStartsOn: string | null;
  /** Days until playoffs open; 0 on the day, negative once open, null when unset. */
  daysUntilPlayoffs: number | null;
  /** True while `today` is inside the playoff window. */
  playoffsLive: boolean;
  /** The playoff scoring window, or null when the season runs no playoffs. */
  playoffWindow: DateWindow | null;
  /** The regular-season scoring window — what seeding is drawn from. */
  regularWindow: DateWindow | null;
  roster: RosterFreezeState;
};

/** Everything a surface needs to render playoff state, derived in one place. */
export function playoffStatus(season: SeasonDates, today: string): PlayoffStatus {
  const phase = seasonPhase(season, today);
  const playoffStartsOn = isDate(season.playoff_starts_on) ? season.playoff_starts_on : null;
  return {
    phase,
    playoffStartsOn,
    daysUntilPlayoffs: playoffStartsOn ? daysBetween(today, playoffStartsOn) : null,
    playoffsLive: phase === "playoff",
    playoffWindow: phaseWindow(season, "playoff"),
    regularWindow: phaseWindow(season, "regular"),
    roster: rosterFreezeState(season, today),
  };
}

/** Normalize an untrusted `?phase=` query value. Anything unrecognised (including
 *  absent) falls back to `full`, so an old client or a typo gets today's
 *  behavior rather than an error or an empty board. */
export function parseScoringPhase(raw: string | null | undefined): ScoringPhase {
  return raw === "playoff" || raw === "regular" ? raw : "full";
}
