// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — /api/v1/subscriber/prefs (the FE's guessed route path).
//   GET   -> SubscriberPrefs        PATCH { pickedProviderId?, selectedRegion?, theme? } -> SubscriberPrefs
// Session token comes from `Authorization: Bearer <dc_session>` (preferred) or `?token=` / body.token.
// The picked provider persists per subscriber in dc_subscribers.scoreboard_prefs (jsonb).
//
// Server-only; Supabase service role. Requires SUPABASE_SERVICE_ROLE_KEY.

import { getPrefs, setPrefs } from "@/lib/tokenomics/server";
import type { SubscriberPrefs } from "@/lib/tokenomics/scoreboard-contract";

function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") || request.headers.get("Authorization");
  if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, "").trim() || null;
  return null;
}

export async function GET(request: Request) {
  const token = bearer(request) || new URL(request.url).searchParams.get("token");
  if (!token) return Response.json({ error: "Missing session" }, { status: 401 });
  const res = await getPrefs(token);
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
  return Response.json(res.prefs);
}

export async function PATCH(request: Request) {
  let body: (Partial<SubscriberPrefs> & { token?: string }) = {};
  try { body = await request.json(); } catch { /* allow empty; token may be in header */ }
  const token = bearer(request) || (body.token ?? null);
  if (!token) return Response.json({ error: "Missing session" }, { status: 401 });
  const { token: _drop, ...patch } = body;
  const res = await setPrefs(token, patch);
  if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
  return Response.json(res.prefs);
}

// POST behaves like PATCH (some clients can't send PATCH bodies).
export const POST = PATCH;
