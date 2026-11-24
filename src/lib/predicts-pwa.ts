// Faraday Predicts — installable app + push (FDY-127 Phase 2, 26-47-v01). Pure helpers only:
// no React, no fetch, no window. node --test covers every function here
// (src/lib/predicts-pwa.test.ts). Spec: docs/specs/predicts-pwa.md (CC-PREDICTS-PWA-1.0).
//
// Rules carried from the spec:
//   · D1 — the Predicts app has its OWN manifest and scope (/predicts), so installing it never
//     takes over the Daily Challenge (and vice versa).
//   · §6/§9 — the push toggle is never shown where it would silently fail: iOS Safari outside an
//     installed Home Screen app gets the install hint instead.
//   · D5 — Followed forecasts = the public Open set filtered by the subscriber's FDY-119
//     preferences, with the FDY-113 digest rule (predictionMatches) applied by NAME, because the
//     public API carries names, not codes. No follow table.
//   · The recipient token is a credential: it is never logged, never put in a URL this app
//     builds, and only ever sent to the two Predicts functions that take it.

import type { V3Row } from "./predicts-v3.ts";

// ── copy (spec §8 — proposals for Myke's review; nothing here is final copy) ──

export const PWA_COPY = {
  name: "Faraday Predicts",
  shortName: "Predicts",
  toggle: "Flash alerts on this device",
  toggleHelp: "Get a notification when Faraday makes a new call you follow. You can turn this off at any time.",
  iosInstallHint: "To get alerts on iPhone, tap Share, then Add to Home Screen, and open Predicts from there.",
  permissionDenied: "Notifications are blocked for this site. Turn them on in your browser settings to get Flash alerts.",
  offlineBanner: (date: string) => `You're offline — showing the calls as of ${date}.`,
  offlineUnknownDate: "your last visit",
  offlineWriteRefused: "You're offline. Preference changes need a connection.",
  installPrompt: "Install Faraday Predicts",
  // Phase 2 additions, quoted in spec §8 for review:
  unsupported: "This browser can't show Flash alerts.",
  followingTitle: "Followed forecasts",
  followingIntro: "Open calls that match your preferences.",
  followingNeedsLink: "Open the \"Manage your preferences\" link in your latest Faraday Predicts email on this device to see the calls you follow.",
  followingEmpty: "No open call matches your preferences right now.",
} as const;

// ── manifest (D1) ────────────────────────────────────────────────────────────

/**
 * Manifest AND service-worker scope. Deliberately "/predicts" with no trailing slash: this site runs
 * with Next's default trailingSlash=false, so "/predicts/" 308s to "/predicts" — and "/predicts" is
 * NOT inside a "/predicts/" scope (scope matching is a plain prefix test). A start_url outside its
 * scope makes browsers discard the scope and fall back to "/", which would capture the whole site.
 * No route starts with "/predicts" other than /predicts and /predicts/*, so the prefix is exact in
 * practice; isInScope() below is stricter still. The worker lives at /predicts/sw.js, so widening
 * its scope to "/predicts" needs the `Service-Worker-Allowed: /predicts` header (next.config.ts).
 */
export const PREDICTS_SCOPE = "/predicts";
export const PREDICTS_MANIFEST_PATH = "/predicts/manifest.webmanifest";
export const PREDICTS_SW_PATH = "/predicts/sw.js";
export const BRAND_FOREST = "#1C3424";

export type WebManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  background_color: string;
  theme_color: string;
  icons: { src: string; type: string; sizes: string; purpose?: string }[];
};

/** The Predicts manifest (served at /predicts/manifest.webmanifest). The root Daily Challenge
 *  manifest (src/app/manifest.ts) is untouched by this file. */
export function predictsManifest(): WebManifest {
  return {
    id: "/predicts",
    name: PWA_COPY.name,
    short_name: PWA_COPY.shortName,
    description: "Faraday's dated, graded forecasts on the AI data center market.",
    start_url: "/predicts?source=pwa",
    scope: PREDICTS_SCOPE,
    display: "standalone",
    background_color: BRAND_FOREST,
    theme_color: BRAND_FOREST,
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
  };
}

/** Is `url` (absolute, or a path) inside the Predicts scope on `origin`? Used by the notification-click guard. */
export function isInScope(url: string, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return false;
  }
  if (u.origin !== new URL(origin).origin) return false;
  return u.pathname === PREDICTS_SCOPE || u.pathname.startsWith(`${PREDICTS_SCOPE}/`);
}

// ── push support (§6, §9) ────────────────────────────────────────────────────

export type PushSupport = "unsupported" | "ios_needs_install" | "prompt" | "granted" | "denied";

export interface PushEnv {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  permission: "default" | "granted" | "denied" | null;
}

export function pushSupportState(e: PushEnv): PushSupport {
  // iOS/iPadOS 16.4+: PushManager exists only inside an installed Home Screen app.
  if (e.isIOS && !e.isStandalone) return "ios_needs_install";
  if (!e.hasServiceWorker || !e.hasPushManager || !e.hasNotification) return e.isIOS ? "ios_needs_install" : "unsupported";
  if (e.permission === "denied") return "denied";
  if (e.permission === "granted") return "granted";
  return "prompt";
}

