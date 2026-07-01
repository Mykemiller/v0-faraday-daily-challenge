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

// Supabase column names differ from the FBL 1.0 interface (pre-existing table
// schema uses 'Available'/'Coming Soon' for status, briefing_type instead of
// type, etc.). Normalize here so the frontend shape stays clean.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(row: any) {
  return {
    id: row.id,
    type: row.briefing_type,
    theater: row.theater ?? null,
    sector: row.sector ?? null,
    thread: row.thread ?? null,
    group: row.briefing_group ?? null,
    title: row.briefing_title ?? "",
    subtitle: row.subtitle ?? "",
    byline: row.byline ?? "",
    updated: row.updated_label ?? "",
    status: row.status === "Available" ? "live" : row.status === "Coming Soon" ? "soon" : row.status,
    abstract: row.abstract ?? row.briefing_description ?? "",
    hypothesis: row.hypothesis ?? "",
    contents: row.contents ?? [],
    sort_order: row.sort_order ?? 0,
  };
}

export async function GET() {
  const headers = svcHeaders();
  if (!headers) {
    return Response.json({ error: "Library service not configured" }, { status: 500 });
  }

  // Only return FBL 1.0 rows (briefing_type IS NOT NULL filters out legacy rows
  // that were in the table before this feature shipped).
  const cols = "id,briefing_type,theater,sector,thread,briefing_group,briefing_title,subtitle,byline,updated_label,status,abstract,briefing_description,hypothesis,contents,sort_order";
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/library_catalog_cache?select=${cols}&briefing_type=not.is.null&order=sort_order.asc`,
    { headers, cache: "no-store" }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error("[library/catalog] Supabase error", res.status, body);
    return Response.json({ error: "Catalog fetch failed" }, { status: 502 });
  }

  const data = await res.json();
  return Response.json(data.map(normalize), {
    headers: {
      // Cache 60s at CDN edge — fresh enough for a catalog that changes rarely
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
