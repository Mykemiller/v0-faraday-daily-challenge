import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { dcManifestScope } from "@/lib/dc-manifest-scope";

// PWA / Android install manifest. Icons are the Faraday "F" roundel (forest
// green #1C3424 + gold #C4922A). Next serves this at /manifest.webmanifest and
// injects the <link rel="manifest"> automatically.
//
// FDY-127 D6 (Myke's call, revertible as one commit): an explicit, host-aware `scope` — "/" on the
// DC's own host, "/daily-challenge" elsewhere — so the game never captures /predicts, which has its
// own manifest (src/app/predicts/manifest.webmanifest). Reading the Host header makes this route
// render per request instead of being cached once.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const host = (await headers()).get("host");
  return {
    name: "Faraday Daily Challenge",
    short_name: "Faraday",
    description:
      "Faraday reads the AI data center market every day and tells you what it means.",
    start_url: "/daily-challenge",
    scope: dcManifestScope(host),
    display: "standalone",
    background_color: "#1C3424",
    theme_color: "#1C3424",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
  };
}
