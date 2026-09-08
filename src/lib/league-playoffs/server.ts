// League Playoffs — server-side season loading + the roster-freeze route guard.
//
// The player-facing API routes write `team_memberships` directly over
// service-role PostgREST rather than going through the team_* RPCs, so the DB
// guard added in migration 20260802120000 does not cover them. This module is
// the matching fence for those routes: same predicate, same wire code, derived
// from the same pure module so the two can't drift.
//
// The League Office `membership.*` actions deliberately do NOT use this — the
// commissioner is above the freeze. See the migration header for why the guard
// is not a table trigger.

import {
  LATE_JOIN_CLOSED_CODE,
  LATE_JOIN_CLOSED_MESSAGE,
  MOVE_WINDOW_CLOSED_CODE,
  MOVE_WINDOW_CLOSED_MESSAGE,
  ROSTER_FROZEN_CODE,
  ROSTER_FROZEN_MESSAGE,
  ROSTER_LOCKED_CODE,
  ROSTER_LOCKED_MESSAGE,
  SWITCHING_DISABLED_CODE,
  SWITCHING_DISABLED_MESSAGE,
  canMoveRoster,
  type SeasonRules,
  playoffStatus,
  rosterFreezeState,
  seasonToday,
  type PlayoffStatus,
  type SeasonDates,
} from "./phase";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

/** Columns every playoff-aware caller needs. Kept in one place so a route can
 *  never half-select and silently lose the freeze date (which would fail open). */
export const SEASON_PLAYOFF_COLUMNS =
  "id,name,starts_on,ends_on,locked_at,tz,playoff_starts_on,roster_freeze_on," +
  // Trading windows + the generated FA start. Selected here rather than at each
  // call site for the same reason the freeze date is: a route that half-selects
  // would fail OPEN and silently stop gating moves.
  "trading_open_starts_on,trading_open_ends_on," +
  "trading_close_starts_on,trading_close_ends_on,free_agency_start";

export type PlayoffSeason = SeasonDates & {
  id: string;
  name?: string | null;
  locked_at?: string | null;
};

/** Fetch one season by id with the playoff columns. Null when absent/unreadable. */
export async function fetchSeasonById(
  headers: Record<string, string>,
  seasonId: string
): Promise<PlayoffSeason | null> {
  return firstRow(
    headers,
    `seasons?id=eq.${encodeURIComponent(seasonId)}&select=${SEASON_PLAYOFF_COLUMNS}&limit=1`
  );
}

/** Fetch the active season with the playoff columns. */
export async function fetchActiveSeason(
  headers: Record<string, string>
): Promise<PlayoffSeason | null> {
  return firstRow(
    headers,
    `seasons?status=eq.active&select=${SEASON_PLAYOFF_COLUMNS}&order=starts_on.desc&limit=1`
  );
}

async function firstRow(
  headers: Record<string, string>,
  path: string
): Promise<PlayoffSeason | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers, cache: "no-store" });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ?? null;
  } catch {
    return null;
  }
}

/** "Today" for a season, in the season's own zone. */
export function todayFor(season: SeasonDates): string {
  return seasonToday(season.tz);
}

/** Whether player roster writes are currently blocked for this season. */
export function isSeasonRosterFrozen(season: SeasonDates | null): boolean {
  if (!season) return false;
  return rosterFreezeState(season, todayFor(season)).frozen;
}

/** Full derived playoff state for a season, as the client surfaces consume it. */
export function statusFor(season: SeasonDates): PlayoffStatus {
  return playoffStatus(season, todayFor(season));
}

/**
 * The guard for player roster writes. Returns a ready-to-return 403 when the
 * season's roster is frozen, or null when the write may proceed.
 *
 * 403 (not 423) on purpose: 423 Locked is already the season-lock code across
 * this codebase, and the two states are independent — a season can be frozen
 * without being locked, and vice versa. Clients branch on the `error` string,
 * not the status, so both stay distinguishable.
 */
export function rosterFreezeGuard(season: SeasonDates | null): Response | null {
  if (!isSeasonRosterFrozen(season)) return null;
  const state = rosterFreezeState(season!, todayFor(season!));
  return Response.json(
    {
      error: ROSTER_FROZEN_CODE,
      message: ROSTER_FROZEN_MESSAGE,
      roster_freeze_on: state.freezeOn,
    },
    { status: 403 }
  );
}

