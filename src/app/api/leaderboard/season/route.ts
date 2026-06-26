// GET /api/leaderboard/season
//   ?token=...                     → global leaderboard for active season + player's teams
//   ?token=...&team_id=...         → team leaderboard for one team
//
// Uses the global_leaderboard() and team_leaderboard_season() Postgres RPCs,
// which are SECURITY DEFINER and bypass RLS.

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export const dynamic = 'force-dynamic';

// CT calendar date — matches the play_date written by /api/score and the
// AUTO-128 rotation boundary, so "today" lines up with the daily puzzle reset.
const DC_TZ = 'America/Chicago';
function centralDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// subscriber_id → today's running daily score (from leaderboard_daily, CT date).
async function fetchTodayPoints(
  headers: Record<string, string>
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const playDate = centralDate(new Date());
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/leaderboard_daily?play_date=eq.${playDate}&select=subscriber_id,score`,
    { headers, cache: 'no-store' }
  );
  if (!r.ok) return map;
  const rows = await r.json().catch(() => null);
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && row.subscriber_id != null) {
      map.set(row.subscriber_id as string, Number(row.score) || 0);
    }
  }
  return map;
}

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

  // Today's per-subscriber points (CT date) — annotates every row so the board
  // can show "Today" alongside the season total.
  const todayMap = await fetchTodayPoints(h);

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

    const teamRows = (Array.isArray(rows) ? rows : []).map((r: Record<string, unknown>) => ({
      rank: r.rank,
      subscriber_id: r.subscriber_id,
      handle: r.handle,
      total_points: r.total_points,
      today_points: todayMap.get(r.subscriber_id as string) ?? 0,
      is_you: sub ? r.subscriber_id === sub.id : false,
    }));
    // Team's combined points earned today.
    const teamTodayTotal = teamRows.reduce(
      (sum: number, r: { today_points: number }) => sum + (r.today_points || 0),
      0
    );

    return Response.json({
      season,
      team_id: teamId,
      team_total: teamTotal,
      team_today_total: teamTodayTotal,
      leaderboard: teamRows,
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

  // Fetch all team memberships for this season to annotate each player row
  const allMemR = await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?season_id=eq.${season.id}&pending=eq.false&select=subscriber_id,team_id,teams(id,name)`,
    { headers: h, cache: 'no-store' }
  );
  const allMems = allMemR.ok ? await allMemR.json().catch(() => []) : [];

  // Build subscriber_id → teams map
  const subTeamsMap = new Map<string, Array<{ team_id: string; team_name: string }>>();
  for (const m of (Array.isArray(allMems) ? allMems : [])) {
    const team = m.teams as Record<string, unknown> | null;
    if (!subTeamsMap.has(m.subscriber_id as string)) subTeamsMap.set(m.subscriber_id as string, []);
    subTeamsMap.get(m.subscriber_id as string)!.push({
      team_id: m.team_id as string,
      team_name: (team?.name as string) ?? '',
    });
  }

  const leaderboard = (Array.isArray(rows) ? rows : []).map((r: Record<string, unknown>) => ({
    rank: r.rank,
    subscriber_id: r.subscriber_id,
    handle: r.handle,
    total_points: r.total_points,
    today_points: todayMap.get(r.subscriber_id as string) ?? 0,
    is_you: sub ? r.subscriber_id === sub.id : false,
    teams: subTeamsMap.get(r.subscriber_id as string) ?? [],
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
