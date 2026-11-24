// CC-DC-CANONICAL-DOMAIN-1.0 — the one place that knows which host serves what.
//
// This Vercel project (prj_A7MhvdAWivMLOccGMTp6AFYZQ1s1) answers for three
// brands at once: the Daily Challenge, the Faraday Intelligence storefront, and
// the Academy's player domain. One deployment, several hosts — so "which site am
// I?" is a routing decision, and before this module it was spread across
// next.config.ts, vercel.json and nothing at all.
//
// The invariant: **DC pages render on www.faradaydailychallenge.com and nowhere
// else.** Every other host that can reach a DC page 308s to the canonical one.
//
// ⚠️ This file is the ONLY place in src/ that may contain the literal
// "faradaydailychallenge.com" as a URL. Everything that needs the DC's own
// origin imports DC_CANONICAL_ORIGIN from here — never VERCEL_URL,
// VERCEL_PROJECT_PRODUCTION_URL or NEXT_PUBLIC_SITE_ORIGIN:
//   · VERCEL_PROJECT_PRODUCTION_URL silently follows Vercel's "primary domain"
//     setting, and Vercel reports the DC domain as this project's production URL
//     — so the Academy correctly refuses to read it too (src/lib/academy/origin.ts).
//   · NEXT_PUBLIC_SITE_ORIGIN belongs to the Academy's player domain.
// A hardcoded constant is deterministic; a dashboard-derived one is not.
// Enforced by the guard test in src/lib/hosts.test.ts.
//
// Pure and dependency-free on purpose: src/proxy.ts runs in the edge runtime and
// is awkward to exercise directly, and a mistake in host routing is invisible
// until a page 404s (or worse, silently answers on the wrong brand) in
// production. The decision is therefore testable in isolation.

/** The canonical origin for every Daily Challenge page and self-referencing URL. */
export const DC_CANONICAL_ORIGIN = "https://www.faradaydailychallenge.com";

/** The bare host, for the share card's footer line and similar display use. */
export const DC_CANONICAL_HOST = "faradaydailychallenge.com";

/**
 * Hosts on which DC pages render.
 *
 * The apex is included deliberately. Vercel 308s faradaydailychallenge.com →
 * www at the edge, so the apex should never reach the app — but if that domain
 * config is ever changed, treating the apex as a DC host makes the app serve the
 * page rather than redirect to a host it already believes it is. A redirect
 * there would be an infinite loop.
 */
export const DC_HOSTS = [
  "www.faradaydailychallenge.com",
  "faradaydailychallenge.com",
] as const;

/** The Faraday Intelligence storefront / brand surface. */
export const BRAND_HOSTS = [
  "www.faraday-intelligence.ai",
  "faraday-intelligence.ai",
] as const;

/**
 * The Academy's player domain. Academy routing on this host is owned by
 * src/lib/academy/player-host.ts (CC-ACADEMY-PLAYER); this module only claims
 * the DC page paths, so the player host can never become a third DC mirror.
 */
export const PLAYER_HOSTS = [
  "www.faraday-player.com",
  "faraday-player.com",
] as const;

/** What the host layer should do with a request. */
export type HostRoute =
  /** Serve a different path on this same host, with no visible redirect. */
  | { kind: "rewrite"; to: string }
  /** Send the client to another URL. Always 308: permanent and method-preserving. */
  | { kind: "redirect"; to: string; status: 308 }
  /**
   * Not ours. Hand the request on untouched.
   *
   * For a composed proxy this means "fall through to the next host rule"
   * (the Academy's player-host logic), not necessarily "serve it".
   */
  | { kind: "next" };

/**
 * Paths that must NEVER be redirected across hosts, whoever asks.
 *
 * A 308 on a POST re-sends the body to another origin; a 308 on a Vercel Cron
 * path breaks the cron (it fires against the project's production URL, not
 * necessarily the DC domain); a 308 on an asset breaks the page that embeds it.
 *
 * The extension rule is load-bearing, not belt-and-braces: /public contains
 * share/icons/*.png and share/fonts/* — real assets sitting *underneath* the
 * /share DC page prefix. Without it, consolidating /share would 404 every
 * share-card icon.
 */
const NEVER_REDIRECT: readonly RegExp[] = [
  /^\/api\//, // includes every /api/cron/* and /api/pipelines/* route
  /^\/_next\//,
  /^\/manifest\.webmanifest$/,
  /^\/favicon\.ico$/,
  /^\/robots\.txt$/,
  /^\/sitemap\.xml$/,
  /\.[a-z0-9]+$/i, // any file extension: .png, .svg, .webp, .woff2, .html, .ico
];

