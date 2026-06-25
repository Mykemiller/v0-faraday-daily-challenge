// TODO: REMOVE BEFORE PRODUCTION — temporary admin testing utility

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

export async function POST() {
  const headers = svcHeaders();
  if (!headers) {
    return Response.json({ error: "Admin service not configured" }, { status: 500 });
  }

  const base = `${SUPABASE_URL}/rest/v1`;

  // Delete all subscribers except the protected 'myke' account.
  // handle column is USER-DEFINED type (citext); the != filter works via REST API.
  const res = await fetch(`${base}/dc_subscribers?handle=neq.myke`, {
    method: "DELETE",
    headers,
  });

  if (!res.ok) {
    return Response.json({ error: "Delete failed", status: res.status }, { status: 500 });
  }

  return Response.json({ ok: true });
}
