// Host-conditioned routing for the player's own domain.
//
// On faraday-player.com the course player is the whole site: the catalog is the
// root and a course is a top-level path. Everywhere else (faraday-intelligence.ai,
// preview URLs) the app is unchanged and the player stays under /academy.
//
// The rewrite is also the guard. Rather than keeping a denylist of engine routes
// to block on this domain, EVERY path maps into the academy tree — so /league-office
// on the player domain resolves to a course named "league-office", which does not
// exist, and the reader gets the academy's own not-found. The staff console and the
// game are unreachable here by construction, and a new engine route cannot leak by
// being forgotten.
//
// Next 16 renamed the `middleware` convention to `proxy`.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PLAYER_HOST = /^(www\.)?faraday-player\.com$/i;

// Must reach the app untouched even on the player host.
const PASSTHROUGH: RegExp[] = [
  /^\/_next\//,            // build assets
  /^\/api\/academy\//,     // Go deeper panel + signed-in progress sync
  /^\/favicon\.ico$/,
  /^\/icon\.svg$/,
  /^\/apple-icon\.png$/,
  /^\/manifest\.webmanifest$/,
];

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0];
  if (!PLAYER_HOST.test(host)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (PASSTHROUGH.some((re) => re.test(pathname))) return NextResponse.next();

  // The player's domain never shows the /academy prefix. Anyone arriving on the
  // old shape (an old link, a crawler) is sent to the canonical one.
  if (pathname === "/academy" || pathname.startsWith("/academy/")) {
    const stripped = pathname === "/academy" ? "/" : pathname.slice("/academy".length);
    return NextResponse.redirect(new URL(`${stripped}${search}`, request.url), 308);
  }

  const target = pathname === "/" ? "/academy" : `/academy${pathname}`;
  return NextResponse.rewrite(new URL(`${target}${search}`, request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
