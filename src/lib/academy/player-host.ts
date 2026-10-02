// Faraday Academy — the player domain's routing decision, as a pure function.
//
// src/proxy.ts is hard to exercise directly (it needs a NextRequest and runs in
// the edge runtime), and a mistake in it is invisible until a path 404s in
// production. The decision itself has no runtime dependencies, so it lives here
// and is unit-tested.

export const PLAYER_HOST = /^(www\.)?faraday-player\.com$/i;

/**
 * Paths that must reach the app untouched on the player domain.
 *
 * Deliberately NOT all of /api: the engine's own endpoints (/api/score,
 * /api/teams, /api/lo/*) must not answer on the player domain. Only the two the
 * player itself needs are listed.
 */
const PASSTHROUGH: RegExp[] = [
  /^\/_next\//,            // build assets
  /^\/api\/academy\//,     // Go deeper panel + signed-in progress sync
  /^\/api\/revalidate$/,   // the academy_courses status-change hook
  /^\/favicon\.ico$/,
  /^\/icon\.svg$/,
  /^\/apple-icon\.png$/,
  /^\/manifest\.webmanifest$/,
];

export type PlayerRoute =
  | { kind: "pass" }
  | { kind: "redirect"; to: string }
  | { kind: "rewrite"; to: string };

export function isPlayerHost(host: string | null): boolean {
  return PLAYER_HOST.test((host ?? "").split(":")[0]);
}

export function routeForPlayerHost(pathname: string): PlayerRoute {
  if (PASSTHROUGH.some((re) => re.test(pathname))) return { kind: "pass" };

  // The player's domain never shows the /academy prefix.
  if (pathname === "/academy" || pathname.startsWith("/academy/")) {
    const stripped = pathname === "/academy" ? "/" : pathname.slice("/academy".length);
    return { kind: "redirect", to: stripped };
  }

  // Everything else maps into the academy tree, so a non-course path lands on the
  // academy's own 404 rather than exposing an engine route.
  return { kind: "rewrite", to: pathname === "/" ? "/academy" : `/academy${pathname}` };
}
