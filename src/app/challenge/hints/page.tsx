"use client";

// /challenge/hints — Hints Today (FAR-287).
// One section per live puzzle type (up to 7), each with the bank's Hint 1/2/3
// as a progressive three-tier reveal. Nothing is shown by default (spoiler
// guard) — every tier takes an explicit tap.
//
// The reveal budget IS the existing FAR-198 gate: HINT_MAX(3) per game per day,
// persisted in the same localStorage key the in-game HintControl spends
// (`faraday_hints_${TODAY}_${gameType}`). Revealing tier N here consumes the
// same budget as pressing "Hint?" in-game, and vice versa; the count is later
// reported to dc_completions.hints_used at completion via /api/score. No gate
// logic is duplicated or modified — this page just reads/spends the same key.
//
// Content comes from dc_daily_page_content via /api/challenge/day-content
// (Supabase only — never Airtable from the client).

import { useEffect, useState } from "react";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import SiteFooter from "@/components/SiteFooter";
import { SESSION_STORAGE_KEY, HANDLE_STORAGE_KEY } from "@/lib/supabase";

const HINT_MAX = 3; // the bank's hint tiers — mirrors DailyChallenge.jsx (FAR-198)

// CC-DC-HINTS-FROM-CONFIG-1.0 D3 — the season's hint rules, as
// /api/challenge/today serves them. The defaults are the pre-pack behaviour,
// so the page renders exactly as it always did until the fetch lands (and for
// any season with no effective config).
interface HintRules { hintsEnabled: boolean; maxHints: number }
const DEFAULT_RULES: HintRules = { hintsEnabled: true, maxHints: HINT_MAX };
// Same day key the in-game HintControl uses (UTC slice, NOT the CT serve day —
// matching exactly is what keeps the two budgets shared).
const TODAY = new Date().toISOString().slice(0, 10);

interface DayPuzzle {
  puzzle_type: string;
  public_id: string | null;
  puzzle_name: string | null;
  topic: string | null;
  hints: string[];
  domain_code: string | null;
  academy: { course_code: string; title: string; url: string; is_free: boolean } | null;
}

interface DayContent {
  available: boolean;
  puzzle_date: string;
  about_content?: { headline?: string };
  puzzles?: DayPuzzle[];
}

function budgetKey(gameType: string) {
  return `faraday_hints_${TODAY}_${gameType}`;
}

function readUsed(gameType: string): number {
  try {
    const v = parseInt(localStorage.getItem(budgetKey(gameType)) || "0", 10);
    return Number.isNaN(v) ? 0 : Math.max(0, Math.min(HINT_MAX, v));
  } catch {
    return 0;
  }
}

function GameHints({ puzzle, budget }: { puzzle: DayPuzzle; budget: number }) {
  // used = tiers revealed today for this game (in-game presses + here).
  const [used, setUsed] = useState(0);
  useEffect(() => { setUsed(readUsed(puzzle.puzzle_type)); }, [puzzle.puzzle_type]);

  // The bank still stores three tiers; how many of them this SEASON lets a
  // player spend is `budget` (already min'd against HINT_MAX by the server,
  // and again by the caller). Slicing to the budget rather than to HINT_MAX is
  // what makes a season of 1 show one locked tier instead of three.
  const tiers = puzzle.hints.slice(0, budget);
  const remaining = Math.max(0, budget - used);

  function revealNext() {
    if (used >= budget || used >= tiers.length) return;
    const next = used + 1;
    setUsed(next);
    try { localStorage.setItem(budgetKey(puzzle.puzzle_type), String(next)); } catch { /* ignore */ }
  }

  const allRevealed = used >= tiers.length;

  return (
    <section className="mt-4 rounded-lg border border-forest/10 bg-white px-5 py-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-near-black/40">
            {puzzle.puzzle_type}
          </div>
          <h2 className="font-serif text-lg font-bold text-forest">
            {puzzle.puzzle_name || puzzle.puzzle_type}
          </h2>
          {puzzle.topic && (
            <p className="mt-0.5 font-mono text-[11px] text-near-black/50">{puzzle.topic}</p>
          )}
        </div>
        <span className="font-mono text-[11px] text-near-black/40">
          {remaining} hint{remaining === 1 ? "" : "s"} left today
        </span>
      </div>

      {tiers.length === 0 ? (
        <p className="font-mono text-[12px] text-near-black/50">
          {budget === 0
            ? "This season gives no hints — trust your instincts."
            : "No hints in the bank for this one — trust your instincts."}
        </p>
      ) : (
        <div className="space-y-2">
          {tiers.map((hint, i) => {
            const tier = i + 1;
            const revealed = used >= tier;
            const isNext = used === i;
            return revealed ? (
              <div
                key={tier}
                className="rounded-md border border-gold/30 bg-gold/10 px-4 py-3 text-[13px] leading-relaxed text-near-black/80"
              >
                <span className="font-mono text-[11px] text-near-black/50">Hint {tier}: </span>
                {hint}
              </div>
            ) : (
              <button
                key={tier}
                type="button"
                disabled={!isNext || remaining === 0}
                onClick={revealNext}
                className={`block w-full rounded-md border px-4 py-3 text-left font-mono text-[12px] transition-colors ${
                  isNext && remaining > 0
                    ? "cursor-pointer border-forest/25 text-forest hover:border-forest hover:bg-forest/5"
                    : "cursor-not-allowed border-forest/10 text-near-black/35"
                }`}
              >
                {remaining === 0
                  ? `Hint ${tier} — no hints left today`
                  : isNext
                    ? `Tap to reveal Hint ${tier}`
                    : `Hint ${tier} — reveal Hint ${i} first`}
              </button>
            );
          })}
        </div>
      )}

      {/* Tier-3 footer: soft Academy nudge (FAR-21 reversal) — skipped
          gracefully when no Domain/course mapping exists yet (pre-FAR-178). */}
      {allRevealed && tiers.length === budget && budget > 0 && puzzle.academy && (
        <p className="mt-3 border-t border-forest/10 pt-3 font-mono text-[11px] text-near-black/60">
          Still stuck? This one leans on {puzzle.topic || "a domain"} fundamentals —{" "}
          <a href={puzzle.academy.url} className="text-forest underline hover:text-gold">
            {puzzle.academy.title}
          </a>{" "}
          at Faraday Academy covers it{puzzle.academy.is_free ? " (free)" : ""}.
        </p>
      )}
    </section>
  );
}

