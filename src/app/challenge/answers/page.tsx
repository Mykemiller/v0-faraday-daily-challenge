"use client";

// /challenge/answers — Answers Today (FAR-287).
// Per-puzzle answer + explanation, released by the SERVER gate in
// /api/challenge/answers: a puzzle unlocks only when this subscriber completed
// it today, or the day has rolled over (partial unlock is normal). This page
// never receives a locked answer, so there is nothing to "hide" client-side.
//
// The stats block (completion rate · avg hints) is computed fresh on every
// request from dc_completions / dc_daily_attempts — never cached content.
// Missed puzzles (attempted, lost) get an Academy course recommendation when a
// Domain→course mapping exists (FAR-21 reversal; graceful no-op pre-FAR-178).

import { useEffect, useState } from "react";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import { SESSION_STORAGE_KEY, HANDLE_STORAGE_KEY } from "@/lib/supabase";

interface AnswerGroups { kind: "groups"; groups: Array<{ label: string; items: string[] }> }
interface AnswerWord { kind: "word"; word: string; clue: string | null }
interface AnswerRanking { kind: "ranking"; metric: string | null; ranked: Array<{ rank: number; item: string; value: string | null }> }
interface AnswerPairs { kind: "pairs"; pairs: Array<{ term: string; def: string }> }
interface AnswerQuestions { kind: "questions"; questions: Array<{ q: string; answer: string; explanation: string | null }> }
type PuzzleAnswer = AnswerGroups | AnswerWord | AnswerRanking | AnswerPairs | AnswerQuestions;

interface AnswerPuzzle {
  puzzle_type: string;
  public_id: string | null;
  puzzle_name: string | null;
  topic: string | null;
  domain_code: string | null;
  unlocked: boolean;
  answer?: PuzzleAnswer | null;
  answer_explanation?: string | null;
  stats: {
    completions: number;
    attempts: number;
    completion_rate: number | null;
    avg_hints_used: number | null;
  };
  missed: boolean;
  academy: { course_code: string; title: string; url: string; is_free: boolean } | null;
}

interface AnswersData {
  available: boolean;
  puzzle_date: string;
  rolled_over: boolean;
  signed_in: boolean;
  puzzles?: AnswerPuzzle[];
  completed_count?: number;
  play_streak?: number | null;
  error?: string;
}

