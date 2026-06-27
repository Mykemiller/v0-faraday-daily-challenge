// JoI set management — Jurisdictions of Interest.
//   GET  /api/joi?token=<session>           → JoI sets with member counts
//   POST /api/joi  { token, name, description?, color? }  → created set
//
// Auth via dc_sessions token (same pattern as /api/account, /api/live-agent).
// Uses SUPABASE_SERVICE_ROLE_KEY — never exposed to the client.

import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

type Svc = { base: string; headers: Record<string, string> };

function svc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
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

export async function GET(req: NextRequest) {
  const s = svc();
  if (!s) return NextResponse.json({ error: 'Service not configured' }, { status: 500 });

  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const subscriberId = await resolveSubscriber(s, token);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await fetch(
    `${s.base}/subscriber_joi_sets?subscriber_id=eq.${subscriberId}&is_active=eq.true&order=created_at.asc&select=*,member_count:subscriber_joi_members(count)`,
    { headers: s.headers, cache: 'no-store' },
  );
  if (!r.ok) return NextResponse.json({ error: 'Failed to fetch sets' }, { status: 500 });
  return NextResponse.json(await r.json());
}

export async function POST(req: NextRequest) {
  const s = svc();
  if (!s) return NextResponse.json({ error: 'Service not configured' }, { status: 500 });

  const { token, name, description, color } = await req.json().catch(() => ({}));
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const subscriberId = await resolveSubscriber(s, token);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Enforce 10-set cap
  const countR = await fetch(
    `${s.base}/subscriber_joi_sets?subscriber_id=eq.${subscriberId}&is_active=eq.true&select=id`,
    { headers: { ...s.headers, Prefer: 'count=exact', 'Content-Type': 'application/json' }, cache: 'no-store' },
  );
  const total = parseInt(countR.headers.get('content-range')?.split('/')[1] ?? '0', 10);
  if (total >= 10)
    return NextResponse.json(
      { error: 'Maximum 10 Jurisdiction of Interest sets allowed' }, { status: 400 }
    );

  const r = await fetch(`${s.base}/subscriber_joi_sets`, {
    method: 'POST',
    headers: s.headers,
    body: JSON.stringify({ subscriber_id: subscriberId, name, description: description ?? null, color: color ?? '#1C1C1C' }),
  });
  if (!r.ok) return NextResponse.json({ error: 'Failed to create set' }, { status: 500 });
  return NextResponse.json(await r.json(), { status: 201 });
}
