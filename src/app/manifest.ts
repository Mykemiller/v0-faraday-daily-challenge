import type { MetadataRoute } from "next";

// PWA / Android install manifest. Icons are the Faraday "F" roundel (forest
// green #1C3424 + gold #C4922A). Next serves this at /manifest.webmanifest and
// injects the <link rel="manifest"> automatically.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Faraday Daily Challenge",
    short_name: "Faraday",
    description:
      "Faraday reads the AI data center market every day and tells you what it means.",
    start_url: "/daily-challenge",
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
