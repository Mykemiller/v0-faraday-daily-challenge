// GET /api/season/active — returns the active season with Free Agency window dates.
// Used by the client to gate team-selection UI and show/hide Free Agency copy.

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export const dynamic = 'force-dynamic';

export async function GET() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return Response.json({ error: 'not_configured' }, { status: 500 });

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/seasons?status=eq.active&select=id,name,starts_on,ends_on,locked_at,free_agency_start,free_agency_notice_start&limit=1`,
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

  return Response.json({ season });
}
