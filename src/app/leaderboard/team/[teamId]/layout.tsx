import type { Metadata } from "next";
import { dcPageMetadata } from "@/lib/dc-metadata";

// CC-DC-CANONICAL-DOMAIN-1.0: a team page is a deliberately shareable URL
// (src/lib/share/buildShare.js emits it), so its canonical must name the team —
// not inherit /leaderboard from the parent segment's layout.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ teamId: string }>;
}): Promise<Metadata> {
  const { teamId } = await params;
  return dcPageMetadata(`/leaderboard/team/${teamId}`, {
    title: "Team · Faraday Daily Challenge",
  });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