/** True when a PostgREST error body is the DB-side freeze rejection — the
 *  FRZ01 SQLSTATE or the token the RPCs put in the message. Lets a route that
 *  calls team_join/team_leave surface the same shape as its own guard even if
 *  the freeze flips between the check and the call. */
export function isDbRosterFrozenError(body: string): boolean {
  return body.includes("FRZ01") || body.includes(ROSTER_FROZEN_CODE);
}

/** True when a PostgREST error body is the DB-side trading-window rejection. */
export function isDbMoveWindowError(body: string): boolean {
  return body.includes("TWC01") || body.includes(MOVE_WINDOW_CLOSED_CODE);
}

/**
 * The guard for roster MOVES (CC-LO-FA-WINDOWS-1.0). Supersedes a bare
 * `rosterFreezeGuard` call on any route that writes memberships: it checks the
 * playoff freeze FIRST and then the trading windows, so one call covers both
 * and their precedence can never be got wrong at a call site.
 *
 * `isFirstJoin` must be true only when the player currently holds no team in
 * this season and the write adds one — onboarding is never gated. Leaving is
 * never a first join.
 *
 * Returns a ready-to-return 403, or null when the write may proceed.
 */
export function rosterMoveGuard(
  season: SeasonDates | null,
  opts: { isFirstJoin?: boolean; rules?: SeasonRules } = {}
): Response | null {
  if (!season) return null;
  const verdict = canMoveRoster(season, todayFor(season), opts);
  if (verdict.allowed) return null;

  // Delegate so the frozen payload stays byte-identical to the old guard —
  // `/account`, the picker and the team page all branch on that exact shape.
  if (verdict.reason === "frozen") return rosterFreezeGuard(season);

  const next = verdict.state.nextWindow;
  const body =
    verdict.reason === "locked"
      ? { error: ROSTER_LOCKED_CODE, message: ROSTER_LOCKED_MESSAGE }
      : verdict.reason === "switching_disabled"
        ? { error: SWITCHING_DISABLED_CODE, message: SWITCHING_DISABLED_MESSAGE }
        : verdict.reason === "late_join_closed"
          ? { error: LATE_JOIN_CLOSED_CODE, message: LATE_JOIN_CLOSED_MESSAGE }
          : {
              error: MOVE_WINDOW_CLOSED_CODE,
              message: next
                ? `${MOVE_WINDOW_CLOSED_MESSAGE} The next window opens ${next.from}.`
                : MOVE_WINDOW_CLOSED_MESSAGE,
              next_window: next,
              windows: verdict.state.windows,
            };

  return Response.json(body, { status: 403 });
}

/** The League Office knobs in force for a season RIGHT NOW.
 *
 *  Reads `v_season_effective_config`, which is the single authority on which
 *  version is live (state active|scheduled, inside its effective dates). A
 *  season whose only config is a `draft` resolves to no row — and every field
 *  of `SeasonRules` is null-permissive, so that season stays ungated rather
 *  than falling into some default. Any failure returns `{}` for the same
 *  reason: the rules layer must never fail CLOSED and lock players out because
 *  a read went wrong.
 */
export async function fetchSeasonRules(
  headers: Record<string, string>,
  seasonId: string
): Promise<SeasonRules> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/v_season_effective_config` +
        `?season_id=eq.${encodeURIComponent(seasonId)}` +
        `&select=allow_free_agency,allow_late_join,allow_mid_season_team_switch,` +
        `roster_lock_on,registration_closes_on&limit=1`,
      { headers, cache: "no-store" }
    );
    if (!r.ok) return {};
    const rows = await r.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    return (row as SeasonRules) ?? {};
  } catch {
    return {};
  }
}

export {
  ROSTER_FROZEN_CODE,
  ROSTER_FROZEN_MESSAGE,
  MOVE_WINDOW_CLOSED_CODE,
  MOVE_WINDOW_CLOSED_MESSAGE,
  ROSTER_LOCKED_CODE,
  SWITCHING_DISABLED_CODE,
  LATE_JOIN_CLOSED_CODE,
  type SeasonRules,
};
