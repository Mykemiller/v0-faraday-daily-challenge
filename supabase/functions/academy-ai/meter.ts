// Faraday Academy — "Go deeper" metering.
//
// Five requests a day for everyone, anonymous and signed in alike, resetting at
// midnight America/Chicago. Anonymous readers are keyed on a signed httpOnly
// cookie plus a hashed IP prefix as a second key, so clearing a cookie does not
// hand out a fresh allowance; signed-in readers key on their user id.
//
// Nothing here is a paywall. The limit exists because web search and a frontier
// model cost real money per call, and the panel always shows what is left.

export const DAILY_LIMIT = 5;
export const CHICAGO = "America/Chicago";

// Burst protection thresholds.
export const BURST_PER_MINUTE = 4;   // more than this in 60s -> Turnstile
export const BURST_PER_HOUR = 20;    // more than this in an hour -> Turnstile
export const HARD_PER_HOUR = 40;     // past this -> 429 for an hour

export const COOKIE_NAME = "fa_deeper_id";

/** The current date in America/Chicago, as YYYY-MM-DD. */
export function chicagoDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHICAGO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * When the allowance resets, as an ISO instant. Computed by walking forward to the
 * first moment whose Chicago date differs, so it is correct across both DST
 * transitions without hard-coding an offset.
 */
export function nextChicagoMidnight(now: Date): Date {
  const today = chicagoDay(now);
  // Start from now and step in hours; at most 25 steps crosses any midnight.
  for (let h = 1; h <= 26; h++) {
    const probe = new Date(now.getTime() + h * 3600_000);
    if (chicagoDay(probe) !== today) {
      // Narrow to the minute for a tidy reset time.
      let lo = new Date(probe.getTime() - 3600_000);
      for (let m = 1; m <= 60; m++) {
        const p2 = new Date(lo.getTime() + m * 60_000);
        if (chicagoDay(p2) !== today) return p2;
      }
      return probe;
    }
  }
  return new Date(now.getTime() + 86_400_000);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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

/** Constant-time compare so the cookie signature is not a timing oracle. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SignedId = { id: string; cookieValue: string };

/** Mints a fresh anonymous id and its signed cookie value. */
export async function mintAnonId(secret: string): Promise<SignedId> {
  const id = crypto.randomUUID();
  const sig = await hmacHex(secret, id);
  return { id, cookieValue: `${id}.${sig}` };
}

/** Returns the id when the cookie's signature checks out, else null. */
export async function verifyAnonCookie(value: string | null, secret: string): Promise<string | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = await hmacHex(secret, id);
  return timingSafeEqual(sig, expected) ? id : null;
}

export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * The IP prefix, not the address: /24 for IPv4 and /48 for IPv6. Narrow enough to
 * blunt cookie-clearing, coarse enough not to be a per-person identifier, and
 * hashed before it is ever stored.
 */
export function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  const first = ip.split(",")[0].trim();
  if (!first) return null;
  if (first.includes(":")) {
    const groups = first.split(":").filter((g) => g.length > 0);
    return groups.slice(0, 3).join(":");
  }
  const octets = first.split(".");
  if (octets.length !== 4) return null;
  return octets.slice(0, 3).join(".");
}

export async function hashedIpKey(ip: string | null, secret: string): Promise<string | null> {
  const prefix = ipPrefix(ip);
  if (!prefix) return null;
  return `ip:${(await sha256Hex(`${secret}:${prefix}`)).slice(0, 32)}`;
}

export type MeterKeys = {
  /** The key the allowance is counted against. */
  primary: string;
  /** The hashed IP-prefix key, counted alongside for anonymous readers. */
  secondary: string | null;
  userId: string | null;
  /** Set when a fresh anonymous cookie must be returned on this response. */
  setCookie: string | null;
};

