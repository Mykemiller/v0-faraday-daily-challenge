// CC-DC-CANONICAL-DOMAIN-1.0 — edge-runtime wiring for the host map.
//
// Next 16 renamed the `middleware` convention to `proxy`. This file is only the
// wiring: the decision itself lives in src/lib/hosts.ts as a pure function, so
// it can be unit-tested (src/lib/hosts.test.ts) instead of discovered in
// production.
//
// ⚠️ CC-ACADEMY-PLAYER composes HERE. The academy branch owns routing on
// faraday-player.com via src/lib/academy/player-host.ts. When it rebases onto
// main, its player-host rules slot in at the marked point below — AFTER
// resolveHostRoute, so a DC page path on the player domain 308s to the DC domain
// and everything else keeps the Academy's behaviour byte-for-byte. Do not add a
// second host router; extend resolveHostRoute or chain it here.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveHostRoute } from "@/lib/hosts";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const route = resolveHostRoute(request.headers.get("host"), pathname, search);

  switch (route.kind) {
    case "redirect":
      // `route.to` is already absolute (it names the canonical origin), and the
      // query string is baked in by dcCanonicalUrl.
      return NextResponse.redirect(route.to, route.status);
    case "rewrite":
      return NextResponse.rewrite(new URL(`${route.to}${search}`, request.url));
    case "next":
      return NextResponse.next();
  }
}

export const config = {
  // Static assets never need a host decision, and excluding them here keeps the
  // proxy off the hot path for every image and chunk. Page and API routes still
  // pass through; src/lib/hosts.ts is what guarantees /api/* is never redirected.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
