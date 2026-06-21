"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { EDGE_FUNCTIONS_BASE, SESSION_STORAGE_KEY } from "@/lib/supabase";

// Leaderboard scaffold/preview. The full leaderboard is gated on the
// Resend-vs-Beehiiv email-provider decision (FAR-64 / FAR-71). This scaffold
// calls the deployed get-leaderboard edge function when reachable; otherwise it
// renders clearly-labeled mock rows. Either way it is framed as a Preview.

type Row = { rank: number; name: string; score: number };

const MOCK_ROWS: Row[] = [
  { rank: 1, name: "Sample Analyst", score: 420 },
  { rank: 2, name: "Sample Operator", score: 365 },
  { rank: 3, name: "Sample PM", score: 310 },
  { rank: 4, name: "Sample Planner", score: 280 },
  { rank: 5, name: "Sample Investor", score: 255 },
];

function normalize(data: unknown): Row[] | null {
  if (!data || typeof data !== "object") return null;
  const arr = (data as { leaderboard?: unknown }).leaderboard;
  if (!Array.isArray(arr)) return null;
  return arr.map((r: Record<string, unknown>, i) => ({
    rank: typeof r.rank === "number" ? r.rank : i + 1,
    name: String(r.name ?? r.display_name ?? r.email ?? "—"),
    score: Number(r.score ?? r.mw ?? r.mw_total ?? 0),
  }));
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState<Row[]>(MOCK_ROWS);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let token: string | null = null;
    try { token = localStorage.getItem(SESSION_STORAGE_KEY); } catch { /* storage disabled */ }
    const qs = new URLSearchParams({ limit: "10" });
    if (token) qs.set("token", token);
    fetch(`${EDGE_FUNCTIONS_BASE}/get-leaderboard?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const normalized = normalize(data);
        if (normalized && normalized.length) {
          setRows(normalized);
          setLive(true);
        }
      })
      .catch(() => { /* keep labeled mock rows */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-warm-white text-near-black font-sans">
      <div className="h-0.5 bg-gold" />
      <header className="bg-forest">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
          <Link href="/" className="flex items-center gap-3" aria-label="Faraday home">
            <BrandMark size={20} framed />
            <span className="font-serif text-[15px] font-bold tracking-wide text-warm-white">Faraday</span>
          </Link>
          <Link href="/" className="ml-auto font-mono text-[11px] text-warm-cream hover:text-gold-light">
            ← All storefronts
          </Link>
        </div>
      </header>
      <div className="h-0.5 bg-gold" />

      <main className="mx-auto max-w-3xl px-5 py-12">
        <div className="mb-8 flex flex-wrap items-center gap-3 rounded-md border border-gold/40 bg-warm-cream px-4 py-2.5">
          <span className="rounded bg-gold/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-dark">
            Preview
          </span>
          <span className="font-mono text-[10px] text-near-black/60">
            Scaffold — the full leaderboard ships with the email-provider decision (FAR-64).
            {live ? " Rows below are live." : " Rows below are sample data, not real players."}
          </span>
        </div>

        <h1 className="font-serif text-[clamp(28px,6vw,40px)] font-bold tracking-tight text-near-black">
          Your Leaderboard
        </h1>
        <p className="mt-3 font-serif text-[18px] italic text-near-black/70">See where you rank.</p>
        <div className="my-6 h-px bg-warm-gray/60" />

        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li
              key={r.rank}
              className="flex items-center gap-4 rounded-md border border-warm-gray bg-warm-white px-4 py-3"
            >
              <span className="w-8 font-mono text-[13px] text-amber-dark">#{r.rank}</span>
              <span className="flex-1 truncate font-sans text-[14px] font-semibold text-near-black">
                {r.name}
                {!live && (
                  <span className="ml-2 rounded bg-warm-cream px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-near-black/50">
                    Preview
                  </span>
                )}
              </span>
              <span className="w-20 text-right font-mono text-[13px] font-semibold text-forest">{r.score} MW</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
