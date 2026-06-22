"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { EDGE_FUNCTIONS_BASE, SESSION_STORAGE_KEY } from "@/lib/supabase";

// Leaderboard V2 — Global board (§3). Period-scoped ranking from the rewritten
// get-leaderboard edge function. Currency is "Signals" everywhere in the UI.
// Bands A (You) + B (Standings) ship here; group bar (Band C) and Today/Season
// context (Band D) land in later phases. No fabricated zero rows; no raw emails.

type Period = "daily" | "season";
type MovementValue = number | null;

interface Row {
  rank: number | null;
  handle: string;
  signals: number;
  playStreak: number;
  fullSetStreak: number;
  movement: MovementValue;
  isYou: boolean;
}
interface You {
  rank: number | null;
  percentile: number | null;
  signals: number;
  playStreak: number;
  fullSetStreak: number;
  movement: MovementValue;
  handle: string;
}
interface Board {
  scope: string;
  period: Period;
  seasonName?: string;
  dayLabel?: string;
  you: You | null;
  leaderboard: Row[];
  totalPlayers: number;
  count: number;
}

// One fixed grid shared by rows AND skeletons so streaming live data never
// shifts the layout (review #7). rank · handle(+streak) · signals · movement.
const GRID = "grid grid-cols-[2.75rem_1fr_5rem_3.25rem] items-center gap-2";
const NUM = { fontVariantNumeric: "tabular-nums" } as const;

function medal(rank: number | null): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return rank == null ? "—" : `#${rank}`;
}

function Movement({ value }: { value: MovementValue }) {
  if (value == null || value === 0) return <span className="text-near-black/30">—</span>;
  const up = value > 0;
  return (
    <span className={up ? "text-green-600" : "text-red-600"} style={NUM}>
      {up ? "▲" : "▼"}{Math.abs(value)}
    </span>
  );
}

function StreakPip({ days }: { days: number }) {
  if (!days) return null;
  return (
    <span className="ml-2 text-[11px] text-near-black/50 whitespace-nowrap" style={NUM}>
      🔥{days}
    </span>
  );
}

// "Top 12% · #340 of 2,910" — percentile is the spec's 0..100 (higher = better);
// the displayed "Top X%" is its complement, floored at 1%.
function percentileLabel(you: You, total: number): string {
  if (you.rank == null || you.percentile == null) return "Unranked — play to join";
  const top = Math.max(1, 100 - you.percentile);
  return `Top ${top}% · #${you.rank.toLocaleString()} of ${total.toLocaleString()}`;
}

