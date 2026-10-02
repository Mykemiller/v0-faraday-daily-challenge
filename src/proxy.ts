// Host-conditioned routing for the player's own domain.
//
// On faraday-player.com the course player is the whole site: the catalog is the
// root and a course is a top-level path. Everywhere else (faraday-intelligence.ai,
// preview URLs) the app is unchanged and the player stays under /academy.
//
// The decision lives in src/lib/academy/player-host.ts so it can be unit-tested;
// this file is only the edge-runtime wiring. Next 16 renamed the `middleware`
// convention to `proxy`.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isPlayerHost, routeForPlayerHost } from "@/lib/academy/player-host";

export function proxy(request: NextRequest) {
  if (!isPlayerHost(request.headers.get("host"))) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const route = routeForPlayerHost(pathname);

  switch (route.kind) {
    case "pass":
      return NextResponse.next();
    case "redirect":
      return NextResponse.redirect(new URL(`${route.to}${search}`, request.url), 308);
    case "rewrite":
      return NextResponse.rewrite(new URL(`${route.to}${search}`, request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
