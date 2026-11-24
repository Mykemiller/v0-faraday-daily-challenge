import type { Metadata } from "next";
import { DC_CANONICAL_ORIGIN } from "@/lib/hosts";

// www.faradaydailychallenge.com serves this segment at the domain root (the
// host-conditioned rewrite in src/lib/hosts.ts maps / -> /challenge), so it
// carries the Daily Challenge tab title and the DC's canonical metadata base.
// The root layout keeps the storefront homepage title, per the engine-as-site
// canon.
export const metadata: Metadata = {
  // CC-DC-CANONICAL-DOMAIN-1.0: pinned, never derived from the Host header —
  // one deployment answers for three brands. Children set their own canonical.
  metadataBase: new URL(DC_CANONICAL_ORIGIN),
  title: "Faraday Daily Challenge",
};

// The Daily Challenge lobby (<DailyChallenge/>) renders its own full-screen
// header and navigation, so the challenge segment uses a pass-through layout.
export default function ChallengeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
