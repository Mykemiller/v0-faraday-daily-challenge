// GET /api/leaderboard/season
//   ?token=...                     → global leaderboard for active season + player's teams
//   ?token=...&team_id=...         → team leaderboard for one team
//
// Uses the global_leaderboard() and team_leaderboard_season() Postgres RPCs,
// which are SECURITY DEFINER and bypass RLS.

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export const dynamic = 'force-dynamic';

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

async function resolveSubscriber(
  token: string
): Promise<{ id: string; handle: string | null } | null> {
  const h = svcHeaders();
  if (!h) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || (row.expires_at && new Date(row.expires_at) < new Date())) return null;

  // Get handle
  const sr = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_subscribers?id=eq.${row.subscriber_id}&select=id,handle`,
    { headers: h, cache: 'no-store' }
  );
  const srows = await sr.json().catch(() => null);
  const sub = Array.isArray(srows) ? srows[0] : null;
  return sub ? { id: sub.id, handle: sub.handle } : null;
}

export async function GET(request: Request) {
  const h = svcHeaders();
  if (!h) return Response.json({ error: 'not_configured' }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') ?? '';
  const teamId = searchParams.get('team_id') ?? '';

  // Resolve active season
  const seasonR = await fetch(
    `${SUPABASE_URL}/rest/v1/seasons?status=eq.active&select=id,name,starts_on,ends_on,free_agency_start,free_agency_notice_start,locked_at&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  const seasonRows = await seasonR.json().catch(() => null);
  const season = Array.isArray(seasonRows) ? seasonRows[0] : null;
  if (!season) return Response.json({ error: 'no_active_season' }, { status: 404 });

  // Resolve authenticated player (optional)
  let sub: { id: string; handle: string | null } | null = null;
  if (token) sub = await resolveSubscriber(token);

  if (teamId) {
    // Team leaderboard
    const rpcR = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/team_leaderboard_season`,
      {
        method: 'POST',
        headers: { ...h, Prefer: 'return=representation' },
        body: JSON.stringify({ p_team_id: teamId, p_season_id: season.id }),
      }
    );
    const rows = rpcR.ok ? await rpcR.json().catch(() => []) : [];

    // Team aggregate score
    const totR = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/team_total_score`,
      {
        method: 'POST',
        headers: { ...h, Prefer: 'return=representation' },
        body: JSON.stringify({ p_team_id: teamId, p_season_id: season.id }),
      }
    );
    const teamTotal = totR.ok ? ((await totR.json().catch(() => 0)) as number) : 0;

    return Response.json({
      season,
      team_id: teamId,
      team_total: teamTotal,
      leaderboard: (Array.isArray(rows) ? rows : []).map((r: Record<string, unknown>) => ({
        rank: r.rank,
        subscriber_id: r.subscriber_id,
        handle: r.handle,
        total_points: r.total_points,
        is_you: sub ? r.subscriber_id === sub.id : false,
      })),
    });
  }

  // Global leaderboard
  const rpcR = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/global_leaderboard`,
    {
      method: 'POST',
      headers: { ...h, Prefer: 'return=representation' },
      body: JSON.stringify({ p_season_id: season.id }),
    }
  );
  const rows = rpcR.ok ? await rpcR.json().catch(() => []) : [];

  const leaderboard = (Array.isArray(rows) ? rows : []).map((r: Record<string, unknown>) => ({
    rank: r.rank,
    subscriber_id: r.subscriber_id,
    handle: r.handle,
    total_points: r.total_points,
    is_you: sub ? r.subscriber_id === sub.id : false,
  }));

  const youRow = leaderboard.find((r: { is_you: boolean }) => r.is_you) ?? null;

  // Player's team memberships (for tab display)
  let myTeams: Array<{ team_id: string; team_name: string }> = [];
  if (sub) {
    const memR = await fetch(
      `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${sub.id}&season_id=eq.${season.id}&pending=eq.false&select=team_id,teams(id,name)`,
      { headers: h, cache: 'no-store' }
    );
    const mems = memR.ok ? await memR.json().catch(() => []) : [];
    myTeams = (Array.isArray(mems) ? mems : []).map((m: Record<string, unknown>) => {
      const team = m.teams as Record<string, unknown> | null;
      return { team_id: m.team_id as string, team_name: (team?.name as string) ?? '' };
    });
  }

  return Response.json({
    season,
    you: youRow,
    my_teams: myTeams,
    leaderboard,
  });
}
