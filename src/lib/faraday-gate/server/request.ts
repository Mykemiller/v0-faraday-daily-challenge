// faraday-gate · server/request.ts (FDY-414). SERVER ONLY.
// "Request demo access" / "Join the waitlist" → estate_access_request. Rate limit: 5 per IP per hour
// (in-memory, per server instance — a soft brake, not a guarantee; Turnstile is a listed follow-up). Never sends mail.
import { isEmail, normalizeEmail } from "../core.ts";
import type { GateServerConfig } from "./check.ts";

const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 5;
const hits = new Map<string, number[]>();

export function clearRateLimit(): void {
  hits.clear();
}

export function rateLimited(ip: string, now = Date.now()): boolean {
  const k = ip || "unknown";
  const arr = (hits.get(k) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= LIMIT) {
    hits.set(k, arr);
    return true;
  }
  arr.push(now);
  hits.set(k, arr);
  return false;
}

export interface AccessRequestInput {
  email: string;
  app: string;
  kind: "demo" | "waitlist";
  message?: string | null;
  sourceUrl?: string | null;
  ip?: string;
}

export type AccessRequestResult =
  | { ok: true; created: boolean; requestId: string | null }
  | { ok: false; status: number; error: string };

export async function submitAccessRequest(input: AccessRequestInput, cfg: GateServerConfig): Promise<AccessRequestResult> {
  const email = normalizeEmail(input.email);
  if (!isEmail(email)) return { ok: false, status: 400, error: "Enter a valid email address." };
  if (input.kind !== "demo" && input.kind !== "waitlist") return { ok: false, status: 400, error: "Unknown request type." };
  const message = input.message ? String(input.message).trim().slice(0, 1000) : null;
  if (rateLimited(input.ip || "unknown")) return { ok: false, status: 429, error: "Too many requests. Try again later." };
  if (!cfg.serviceKey) return { ok: false, status: 503, error: "Requests are not available right now." };
  const f = cfg.fetchImpl ?? fetch;
  try {
    const r = await f(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/estate_access_request", {
      method: "POST",
      headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_email: email, p_app: input.app, p_kind: input.kind, p_message: message || null,
        p_source_url: input.sourceUrl ? String(input.sourceUrl).slice(0, 2000) : null,
      }),
    });
    if (!r.ok) return { ok: false, status: 502, error: "We could not record that just now. Try again later." };
    const j = (await r.json()) as { created?: boolean; request_id?: string } | null;
    return { ok: true, created: j?.created === true, requestId: j?.request_id ?? null };
  } catch {
    return { ok: false, status: 502, error: "We could not record that just now. Try again later." };
  }
}
