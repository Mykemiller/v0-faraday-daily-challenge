// Faraday Academy — the absolute origin used for canonical and Open Graph URLs.
//
// Next emits RELATIVE canonical/og:url unless metadataBase is set, and a relative
// canonical is invalid — crawlers ignore it and social unfurlers get nothing.
// Open lessons are the whole reason the SEO work exists, so this matters.
//
// ⚠️ Deliberately does NOT fall back to VERCEL_PROJECT_PRODUCTION_URL or
// VERCEL_URL. This Vercel project serves TWO production domains — the Daily
// Challenge on faradaydailychallenge.com and the brand surface on
// faraday-intelligence.ai — and Vercel reports the former as the project's
// production URL. Canonicalising the Academy onto the game domain would tell
// search engines the courses live somewhere they do not. The player's home is
// faraday-player.com (Myke, 2026-10-02), so that is the default, and
// NEXT_PUBLIC_SITE_ORIGIN is the explicit override.
//
// ⚠️ faraday-player.com is NOT yet attached to this Vercel project, and the path
// shape under it is undecided (/academy/... vs the domain root). Until both are
// settled these canonicals name a host that does not serve them yet.

const ACADEMY_HOME = "https://faraday-player.com";

export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (explicit) return explicit.replace(/\/$/, "");
  return ACADEMY_HOME;
}
