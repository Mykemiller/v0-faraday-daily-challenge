"use client";

// Help & Feedback (gear menu) → Glossary. Browsable list of the Faraday Lexicon
// — the same term bank the puzzles draw from — via /api/lexicon?list=1 (FAR-408).
// Client-side search filters the already-loaded list; no per-keystroke fetch.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import SiteFooter from "@/components/SiteFooter";

interface Term {
  term: string;
  definition: string;
  domain: string | null;
}

export default function GlossaryPage() {
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/lexicon?list=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setTerms(Array.isArray(d.terms) ? d.terms : []))
      .catch(() => setErr("Couldn't load the glossary — try again in a minute."));
  }, []);

  const filtered = useMemo(() => {
    if (!terms) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return terms;
    return terms.filter(
      (t) => t.term.toLowerCase().includes(needle) || t.definition.toLowerCase().includes(needle),
    );
  }, [terms, q]);

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav />
      <main className="mx-auto max-w-2xl px-5 pb-20 pt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-dark">Help</div>
        <h1 className="mt-3 font-serif text-4xl font-bold leading-tight text-forest">Glossary</h1>
        <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-near-black/80">
          The data-center-economy terms the puzzles draw from, defined. Straight from the Faraday
          Lexicon — the same term bank that powers the games.
        </p>

        <div className="sticky top-[68px] z-10 mt-6 bg-warm-white pb-2 pt-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search terms and definitions…"
            className="w-full rounded-lg border border-forest/20 bg-white px-4 py-2.5 font-mono text-[13px] text-near-black outline-none focus:border-gold"
          />
          {terms && (
            <p className="mt-1.5 font-mono text-[11px] text-near-black/45">
              {q.trim()
                ? `${filtered.length} of ${terms.length} terms`
                : `${terms.length} terms`}
            </p>
          )}
        </div>

        {err && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-700">
            {err}
          </div>
        )}

        {!terms && !err && (
          <div className="mt-4 animate-pulse space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-16 rounded-lg bg-warm-cream" />)}
          </div>
        )}

        {terms && filtered.length === 0 && !err && (
          <p className="mt-6 font-mono text-[13px] text-near-black/55">
            {terms.length === 0
              ? "The glossary is being built — check back soon."
              : `No terms match “${q.trim()}”.`}
          </p>
        )}

        <dl className="mt-4 space-y-2.5">
          {filtered.map((t) => (
            <div key={t.term} className="rounded-lg border border-forest/10 bg-white px-5 py-4">
              <dt className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-serif text-[17px] font-bold text-forest">{t.term}</span>
                {t.domain && (
                  <span className="rounded-full border border-forest/15 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-near-black/50">
                    {t.domain}
                  </span>
                )}
              </dt>
              <dd className="mt-1.5 text-[14px] leading-relaxed text-near-black/75">{t.definition}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-12 font-mono text-[11px] text-near-black/50">
          <Link href="/challenge" className="underline hover:text-forest">← Back to the Daily Challenge</Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
