// Player-facing Announcements banner.
//
//   GET  /api/broadcast?token=<dc_session>   → { broadcast: {...} | null }
//   POST /api/broadcast  { token, broadcastId }  → permanent per-player dismissal
//
// SECURITY: lo_broadcasts / lo_broadcast_dismissals are RLS deny-all — Daily
// Challenge players hold no Supabase identity, so the ticket's visibility rules
// are enforced HERE:
//   • the live window (not revoked · started · not expired) is the query itself,
//   • the subscriber_id written on dismissal comes from the validated session
//     token — NEVER from the request body, so player A can't dismiss for B,
//   • no token → no read, no write (logged-out visitors get `null` and can
//     never reach the dismissal insert).
//
// Server-only: uses the Supabase service role, same pattern as /api/account.

import { svc } from "@/lib/league-office/service";
import { liveBroadcastFor } from "@/lib/league-office/broadcasts";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

/** Validate a dc_session token → subscriber id, or null. (Mirrors /api/account.) */
async function resolveSubscriber(
  headers: Record<string, string>,
  token: string
): Promise<string | null> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`,
      { headers, cache: "no-store" }
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
    return row.subscriber_id ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const s = svc();
  // Never break the game over an announcement: an unconfigured or unreachable
  // service degrades to "no banner", not an error surface.
  if (!s) return Response.json({ broadcast: null });

  const token = new URL(request.url).searchParams.get("token");
  if (!token) return Response.json({ broadcast: null }); // anonymous → nothing

  const subscriberId = await resolveSubscriber(s.headers, token);
  if (!subscriberId) return Response.json({ broadcast: null });

  const broadcast = await liveBroadcastFor(s, subscriberId);
  return Response.json({ broadcast });
}

export async function POST(request: Request) {
  const s = svc();
  if (!s) return Response.json({ ok: false }, { status: 503 });

  let body: { token?: string; broadcastId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const token = (body.token || "").trim();
  const broadcastId = (body.broadcastId || "").trim();
  if (!token) return Response.json({ ok: false }, { status: 401 });
  if (!broadcastId) return Response.json({ ok: false }, { status: 400 });

  const subscriberId = await resolveSubscriber(s.headers, token);
  if (!subscriberId) return Response.json({ ok: false }, { status: 401 });

  // Dismissal is permanent and idempotent — a replayed dismiss is a no-op.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/lo_broadcast_dismissals`, {
    method: "POST",
    headers: { ...s.headers, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ broadcast_id: broadcastId, subscriber_id: subscriberId }),
    cache: "no-store",
  });
  if (!r.ok) return Response.json({ ok: false }, { status: 400 });

  return Response.json({ ok: true });
}
