import type { Metadata } from "next";
import { DC_CANONICAL_ORIGIN } from "@/lib/hosts";

// CC-DC-CANONICAL-DOMAIN-1.0: a join URL carries a single-use invite token, so
// it must not be indexed and must not advertise a canonical — the token is the
// whole payload. noindex here also stops the parent /leaderboard layout's
// canonical from being inherited onto a tokenised path.
export const metadata: Metadata = {
  metadataBase: new URL(DC_CANONICAL_ORIGIN),
  title: "Join a team · Faraday Daily Challenge",
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
