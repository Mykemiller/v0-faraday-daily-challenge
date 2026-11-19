// faraday-gate · core (FDY-414, ADM-1.7). Pure: no I/O, no framework imports, safe on server and client.
// Canonical copy lives in Mykemiller/faraday-workbench/packages/faraday-gate/. Apps vendor it as lib/faraday-gate/
// (with VERSION). Do not edit a vendored copy; change the canonical one and re-vendor.

export type GateMode = "open" | "invite" | "waitlist" | "live";

/** What estate_entitled(email, app) returns. */
export interface Entitlement {
  allowed: boolean;
  reason:
    | "unknown_app" | "owner" | "open" | "grant"
    | "expired" | "paused" | "revoked" | "waitlist_mode" | "no_grant"
    | "error" | "signed_out";
  mode: GateMode | null;
  role?: string | null;
  grant_kind?: string | null;
  expires_at?: string | null;
  app?: string;
  code?: string;
}

/** Fail-closed answer used for every error, timeout or malformed reply. */
export function denied(reason: Entitlement["reason"] = "error", mode: GateMode | null = null): Entitlement {
  return { allowed: false, reason, mode, role: null, grant_kind: null, expires_at: null };
}

/** Coerce an RPC reply into an Entitlement. Anything that is not clearly `allowed === true` is a denial. */
export function parseEntitlement(raw: unknown): Entitlement {
  if (!raw || typeof raw !== "object") return denied("error");
  const r = raw as Record<string, unknown>;
  const mode = (["open", "invite", "waitlist", "live"] as const).find((m) => m === r.mode) ?? null;
  const reason = typeof r.reason === "string" ? (r.reason as Entitlement["reason"]) : "error";
  return {
    allowed: r.allowed === true,
    reason,
    mode,
    role: typeof r.role === "string" ? r.role : null,
    grant_kind: typeof r.grant_kind === "string" ? r.grant_kind : null,
    expires_at: typeof r.expires_at === "string" ? r.expires_at : null,
    app: typeof r.app === "string" ? r.app : undefined,
    code: typeof r.code === "string" ? r.code : undefined,
  };
}

/** Which gate screen to show for a denial. */
export type GateView = "pass" | "request" | "expired" | "waitlist" | "unavailable";

export function gateView(e: Entitlement, signedIn: boolean): GateView {
  if (e.allowed) return "pass";
  if (e.reason === "error" || e.reason === "unknown_app") return "unavailable";
  if (signedIn && e.reason === "expired") return "expired";
  if (e.reason === "waitlist_mode") return "waitlist";
  return "request";
}

/** The only commercial sentence the gate may print (no prices, ever). */
export const COMMERCIAL_LINE =
  "Faraday is offered as a monthly subscription, with plans for individuals and enterprise plans by inquiry. A demonstration period is available at no charge upon inquiry.";

export interface GateCopy {
  access_key: string;
  status: "draft" | "approved";
  app_name: string;
  story: string;
  what_you_get: string[];
}

/** Neutral text shown until Myke approves an app's copy (subscriber-facing copy is always-human). */
export function displayCopy(copy: GateCopy | null | undefined, appName: string): { title: string; story: string; points: string[] } {
  if (copy && copy.status === "approved") {
    return { title: copy.app_name, story: copy.story, points: copy.what_you_get.slice(0, 3) };
  }
  return {
    title: appName,
    story: `${appName} is in a private beta. Every request is reviewed by hand, and we reply by email.`,
    points: [],
  };
}

/** True when text carries a price-like string. Used by tests and by a runtime guard on copy. */
export function containsPrice(text: string): boolean {
  return /\$|\bUSD\b|€|£|\b\d+\s*(?:\/\s*mo|per\s+month|tokens?)\b/i.test(text);
}

/** Count-free rule (Brand Bible G1): never state counts of Theaters, Sectors, Threads or Domains. */
export function containsCountClaim(text: string): boolean {
  return /\b\d+\s+(?:theaters?|sectors?|threads?|domains?|sub-?domains?)\b/i.test(text);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}
export function isEmail(e: string): boolean {
  return EMAIL_RE.test(e) && e.length <= 254;
}
