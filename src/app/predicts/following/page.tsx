import { Suspense } from "react";
import type { Metadata } from "next";
import { PREDICTS_API_URL, PREDICTS_VOTE_URL, predictsGet, type OpenResponse } from "@/lib/predicts-api";
import { preferencesUrlFrom } from "@/lib/predicts-preferences";
import { PWA_COPY } from "@/lib/predicts-pwa";
import FollowedForecasts from "./FollowedForecasts";

// /predicts/following — Followed forecasts (FDY-127 Phase 2d, CC-PREDICTS-PWA-1.0 §1 / D5).
// The public Open set (server-rendered, same 300s read as the board) filtered in the browser by the
// subscriber's FDY-119 preferences. No follow table, no new data surface. Not linked from the tab bar
// yet: whether it gets a tab is Myke's call (listed in the PR).

export const metadata: Metadata = {
  title: `${PWA_COPY.followingTitle} — Faraday Predicts`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function FollowingPage() {
  const open = await predictsGet<OpenResponse>("view=open&horizon=all");
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 md:py-8">
      <h1 className="font-display text-[clamp(26px,4.4vw,36px)] font-bold leading-tight text-near-black">{PWA_COPY.followingTitle}</h1>
      <p className="mt-1 font-serif text-[18px] italic text-forest">{PWA_COPY.followingIntro}</p>
      <div className="double-rule" aria-hidden />
      <Suspense fallback={<div aria-busy="true" className="mt-6 h-40 animate-pulse rounded-xl bg-warm-cream" />}>
        <FollowedForecasts
          rows={open?.predictions ?? []}
          failed={!open}
          prefsUrl={preferencesUrlFrom(PREDICTS_API_URL)}
          voteUrl={PREDICTS_VOTE_URL}
          votesEnabled={open?.capabilities?.votes ?? false}
        />
      </Suspense>
    </main>
  );
}
