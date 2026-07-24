import type { Metadata } from "next";

// faradaydailychallenge.com 301s to /daily-challenge -> /challenge, so this
// segment carries the Daily Challenge tab title (the root layout keeps the
// storefront homepage title, per the engine-as-site canon).
export const metadata: Metadata = {
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
