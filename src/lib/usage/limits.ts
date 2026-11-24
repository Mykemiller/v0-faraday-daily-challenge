// Estate-wide daily usage limits — the app-side helper (FDY-353 §3, FDY-392 UL-2).
//
// One call: consume({ metric, item?, weight? }, req) -> { allowed, resetAt, reason }.
// It resolves who the reader is, asks the shared `public.usage_consume` function
// whether this action fits today's allowance, and FAILS CLOSED (D8): a missing
// service key, an RPC error, a timeout past 1.5 s or a malformed answer all come
// back as not allowed.
//
// SERVER-SIDE ONLY. It reads SUPABASE_SERVICE_ROLE_KEY and calls PostgREST with
// it; it must never be imported into a client component, and it never uses the
// anon key. The limits themselves live in app_setting_def / app_setting_value
// (FA daily_limit_courses, FA usage_limits_mode), tunable from the Workbench
// without a redeploy — there is deliberately no limit number in this file.
//
// Who the reader is (D4) — this app has no estate-linked sign-in today
// (auth.users is empty), so every subject is anonymous:
//   · v:<uuid> — REUSES the player's existing anonymous id, the httpOnly
//     `fa_deeper_id` cookie the "Go deeper" tutor meter already sets on this
//     origin (`<uuid>.<hmac>`, keyed as anon:<uuid> in academy_ai_usage). No
//     second visitor cookie is minted. When ACADEMY_COOKIE_SECRET is present in
//     this deployment the signature is verified and a fresh cookie can be minted
//     locally; without it, a well-formed id is accepted as-is (forging one buys
//     nothing that clearing the cookie would not, and the IP subject below backs
//     both up) and a missing cookie is minted by the tutor function's own quota
//     endpoint, whose Set-Cookie is relayed unchanged.
//   · ip:<32 hex> — HMAC-SHA256 of the client IP with USAGE_IP_SALT (D5), checked
//     by the database at the WB usage_anon_ip_multiplier times the limit. Skipped,
//     with one log line, when the salt is not set. The raw IP is never sent.
//
// Imports are relative (no "@/" alias) so node --test can load this file directly.

export const USAGE_APP = "FA";
export const RPC_TIMEOUT_MS = 1500;
export const VISITOR_COOKIE = "fa_deeper_id";

const DEFAULT_SUPABASE_URL = "https://ycadmmngkdhvpcsrcuaq.supabase.co";
/** The retired project. Code must refuse it (FDY-353 §0). */
const FORBIDDEN_PROJECT_REF = "xgbpmlkanxewtfizloay";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIG_RE = /^[0-9a-f]{64}$/i;

export type ConsumeReason =
  | "ok"
  | "already_counted"
  | "limit"
  | "unconfigured"
  | "off"
  | "bypass"
  | "bad_input"
  /** App-side: the service key is missing or points at the wrong project. */
  | "not_configured"
  /** App-side: no visitor id could be resolved or minted. */
  | "no_subject"
  /** App-side: the RPC failed, timed out or answered in an unexpected shape. */
  | "error";

export type ConsumeResult = {
  allowed: boolean;
  /** Next UTC midnight from the database; null only when the RPC never answered. */
  resetAt: string | null;
  reason: ConsumeReason;
  /** A Set-Cookie header the caller must put on its response, when one was minted. */
  setCookie: string | null;
};

export type UsageConsumeArgs = {
  p_app: string;
  p_metric: string;
  p_subject: string;
  p_item: string | null;
  p_weight: number;
  p_ip_subject: string | null;
  p_dry_run: boolean;
};

/** Calls usage_consume and returns its parsed JSON body; throws on any failure. */
export type UsageRpc = (args: UsageConsumeArgs, signal: AbortSignal) => Promise<unknown>;

/** Mints a visitor id when the reader has none. Returns null when it cannot. */
export type VisitorMinter = (req: Request) => Promise<{ id: string; setCookie: string } | null>;

export type ConsumeDeps = {
  rpc?: UsageRpc;
  mintVisitor?: VisitorMinter;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  log?: (msg: string) => void;
};

// ── small crypto helpers (Web Crypto: same in Node 22 and the edge) ───────────

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * The uuid inside a `fa_deeper_id` cookie value (`<uuid>.<64 hex>`), or null.
 * With a secret the signature must check out; without one only the shape is
 * checked (see the header for why that is acceptable for a fair-use count).
 */
export async function visitorIdFromCookie(
  value: string | null,
  secret: string | undefined,
): Promise<string | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!UUID_RE.test(id) || !SIG_RE.test(sig)) return null;
  if (secret) {
    const expected = await hmacHex(secret, id);
    if (!timingSafeEqual(sig.toLowerCase(), expected)) return null;
  }
  return id.toLowerCase();
}

