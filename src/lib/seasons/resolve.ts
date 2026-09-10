// THE season resolver (CC-LO-CONCURRENT-SEASONS-1.0, D1).
//
// Seasons are independent and may overlap (CC-LO-SEASONS-OVERLAP-1.0), so
// "the active season" is not a thing any more — there is the season FOR A
// SUBSCRIBER (their confirmed, in-scope team membership decides; a carve-out
// beats the platform season, D3/D5) and the DEFAULT season for anonymous or
// team-less callers (the platform-scoped active season, D4). Both are decided
// by ONE SQL function, `fn_season_for_subscriber`, and never re-derived here.
//
// Every runtime reader that used to do `seasons?status=eq.active…&limit=1`
// goes through this module. `npm run test:season-resolve` fails the build if
// that predicate reappears anywhere else under src/.
//
// Fail-soft: every failure path returns null, which callers already treat as
// "no active season" — the pre-existing behaviour for an empty active set.

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

/** The full `seasons` row as `fn_season_for_subscriber_row` returns it. Typed
 *  loosely on purpose: every caller narrows to the columns it already used. */
export type ResolvedSeason = {
  id: string;
  slug: string | null;
  name: string | null;
  starts_on: string;
  ends_on: string;
  status: "upcoming" | "active" | "closed";
  tz: string | null;
  locked_at: string | null;
  free_agency_start: string | null;
  free_agency_notice_start: string | null;
  league_id: string | null;
  playoff_starts_on: string | null;
  roster_freeze_on: string | null;
  trading_open_starts_on: string | null;
  trading_open_ends_on: string | null;
  trading_close_starts_on: string | null;
  trading_close_ends_on: string | null;
  pilot_approved_at: string | null;
  generated_at: string | null;
  created_at: string | null;
};

/**
 * The season for `subscriberId` (null = anonymous → the default season).
 * `headers` are service-role PostgREST headers (the RPC is service_role-only).
 * Returns null when no season resolves, when the key is missing, or on any
 * transport/shape failure — never throws.
 */
export async function resolveSeasonFor(
  headers: Record<string, string> | null | undefined,
  subscriberId: string | null | undefined
): Promise<ResolvedSeason | null> {
  if (!headers) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_season_for_subscriber_row`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ p_subscriber_id: subscriberId ?? null }),
    });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    return row && typeof row.id === "string" ? (row as ResolvedSeason) : null;
  } catch {
    return null;
  }
}

/** Just the id. Same contract as resolveSeasonFor. */
export async function resolveSeasonIdFor(
  headers: Record<string, string> | null | undefined,
  subscriberId: string | null | undefined
): Promise<string | null> {
  const s = await resolveSeasonFor(headers, subscriberId);
  return s?.id ?? null;
}
