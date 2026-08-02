// GET /api/season/active — returns the active season with Free Agency window dates
// and the derived playoff / roster-freeze state.
// Used by the client to gate team-selection UI and show/hide Free Agency copy.
//
// THE single season source for both team-picker surfaces (`/account` and the
// in-app account screen in DailyChallenge.jsx), so the derived state is computed
// here ONCE rather than re-deriving dates in two clients that could disagree.

import { SEASON_PLAYOFF_COLUMNS, statusFor } from '@/lib/league-playoffs/server';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export const dynamic = 'force-dynamic';

export async function GET() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return Response.json({ error: 'not_configured' }, { status: 500 });

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/seasons?status=eq.active` +
      `&select=${SEASON_PLAYOFF_COLUMNS},free_agency_start,free_agency_notice_start&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      cache: 'no-store',
    }
  );

  if (!r.ok) return Response.json({ error: 'fetch_failed' }, { status: 502 });

  const rows = await r.json().catch(() => null);
  const season = Array.isArray(rows) ? rows[0] : null;

  if (!season) return Response.json({ season: null });

  // Derived playoff state, computed server-side in the SEASON's own timezone so a
  // client in another zone can never disagree about whether rosters are frozen.
  // Purely additive — every pre-existing field is still returned unchanged.
  const status = statusFor(season);

  return Response.json({
    season: {
      ...season,
      roster_frozen: status.roster.frozen,
      days_until_roster_freeze: status.roster.daysUntilFreeze,
      season_phase: status.phase,
      playoffs_live: status.playoffsLive,
      days_until_playoffs: status.daysUntilPlayoffs,
    },
  });
}
