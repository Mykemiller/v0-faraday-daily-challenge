// Faraday Academy — the absolute origin used for canonical and Open Graph URLs.
//
// Next emits RELATIVE canonical/og:url unless metadataBase is set, and a relative
// canonical is invalid — Lighthouse flags it and crawlers ignore it. Open lessons
// make that matter, so every academy page resolves against this.
//
// Order is deliberate: a canonical should always name the production URL, so the
// ephemeral per-deployment VERCEL_URL is the last resort, not the first.

export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (explicit) return explicit.replace(/\/$/, "");

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;

  const deployment = process.env.VERCEL_URL;
  if (deployment) return `https://${deployment}`;

  return "https://faraday-intelligence.ai";
}
