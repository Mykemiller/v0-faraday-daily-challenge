// GET /api/season/active[?token=…] — returns the caller's season with Free Agency
// window dates and the derived playoff / roster-freeze state.
//
// Seasons are independent and may overlap (CC-LO-CONCURRENT-SEASONS-1.0): with a
// token this is the season for THAT subscriber (their in-scope team membership);
// anonymous, or with an invalid token, it is the platform default season — so
// the account page's first paint (before the session hydrates) still answers.
// Used by the client to gate team-selection UI and show/hide Free Agency copy.
//
// THE single season source for both team-picker surfaces (`/account` and the
// in-app account screen in DailyChallenge.jsx), so the derived state is computed
// here ONCE rather than re-deriving dates in two clients that could disagree.

import { statusFor } from '@/lib/league-playoffs/server';
import { resolveSeasonFor } from '@/lib/seasons/resolve';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export const dynamic = 'force-dynamic';

async function resolveSubscriberId(h: Record<string, string>, token: string): Promise<string | null> {
  if (!token) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || (row.expires_at && new Date(row.expires_at) < new Date())) return null;
  return row.subscriber_id ?? null;
}

export async function GET(request: Request) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return Response.json({ error: 'not_configured' }, { status: 500 });
  const h = { apikey: key, Authorization: `Bearer ${key}` };

  const token = new URL(request.url).searchParams.get('token') ?? '';
  const subscriberId = await resolveSubscriberId(h, token);
  const season = await resolveSeasonFor(h, subscriberId);

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
