import type { NextConfig } from "next";

// Engine-as-site: this app now serves the whole faraday-intelligence.ai surface
// at the domain root (no basePath) — storefront homepage at /, the Daily
// Challenge at /daily-challenge, the per-product storefront pages, and the ported
// brand APIs. The faradaydailychallenge.com retirement 301 lives in vercel.json
// (edge-level, so it can emit a real 301).
const nextConfig: NextConfig = {
  async redirects() {
    return [
      // /briefing-library was the old stub route; /library is canonical for FBL 1.0
      { source: "/briefing-library", destination: "/library", permanent: true },
      { source: "/briefing-library/:path*", destination: "/library/:path*", permanent: true },
    ];
  },
  async rewrites() {
    return [
      // Preserve the canonical Daily Challenge URL without a basePath: serve the
      // /challenge lobby in place at /daily-challenge (no client-visible bounce).
      { source: "/daily-challenge", destination: "/challenge" },
      { source: "/daily-challenge/:path*", destination: "/challenge/:path*" },
    ];
  },
};

export default nextConfig;
