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
  /** Trading windows (CC-LO-TRADING-WINDOWS-1.0). Both ends of a window are
   *  present together or not at all — the `seasons_trading_*_paired` CHECKs
   *  guarantee it. NULL on every season created before 2026-09-07. */
  trading_open_starts_on?: string | null;
  trading_open_ends_on?: string | null;
  trading_close_starts_on?: string | null;
  trading_close_ends_on?: string | null;
  /** GENERATED ALWAYS as `ends_on - 3`. Free agency runs from here to the end
   *  of the season and counts as a third open period (Myke, 2026-09-08). */
  free_agency_start?: string | null;
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

// ── roster move windows (CC-LO-FA-WINDOWS-1.0) ───────────────────────────────
//
// A season may declare two trading windows. When it does, a roster MOVE is only
// legal inside one of three open periods: the opening window, the closing
// window, or free agency (`free_agency_start` … `ends_on`).
//
// Three rules make this safe to ship on a live estate:
//
//   1. FAIL OPEN. A season with no stored windows is not using the feature, so
//      it is never gated. Every season created before 2026-09-07 has NULLs —
//      including `testing`, which is active right now with 18 memberships.
//   2. A FIRST JOIN IS ALWAYS ALLOWED. A player holding no team this season may
//      join, create or accept an invite at any time; onboarding is never
//      blocked. Only moving once you already hold a team needs an open period.
//   3. THE PLAYOFF FREEZE STILL WINS. `roster_freeze_on` is an absolute stop and
//      is checked first — free agency does NOT reopen a frozen roster.

/**
 * The League Office knobs that govern roster writes, as resolved by
 * `v_season_effective_config` — the ONE place "which config is in force right
 * now" is decided (state active|scheduled, effective_from <= now < effective_to).
 * A `draft` config is deliberately not effective, so a season whose only version
 * is a draft yields all-nulls here.
 *
 * EVERY field is optional and null-permissive: a null means "not configured",
 * and not-configured never blocks. That is what keeps the five seasons with no
 * effective config — `testing` among them, live with 18 memberships — ungated.
 */
export type SeasonRules = {
  /** false ⇒ free agency does NOT count as an open period. */
  allow_free_agency?: boolean | null;
  /** false ⇒ a FIRST join is refused once late-join has closed. */
  allow_late_join?: boolean | null;
  /** false ⇒ no moves at all, whatever the windows say. */
  allow_mid_season_team_switch?: boolean | null;
  /** Config-level roster lock. A softer sibling of `seasons.roster_freeze_on`:
   *  same one-way effect, but versioned and set on the config, not the season. */
  roster_lock_on?: string | null;
  /** Anchors "late". Falls back to `starts_on` when unset (Myke, 2026-09-08). */
  registration_closes_on?: string | null;
};

/** Treat a null/absent flag as permissive — see `SeasonRules`. */
function allows(flag: boolean | null | undefined): boolean {
  return flag !== false;
}

/** Does this season gate roster moves at all? False = fail open. */
export function seasonGatesMoves(season: SeasonDates | null): boolean {
  if (!season) return false;
  return (
    isDate(season.trading_open_starts_on) ||
    isDate(season.trading_close_starts_on)
  );
}

/** The open periods for a gated season, in chronological order. Empty for a
 *  season that does not gate (callers should check `seasonGatesMoves` first —
 *  an empty list means "nothing is open", not "everything is"). */
