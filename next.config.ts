import type { NextConfig } from "next";

// Engine-as-site: this app serves the whole faraday-intelligence.ai surface at
// the domain root (no basePath) — storefront homepage at /, the per-product
// storefront pages, and the ported brand APIs.
//
// ⚠️ CC-DC-CANONICAL-DOMAIN-1.0: the Daily Challenge is NOT part of that surface
// any more. DC pages are canonical on www.faradaydailychallenge.com and 308 off
// every other host. The host decision lives in src/lib/hosts.ts (executed by
// src/proxy.ts) — not here and not in vercel.json. The earlier comment here
// described a "faradaydailychallenge.com retirement 301", which PR #112 reversed
// and which no longer exists in vercel.json.
//
// The host-conditioned root rewrite below is retained deliberately: it is the
// mechanism that has served the lobby at the DC domain root since PR #112, and
// it agrees with resolveHostRoute by construction. Keeping both is defence in
// depth on the one path whose breakage would take the game offline.
const nextConfig: NextConfig = {
  async redirects() {
    return [
      // /briefing-library was the old stub route; /library is canonical for FBL 1.0
      { source: "/briefing-library", destination: "/library", permanent: true },
      { source: "/briefing-library/:path*", destination: "/library/:path*", permanent: true },
    ];
  },
  async rewrites() { return { beforeFiles: [ { source: "/", has: [{ type: "host", value: "(www\\.)?faradaydailychallenge\\.com" }], destination: "/challenge" } ], afterFiles: [ { source: "/daily-challenge", destination: "/challenge" }, { source: "/daily-challenge/:path*", destination: "/challenge/:path*" } ] }; },
};

export default nextConfig;
