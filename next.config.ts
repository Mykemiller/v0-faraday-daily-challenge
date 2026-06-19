import type { NextConfig } from "next";

// Canonical Daily Challenge engine. Mounted under /daily-challenge so the whole
// app (pages, API routes, _next assets) lives under that path and can be proxied
// cleanly from faraday-intelligence.ai/daily-challenge. The host-conditioned 301
// that retires faradaydailychallenge.com lives in vercel.json (edge-level, so it
// can emit a real 301 — next.config redirects only emit 307/308).
const nextConfig: NextConfig = {
  basePath: "/daily-challenge",
  async redirects() {
    return [
      // Standalone correctness: land the bare engine path on the lobby.
      // basePath-aware: /daily-challenge -> /daily-challenge/challenge.
      { source: "/", destination: "/challenge", permanent: false },
    ];
  },
};

export default nextConfig;
