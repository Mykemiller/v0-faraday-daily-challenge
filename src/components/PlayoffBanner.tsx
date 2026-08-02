"use client";

// Daily Challenge — playoff status banner.
//
// Mounts in the player app shell beside BroadcastBanner. Shows one of three
// states, and NOTHING at all when the season runs no playoffs — which is every
// season today except Hot Summer, so this ships invisible for them.
//
//   roster freeze approaching → "Rosters freeze in N days"
//   playoffs approaching      → "Playoffs start in N days"
//   playoffs live             → "Playoffs are live"
//
// Read-only and public: no token required, nothing dismissible, no writes. All
// state is SERVER-derived in the season's own timezone (/api/playoffs) — the
// countdown is never recomputed here, or two timezones would disagree about the
// boundary day.
//
// Palette-agnostic per the FAR-395 convention: color arrives via `tokens` (the
// `C` object in DailyChallenge.jsx), layout is local.

import { useEffect, useState } from "react";

import { bannerLine, type PlayoffBannerState as PlayoffState } from "@/lib/league-playoffs/banner";

export type PlayoffBannerTokens = {
  forest: string;
  gold: string;
  white: string;
  sage: string;
  muted: string;
};

const FALLBACK: PlayoffBannerTokens = {
  forest: "#1C3424",
  gold: "#C4922A",
  white: "#F8F5F0",
  sage: "#8CA68A",
  muted: "#9A938C",
};

export default function PlayoffBanner({
  tokens,
  state: provided,
}: {
  tokens?: Partial<PlayoffBannerTokens>;
  /** Pass the already-fetched state to avoid a second request when the host
   *  page needs it too (DailyChallenge uses it for the ScoreCard relabel).
   *  Omit it and the banner fetches for itself. */
  state?: PlayoffState | null;
}) {
  const C = { ...FALLBACK, ...(tokens ?? {}) };
  const [fetched, setFetched] = useState<PlayoffState | null>(null);
  const selfFetch = provided === undefined;

  useEffect(() => {
    if (!selfFetch) return;
    let alive = true;
    fetch("/api/playoffs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j && j.playoff_starts_on !== undefined) setFetched(j as PlayoffState); })
      .catch(() => { /* the banner is decorative — never surface a fetch error */ });
    return () => { alive = false; };
  }, [selfFetch]);

  const state = selfFetch ? fetched : provided;
  if (!state) return null;
  // No playoffs configured for this season → render nothing at all.
  if (!state.playoff_starts_on) return null;
  // Season over → the bracket lives on /leaderboard; no banner.
  if (state.phase === "post") return null;

  const line = bannerLine(state);
  if (!line) return null;

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "10px 16px",
        margin: "0 0 12px",
        borderRadius: 8,
        border: `1px solid ${C.gold}55`,
        background: `${C.gold}14`,
      }}
    >
      <span aria-hidden style={{ fontSize: 14, color: C.gold, lineHeight: 1 }}>◆</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.white }}>{line.headline}</span>
      {line.detail && (
        <span style={{ fontSize: 12, color: C.muted }}>{line.detail}</span>
      )}
      <a
        href="/leaderboard?view=playoffs"
        style={{
          marginLeft: "auto",
          fontSize: 11.5,
          fontWeight: 600,
          color: C.gold,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        {line.cta} →
      </a>
    </div>
  );
}
