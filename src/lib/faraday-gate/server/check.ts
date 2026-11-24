// faraday-gate · server/check.ts (FDY-414). SERVER ONLY: uses the Supabase service key.
// checkAccess calls estate_entitled with a 2 s timeout, caches per (email, app) for 60 s, and fails closed.
import { denied, normalizeEmail, parseEntitlement, type Entitlement } from "../core.ts";

export interface GateServerConfig {
  supabaseUrl: string;        // e.g. https://ycadmmngkdhvpcsrcuaq.supabase.co
  serviceKey: string;         // service-role key, read from the app's existing env name; never sent to a browser
  anonKey?: string;           // publishable key, only needed for email one-time codes
  fetchImpl?: typeof fetch;   // injectable for tests
  timeoutMs?: number;         // default 2000
  cacheTtlMs?: number;        // default 60000
  now?: () => number;         // injectable for tests
}

const DECOY_PROJECT = "xgbpmlkanxewtfizloay";
type CacheEntry = { at: number; value: Entitlement };
const cache = new Map<string, CacheEntry>();

export function clearGateCache(): void {
  cache.clear();
}

export async function checkAccess(
  args: { email: string | null | undefined; app: string },
  cfg: GateServerConfig,
): Promise<Entitlement> {
  const email = normalizeEmail(args.email);
  const app = String(args.app || "").trim().toLowerCase();
  if (!app || !cfg || !cfg.supabaseUrl || !cfg.serviceKey || cfg.supabaseUrl.includes(DECOY_PROJECT)) return denied("error");
  const now = cfg.now ?? Date.now;
  const ttl = cfg.cacheTtlMs ?? 60_000;
  const key = email + "|" + app;
  const hit = cache.get(key);
  if (hit && now() - hit.at < ttl) return hit.value;

  const f = cfg.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeoutMs ?? 2000);
  try {
    const r = await f(cfg.supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/estate_entitled", {
      method: "POST",
      headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_email: email || null, p_app: app }),
      signal: ac.signal,
      cache: "no-store",
    } as RequestInit);
    if (!r.ok) return denied("error");   // errors are never cached
    const value = parseEntitlement(await r.json());
    if (value.reason !== "error") cache.set(key, { at: now(), value });
    return value;
  } catch {
    return denied("error");
  } finally {
    clearTimeout(timer);
  }
}

/** Mode-only probe: the gate's answer for nobody. "open" means the route group needs no sign-in at all. */
export async function appMode(app: string, cfg: GateServerConfig): Promise<Entitlement> {
  return checkAccess({ email: null, app }, cfg);
}