export function moveWindows(season: SeasonDates, rules: SeasonRules = {}): DateWindow[] {
  const out: DateWindow[] = [];
  const push = (from: string | null | undefined, to: string | null | undefined) => {
    if (isDate(from) && isDate(to) && to >= from) out.push({ from, to });
  };

  push(season.trading_open_starts_on, season.trading_open_ends_on);
  push(season.trading_close_starts_on, season.trading_close_ends_on);
  // Free agency: from the generated start through the season end. It is clamped
  // to `ends_on` because a roster move after the season is over is meaningless
  // — the season-detail timeline deliberately draws the FA band overhanging the
  // end, but that is presentation, not permission. Suppressed entirely when the
  // config turns free agency off.
  if (allows(rules.allow_free_agency)) push(season.free_agency_start, season.ends_on);

  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

export type RosterMoveState = {
  /** Whether this season gates moves at all. */
  gated: boolean;
  /** Whether a move is permitted right now (ignoring the playoff freeze, which
   *  the caller checks first and which overrides this). */
  open: boolean;
  /** The period containing `today`, when one does. */
  currentWindow: DateWindow | null;
  /** The next period that opens after `today`, when one does. */
  nextWindow: DateWindow | null;
  /** All open periods, chronological. */
  windows: DateWindow[];
};

/** Where `today` sits relative to a season's roster-move periods. */
export function rosterMoveState(
  season: SeasonDates,
  today: string,
  rules: SeasonRules = {}
): RosterMoveState {
  if (!seasonGatesMoves(season)) {
    return { gated: false, open: true, currentWindow: null, nextWindow: null, windows: [] };
  }
  const windows = moveWindows(season, rules);
  const currentWindow = windows.find((w) => windowContains(w, today)) ?? null;
  const nextWindow = windows.find((w) => w.from > today) ?? null;
  return { gated: true, open: currentWindow != null, currentWindow, nextWindow, windows };
}

/** The wire error code a blocked roster MOVE returns. Distinct from
 *  `roster_frozen`: that one is terminal for the season, this one reopens. */
export const MOVE_WINDOW_CLOSED_CODE = "trading_window_closed";

/** Player-facing sentence for a blocked move. `nextOpensOn` is appended by the
 *  guard when a later window exists, so the player learns when to come back. */
export const MOVE_WINDOW_CLOSED_MESSAGE =
  "Rosters are locked outside the trading windows.";

/** Config-level roster lock (`season_config.roster_lock_on`). One-way like the
 *  playoff freeze, but versioned — hence its own code and copy. */
export const ROSTER_LOCKED_CODE = "roster_locked";
export const ROSTER_LOCKED_MESSAGE = "Rosters are locked for this season.";

/** `allow_mid_season_team_switch = false`. */
export const SWITCHING_DISABLED_CODE = "switching_disabled";
export const SWITCHING_DISABLED_MESSAGE =
  "Team switching is turned off for this season.";

/** `allow_late_join = false`, past the late-join deadline. */
export const LATE_JOIN_CLOSED_CODE = "late_join_closed";
export const LATE_JOIN_CLOSED_MESSAGE = "This season is closed to new players.";

export type MoveBlockReason =
  | "ok"
  | "frozen"
  | "locked"
  | "switching_disabled"
  | "late_join_closed"
  | "window_closed";

/** The date after which a FIRST join counts as "late". `registration_closes_on`
 *  when the config sets one, else the season start (Myke, 2026-09-08). Null when
 *  neither is a usable date, in which case nothing is ever late. */
export function lateJoinDeadline(
  season: SeasonDates,
  rules: SeasonRules = {}
): string | null {
  if (isDate(rules.registration_closes_on)) return rules.registration_closes_on;
  return isDate(season.starts_on) ? season.starts_on : null;
}

/**
 * The one place the "may this roster write proceed?" question is answered.
 *
 * Precedence, strictest first — order is the whole contract:
 *
 *   1. `seasons.roster_freeze_on`      playoff freeze, absolute
 *   2. `season_config.roster_lock_on`  config lock, absolute
 *   3. first join?  → `allow_late_join` decides, and nothing else applies
 *   4. `allow_mid_season_team_switch`  a hard off-switch for moves
 *   5. the trading windows             (free agency included per `allow_free_agency`)
 *
 * `isFirstJoin` must be true only when the player currently holds NO team in
 * this season AND the write adds one. Leaving is never a first join.
 */
export function canMoveRoster(
  season: SeasonDates,
  today: string,
  opts: { isFirstJoin?: boolean; rules?: SeasonRules } = {}
): { allowed: boolean; reason: MoveBlockReason; state: RosterMoveState } {
  const rules = opts.rules ?? {};
  const state = rosterMoveState(season, today, rules);
  const no = (reason: MoveBlockReason) => ({ allowed: false, reason, state });

  // 1. The playoff freeze is absolute and is checked BEFORE everything, so an
  //    open free-agency period can never thaw a frozen roster.
  if (isRosterFrozen(season, today)) return no("frozen");

  // 2. The config-level lock behaves the same way, one version down.
  if (isDate(rules.roster_lock_on) && today >= rules.roster_lock_on) return no("locked");

  // 3. A first join answers to `allow_late_join` alone. It is deliberately NOT
  //    subject to the windows or the switch flag: joining your first team is
  //    onboarding, not trading.
  if (opts.isFirstJoin) {
    if (allows(rules.allow_late_join)) return { allowed: true, reason: "ok", state };
    const deadline = lateJoinDeadline(season, rules);
    return deadline && today > deadline
      ? no("late_join_closed")
      : { allowed: true, reason: "ok", state };
  }

  // 4. A hard off-switch for moves, independent of any window.
  if (!allows(rules.allow_mid_season_team_switch)) return no("switching_disabled");

  // 5. Finally the windows. An ungated season (no stored windows) is open.
  if (!state.gated) return { allowed: true, reason: "ok", state };
  return state.open ? { allowed: true, reason: "ok", state } : no("window_closed");
}