function StandingsRow({ row }: { row: Row }) {
  return (
    <div
      className={`${GRID} px-3 py-2.5 rounded ${
        row.isYou ? "bg-gold/15 ring-1 ring-gold" : "odd:bg-warm-cream/50"
      }`}
    >
      <span className="text-sm font-semibold text-forest" style={NUM}>{medal(row.rank)}</span>
      <span className="min-w-0 flex items-center">
        <span className="truncate text-sm text-near-black">{row.handle}</span>
        {row.isYou && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-dark">you</span>}
        <StreakPip days={row.playStreak} />
      </span>
      <span className="text-right text-sm font-semibold text-near-black" style={NUM}>
        {row.signals.toLocaleString()}
      </span>
      <span className="text-right text-xs"><Movement value={row.movement} /></span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden className="animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className={`${GRID} px-3 py-2.5`}>
          <span className="h-4 w-6 rounded bg-warm-gray/50" />
          <span className="h-4 w-32 rounded bg-warm-gray/50" />
          <span className="h-4 w-10 justify-self-end rounded bg-warm-gray/50" />
          <span className="h-4 w-6 justify-self-end rounded bg-warm-gray/50" />
        </div>
      ))}
    </div>
  );
}

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>("daily");
  const [data, setData] = useState<Board | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async (p: Period) => {
    setStatus("loading");
    let token: string | null = null;
    try { token = localStorage.getItem(SESSION_STORAGE_KEY); } catch { /* storage disabled */ }
    const qs = new URLSearchParams({ scope: "global", period: p, limit: "50" });
    if (token) qs.set("token", token);
    try {
      const res = await fetch(`${EDGE_FUNCTIONS_BASE}/get-leaderboard?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Board;
      setData(json);
      setStatus("ready");
    } catch (e) {
      console.error("Leaderboard load failed:", e);
      setStatus("error");
    }
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  const you = data?.you ?? null;
  const youInList = !!data?.leaderboard.some((r) => r.isYou);

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <div className="h-0.5 bg-gold" />
      <header className="bg-forest">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-3">
          <Link href="/daily-challenge" className="flex items-center gap-3" aria-label="Daily Challenge">
            <BrandMark size={20} framed />
            <span className="font-serif text-[15px] font-bold tracking-wide text-warm-white">Faraday</span>
          </Link>
          <Link href="/daily-challenge" className="ml-auto font-mono text-[11px] text-warm-cream hover:text-gold-light">
            ← Daily Challenge
          </Link>
        </div>
      </header>
      <div className="h-0.5 bg-gold" />

      <main className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <h1 className="font-serif text-3xl font-bold text-forest">Leaderboard</h1>
        <p className="mb-5 mt-1 text-sm text-near-black/60">
          {period === "season" ? data?.seasonName ?? "Season" : "Today · resets midnight Central"}
        </p>

        {/* Period selector (Today · Season). Scope = Global; My Team/Company arrive in Phase 3. */}
        <div className="mb-6 inline-flex rounded-lg border border-warm-gray p-0.5" role="tablist">
          {(["daily", "season"] as Period[]).map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={period === p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
                period === p ? "bg-gold font-semibold text-forest" : "text-near-black/60 hover:text-near-black"
              }`}
            >
              {p === "daily" ? "Today" : "Season"}
            </button>
          ))}
        </div>

        {/* Band A — You */}
        <section className="mb-6">
          {status === "ready" && !you && (
            <div className="rounded-lg border border-gold/40 bg-gold/5 p-5 text-center">
              <p className="mb-3 text-near-black/80">Claim your spot on the leaderboard.</p>
              <Link
                href="/daily-challenge"
                className="inline-block rounded bg-gold px-5 py-2.5 font-semibold text-forest transition-colors hover:bg-gold-light"
              >
                Play &amp; join →
              </Link>
            </div>
          )}
          {status === "ready" && you && data && (
            <div className="rounded-lg border-2 border-gold bg-gold/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-forest">{you.handle}</span>
                    <Movement value={you.movement} />
                  </div>
                  <div className="mt-0.5 text-xs text-near-black/60" style={NUM}>
                    {percentileLabel(you, data.totalPlayers)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xl font-bold text-near-black" style={NUM}>
                    {you.signals.toLocaleString()}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-near-black/50">Signals</div>
                </div>
              </div>
            </div>
          )}
          {status === "loading" && <div className="h-[76px] animate-pulse rounded-lg bg-warm-gray/40" />}
        </section>

        {/* Band B — Standings */}
        <section>
          <div className={`${GRID} px-3 pb-2 text-[11px] uppercase tracking-wide text-near-black/40`}>
            <span>Rank</span><span>Player</span>
            <span className="text-right">Signals</span><span className="text-right">Move</span>
          </div>

          {status === "loading" && <SkeletonRows />}

          {status === "error" && (
            <div className="py-10 text-center">
              <p className="mb-3 text-near-black/70">Couldn’t load the leaderboard.</p>
              <button
                onClick={() => load(period)}
                className="rounded border border-warm-gray px-4 py-2 text-sm hover:bg-warm-cream"
              >
                Retry
              </button>
            </div>
          )}

          {status === "ready" && data && data.leaderboard.length === 0 && (
            <div className="py-10 text-center text-near-black/60">
              {period === "season" && !data.seasonName
                ? "No active season right now."
                : "Be the first to play today."}
            </div>
          )}

          {status === "ready" && data && data.leaderboard.length > 0 && (
            <div className="space-y-0.5">
              {data.leaderboard.map((r) => (
                <StandingsRow key={`${r.rank}-${r.handle}`} row={r} />
              ))}
              {/* Pin the You-row even when outside the top window (§3). */}
              {you && !youInList && (
                <>
                  <div className="select-none py-1 text-center text-near-black/30">···</div>
                  <StandingsRow
                    row={{
                      rank: you.rank, handle: you.handle, signals: you.signals,
                      playStreak: you.playStreak, fullSetStreak: you.fullSetStreak,
                      movement: you.movement, isYou: true,
                    }}
                  />
                </>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
