// JoI member management — add or remove jurisdictions from a set.
//   POST   /api/joi/:setId/members  { token, jurisdictionId }  → added member
//   DELETE /api/joi/:setId/members  { token, jurisdictionId }  → removed
//
// Auth via dc_sessions token. Enforces 1,000-member-per-set cap on POST.

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

// Verify the set belongs to this subscriber before mutating it.
async function verifySetOwner(s: Svc, setId: string, subscriberId: string): Promise<boolean> {
  const r = await fetch(
    `${s.base}/subscriber_joi_sets?id=eq.${setId}&subscriber_id=eq.${subscriberId}&select=id`,
    { headers: s.headers, cache: 'no-store' },
  );
  if (!r.ok) return false;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ setId: string }> },
) {
  const s = svc();
  if (!s) return NextResponse.json({ error: 'Service not configured' }, { status: 500 });

  const { setId } = await params;
  const { token, jurisdictionId } = await req.json().catch(() => ({}));
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const subscriberId = await resolveSubscriber(s, token);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await verifySetOwner(s, setId, subscriberId)))
    return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Enforce 1,000-member cap
  const countR = await fetch(
    `${s.base}/subscriber_joi_members?set_id=eq.${setId}&select=id`,
    { headers: { ...s.headers, Prefer: 'count=exact', 'Content-Type': 'application/json' }, cache: 'no-store' },
  );
  const total = parseInt(countR.headers.get('content-range')?.split('/')[1] ?? '0', 10);
  if (total >= 1000)
    return NextResponse.json({ error: 'Maximum 1,000 jurisdictions per set' }, { status: 400 });

  const r = await fetch(`${s.base}/subscriber_joi_members`, {
    method: 'POST',
    headers: s.headers,
    body: JSON.stringify({ set_id: setId, jurisdiction_id: jurisdictionId }),
  });
  if (!r.ok) return NextResponse.json({ error: 'Failed to add member' }, { status: 500 });
  return NextResponse.json(await r.json(), { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ setId: string }> },
) {
  const s = svc();
  if (!s) return NextResponse.json({ error: 'Service not configured' }, { status: 500 });

  const { setId } = await params;
  const { token, jurisdictionId } = await req.json().catch(() => ({}));
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const subscriberId = await resolveSubscriber(s, token);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await verifySetOwner(s, setId, subscriberId)))
    return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await fetch(
    `${s.base}/subscriber_joi_members?set_id=eq.${setId}&jurisdiction_id=eq.${jurisdictionId}`,
    { method: 'DELETE', headers: s.headers },
  );
  return NextResponse.json({ success: true });
}
