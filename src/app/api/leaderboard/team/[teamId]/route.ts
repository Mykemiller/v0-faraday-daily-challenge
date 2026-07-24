// Team page data + management API.
//
// GET  /api/leaderboard/team/[teamId]?token=...
//   → team detail, full member roster (incl. members who haven't scored → null
//     scores, rendered as "—"), team totals, team rank among teams, and the
//     viewer's relationship to the team (member / captain). join_token is
//     returned only to members (it backs the invite link).
//
// POST /api/leaderboard/team/[teamId]   body: { token, action, ... }
//   action "rename"       (captain only)  { name }        → rename the team
//   action "leave"        (member only)                   → leave via team_leave RPC
//   action "rotate-token" (captain only)                  → new join_token
//
// All mutations are authorized server-side against the resolved session — the
// UI hiding an affordance is never the enforcement point. Mirrors the
// service-role + dc_sessions pattern used by /api/leaderboard/season and
// /api/teams. The route key is teams.id (uuid) — the identifier the whole
// leaderboard data layer already keys on.

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export const dynamic = 'force-dynamic';

const DC_TZ = 'America/Chicago';
function centralDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
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

type Svc = Record<string, string>;

async function resolveSubscriber(
  h: Svc,
  token: string
): Promise<{ id: string; handle: string | null; email: string | null } | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || (row.expires_at && new Date(row.expires_at) < new Date())) return null;
  const sr = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_subscribers?id=eq.${row.subscriber_id}&select=id,handle,email`,
    { headers: h, cache: 'no-store' }
  );
  const srows = await sr.json().catch(() => null);
  const sub = Array.isArray(srows) ? srows[0] : null;
  return sub ? { id: sub.id, handle: sub.handle, email: sub.email } : null;
}

async function activeSeason(h: Svc) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/seasons?status=eq.active&select=id,name,ends_on,locked_at&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? rows[0] : null;
}

async function fetchTeam(h: Svc, teamId: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/teams?id=eq.${encodeURIComponent(teamId)}&select=id,name,code,captain_id,group_type,parent_id,join_token&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

interface RosterMember {
  rank: number | null;
  subscriber_id: string;
  handle: string;
  today_points: number | null;
  season_points: number | null;
  is_you: boolean;
  is_captain: boolean;
}

// GET — team detail + roster
export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const h = svcHeaders();
  if (!h) return Response.json({ error: 'not_configured' }, { status: 500 });

  const { teamId } = await params;
  // Basic uuid shape guard so a bad path segment reads as "not found", not a 500.
  if (!/^[0-9a-fA-F-]{16,}$/.test(teamId)) {
    return Response.json({ error: 'team_not_found' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') ?? '';

  const season = await activeSeason(h);
  if (!season) return Response.json({ error: 'no_active_season' }, { status: 404 });

  const team = await fetchTeam(h, teamId);
  if (!team) return Response.json({ error: 'team_not_found' }, { status: 404 });

  const viewer = token ? await resolveSubscriber(h, token) : null;

  // Full active membership list for this team + season (INCLUDING members who
  // have never scored — the team_leaderboard_season RPC inner-joins score_events
  // and would drop them, but the roster must show them as "—").
  const memR = await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?team_id=eq.${teamId}&season_id=eq.${season.id}&pending=eq.false&select=subscriber_id,created_at,dc_subscribers(id,handle,email,active)`,
    { headers: h, cache: 'no-store' }
  );
  const memRows: Array<{
    subscriber_id: string;
    created_at: string;
    dc_subscribers?: { id: string; handle: string | null; email: string | null; active: boolean };
  }> = memR.ok ? await memR.json().catch(() => []) : [];
  const members = memRows.filter(m => m.dc_subscribers?.active !== false);

  const isMember = viewer ? members.some(m => m.subscriber_id === viewer.id) : false;
  const isCaptain = viewer ? team.captain_id === viewer.id : false;

  // Season points per member (scored members only).
  const seasonPointsMap = new Map<string, number>();
  const lbR = await fetch(`${SUPABASE_URL}/rest/v1/rpc/team_leaderboard_season`, {
    method: 'POST',
    headers: { ...h, Prefer: 'return=representation' },
    body: JSON.stringify({ p_team_id: teamId, p_season_id: season.id }),
  });
  if (lbR.ok) {
    const rows = await lbR.json().catch(() => []);
    for (const r of Array.isArray(rows) ? rows : []) {
      seasonPointsMap.set(r.subscriber_id as string, Number(r.total_points) || 0);
    }
  }

  // Today's points per member (from leaderboard_daily, CT date).
  const todayMap = new Map<string, number>();
  const ids = members.map(m => m.subscriber_id);
  if (ids.length > 0) {
    const playDate = centralDate(new Date());
    const inList = ids.map(encodeURIComponent).join(',');
    const tR = await fetch(
      `${SUPABASE_URL}/rest/v1/leaderboard_daily?play_date=eq.${playDate}&subscriber_id=in.(${inList})&select=subscriber_id,score`,
      { headers: h, cache: 'no-store' }
    );
    if (tR.ok) {
      const rows = await tR.json().catch(() => []);
      for (const r of Array.isArray(rows) ? rows : []) {
        if (r?.subscriber_id != null) todayMap.set(r.subscriber_id as string, Number(r.score) || 0);
      }
    }
  }

  // Team aggregate season total (authoritative RPC).
  const totR = await fetch(`${SUPABASE_URL}/rest/v1/rpc/team_total_score`, {
    method: 'POST',
    headers: { ...h, Prefer: 'return=representation' },
    body: JSON.stringify({ p_team_id: teamId, p_season_id: season.id }),
  });
  const teamTotal = totR.ok ? ((await totR.json().catch(() => 0)) as number) || 0 : 0;
  const teamTodayTotal = ids.reduce((s, id) => s + (todayMap.get(id) ?? 0), 0);

  // Build roster. Members with a season entry are "scored" and ranked 1..k by
  // season desc → today desc → handle asc; members who have never scored sort to
  // the bottom with rank null and both scores null (→ "—" in the UI).
  const enriched = members.map(m => {
    const sub = m.dc_subscribers!;
    const handle = sub.handle || (sub.email ? sub.email.split('@')[0] : 'anonymous');
    const scored = seasonPointsMap.has(m.subscriber_id);
    return {
      subscriber_id: m.subscriber_id,
      handle,
      season_points: scored ? seasonPointsMap.get(m.subscriber_id)! : null,
      today_points: todayMap.has(m.subscriber_id) ? todayMap.get(m.subscriber_id)! : null,
      is_you: viewer ? m.subscriber_id === viewer.id : false,
      is_captain: team.captain_id === m.subscriber_id,
    };
  });

  const cmpHandle = (a: { handle: string }, b: { handle: string }) =>
    a.handle.toLowerCase().localeCompare(b.handle.toLowerCase());

  const scored = enriched
    .filter(m => m.season_points !== null)
    .sort((a, b) => {
      if ((b.season_points ?? 0) !== (a.season_points ?? 0)) return (b.season_points ?? 0) - (a.season_points ?? 0);
      if ((b.today_points ?? 0) !== (a.today_points ?? 0)) return (b.today_points ?? 0) - (a.today_points ?? 0);
      return cmpHandle(a, b);
    });
  const unscored = enriched.filter(m => m.season_points === null).sort(cmpHandle);

  const roster: RosterMember[] = [
    ...scored.map((m, i) => ({ ...m, rank: i + 1 })),
    ...unscored.map(m => ({ ...m, rank: null })),
  ];

  // Team rank among teams — aggregate the same way the Leaderboard "Teams" tab
  // does (sum member season totals across all pending=false memberships) so the
  // "#N of M" here matches what the user sees there.
  let teamRank: number | null = null;
  let teamCount = 0;
  const glR = await fetch(`${SUPABASE_URL}/rest/v1/rpc/global_leaderboard`, {
    method: 'POST',
    headers: { ...h, Prefer: 'return=representation' },
    body: JSON.stringify({ p_season_id: season.id }),
  });
  const allMemR = await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?season_id=eq.${season.id}&pending=eq.false&select=subscriber_id,team_id`,
    { headers: h, cache: 'no-store' }
  );
  if (glR.ok && allMemR.ok) {
    const glRows: Array<{ subscriber_id: string; total_points: number }> =
      (await glR.json().catch(() => [])) || [];
    const pointsBySub = new Map<string, number>();
    for (const r of Array.isArray(glRows) ? glRows : []) {
      pointsBySub.set(r.subscriber_id, Number(r.total_points) || 0);
    }
    const allMems: Array<{ subscriber_id: string; team_id: string }> =
      (await allMemR.json().catch(() => [])) || [];
    const totalByTeam = new Map<string, number>();
    for (const m of Array.isArray(allMems) ? allMems : []) {
      totalByTeam.set(m.team_id, (totalByTeam.get(m.team_id) ?? 0) + (pointsBySub.get(m.subscriber_id) ?? 0));
    }
    const ranked = [...totalByTeam.entries()].sort((a, b) => b[1] - a[1]);
    teamCount = ranked.length;
    const idx = ranked.findIndex(([tid]) => tid === teamId);
    teamRank = idx >= 0 ? idx + 1 : null;
  }

  return Response.json({
    season: { id: season.id, name: season.name },
    team: {
      id: team.id,
      name: team.name,
      code: team.code,
      group_type: team.group_type,
      captain_id: team.captain_id,
    },
    member_count: members.length,
    team_total: teamTotal,
    team_today_total: teamTodayTotal,
    team_rank: teamRank,
    team_count: teamCount,
    viewer: {
      authed: !!viewer,
      subscriber_id: viewer?.id ?? null,
      is_member: isMember,
      is_captain: isCaptain,
    },
    // Invite link backing token — members only.
    join_token: isMember ? team.join_token : null,
    roster,
  });
}

// POST — management actions
export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const h = svcHeaders();
  if (!h) return Response.json({ error: 'not_configured' }, { status: 500 });

  const { teamId } = await params;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'invalid_body' }, { status: 400 }); }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!token) return Response.json({ error: 'missing_token' }, { status: 401 });

  const viewer = await resolveSubscriber(h, token);
  if (!viewer) return Response.json({ error: 'invalid_session' }, { status: 401 });

  const season = await activeSeason(h);
  if (!season) return Response.json({ error: 'no_active_season' }, { status: 404 });
  const isLocked = season.locked_at && new Date() > new Date(season.locked_at);

  const team = await fetchTeam(h, teamId);
  if (!team) return Response.json({ error: 'team_not_found' }, { status: 404 });

  const isCaptain = team.captain_id === viewer.id;

  // Membership check (active season, non-pending).
  const memR = await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?team_id=eq.${teamId}&season_id=eq.${season.id}&subscriber_id=eq.${viewer.id}&pending=eq.false&select=subscriber_id&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  const isMember = memR.ok ? ((await memR.json().catch(() => [])) as unknown[]).length > 0 : false;

  // ── Rename (captain only) ───────────────────────────────────────────────────
  if (action === 'rename') {
    if (!isCaptain) return Response.json({ error: 'not_captain' }, { status: 403 });
    if (isLocked) return Response.json({ error: 'season_locked' }, { status: 403 });

    const raw = typeof body.name === 'string' ? body.name : '';
    const name = raw.trim();
    if (name.length < 2 || name.length > 40) {
      return Response.json({ error: 'invalid_name', message: 'Team name must be 2–40 characters.' }, { status: 400 });
    }

    // Case-insensitive uniqueness across all teams (excluding this one). Team
    // count is small; fetch names and compare in JS to avoid ILIKE wildcard
    // pitfalls with %, _ in names.
    const allR = await fetch(
      `${SUPABASE_URL}/rest/v1/teams?select=id,name&limit=2000`,
      { headers: h, cache: 'no-store' }
    );
    const allTeams: Array<{ id: string; name: string }> = allR.ok ? await allR.json().catch(() => []) : [];
    const clash = allTeams.some(t => t.id !== teamId && (t.name ?? '').trim().toLowerCase() === name.toLowerCase());
    if (clash) {
      return Response.json({ error: 'name_taken', message: 'That team name is already taken.' }, { status: 409 });
    }

    const upR = await fetch(
      `${SUPABASE_URL}/rest/v1/teams?id=eq.${teamId}`,
      { method: 'PATCH', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify({ name }) }
    );
    if (!upR.ok) {
      const err = await upR.text();
      console.error('team rename failed', err);
      return Response.json({ error: 'rename_failed' }, { status: 500 });
    }
    return Response.json({ ok: true, name });
  }

  // ── Leave (any member) ──────────────────────────────────────────────────────
  if (action === 'leave') {
    if (!isMember) return Response.json({ error: 'not_a_member' }, { status: 403 });
    if (!viewer.email) return Response.json({ error: 'subscriber_not_found' }, { status: 400 });
    // Reuse the canonical team_leave RPC: season-scoped delete + captaincy roll +
    // last-member team cleanup (company-with-children preserved). Preserves the
    // subscriber's historical scores — only the membership is removed.
    const rpcR = await fetch(`${SUPABASE_URL}/rest/v1/rpc/team_leave`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=representation' },
      body: JSON.stringify({ p_email: viewer.email, p_code: team.code }),
    });
    if (!rpcR.ok) {
      const err = await rpcR.text();
      console.error('team leave failed', err);
      return Response.json({ error: 'leave_failed' }, { status: 500 });
    }
    return Response.json({ ok: true });
  }

  // ── Rotate invite token (captain only) ──────────────────────────────────────
  if (action === 'rotate-token') {
    if (!isCaptain) return Response.json({ error: 'not_captain' }, { status: 403 });
    const newToken = crypto.randomUUID();
    const patchR = await fetch(
      `${SUPABASE_URL}/rest/v1/teams?id=eq.${teamId}`,
      { method: 'PATCH', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify({ join_token: newToken }) }
    );
    if (!patchR.ok) {
      const err = await patchR.text();
      console.error('rotate token failed', err);
      return Response.json({ error: 'rotate_failed' }, { status: 500 });
    }
    return Response.json({ ok: true, join_token: newToken });
  }

  return Response.json({ error: 'unknown_action' }, { status: 400 });
}
