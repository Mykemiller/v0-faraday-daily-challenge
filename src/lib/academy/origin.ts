// Faraday Academy — the player's public origin and path shape.
//
// The player's home is faraday-player.com (Myke, 2026-10-02) and it is served at
// that domain's ROOT: faraday-player.com/<slug>/1/2, not /academy/<slug>/1/2.
// src/proxy.ts does the host-conditioned mapping; this module is the single place
// that knows what the resulting public URL looks like.
//
// ⚠️ One deployment serves several hosts, so the canonical must NOT be derived
// from the incoming Host header: reading headers() in generateMetadata would opt
// every course route out of ISR. A canonical names the PREFERRED url regardless
// of which host answered, so a page served from faraday-intelligence.ai/academy/x
// correctly canonicalises to faraday-player.com/x. That is both correct and
// static.
//
// Deliberately does NOT fall back to VERCEL_PROJECT_PRODUCTION_URL: this Vercel
// project serves two other production domains, and Vercel reports the Daily
// Challenge game domain as "the" production URL. Canonicalising the courses onto
// the game domain would be worse than the relative URLs this replaced.

const PLAYER_HOME = "https://faraday-player.com";

/** The player is mounted at its own domain's root, not under /academy. */
const PLAYER_AT_ROOT = true;

export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (explicit) return explicit.replace(/\/$/, "");
  return PLAYER_HOME;
}

/**
 * Internal app path -> the path the reader sees on the player's own domain.
 * "/academy" -> "/", "/academy/cooling/1/2" -> "/cooling/1/2".
 */
export function publicPath(internal: string): string {
  if (!PLAYER_AT_ROOT) return internal;
  if (internal === "/academy") return "/";
  return internal.startsWith("/academy/") ? internal.slice("/academy".length) : internal;
}

/** Absolute canonical URL for an internal app path. */
export function canonicalUrl(internal: string): string {
  return new URL(publicPath(internal), siteOrigin()).toString();
}
