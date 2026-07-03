"use client";

// /challenge/about — About Today's Challenge (FAR-287).
// Day-level theme/domain framing from dc_daily_page_content.about_content —
// the same for every visitor (no personalization, no live stats; a future
// share/social surface). Domain-grounded once FAR-178 populates the bank's
// Domain field; until then it frames the day from each puzzle's topic line
// (domain_code null-tolerant by design).

import { useEffect, useState } from "react";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import { SESSION_STORAGE_KEY, HANDLE_STORAGE_KEY } from "@/lib/supabase";

interface AboutContent {
  date?: string;
  headline?: string;
  intro?: string;
  domain_code?: string | null;
  domain_name?: string | null;
  topics?: string[];
  games?: Array<{ puzzle_type: string; name: string | null; topic: string | null }>;
}

interface DayContent {
  available: boolean;
  puzzle_date: string;
  domain_code?: string | null;
  about_content?: AboutContent;
}

export default function AboutTodayPage() {
  const [data, setData] = useState<DayContent | null>(null);
  const [err, setErr] = useState("");
  const [handle, setHandle] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    try {
      setAuthed(!!localStorage.getItem(SESSION_STORAGE_KEY));
      setHandle(localStorage.getItem(HANDLE_STORAGE_KEY));
    } catch { /* storage disabled */ }
    fetch("/api/challenge/day-content")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setErr("Could not load today's challenge notes — try again in a minute."));
  }, []);

  const about = data?.available ? data.about_content ?? {} : null;
  const games = about?.games ?? [];

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav authed={authed} handle={handle} />
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <div className="font-mono text-[10px] uppercase tracking-widest text-near-black/40">
          About Today&rsquo;s Challenge{data?.puzzle_date ? ` · ${data.puzzle_date}` : ""}
        </div>
        <h1 className="mt-2 font-serif text-3xl font-bold text-forest">
          {about?.headline || "Today's Daily Challenge"}
        </h1>

        {err && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-700">
            {err}
          </div>
        )}

        {!data && !err && (
          <div className="mt-4 animate-pulse space-y-3">
            {[1, 2].map((i) => <div key={i} className="h-24 rounded-lg bg-warm-cream" />)}
          </div>
        )}

        {data && !about && !err && (
          <div className="mt-4 rounded-lg border border-forest/10 bg-white px-5 py-5 font-mono text-[12px] text-near-black/60">
            Today&rsquo;s notes aren&rsquo;t ready yet — check back shortly after midnight Central.
          </div>
        )}

        {about && (
          <>
            {about.intro && (
              <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-near-black/75">
                {about.intro}
              </p>
            )}

            {about.domain_name && (
              <p className="mt-3 font-mono text-[11px] text-near-black/50">
                IDF Domain{about.domain_code ? ` ${about.domain_code}` : ""} · {about.domain_name}
              </p>
            )}

            {!!(about.topics && about.topics.length) && (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {about.topics.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-forest/20 px-3 py-1 font-mono text-[11px] text-forest/80"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {games.length > 0 && (
              <section className="mt-6 rounded-lg border border-forest/10 bg-white px-5 py-5">
                <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-near-black/40">
                  In today&rsquo;s set
                </div>
                <div className="divide-y divide-forest/8">
                  {games.map((g) => (
                    <div key={g.puzzle_type} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                      <span className="font-mono text-[11px] uppercase tracking-wider text-near-black/50">
                        {g.puzzle_type}
                      </span>
                      <span className="min-w-0 flex-1 text-right text-[13px] text-near-black/75">
                        {g.name || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <p className="mt-6 font-mono text-[12px] text-near-black/60">
              <a href="/challenge" className="text-forest underline hover:text-gold">Play today&rsquo;s set →</a>
            </p>
          </>
        )}

        <p className="mt-10 font-mono text-[11px] text-near-black/50">
          <a href="/challenge" className="underline hover:text-forest">← Back to the Daily Challenge</a>
        </p>
      </main>
    </div>
  );
}