function AnswerBody({ answer }: { answer: PuzzleAnswer }) {
  if (answer.kind === "word") {
    return (
      <p className="text-[15px] text-near-black/85">
        <span className="font-mono font-bold tracking-[0.2em] text-forest">{answer.word}</span>
        {answer.clue && <span className="mt-1 block text-[13px] text-near-black/60">{answer.clue}</span>}
      </p>
    );
  }
  if (answer.kind === "groups") {
    return (
      <div className="space-y-2">
        {answer.groups.map((g) => (
          <div key={g.label} className="rounded-md border border-forest/10 bg-warm-cream/50 px-3 py-2">
            <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-forest">{g.label}</div>
            <div className="mt-0.5 text-[13px] text-near-black/75">{g.items.join(" · ")}</div>
          </div>
        ))}
      </div>
    );
  }
  if (answer.kind === "ranking") {
    return (
      <div>
        {answer.metric && (
          <p className="mb-1.5 font-mono text-[11px] text-near-black/50">Ranked by {answer.metric}</p>
        )}
        <ol className="space-y-1">
          {answer.ranked.map((r) => (
            <li key={r.rank} className="flex items-baseline gap-2 text-[13px] text-near-black/80">
              <span className="font-mono text-[11px] text-near-black/40">#{r.rank}</span>
              <span className="flex-1">{r.item}</span>
              {r.value && <span className="font-mono text-[11px] text-near-black/50">{r.value}</span>}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (answer.kind === "pairs") {
    return (
      <dl className="space-y-1.5">
        {answer.pairs.map((p) => (
          <div key={p.term} className="text-[13px]">
            <dt className="inline font-mono font-bold text-forest">{p.term}</dt>
            <dd className="inline text-near-black/70"> — {p.def}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <div className="space-y-3">
      {answer.questions.map((q, i) => (
        <div key={i} className="text-[13px]">
          <p className="text-near-black/70">{q.q}</p>
          <p className="mt-0.5 font-semibold text-forest">✓ {q.answer}</p>
          {q.explanation && <p className="mt-0.5 text-[12px] text-near-black/55">{q.explanation}</p>}
        </div>
      ))}
    </div>
  );
}

function StatsRow({ stats }: { stats: AnswerPuzzle["stats"] }) {
  return (
    <p className="mt-3 border-t border-forest/10 pt-2.5 font-mono text-[11px] text-near-black/50">
      {stats.completion_rate !== null
        ? `${stats.completion_rate}% of players completed this today`
        : "No plays recorded yet today"}
      {stats.avg_hints_used !== null ? ` · avg ${stats.avg_hints_used} hints used` : ""}
    </p>
  );
}

export default function AnswersTodayPage() {
  const [data, setData] = useState<AnswersData | null>(null);
  const [err, setErr] = useState("");
  const [handle, setHandle] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let t: string | null = null;
    try {
      t = localStorage.getItem(SESSION_STORAGE_KEY);
      setHandle(localStorage.getItem(HANDLE_STORAGE_KEY));
    } catch { /* storage disabled */ }
    setToken(t);
    setReady(true);
    fetch(`/api/challenge/answers${t ? `?token=${encodeURIComponent(t)}` : ""}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setErr("Could not load today's answers — try again in a minute."));
  }, []);

  const puzzles = data?.available ? data.puzzles ?? [] : [];
  const unlockedCount = puzzles.filter((p) => p.unlocked).length;

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav authed={!!token} handle={handle} />
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <h1 className="font-serif text-3xl font-bold text-forest">Answers Today</h1>
        <p className="mt-1 text-sm text-near-black/60">
          Each answer unlocks when you finish that puzzle — or when the day rolls over at
          midnight Central. No spoilers before you&rsquo;ve played.
        </p>

        {err && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-700">
            {err}
          </div>
        )}
        {data?.error && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-700">
            {data.error}
          </div>
        )}

        {(!ready || (!data && !err)) && (
          <div className="mt-4 animate-pulse space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-lg bg-warm-cream" />)}
          </div>
        )}

        {ready && !token && data && !data.rolled_over && (
          <div className="mt-4 rounded-lg border border-forest/10 bg-white px-5 py-5">
            <p className="text-[14px] text-near-black/75">
              Sign in to unlock the answers for puzzles you&rsquo;ve completed today.
            </p>
            <p className="mt-2 font-mono text-[12px]">
              <a href="/account" className="text-forest underline hover:text-gold">Sign in →</a>
            </p>
          </div>
        )}

        {data && data.available === false && !err && (
          <div className="mt-4 rounded-lg border border-forest/10 bg-white px-5 py-5 font-mono text-[12px] text-near-black/60">
            Today&rsquo;s answer set isn&rsquo;t ready yet — check back shortly after midnight Central.
          </div>
        )}

        {puzzles.length > 0 && (
          <p className="mt-4 font-mono text-[11px] text-near-black/50">
            {data?.rolled_over
              ? "This day is over — every answer is open."
              : `${unlockedCount} of ${puzzles.length} unlocked`}
          </p>
        )}

        {puzzles.map((p) => (
          <section key={p.puzzle_type} className="mt-4 rounded-lg border border-forest/10 bg-white px-5 py-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-near-black/40">
                  {p.puzzle_type}{p.public_id ? ` · ${p.public_id}` : ""}
                </div>
                <h2 className="font-serif text-lg font-bold text-forest">
                  {p.puzzle_name || p.puzzle_type}
                </h2>
              </div>
              {!p.unlocked && (
                <span className="rounded-full border border-forest/20 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-near-black/50">
                  🔒 Locked
                </span>
              )}
            </div>

            {p.unlocked ? (
              <div className="mt-3">
                {p.answer ? (
                  <AnswerBody answer={p.answer} />
                ) : (
                  <p className="font-mono text-[12px] text-near-black/50">
                    Answer detail isn&rsquo;t in the bank for this one yet.
                  </p>
                )}
                {p.answer_explanation && (
                  <div className="mt-3 rounded-md border border-gold/25 bg-gold/8 px-4 py-3">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-near-black/45">Why</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-near-black/75">{p.answer_explanation}</p>
                  </div>
                )}
                {p.missed && p.academy && (
                  <p className="mt-3 font-mono text-[11px] text-near-black/60">
                    Missed this one? <a href={p.academy.url} className="text-forest underline hover:text-gold">{p.academy.title}</a>{" "}
                    at Faraday Academy covers this ground{p.academy.is_free ? " (free)" : ""}.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-near-black/55">
                Complete this puzzle to see the answer — or come back after midnight Central.
              </p>
            )}

            <StatsRow stats={p.stats} />
          </section>
        ))}

        {typeof data?.play_streak === "number" && data.play_streak > 0 && (
          <p className="mt-6 rounded-lg border border-forest/10 bg-warm-cream/60 px-4 py-3 font-mono text-[12px] text-forest">
            🔥 You&rsquo;re on a {data.play_streak}-day streak — tomorrow&rsquo;s set drops at midnight Central.
          </p>
        )}

        <p className="mt-10 font-mono text-[11px] text-near-black/50">
          <a href="/challenge" className="underline hover:text-forest">← Back to the Daily Challenge</a>
        </p>
      </main>
    </div>
  );
}
