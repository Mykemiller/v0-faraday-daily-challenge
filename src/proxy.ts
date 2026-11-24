// CC-DC-CANONICAL-DOMAIN-1.0 — edge-runtime wiring for the host map, with the
// Academy player's routing chained after it (CC-ACADEMY-PLAYER).
//
// Next 16 renamed the `middleware` convention to `proxy`. This file is only the
// wiring: both decisions are pure functions so they can be unit-tested instead
// of discovered in production —
//   · src/lib/hosts.ts               resolveHostRoute   (src/lib/hosts.test.ts)
//   · src/lib/academy/player-host.ts routeForPlayerHost (src/lib/academy/academy.test.ts)
//
// Order matters: resolveHostRoute runs FIRST, so a DC page path on the player
// domain 308s to the DC domain (a stale DC link should go home, not hit an
// Academy 404). Only when it says "next" does the player's own routing run, and
// from there the Academy's behaviour is unchanged. Do not add a second host
// router; extend resolveHostRoute or chain it here.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveHostRoute } from "@/lib/hosts";
import { isPlayerHost, routeForPlayerHost } from "@/lib/academy/player-host";

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
      break;
  }

  // CC-ACADEMY-PLAYER composes here, after the DC host map.
  if (!isPlayerHost(host)) return NextResponse.next();

  const player = routeForPlayerHost(pathname);
  switch (player.kind) {
    case "pass":
      return NextResponse.next();
    case "redirect":
      return NextResponse.redirect(new URL(`${player.to}${search}`, request.url), 308);
    case "rewrite":
      return NextResponse.rewrite(new URL(`${player.to}${search}`, request.url));
  }
}

export const config = {
  // Static assets never need a host decision, and excluding them here keeps the
  // proxy off the hot path for every image and chunk. Page and API routes still
  // pass through; src/lib/hosts.ts is what guarantees /api/* is never redirected.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
