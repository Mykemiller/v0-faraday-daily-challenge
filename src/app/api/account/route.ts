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

  const params = new URL(request.url).searchParams;

  // Handle uniqueness check (no auth required)
  const handleCheck = params.get("handle_check");
  if (handleCheck) {
    const r = await fetch(
      `${s.base}/dc_subscribers?handle=eq.${encodeURIComponent(handleCheck.trim().toLowerCase())}&select=id`,
      { headers: s.headers, cache: "no-store" }
    );
    const rows = r.ok ? await r.json().catch(() => null) : null;
    const taken = Array.isArray(rows) && rows.length > 0;
    return Response.json({ available: !taken });
  }

  const token = params.get("token");
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

  let body: { token?: string; action?: string; newHandle?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const token = (body.token || "").trim();
  const action = body.action;
  if (!token) return Response.json({ error: "Missing session" }, { status: 401 });
  if (action !== "leave" && action !== "rejoin" && action !== "update-handle") {
    return Response.json({ error: "Invalid action" }, { status: 400 });
  }

  const id = await resolveSubscriber(s, token);
  if (!id) return Response.json({ error: "Invalid or expired session" }, { status: 401 });

  // ── Handle update ──────────────────────────────────────────────────────────
  if (action === "update-handle") {
    const raw = typeof body.newHandle === "string" ? body.newHandle.trim().toLowerCase() : "";
    // Validate: 3-24 chars, lowercase letters, numbers, and underscores.
    // Uppercase letters are already normalised to lowercase above.
    if (!/^[a-z0-9_]{3,24}$/.test(raw)) {
      return Response.json(
        { error: "Handle must be 3–24 characters, letters, numbers, and _ only." },
        { status: 422 }
      );
    }
    // Uniqueness check (case-insensitive via citext).
    const uniqR = await fetch(
      `${s.base}/dc_subscribers?handle=eq.${encodeURIComponent(raw)}&select=id`,
      { headers: s.headers, cache: "no-store" }
    );
    if (uniqR.ok) {
      const rows = await uniqR.json().catch(() => null);
      const existing = Array.isArray(rows) ? rows[0] : null;
      if (existing && existing.id !== id) {
        return Response.json({ error: "That handle is already taken." }, { status: 409 });
      }
    }
    const patchR = await fetch(`${s.base}/dc_subscribers?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...s.headers, Prefer: "return=representation" },
      body: JSON.stringify({ handle: raw }),
    });
    if (!patchR.ok) {
      const detail = await patchR.text().catch(() => "");
      return Response.json(
        { error: "Could not update handle", detail: detail.slice(0, 300) },
        { status: 500 }
      );
    }
    return Response.json({ ok: true, handle: raw });
  }

  // ── Soft opt-out / rejoin ──────────────────────────────────────────────────
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
