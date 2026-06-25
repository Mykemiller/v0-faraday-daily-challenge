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
  const teamIds = Array.isArray(body.team_ids) ? body.team_ids.slice(0, 5) : [];
  const seasonId = typeof body.season_id === 'string' ? body.season_id : null;

  if (!token) return Response.json({ error: 'missing_token' }, { status: 401 });
  if (!seasonId) return Response.json({ error: 'missing_season_id' }, { status: 400 });

  const subscriberId = await resolveSubscriber(token);
  if (!subscriberId) return Response.json({ error: 'invalid_session' }, { status: 401 });

  // Determine Free Agency window for this season
  const seasonR = await fetch(
    `${SUPABASE_URL}/rest/v1/seasons?id=eq.${seasonId}&select=id,ends_on,free_agency_start,locked_at&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  const seasonRows = await seasonR.json().catch(() => null);
  const season = Array.isArray(seasonRows) ? seasonRows[0] : null;
  if (!season) return Response.json({ error: 'season_not_found' }, { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  const inFreeAgency = season.free_agency_start && today >= season.free_agency_start;
  const isLocked = season.locked_at && new Date() > new Date(season.locked_at);
  if (isLocked) return Response.json({ error: 'season_locked' }, { status: 403 });

  // Outside Free Agency: only allow setting initial teams (pending=false)
  // During Free Agency: changes are staged as pending=true
  const pending = inFreeAgency;

  // Delete existing memberships of same pending type to replace them
  await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${subscriberId}&season_id=eq.${seasonId}&pending=eq.${pending}`,
    { method: 'DELETE', headers: h }
  ).catch(() => {});

  // Insert new memberships
  if (teamIds.length > 0) {
    const rows = teamIds.map((tid: string) => ({
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
