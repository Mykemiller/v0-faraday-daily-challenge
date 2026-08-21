import type { Metadata } from "next";
import DailyChallenge from '@/components/DailyChallenge';
import { dayCardMeta } from "@/lib/share/og";
import { buildShareRegistry } from "@/lib/share/manifest";
import { loadLiveGames } from "@/lib/game-registry-server";

// CC-DC-SHARE-1.0 Phase 4 (D9): link unfurls render through the same
// /api/share/card renderer as shares. ?g=<slug> (or the legacy ?game=<type>)
// gets the per-game day card; the plain lobby gets the Daily Challenge card.
// Day-scoped only — dayCardMeta never emits score/band/grid, so an unfurl can
// never carry a personal result. Reading searchParams makes this route
// dynamic; the page is a thin client-component shell, so the per-request cost
// is the metadata resolution alone (puzzle data still loads client-side from
// the no-store /api/challenge/today).
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const share = buildShareRegistry(await loadLiveGames());
  const meta = dayCardMeta({ g: one(sp.g), game: one(sp.game), d: one(sp.d) }, share);
  return {
    title: meta.title,
    description: meta.description,
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: meta.pageUrl,
      siteName: "Faraday Daily Challenge",
      type: "website",
      images: [{ url: meta.imageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [meta.imageUrl],
    },
  };
}

// The lobby's game list comes from game_catalog (CC-DC-GAME-REGISTRY-1.0), read
// here on the server and handed to the client component. An eighth game appears
// by inserting a catalog row — no code change on this path.
export default async function ChallengePage() {
  const games = await loadLiveGames();
  return <DailyChallenge games={games} />;
}