/**
 * Path prefixes that are Daily Challenge pages.
 *
 * Enumerated from src/app in Phase 0 rather than hand-written, and deliberately
 * a prefix list: a new /challenge/* or /help/* page is covered the day it lands.
 *
 * NOT here, and why:
 *   · /terms, /terms/*, /privacy — the master Terms is the canonical legal body
 *     for every Faraday storefront and /privacy covers both surfaces by name.
 *     Shared, so they answer on whichever host the reader arrived on.
 *   · /about, /who-is-faraday, /merch, /library, /briefing-library, /signal-room,
 *     /jurisdiction-watch, /intelligent-alert, /live-agent, /thought-forge,
 *     /legal — brand pages. The DC masthead links to them under "More Faraday"
 *     by design.
 *   · /academy — owned by CC-ACADEMY-PLAYER.
 *   · /internal/* — secret-gated ops tooling, noindex.
 */
const DC_PATH_PREFIXES: readonly string[] = [
  "/challenge",
  "/daily-challenge",
  "/leaderboard",
  "/free-agency",
  "/auth",
  "/account",
  "/notifications",
  "/messages",
  "/share",
  "/help",
  "/league-office",
];

/** Lowercase the host and drop any :port, so "WWW.Example.com:443" matches. */
function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().split(":")[0];
}

function isIn(hosts: readonly string[], host: string): boolean {
  return hosts.includes(host);
}

export function isDcHost(host: string | null | undefined): boolean {
  return isIn(DC_HOSTS, normalizeHost(host));
}

export function isBrandHost(host: string | null | undefined): boolean {
  return isIn(BRAND_HOSTS, normalizeHost(host));
}

export function isPlayerHost(host: string | null | undefined): boolean {
  return isIn(PLAYER_HOSTS, normalizeHost(host));
}

/** True for a path that must never be redirected cross-host (D7). */
export function isNeverRedirected(pathname: string): boolean {
  return NEVER_REDIRECT.some((re) => re.test(pathname));
}

/** True for a path that is a Daily Challenge *page*. Assets are excluded. */
export function isDcPagePath(pathname: string): boolean {
  if (isNeverRedirected(pathname)) return false;
  return DC_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * The canonical DC path for a DC page path.
 *
 * /daily-challenge is a rewrite alias for /challenge (next.config.ts afterFiles),
 * and on the DC host the lobby answers at the bare root — which is already what
 * og:url advertises (`${DC_CANONICAL_ORIGIN}/`, see src/lib/share/og.js). So the
 * three lobby spellings collapse to one canonical URL instead of redirecting to
 * a second alias, and the deep paths keep their shape.
 */
export function canonicalDcPath(pathname: string): string {
  if (pathname === "/daily-challenge" || pathname === "/challenge") return "/";
  if (pathname.startsWith("/daily-challenge/")) {
    return `/challenge${pathname.slice("/daily-challenge".length)}`;
  }
  return pathname;
}

/** Absolute canonical URL for an internal DC page path. */
export function dcCanonicalUrl(pathname: string, search = ""): string {
  return `${DC_CANONICAL_ORIGIN}${canonicalDcPath(pathname)}${search}`;
}

/**
 * The host-routing decision, as a pure function.
 *
 * @param host       the incoming Host header (may carry a port, any case)
 * @param pathname   the request path, leading slash, no query
 * @param search     the query string including "?", or "" — preserved verbatim
 *                   across a redirect so ?game=Rackl survives the hop
 */
export function resolveHostRoute(
  host: string | null | undefined,
  pathname: string,
  search = "",
): HostRoute {
  const h = normalizeHost(host);

  // The canonical DC host. Behaviour here is unchanged from before this module:
  // the lobby renders at the bare root, every other DC path serves itself.
  //
  // Returning the root rewrite (rather than deferring to next.config.ts, which
  // still carries the same host-conditioned rule) keeps the whole host decision
  // readable in one place and under test. The two agree by construction.
  if (isIn(DC_HOSTS, h)) {
    if (pathname === "/") return { kind: "rewrite", to: "/challenge" };
    return { kind: "next" };
  }

  // Brand and player hosts: a DC page belongs on the DC domain.
  //
  // On the player host this intentionally takes precedence over the Academy's
  // catch-all rewrite-into-/academy, which would otherwise answer a stale DC
  // link with an Academy 404. Everything that is not a DC page path falls
  // through untouched, so the Academy's own routing is preserved exactly.
  if (isIn(BRAND_HOSTS, h) || isIn(PLAYER_HOSTS, h)) {
    if (isDcPagePath(pathname)) {
      return { kind: "redirect", to: dcCanonicalUrl(pathname, search), status: 308 };
    }
    return { kind: "next" };
  }

  // Preview deployments (*.vercel.app) and local dev render everything on their
  // own URL — redirecting them to production would make preview QA impossible,
  // including the Academy branch's.
  return { kind: "next" };
}
