// faraday-gate · server/handlers.ts (FDY-414). SERVER ONLY.
// Framework-neutral Web Request → Response handlers for one catch-all route, e.g. app/api/faraday-gate/[action]/route.ts:
//   POST  code      { email }                       send a one-time code
//   POST  verify    { email, code }                 verify it, set the httpOnly gate cookie
//   POST  request   { email, kind, message? }       Request demo access / Join the waitlist
//   POST  signout                                   clear the gate cookie
// Same-origin only (an Origin header from another host is refused).
import { normalizeEmail } from "../core.ts";
import { clearGateCache, type GateServerConfig } from "./check.ts";
import { gateCookieHeader, sendCode, verifyCode } from "./identity.ts";
import { submitAccessRequest } from "./request.ts";

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").toLowerCase();
  try { return new URL(origin).host.toLowerCase() === host; } catch { return false; }
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function handleGateAction(req: Request, action: string, app: string, cfg: GateServerConfig): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
  if (!sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { body = {}; }

  if (action === "code") {
    const r = await sendCode(String(body.email || ""), cfg);
    return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
  }
  if (action === "verify") {
    const r = await verifyCode(String(body.email || ""), String(body.code || ""), cfg);
    if (!r.ok) return json({ error: r.error }, 400);
    clearGateCache();
    return json({ ok: true, email: r.email }, 200, { "Set-Cookie": gateCookieHeader(r.accessToken) });
  }
  if (action === "request") {
    const kind = body.kind === "waitlist" ? "waitlist" : body.kind === "demo" ? "demo" : null;
    if (!kind) return json({ error: "Unknown request type." }, 400);
    const r = await submitAccessRequest({
      email: normalizeEmail(body.email), app, kind,
      message: typeof body.message === "string" ? body.message : null,
      sourceUrl: req.headers.get("referer"), ip: clientIp(req),
    }, cfg);
    return r.ok ? json({ ok: true, created: r.created }) : json({ error: r.error }, r.status);
  }
  if (action === "signout") {
    return json({ ok: true }, 200, { "Set-Cookie": gateCookieHeader(null) });
  }
  return json({ error: "Not found" }, 404);
}
