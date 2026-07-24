// Teams API — search teams + read/write player's season-scoped team memberships.
//
// GET /api/teams?q=search               → list teams matching query (max 50)
// GET /api/teams?scope=my&token=...     → player's current memberships + pending
// POST /api/teams                       → upsert memberships (respects Free Agency gate)
//   body: { token, team_ids: string[], season_id: string }

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
    Prefer: 'return=representation',
  };
}

async function resolveSubscriber(token: string): Promise<string | null> {
  const h = svcHeaders();
  if (!h) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row.subscriber_id ?? null;
}

export async function GET(request: Request) {
  const h = svcHeaders();
  if (!h) return Response.json({ error: 'not_configured' }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get('scope');
  const q = searchParams.get('q') ?? '';
  const token = searchParams.get('token') ?? '';

  if (scope === 'my') {
    if (!token) return Response.json({ error: 'missing_token' }, { status: 401 });
    const subscriberId = await resolveSubscriber(token);
    if (!subscriberId) return Response.json({ error: 'invalid_session' }, { status: 401 });

    // Get active season
    const seasonR = await fetch(
      `${SUPABASE_URL}/rest/v1/seasons?status=eq.active&select=id&limit=1`,
      { headers: h, cache: 'no-store' }
    );
    const seasonRows = await seasonR.json().catch(() => null);
    const seasonId = Array.isArray(seasonRows) ? seasonRows[0]?.id : null;
    if (!seasonId) return Response.json({ memberships: [] });

    const memR = await fetch(
      `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${seasonId}&select=team_id,pending,teams(id,name)`,
      { headers: h, cache: 'no-store' }
    );
    const memberships: Array<{ team_id: string; pending: boolean; teams?: { id: string; name: string } }> =
      memR.ok ? await memR.json().catch(() => []) : [];
    const teams = memberships.map(m => ({
      team_id: m.team_id,
      team_name: m.teams?.name ?? '',
      pending: m.pending,
    }));
    return Response.json({ teams, season_id: seasonId });
  }

  // Search teams by name (default)
  const filter = q
    ? `&name=ilike.*${encodeURIComponent(q)}*`
    : '';
  const teamsR = await fetch(
    `${SUPABASE_URL}/rest/v1/teams?select=id,name&order=name.asc&limit=50${filter}`,
    { headers: h, cache: 'no-store' }
  );
  const teams = teamsR.ok ? await teamsR.json().catch(() => []) : [];
  return Response.json({ teams });
}

export async function POST(request: Request) {
  const h = svcHeaders();
  if (!h) return Response.json({ error: 'not_configured' }, { status: 500 });

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'invalid_body' }, { status: 400 }); }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const action = typeof body.action === 'string' ? body.action : 'upsert';
  const seasonId = typeof body.season_id === 'string' ? body.season_id : null;

  if (!token) return Response.json({ error: 'missing_token' }, { status: 401 });

  // ── Join a team via a durable invite token (team page "Invite / Share") ──────
  // Resolves the active season itself (the invite link carries no season_id) and
  // adds an immediate, non-pending membership, honouring the 5-team cap and the
  // season lock. Idempotent: already-a-member is a success no-op.
  if (action === 'join_by_token') {
    const joinToken = typeof body.join_token === 'string' ? body.join_token.trim() : '';
    if (!joinToken) return Response.json({ error: 'missing_join_token' }, { status: 400 });

    const subscriberId = await resolveSubscriber(token);
    if (!subscriberId) return Response.json({ error: 'invalid_session' }, { status: 401 });

    // Active season
    const seasonR = await fetch(
      `${SUPABASE_URL}/rest/v1/seasons?status=eq.active&select=id,locked_at&limit=1`,
      { headers: h, cache: 'no-store' }
    );
    const seasonRows = await seasonR.json().catch(() => null);
    const season = Array.isArray(seasonRows) ? seasonRows[0] : null;
    if (!season) return Response.json({ error: 'no_active_season' }, { status: 404 });
    if (season.locked_at && new Date() > new Date(season.locked_at)) {
      return Response.json({ error: 'season_locked' }, { status: 403 });
    }

    // Resolve the team by its invite token
    const teamR = await fetch(
      `${SUPABASE_URL}/rest/v1/teams?join_token=eq.${encodeURIComponent(joinToken)}&select=id,name&limit=1`,
      { headers: h, cache: 'no-store' }
    );
    const teamRows = teamR.ok ? await teamR.json().catch(() => []) : [];
    const team = Array.isArray(teamRows) ? teamRows[0] : null;
    if (!team) return Response.json({ error: 'invalid_invite' }, { status: 404 });

    // Current memberships — cap + already-member check
    const curR = await fetch(
      `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${season.id}&select=team_id`,
      { headers: h, cache: 'no-store' }
    );
    const curRows: Array<{ team_id: string }> = curR.ok ? await curR.json().catch(() => []) : [];
    if (curRows.some(r => r.team_id === team.id)) {
      return Response.json({ ok: true, team_id: team.id, team_name: team.name, already_member: true });
    }
    if (curRows.length >= 5) return Response.json({ error: 'team_limit_reached' }, { status: 400 });

    const insR = await fetch(`${SUPABASE_URL}/rest/v1/team_memberships`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify([{ subscriber_id: subscriberId, team_id: team.id, season_id: season.id, pending: false }]),
    });
    if (!insR.ok) {
      const err = await insR.text();
      console.error('team_memberships join_by_token failed', err);
      return Response.json({ error: 'join_failed' }, { status: 500 });
    }
    return Response.json({ ok: true, team_id: team.id, team_name: team.name });
  }

  if (!seasonId) return Response.json({ error: 'missing_season_id' }, { status: 400 });

  const subscriberId = await resolveSubscriber(token);
  if (!subscriberId) return Response.json({ error: 'invalid_session' }, { status: 401 });

  // Fetch season details (needed for both actions)
  const seasonR = await fetch(
    `${SUPABASE_URL}/rest/v1/seasons?id=eq.${seasonId}&select=id,name,ends_on,free_agency_start,locked_at&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  const seasonRows = await seasonR.json().catch(() => null);
  const season = Array.isArray(seasonRows) ? seasonRows[0] : null;
  if (!season) return Response.json({ error: 'season_not_found' }, { status: 404 });

  const isLocked = season.locked_at && new Date() > new Date(season.locked_at);
  if (isLocked) return Response.json({ error: 'season_locked' }, { status: 403 });
  // Joins are immediate — the Free Agency deferral (pending) has been retired.
  // Players may hold up to 5 teams and edits take effect right away.
  const pending = false;

  // ── Create a new team and auto-join it ──────────────────────────────────────
  if (action === 'create') {
    const teamName = typeof body.team_name === 'string' ? body.team_name.trim() : '';
    if (!teamName || teamName.length < 2 || teamName.length > 80) {
      return Response.json({ error: 'invalid_team_name' }, { status: 400 });
    }

    // Guard membership cap
    const myMemR = await fetch(
      `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${seasonId}&select=team_id`,
      { headers: h, cache: 'no-store' }
    );
    const myMem: { team_id: string }[] = myMemR.ok ? await myMemR.json().catch(() => []) : [];
    if (myMem.length >= 5) return Response.json({ error: 'team_limit_reached' }, { status: 400 });

    // Fetch subscriber email for created_by_email (required field on teams table)
    const subEmailR = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_subscribers?id=eq.${subscriberId}&select=email`,
      { headers: h, cache: 'no-store' }
    );
    const subEmailRows = subEmailR.ok ? await subEmailR.json().catch(() => null) : null;
    const createdByEmail: string = (Array.isArray(subEmailRows) ? subEmailRows[0]?.email : null) ?? '';
    if (!createdByEmail) return Response.json({ error: 'subscriber_not_found' }, { status: 400 });

    // Generate a unique code slug from the team name
    const toCode = (name: string, suffix?: string) => {
      const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
      return suffix ? `${base}-${suffix}` : base;
    };

    const teamPayload = (code: string) => ({
      name: teamName,
      code,
      // teams.season is DEPRECATED (founding-era label only) — still stamped for
      // continuity; season scoping lives on team_memberships.season_id.
      season: (season as Record<string, unknown>).name ?? '',
      created_by_email: createdByEmail,
      group_type: 'team',
      // Team Captain MVP: the creating subscriber is automatically captain.
      captain_id: subscriberId,
    });

    // Try insert; retry once with a suffix if the code slug collides
    let code = toCode(teamName);
    let createR = await fetch(`${SUPABASE_URL}/rest/v1/teams`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=representation' },
      body: JSON.stringify(teamPayload(code)),
    });
    if (!createR.ok) {
      const errText = await createR.text();
      if (errText.includes('23505') || errText.includes('unique')) {
        // Code collision — retry with a 4-digit suffix
        code = toCode(teamName, String(Date.now()).slice(-4));
        createR = await fetch(`${SUPABASE_URL}/rest/v1/teams`, {
          method: 'POST',
          headers: { ...h, Prefer: 'return=representation' },
          body: JSON.stringify(teamPayload(code)),
        });
      }
      if (!createR.ok) {
        const err = await createR.text();
        console.error('team create failed', err);
        return Response.json({ error: 'create_failed' }, { status: 500 });
      }
    }
    const created = await createR.json().catch(() => null);
    const newTeamId: string | null =
      Array.isArray(created) ? (created[0]?.id ?? null) : ((created as Record<string, unknown>)?.id as string ?? null);
    if (!newTeamId) return Response.json({ error: 'create_failed' }, { status: 500 });

    // Join the new team
    const memInsR = await fetch(`${SUPABASE_URL}/rest/v1/team_memberships`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify([{ subscriber_id: subscriberId, team_id: newTeamId, season_id: seasonId, pending }]),
    });
    if (!memInsR.ok) {
      const err = await memInsR.text();
      console.error('team_memberships create-join failed', err);
      return Response.json({ error: 'join_failed' }, { status: 500 });
    }

    return Response.json({ ok: true, team_id: newTeamId, team_name: teamName, pending });
  }

  // ── Upsert: reconcile the player's membership set for this season ────────────
  // `team_ids` is the FULL desired set. We diff it against ALL current memberships
  // (regardless of `pending`), because the unique key is
  // (subscriber_id, team_id, season_id, pending) — a team can have one row per
  // pending value. The previous implementation deleted/re-inserted only rows
  // matching the *current* pending flag, which had two bugs:
  //   1. a confirmed (pending=false) membership could never be removed during
  //      Free Agency (current pending=true) — "Leave team" silently did nothing;
  //   2. kept teams were blindly re-inserted under the current pending value,
  //      creating a second row and duplicate entries in the UI.
  // Diffing fixes both: drop teams that left (every row, any pending), add only
  // genuinely new teams, and never touch the rows of kept teams.
  const desired = Array.from(
    new Set(
      (Array.isArray(body.team_ids) ? body.team_ids : []).filter(
        (x): x is string => typeof x === 'string' && x.length > 0
      )
    )
  ).slice(0, 5);

  const curR = await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${seasonId}&select=team_id`,
    { headers: h, cache: 'no-store' }
  );
  const curRows: Array<{ team_id: string }> = curR.ok ? await curR.json().catch(() => []) : [];
  const currentTeamIds = Array.from(new Set(curRows.map(r => r.team_id)));

  const toRemove = currentTeamIds.filter(tid => !desired.includes(tid));
  const toAdd = desired.filter(tid => !currentTeamIds.includes(tid));

  // Remove dropped teams — every row for that team, regardless of pending.
  if (toRemove.length > 0) {
    const inList = toRemove.map(encodeURIComponent).join(',');
    await fetch(
      `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${seasonId}&team_id=in.(${inList})`,
      { method: 'DELETE', headers: h }
    ).catch(() => {});
  }

  // Add newly-desired teams with the current pending flag (skips teams already
  // present under either pending value, so no duplicate row is created).
  if (toAdd.length > 0) {
    const rows = toAdd.map((tid: string) => ({
      subscriber_id: subscriberId,
      team_id: tid,
      season_id: seasonId,
      pending,
    }));
    const insR = await fetch(`${SUPABASE_URL}/rest/v1/team_memberships`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!insR.ok) {
      const err = await insR.text();
      console.error('team_memberships insert failed', err);
      return Response.json({ error: 'insert_failed' }, { status: 500 });
    }
  }

  // Heal any legacy rows still flagged pending (from the retired Free Agency
  // deferral) so kept teams become active — every membership is immediate now.
  await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${seasonId}&pending=eq.true`,
    { method: 'PATCH', headers: h, body: JSON.stringify({ pending: false }) }
  ).catch(() => {});

  // Return normalized team list so the client can update without a re-fetch
  const afterR = await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${seasonId}&select=team_id,pending,teams(id,name)`,
    { headers: h, cache: 'no-store' }
  );
  const after: Array<{ team_id: string; pending: boolean; teams?: { id: string; name: string } }> =
    afterR.ok ? await afterR.json().catch(() => []) : [];
  const teams = after.map(m => ({
    team_id: m.team_id,
    team_name: m.teams?.name ?? '',
    pending: m.pending,
  }));
  return Response.json({ ok: true, pending, teams });
}
