// faraday-gate · server/identity.ts (FDY-414). SERVER ONLY.
// Resolves the signed-in email. Two sources, in order:
//   1. the app's own verified sign-in (the caller passes `appEmail`) — JW's Supabase magic link, etc.;
//   2. the gate's own session: a Supabase Auth email ONE-TIME CODE on project ycadmmngkdhvpcsrcuaq.
// The code is typed into the gate page (verifyOtp type 'email'); no magic link and no emailRedirectTo is used,
// so no Supabase redirect-URL allow-list entry is needed for any app domain.
import { isEmail, normalizeEmail } from "../core.ts";
import type { GateServerConfig } from "./check.ts";

export const GATE_COOKIE = "fgate_at";          // httpOnly access token from the gate's own sign-in
export const GATE_COOKIE_MAX_AGE = 60 * 60;    // 1 hour (the Supabase access-token lifetime)

function authHeaders(cfg: GateServerConfig, bearer?: string): Record<string, string> {
  const key = cfg.anonKey || "";
  return { apikey: key, Authorization: `Bearer ${bearer || key}`, "Content-Type": "application/json" };
}

/** Send a one-time code. shouldCreateUser true: a new address gets an auth user (no app access by itself). */
export async function sendCode(emailRaw: string, cfg: GateServerConfig): Promise<{ ok: boolean; error?: string }> {
  const email = normalizeEmail(emailRaw);
  if (!isEmail(email)) return { ok: false, error: "Enter a valid email address." };
  if (!cfg.anonKey) return { ok: false, error: "Sign-in is not configured on this deployment." };
  const f = cfg.fetchImpl ?? fetch;
  try {
    const r = await f(cfg.supabaseUrl.replace(/\/$/, "") + "/auth/v1/otp", {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ email, create_user: true }),
    });
    return r.ok ? { ok: true } : { ok: false, error: "We could not send a code just now. Try again in a minute." };
  } catch {
    return { ok: false, error: "We could not send a code just now. Try again in a minute." };
  }
}

/** Verify a typed code. Returns the access token and the verified email. */
export async function verifyCode(
  emailRaw: string, code: string, cfg: GateServerConfig,
): Promise<{ ok: true; accessToken: string; email: string } | { ok: false; error: string }> {
  const email = normalizeEmail(emailRaw);
  const token = String(code || "").replace(/\s+/g, "");
  if (!isEmail(email) || !/^\d{6,10}$/.test(token)) return { ok: false, error: "Enter the code from the email." };
  if (!cfg.anonKey) return { ok: false, error: "Sign-in is not configured on this deployment." };
  const f = cfg.fetchImpl ?? fetch;
  try {
    const r = await f(cfg.supabaseUrl.replace(/\/$/, "") + "/auth/v1/verify", {
      method: "POST",
      headers: authHeaders(cfg),
      body: JSON.stringify({ type: "email", email, token }),
    });
    const j = (await r.json().catch(() => null)) as { access_token?: string; user?: { email?: string } } | null;
    const verified = normalizeEmail(j?.user?.email);
    if (!r.ok || !j?.access_token || verified !== email) return { ok: false, error: "That code did not work. Request a new one." };
    return { ok: true, accessToken: j.access_token, email: verified };
  } catch {
    return { ok: false, error: "That code did not work. Request a new one." };
  }
}

/** The email behind a gate access token, verified by Supabase Auth (service key). Null on any failure. */
export async function emailFromAccessToken(accessToken: string | null | undefined, cfg: GateServerConfig): Promise<string | null> {
  if (!accessToken || !cfg.serviceKey) return null;
  const f = cfg.fetchImpl ?? fetch;
  try {
    const r = await f(cfg.supabaseUrl.replace(/\/$/, "") + "/auth/v1/user", {
      headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { email?: string } | null;
    const e = normalizeEmail(j?.email);
    return isEmail(e) ? e : null;
  } catch {
    return null;
  }
}

/** Resolve identity: an app-verified email wins; otherwise the gate cookie. */
export async function resolveIdentity(
  opts: { appEmail?: string | null; gateToken?: string | null },
  cfg: GateServerConfig,
): Promise<{ email: string | null; source: "app" | "gate" | "none" }> {
  const appEmail = normalizeEmail(opts.appEmail);
  if (isEmail(appEmail)) return { email: appEmail, source: "app" };
  const e = await emailFromAccessToken(opts.gateToken, cfg);
  return e ? { email: e, source: "gate" } : { email: null, source: "none" };
}

export function gateCookieHeader(token: string | null): string {
  const base = `${GATE_COOKIE}=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return token ? `${base}; Max-Age=${GATE_COOKIE_MAX_AGE}` : `${base}; Max-Age=0`;
}

export function readCookie(cookieHeader: string | null | undefined, name = GATE_COOKIE): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()) || null;
  }
  return null;
}
