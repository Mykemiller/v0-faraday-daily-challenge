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
  ROSTER_FROZEN_CODE,
  ROSTER_FROZEN_MESSAGE,
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
  "id,name,starts_on,ends_on,locked_at,tz,playoff_starts_on,roster_freeze_on";

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

export { ROSTER_FROZEN_CODE, ROSTER_FROZEN_MESSAGE };