/** The cookie line the tutor function itself would set (same name, shape and lifetime). */
export function visitorCookieLine(cookieValue: string): string {
  return `${VISITOR_COOKIE}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

/** The client IP on Vercel: the first hop of x-forwarded-for, else x-real-ip. */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  if (first) return first;
  const real = req.headers.get("x-real-ip")?.trim();
  return real || null;
}

/** D5: `ip:` + the first 32 hex of HMAC-SHA256(salt, ip). Null without salt or IP. */
export async function ipSubject(ip: string | null, salt: string | undefined): Promise<string | null> {
  if (!ip || !salt) return null;
  return `ip:${(await hmacHex(salt, ip)).slice(0, 32)}`;
}

// ── default dependencies ─────────────────────────────────────────────────────

function supabaseUrl(env: Record<string, string | undefined>): string {
  return (env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
}

/** usage_consume over PostgREST with the service role key. */
export function postgrestRpc(env: Record<string, string | undefined>): UsageRpc | null {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const base = supabaseUrl(env);
  if (!key || base.includes(FORBIDDEN_PROJECT_REF)) return null;
  return async (args, signal) => {
    const res = await fetch(`${base}/rest/v1/rpc/usage_consume`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(args),
      cache: "no-store",
      signal,
    });
    if (!res.ok) throw new Error(`usage_consume HTTP ${res.status}`);
    return res.json();
  };
}

/**
 * Mints a visitor id. Locally when this deployment holds ACADEMY_COOKIE_SECRET;
 * otherwise by asking the tutor function's quota endpoint (which mints and signs
 * the same cookie) and relaying its Set-Cookie. Either way it is ONE cookie.
 */
export function defaultMinter(env: Record<string, string | undefined>, timeoutMs: number): VisitorMinter {
  return async (req) => {
    const secret = env.ACADEMY_COOKIE_SECRET;
    if (secret) {
      const id = crypto.randomUUID();
      const sig = await hmacHex(secret, id);
      return { id, setCookie: visitorCookieLine(`${id}.${sig}`) };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {};
      const xff = req.headers.get("x-forwarded-for");
      if (xff) headers["x-forwarded-for"] = xff;
      const res = await fetch(`${supabaseUrl(env)}/functions/v1/academy-ai/quota`, {
        headers,
        cache: "no-store",
        signal: ctl.signal,
      });
      const line = res.headers.get("set-cookie");
      if (!line) return null;
      const first = line.split(";")[0];
      const eq = first.indexOf("=");
      if (eq < 0 || first.slice(0, eq).trim() !== VISITOR_COOKIE) return null;
      const id = await visitorIdFromCookie(decodeURIComponent(first.slice(eq + 1)), undefined);
      return id ? { id, setCookie: line } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

// ── the helper ───────────────────────────────────────────────────────────────

function parseAnswer(raw: unknown): { allowed: boolean; resetAt: string | null; reason: ConsumeReason } | null {
  // PostgREST returns a jsonb scalar as the object itself; tolerate a one-row array.
  const body = Array.isArray(raw) ? raw[0] : raw;
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (typeof o.allowed !== "boolean") return null;
  const resetAt = typeof o.reset_at === "string" ? o.reset_at : null;
  const reason = (typeof o.reason === "string" ? o.reason : "error") as ConsumeReason;
  return { allowed: o.allowed === true, resetAt, reason };
}

let warnedNoSalt = false;

export async function consume(
  opts: { metric: string; item?: string | null; weight?: number },
  req: Request,
  deps: ConsumeDeps = {},
): Promise<ConsumeResult> {
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const timeoutMs = deps.timeoutMs ?? RPC_TIMEOUT_MS;
  const log = deps.log ?? ((m: string) => console.error(m));
  const closed = (reason: ConsumeReason, setCookie: string | null = null): ConsumeResult => ({
    allowed: false,
    resetAt: null,
    reason,
    setCookie,
  });

  const rpc = deps.rpc ?? postgrestRpc(env);
  if (!rpc) {
    log("usage: service role key missing or wrong project — failing closed");
    return closed("not_configured");
  }

  // Subject: reuse the tutor meter's anonymous id; mint it only when absent.
  let setCookie: string | null = null;
  let visitor = await visitorIdFromCookie(
    readCookie(req.headers.get("cookie"), VISITOR_COOKIE),
    env.ACADEMY_COOKIE_SECRET,
  );
  if (!visitor) {
    const minted = await (deps.mintVisitor ?? defaultMinter(env, timeoutMs))(req).catch(() => null);
    if (!minted) {
      log("usage: no visitor id and none could be minted — failing closed");
      return closed("no_subject");
    }
    visitor = minted.id;
    setCookie = minted.setCookie;
  }

  const salt = env.USAGE_IP_SALT;
  if (!salt && !warnedNoSalt) {
    warnedNoSalt = true;
    log("usage: USAGE_IP_SALT is not set — the per-IP check is skipped (visitor check still applies)");
  }

  const args: UsageConsumeArgs = {
    p_app: USAGE_APP,
    p_metric: opts.metric,
    p_subject: `v:${visitor}`,
    p_item: opts.item ?? null,
    p_weight: opts.weight ?? 1,
    p_ip_subject: await ipSubject(clientIp(req), salt),
    p_dry_run: false,
  };

  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort();
        reject(new Error("usage_consume timed out"));
      }, timeoutMs);
    });
    const raw = await Promise.race([rpc(args, ctl.signal), timeout]);
    const answer = parseAnswer(raw);
    if (!answer) {
      log("usage: usage_consume answered in an unexpected shape — failing closed");
      return closed("error", setCookie);
    }
    return { ...answer, setCookie };
  } catch (err) {
    log(`usage: usage_consume failed — failing closed: ${err instanceof Error ? err.message : String(err)}`);
    return closed("error", setCookie);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Test hook: lets a test observe the one-time "no salt" log line again. */
export function _resetWarnings(): void {
  warnedNoSalt = false;
}
