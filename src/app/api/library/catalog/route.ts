// GET /api/library/catalog
// Returns all rows from library_catalog_cache ordered by sort_order.
// Service-role read so the anon key is never exposed and future RLS tightening
// (subscriber-only access, entitlement gates) is just a policy change.

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export async function GET() {
  const headers = svcHeaders();
  if (!headers) {
    return Response.json({ error: "Library service not configured" }, { status: 500 });
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/library_catalog_cache?select=*&order=sort_order.asc`,
    { headers, cache: "no-store" }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error("[library/catalog] Supabase error", res.status, body);
    return Response.json({ error: "Catalog fetch failed" }, { status: 502 });
  }

  const data = await res.json();
  return Response.json(data, {
    headers: {
      // Cache 60s at CDN edge — fresh enough for a catalog that changes rarely
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
