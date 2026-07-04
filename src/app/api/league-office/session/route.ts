// League Office — session bridge for the client staff gate.
//
//   POST /api/league-office/session  { token }  → validates the dc_session token,
//     and ONLY if it resolves to a STAFF email sets an httpOnly `lo_session`
//     cookie (so Server Components can verify every read) and returns the role.
//   DELETE /api/league-office/session            → clears the cookie (sign-out).
//
// The client mirrors its existing localStorage dc_session token here; we never
// change the magic-link flow. httpOnly keeps the token no more exposed than it
// already is client-side, while letting the server fence every data read.

import { cookies } from "next/headers";
import { svc, q, LO_COOKIE } from "@/lib/league-office/service";
import { staffRole } from "@/lib/league-office/constants";

export async function POST(request: Request) {
  const s = svc();
  if (!s) return Response.json({ ok: false, reason: "unconfigured" }, { status: 500 });

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "bad-body" }, { status: 400 });
  }
  const token = (body.token || "").trim();
  if (!token) return Response.json({ ok: false, reason: "no-token" }, { status: 401 });

  const sessions = await q<{ subscriber_id: string; expires_at: string | null }>(
    s,
    `dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`
  );
  const session = sessions[0];
  const expired = session?.expires_at && new Date(session.expires_at) < new Date();
  if (!session || expired)
    return Response.json({ ok: false, reason: "no-session" }, { status: 401 });

  const subs = await q<{ email: string }>(
    s,
    `dc_subscribers?id=eq.${session.subscriber_id}&select=email`
  );
  const email = subs[0]?.email ?? null;
  const role = staffRole(email);
  if (!email || !role) {
    // Not staff: make sure no stale cookie lingers.
    (await cookies()).delete(LO_COOKIE);
    return Response.json({ ok: false, reason: "not-staff" }, { status: 403 });
  }

  (await cookies()).set(LO_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h; re-mirrored on each visit
  });

  return Response.json({ ok: true, email: email.toLowerCase(), role });
}

export async function DELETE() {
  (await cookies()).delete(LO_COOKIE);
  return Response.json({ ok: true });
}