export default function HintsTodayPage() {
  const [data, setData] = useState<DayContent | null>(null);
  const [err, setErr] = useState("");
  const [handle, setHandle] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  // CC-DC-HINTS-FROM-CONFIG-1.0 D3. Token-scoped like the lobby's own fetch,
  // because the hint rules belong to the CALLER's season.
  const [rules, setRules] = useState<HintRules>(DEFAULT_RULES);

  useEffect(() => {
    let token = "";
    try {
      token = localStorage.getItem(SESSION_STORAGE_KEY) || "";
      setAuthed(!!token);
      setHandle(localStorage.getItem(HANDLE_STORAGE_KEY));
    } catch { /* storage disabled */ }
    fetch("/api/challenge/day-content")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setErr("Could not load today's hints — try again in a minute."));
    // Fail-soft: a failed or older payload leaves DEFAULT_RULES in place, so
    // the page never hides hints because a second request went wrong.
    fetch(token ? `/api/challenge/today?token=${encodeURIComponent(token)}` : "/api/challenge/today")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const r = d?.rules;
        if (r && typeof r.maxHints === "number")
          setRules({ hintsEnabled: r.hintsEnabled !== false, maxHints: r.maxHints });
      })
      .catch(() => { /* keep the defaults */ });
  }, []);

  const puzzles = data?.available ? data.puzzles ?? [] : [];
  const budget = Math.max(0, Math.min(HINT_MAX, rules.maxHints));

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav authed={authed} handle={handle} />
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <h1 className="font-serif text-3xl font-bold text-forest">Hints Today</h1>
        <p className="mt-1 text-sm text-near-black/60">
          Revealed one tap at a time — the same {budget}-hint daily budget as the
          “Hint?” button in-game. Hints are free and never affect your score.
        </p>

        {/* D3: the season has hints switched off — no entries, one line saying
            so, so the absence reads as a rule rather than as a broken page. */}
        {!rules.hintsEnabled && (
          <div className="mt-4 rounded-lg border border-forest/10 bg-white px-5 py-5 font-mono text-[12px] text-near-black/60">
            Hints are off this season.
          </div>
        )}

        {err && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-700">
            {err}
          </div>
        )}

        {rules.hintsEnabled && !data && !err && (
          <div className="mt-4 animate-pulse space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-lg bg-warm-cream" />)}
          </div>
        )}

        {rules.hintsEnabled && data && puzzles.length === 0 && !err && (
          <div className="mt-4 rounded-lg border border-forest/10 bg-white px-5 py-5 font-mono text-[12px] text-near-black/60">
            Today&rsquo;s hint set isn&rsquo;t ready yet — check back shortly after midnight Central.
          </div>
        )}

        {rules.hintsEnabled &&
          puzzles.map((p) => <GameHints key={p.puzzle_type} puzzle={p} budget={budget} />)}

        <p className="mt-10 font-mono text-[11px] text-near-black/50">
          <a href="/challenge" className="underline hover:text-forest">← Back to the Daily Challenge</a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