/** iPhone/iPad, including iPadOS 13+ which reports a Macintosh UA but has touch. */
export function isIOSUserAgent(ua: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && maxTouchPoints > 1;
}

export function platformOf(ua: string, maxTouchPoints = 0): "ios" | "android" | "desktop" | "unknown" {
  if (!ua) return "unknown";
  if (isIOSUserAgent(ua, maxTouchPoints)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return "desktop";
  return "unknown";
}

/** VAPID public key (base64url) → the Uint8Array pushManager.subscribe() wants. Null when malformed. */
export function vapidKeyBytes(b64url: string | null | undefined): Uint8Array | null {
  const s = String(b64url ?? "").trim();
  if (!/^[A-Za-z0-9_-]{86,88}={0,2}$/.test(s)) return null;
  const t = s.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  if (bin.length !== 65 || bin.charCodeAt(0) !== 4) return null;
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** predicts-push-subscribe sits beside predicts-public on the same functions origin. */
export function pushSubscribeUrlFrom(publicApiUrl: string): string {
  return publicApiUrl.replace(/predicts-public\/?$/, "predicts-push-subscribe");
}

// ── the recipient token (FDY-112 / FDY-119 link token) ──────────────────────

export const TOKEN_KEY = "faraday_predicts_token";
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseToken(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim();
  return TOKEN_RE.test(t) ? t.toLowerCase() : null;
}

/** ?t= wins (a fresh email link); otherwise the token this device kept from an earlier visit. */
export function chooseToken(fromUrl: string | null | undefined, stored: string | null | undefined): string | null {
  return parseToken(fromUrl) ?? parseToken(stored);
}

// ── offline banner date ──────────────────────────────────────────────────────

/** The time a cached page was stored (epoch ms, written by the service worker), in the reader's zone. */
export function formatCachedAt(epochMs: number | null | undefined, timeZone?: string): string | null {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs) || epochMs <= 0) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).formatToParts(epochMs);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")}`.trim();
  } catch {
    return null;
  }
}

// ── Followed forecasts (D5) ──────────────────────────────────────────────────

export interface FollowPrefs {
  sectors: string[];
  theaters: string[];
  threads: string[];
  key_players: string[];
  horizons: string[];
  min_probability: number;
  include_bold: boolean;
}

export interface FollowNames {
  /** code → display name, from the preferences GET `options` */
  sectors: ReadonlyMap<string, string>;
  theaters: ReadonlyMap<string, string>;
  threads: ReadonlyMap<string, string>;
  /** company_uid → name, from options.selected_key_players */
  keyPlayers: ReadonlyMap<string, string>;
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

function namesFor(codes: readonly string[], map: ReadonlyMap<string, string>): Set<string> {
  return new Set(codes.map((c) => norm(map.get(c) ?? "")).filter(Boolean));
}

/**
 * The FDY-113 rule (predictionMatches in the engine's _shared/predicts-preferences-pure.ts) over a
 * public row: every non-empty filter must match; an empty filter matches everything; a row with no
 * value for a non-empty filter does not match; and the probability floor is waived for a Bold Call
 * when include_bold is on. Codes are mapped to names first (the public API carries names only).
 * A code whose name is unknown can match nothing, so a non-empty filter of only unknown codes
 * excludes everything rather than silently widening.
 */
export function followedMatches(row: V3Row, p: FollowPrefs, n: FollowNames): boolean {
  const sector = norm(row.taxonomy?.sector ?? row.sector_name);
  const theater = norm(row.taxonomy?.theater);
  const thread = norm(row.taxonomy?.thread);
  if (p.sectors.length && !(sector && namesFor(p.sectors, n.sectors).has(sector))) return false;
  if (p.theaters.length && !(theater && namesFor(p.theaters, n.theaters).has(theater))) return false;
  if (p.threads.length && !(thread && namesFor(p.threads, n.threads).has(thread))) return false;
  if (p.key_players.length) {
    const want = namesFor(p.key_players, n.keyPlayers);
    if (!(row.companies ?? []).some((c) => want.has(norm(c.name)))) return false;
  }
  if (p.horizons.length && !(row.horizon_bucket && p.horizons.includes(row.horizon_bucket))) return false;
  const prob = typeof row.probability_score === "number" ? row.probability_score : -1;
  return prob >= p.min_probability || (!!row.is_bold && p.include_bold);
}

export function followedForecasts(rows: readonly V3Row[], p: FollowPrefs, n: FollowNames): V3Row[] {
  return rows.filter((r) => followedMatches(r, p, n));
}

/** Build the name maps from the FDY-119 GET `options` object (shape in predicts-preferences.ts). */
export function followNamesFrom(options: {
  sectors?: { code: string; name: string }[];
  theaters?: { code: string; name: string }[];
  thread_groups?: { threads: { code: string; name: string }[] }[];
  selected_key_players?: { id: string; name: string }[];
} | null | undefined): FollowNames {
  const o = options ?? {};
  return {
    sectors: new Map((o.sectors ?? []).map((x) => [x.code, x.name])),
    theaters: new Map((o.theaters ?? []).map((x) => [x.code, x.name])),
    threads: new Map((o.thread_groups ?? []).flatMap((g) => g.threads.map((t) => [t.code, t.name] as const))),
    keyPlayers: new Map((o.selected_key_players ?? []).map((k) => [k.id, k.name])),
  };
}
