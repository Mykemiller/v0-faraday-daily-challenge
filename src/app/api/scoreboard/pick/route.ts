// Per-subscriber Tokenomics Scoreboard preferences (the pickable 5th column).
//   GET  /api/scoreboard/pick?token=<session>          → { pick5, region, roster }
//   POST /api/scoreboard/pick { token, pick5, region } → persists the pick
//
// Mirrors /api/account: service-role PostgREST, session-token auth, writes
// dc_subscribers.scoreboard_prefs (jsonb). The pick5 must be in the candidate
// pool; an invalid pick falls back to the default (Together AI). Server-only.

import { NEOCLOUD_ROSTER, isValidPick5, resolvePick5, DEFAULT_PICK5 } from '@/lib/tokenomics/roster';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

type Svc = { base: string; headers: Record<string, string> };

function svc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  };
}

async function resolveSubscriber(s: Svc, token: string): Promise<string | null> {
  const r = await fetch(
    `${s.base}/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`,
    { headers: s.headers, cache: 'no-store' },
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row.subscriber_id ?? null;
}

export async function GET(request: Request) {
  const s = svc();
  if (!s) return Response.json({ error: 'Scoreboard service not configured' }, { status: 500 });

  const token = new URL(request.url).searchParams.get('token');
  if (!token) return Response.json({ error: 'Missing session' }, { status: 401 });

  const id = await resolveSubscriber(s, token);
  if (!id) return Response.json({ error: 'Invalid or expired session' }, { status: 401 });

  const r = await fetch(`${s.base}/dc_subscribers?id=eq.${id}&select=scoreboard_prefs`, {
    headers: s.headers,
    cache: 'no-store',
  });
  if (!r.ok) return Response.json({ error: 'Lookup failed' }, { status: 500 });
  const rows = await r.json().catch(() => null);
  const prefs = Array.isArray(rows) ? rows[0]?.scoreboard_prefs : null;

  return Response.json({
    pick5: resolvePick5(prefs),
    region: (prefs && typeof prefs === 'object' && (prefs as { region?: string }).region) || null,
    roster: NEOCLOUD_ROSTER,
  });
}

export async function POST(request: Request) {
  const s = svc();
  if (!s) return Response.json({ error: 'Scoreboard service not configured' }, { status: 500 });

  let body: { token?: string; pick5?: string; region?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const token = (body.token || '').trim();
  if (!token) return Response.json({ error: 'Missing session' }, { status: 401 });

  const pick5 = typeof body.pick5 === 'string' ? body.pick5.trim().toLowerCase() : '';
  if (!isValidPick5(pick5)) {
    return Response.json(
      { error: `pick5 must be one of the candidate pool`, candidates: NEOCLOUD_ROSTER.candidates },
      { status: 422 },
    );
  }

  const id = await resolveSubscriber(s, token);
  if (!id) return Response.json({ error: 'Invalid or expired session' }, { status: 401 });

  const prefs: Record<string, unknown> = {
    pick5: isValidPick5(pick5) ? pick5 : DEFAULT_PICK5,
    updated_at: new Date().toISOString(),
  };
  if (typeof body.region === 'string' && body.region.trim()) prefs.region = body.region.trim();

  const patchR = await fetch(`${s.base}/dc_subscribers?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...s.headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ scoreboard_prefs: prefs }),
  });
  if (!patchR.ok) {
    const detail = await patchR.text().catch(() => '');
    return Response.json({ error: 'Could not save pick', detail: detail.slice(0, 300) }, { status: 500 });
  }
  return Response.json({ ok: true, pick5: prefs.pick5, region: prefs.region ?? null });
}
