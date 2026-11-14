import { predictsManifest } from "@/lib/predicts-pwa";

// FDY-127 (CC-PREDICTS-PWA-1.0 D1) — the Predicts app's OWN manifest, at /predicts/manifest.webmanifest.
// Next's app/manifest.ts convention only works at the root, and that file stays the Daily Challenge
// manifest. src/app/predicts/layout.tsx points /predicts/* at this one. The path has a file
// extension, so src/lib/hosts.ts never redirects it across hosts.
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(JSON.stringify(predictsManifest()), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
