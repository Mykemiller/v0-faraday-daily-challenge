// League Office — server-only data-access layer.
//
// SECURITY MODEL (locked with Myke): the /league-office tree is gated two ways.
//  1. A client gate (StaffGate) shows the console only to a signed-in staff email
//     and mirrors the existing dc_session token into an `lo_session` cookie.
//  2. EVERY reader here independently re-verifies that cookie resolves to a STAFF
//     email before it returns a single row. Data never leaves the server without
//     a staff check — the client gate is convenience, this is the real fence.
//
// Reads go through the Supabase service role via PostgREST (same pattern as
// /api/account). RLS locks anon/authenticated out of these tables; the service
// key is server-only and never reaches the browser. Requires env
// SUPABASE_SERVICE_ROLE_KEY — without it every reader reports "not configured".

import { cookies } from "next/headers";
import { staffRole } from "./constants";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

export const LO_COOKIE = "lo_session";

export type Svc = { base: string; headers: Record<string, string> };

export function svc(): Svc | null {
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

/** Thin PostgREST GET → parsed JSON array. Returns [] on any failure so a single
 *  bad read degrades to an empty state rather than throwing the whole screen. */
export async function q<T = Record<string, unknown>>(
  s: Svc,
  path: string
): Promise<T[]> {
  try {
    const r = await fetch(`${s.base}/${path}`, {
      headers: s.headers,
      cache: "no-store",
    });
    if (!r.ok) return [];
    const rows = await r.json().catch(() => null);
    return Array.isArray(rows) ? (rows as T[]) : [];
  } catch {
    return [];
  }
}

export type StaffContext =
  | { ok: true; email: string; role: "commissioner"; s: Svc }
  | { ok: false; reason: "unconfigured" | "no-session" | "not-staff" };

/** Resolve the caller to a verified staff context, or an explanatory failure.
 *  Reads the lo_session cookie → dc_sessions → dc_subscribers.email → allowlist.
 *  Reading cookies() opts the segment into dynamic rendering, which is correct:
 *  this is live, per-request admin data that must never be statically cached. */
export async function requireStaff(): Promise<StaffContext> {
  const s = svc();
  if (!s) return { ok: false, reason: "unconfigured" };

  const token = (await cookies()).get(LO_COOKIE)?.value;
  if (!token) return { ok: false, reason: "no-session" };

  const sessions = await q<{ subscriber_id: string; expires_at: string | null }>(
    s,
    `dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`
  );
  const session = sessions[0];
  if (!session) return { ok: false, reason: "no-session" };
  if (session.expires_at && new Date(session.expires_at) < new Date())
    return { ok: false, reason: "no-session" };

  const subs = await q<{ email: string }>(
    s,
    `dc_subscribers?id=eq.${session.subscriber_id}&select=email`
  );
  const email = subs[0]?.email ?? null;
  const role = staffRole(email);
  if (!email || !role) return { ok: false, reason: "not-staff" };

  return { ok: true, email: email.toLowerCase(), role, s };
}
