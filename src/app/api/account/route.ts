// Account self-service backend for the Daily Challenge.
//   GET  /api/account?token=<session>     → { email, handle, active }
//   POST /api/account  { token, action }   → action: "leave" | "rejoin"
//
// "leave" is a SOFT opt-out: it sets dc_subscribers.active = false. All data is
// retained — there is NO hard deletion here. Team/company membership is edited
// directly against the existing `team-action` edge function from the client; this
// route owns only the `active` flag.
//
// Server-only. Uses the Supabase service role via PostgREST so the client never
// sees the key. Requires env: SUPABASE_SERVICE_ROLE_KEY (and optionally
// SUPABASE_URL — falls back to the project URL). Until that env var is set in the
// Vercel project, the route returns 500 "Account service not configured".

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

type Svc = { base: string; headers: Record<string, string> };

function svc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

// Validate a session token and return the subscriber id, or null if invalid/expired.
async function resolveSubscriber(s: Svc, token: string): Promise<string | null> {
  const r = await fetch(
    `${s.base}/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`,
    { headers: s.headers, cache: "no-store" }
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
  if (!s) return Response.json({ error: "Account service not configured" }, { status: 500 });

  const token = new URL(request.url).searchParams.get("token");
  if (!token) return Response.json({ error: "Missing session" }, { status: 401 });

  const id = await resolveSubscriber(s, token);
  if (!id) return Response.json({ error: "Invalid or expired session" }, { status: 401 });

  const r = await fetch(
    `${s.base}/dc_subscribers?id=eq.${id}&select=email,handle,active`,
    { headers: s.headers, cache: "no-store" }
  );
  if (!r.ok) return Response.json({ error: "Lookup failed" }, { status: 500 });
  const rows = await r.json().catch(() => null);
  const sub = Array.isArray(rows) ? rows[0] : null;
  if (!sub) return Response.json({ error: "Subscriber not found" }, { status: 404 });

  return Response.json({
    email: sub.email,
    handle: sub.handle ?? null,
    active: sub.active !== false, // default-active if the column is absent
  });
}

export async function POST(request: Request) {
  const s = svc();
  if (!s) return Response.json({ error: "Account service not configured" }, { status: 500 });

  let body: { token?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const token = (body.token || "").trim();
  const action = body.action;
  if (!token) return Response.json({ error: "Missing session" }, { status: 401 });
  if (action !== "leave" && action !== "rejoin") {
    return Response.json({ error: "Invalid action" }, { status: 400 });
  }

  const id = await resolveSubscriber(s, token);
  if (!id) return Response.json({ error: "Invalid or expired session" }, { status: 401 });

  const active = action === "rejoin";
  const r = await fetch(`${s.base}/dc_subscribers?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...s.headers, Prefer: "return=representation" },
    body: JSON.stringify({ active }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return Response.json(
      { error: "Could not update account", detail: detail.slice(0, 300) },
      { status: 500 }
    );
  }
  return Response.json({ ok: true, active });
}