export async function resolveKeys(opts: {
  userId: string | null;
  cookieHeader: string | null;
  ip: string | null;
  secret: string;
}): Promise<MeterKeys> {
  if (opts.userId) {
    return { primary: `user:${opts.userId}`, secondary: null, userId: opts.userId, setCookie: null };
  }
  const existing = await verifyAnonCookie(parseCookie(opts.cookieHeader, COOKIE_NAME), opts.secret);
  let id = existing;
  let setCookie: string | null = null;
  if (!id) {
    const minted = await mintAnonId(opts.secret);
    id = minted.id;
    setCookie = `${COOKIE_NAME}=${encodeURIComponent(minted.cookieValue)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
  }
  return {
    primary: `anon:${id}`,
    secondary: await hashedIpKey(opts.ip, opts.secret),
    userId: null,
    setCookie,
  };
}

export type Decision =
  | { allow: true; remaining: number; resetsAt: string }
  | { allow: false; reason: "limit"; remaining: 0; resetsAt: string }
  | { allow: false; reason: "turnstile"; remaining: number; resetsAt: string }
  | { allow: false; reason: "throttled"; remaining: number; resetsAt: string }
  | { allow: false; reason: "spend_cap"; remaining: number; resetsAt: string };

/**
 * The allowance decision. `used` is the higher of the two keys' counts, so an
 * anonymous reader cannot reset their day by dropping a cookie.
 */
export function decide(opts: {
  usedPrimary: number;
  usedSecondary: number;
  lastMinute: number;
  lastHour: number;
  turnstilePassed: boolean;
  spendCapReached: boolean;
  now: Date;
}): Decision {
  const resetsAt = nextChicagoMidnight(opts.now).toISOString();
  const used = Math.max(opts.usedPrimary, opts.usedSecondary);
  const remaining = Math.max(DAILY_LIMIT - used, 0);

  // A global overspend stops everyone until reset, ahead of any per-key check.
  if (opts.spendCapReached) return { allow: false, reason: "spend_cap", remaining, resetsAt };
  if (opts.lastHour > HARD_PER_HOUR) return { allow: false, reason: "throttled", remaining, resetsAt };
  if (remaining <= 0) return { allow: false, reason: "limit", remaining: 0, resetsAt };
  if (!opts.turnstilePassed && (opts.lastMinute > BURST_PER_MINUTE || opts.lastHour > BURST_PER_HOUR)) {
    return { allow: false, reason: "turnstile", remaining, resetsAt };
  }
  return { allow: true, remaining, resetsAt };
}

// ── cost metering ────────────────────────────────────────────────────────────

/**
 * Per-million-token rates, overridable by env so a model change does not silently
 * mis-price. Defaults are Claude Opus 5 list rates; web search is $10 per 1,000.
 */
export type Rates = {
  inputPerMTok: number;
  outputPerMTok: number;
  perSearch: number;
};

export const DEFAULT_RATES: Rates = {
  inputPerMTok: 5,
  outputPerMTok: 25,
  perSearch: 10 / 1000,
};

/**
 * A request counts against the reader's allowance only if it actually consumed
 * something. A call that failed before the model produced any tokens cost us
 * nothing, so charging a reader one of their five for our own outage is wrong —
 * and it opens no abuse vector, because a failure that is free for us is equally
 * free for an attacker.
 */
export function shouldChargeRequest(totals: {
  input: number;
  output: number;
  searches: number;
}): boolean {
  return totals.input > 0 || totals.output > 0 || totals.searches > 0;
}

export function estimateCostUsd(
  usage: { input_tokens?: number; output_tokens?: number; searches?: number },
  rates: Rates = DEFAULT_RATES,
): number {
  const input = (usage.input_tokens ?? 0) / 1_000_000 * rates.inputPerMTok;
  const output = (usage.output_tokens ?? 0) / 1_000_000 * rates.outputPerMTok;
  const search = (usage.searches ?? 0) * rates.perSearch;
  return Number((input + output + search).toFixed(6));
}
