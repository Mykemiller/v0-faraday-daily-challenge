// CC-DC-CANONICAL-DOMAIN-1.0 — edge-runtime wiring for the host map, with the
// Academy player's routing chained after it (CC-ACADEMY-PLAYER).
//
// Next 16 renamed the `middleware` convention to `proxy`. This file is only the
// wiring: the host decision lives in src/lib/hosts.ts as a pure function, so
// it can be unit-tested (src/lib/hosts.test.ts) instead of discovered in
// production.
//
// Order matters: resolveHostRoute runs FIRST, so a DC page path on the player
// domain 308s to the DC domain (a stale DC link should go home, not hit an
// Academy 404). Only when it says "next" does the player's own routing run.
// Do not add a second host router; extend resolveHostRoute or chain it here.
//
// Player routing (faraday-player.com only): the course player is the whole
// site — the catalog is the root and a course is a top-level path. Everywhere
// else the app is unchanged and the player stays under /academy. The rewrite
// is also the guard: EVERY non-passthrough path maps into the academy tree, so
// engine routes are unreachable on the player domain by construction.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveHostRoute, isPlayerHost } from "@/lib/hosts";

// Must reach the app untouched even on the player host.
const PLAYER_PASSTHROUGH: RegExp[] = [
  /^\/_next\//,            // build assets
  /^\/api\/academy\//,     // Go deeper panel + signed-in progress sync
  /^\/favicon\.ico$/,
  /^\/icon\.svg$/,
  /^\/apple-icon\.png$/,
  /^\/manifest\.webmanifest$/,
];

function playerRoute(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PLAYER_PASSTHROUGH.some((re) => re.test(pathname))) return NextResponse.next();

  // The player's domain never shows the /academy prefix. Anyone arriving on the
  // old shape (an old link, a crawler) is sent to the canonical one.
  if (pathname === "/academy" || pathname.startsWith("/academy/")) {
    const stripped = pathname === "/academy" ? "/" : pathname.slice("/academy".length);
    return NextResponse.redirect(new URL(`${stripped}${search}`, request.url), 308);
  }

  const target = pathname === "/" ? "/academy" : `/academy${pathname}`;
  return NextResponse.rewrite(new URL(`${target}${search}`, request.url));
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = request.headers.get("host");
  const route = resolveHostRoute(host, pathname, search);

  switch (route.kind) {
    case "redirect":
      // `route.to` is already absolute (it names the canonical origin), and the
      // query string is baked in by dcCanonicalUrl.
      return NextResponse.redirect(route.to, route.status);
    case "rewrite":
      return NextResponse.rewrite(new URL(`${route.to}${search}`, request.url));
    case "next":
      // CC-ACADEMY-PLAYER composes here, after the DC host map.
      if (isPlayerHost(host)) return playerRoute(request);
      return NextResponse.next();
  }
}

export const config = {
  // Static assets never need a host decision, and excluding them here keeps the
  // proxy off the hot path for every image and chunk. Page and API routes still
  // pass through; src/lib/hosts.ts is what guarantees /api/* is never redirected.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
