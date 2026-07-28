"use client";

// /challenge/signals — "Faraday's Take" · Today's Top Signals.
//
// A read-only funnel teaser for the paid Signal product, OPEN TO ALL players
// (including anonymous/logged-out) — no auth gate, no tier gate, no paywall,
// no email capture. The hero of each card is `faradays_take`; byline,
// conviction, framing, and plain-language domain chips are supporting.
//
// Data comes from /api/challenge/signals (service-role, tz-aware "today",
// High-then-Medium floor rule, cap 10). This page performs NO writes and shows
// NO raw domain codes, UUIDs, or backend identifiers — the route resolves and
// strips those server-side.
//
// A persistent "Back to the Challenge" affordance sits at BOTH the top and the
// bottom: this is a one-tap detour, and completed games re-hydrate on return.

import { useEffect, useState } from "react";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import { SESSION_STORAGE_KEY, HANDLE_STORAGE_KEY } from "@/lib/supabase";

interface PublicSignal {
  take: string;
  byline: string | null;
  conviction: "High" | "Medium";
  framing: string | null;
  domains: string[];
}

interface SignalsPayload {
  date: string;
  signals: PublicSignal[];
}

function BackToChallenge({ placement }: { placement: "top" | "bottom" }) {
  // Same-tab detour: /challenge is the canonical live game; completed games
  // and the day total re-hydrate from localStorage + server on return.
  return (
    <a
      href="/challenge"
      className={
        placement === "top"
          ? "inline-flex items-center gap-1.5 rounded-full bg-forest px-4 py-2 font-mono text-[12px] font-medium text-warm-white transition-colors hover:bg-forest-mid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          : "inline-flex items-center gap-1.5 rounded-full border border-forest/30 px-4 py-2 font-mono text-[12px] font-medium text-forest transition-colors hover:bg-forest hover:text-warm-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      }
    >
      <span aria-hidden="true">←</span> Back to the Challenge
    </a>
  );
}

function ConvictionBadge({ conviction }: { conviction: "High" | "Medium" }) {
  const high = conviction === "High";
  return (
    <span
      className={
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] " +
        (high
          ? "bg-gold/20 text-amber-dark"
          : "bg-sage/20 text-sage-dark")
      }
    >
      {conviction} conviction
    </span>
  );
}

function SignalCard({ signal }: { signal: PublicSignal }) {
  return (
    <article className="rounded-xl border border-forest/10 bg-white px-5 py-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        {signal.byline ? (
          <span className="font-mono text-[11px] uppercase tracking-wider text-near-black/50">
            Faraday&rsquo;s Take · {signal.byline}
          </span>
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-wider text-near-black/50">
            Faraday&rsquo;s Take
          </span>
        )}
        <ConvictionBadge conviction={signal.conviction} />
      </div>

      {/* Hero: the take is the primary content, not a footnote. */}
      <p className="text-[16px] leading-relaxed text-near-black">{signal.take}</p>

      {signal.framing && (
        <p className="mt-3 border-l-2 border-forest/15 pl-3 text-[13px] leading-relaxed text-near-black/60">
          {signal.framing}
        </p>
      )}

      {signal.domains.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {signal.domains.map((d) => (
            <span
              key={d}
              className="rounded-full border border-forest/20 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-forest/75"
            >
              {d}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

export default function SignalsPage() {
  const [data, setData] = useState<SignalsPayload | null>(null);
  const [err, setErr] = useState("");
  const [handle, setHandle] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    // Best-effort personalization only — the page renders fully for anonymous
    // visitors; nothing here gates content.
    try {
      setAuthed(!!localStorage.getItem(SESSION_STORAGE_KEY));
      setHandle(localStorage.getItem(HANDLE_STORAGE_KEY));
    } catch { /* storage disabled */ }

    fetch("/api/challenge/signals")
      .then((r) => r.json())
      .then((d: SignalsPayload) => setData(d))
      .catch(() => setErr("Couldn't load today's signals — try again in a minute."));
  }, []);

  const signals = data?.signals ?? [];
  const hasSignals = signals.length > 0;

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav authed={authed} handle={handle} />

      <main className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        {/* Top return affordance — always visible, above the fold. */}
        <div className="mb-6">
          <BackToChallenge placement="top" />
        </div>

        <div className="font-mono text-[10px] uppercase tracking-widest text-near-black/40">
          Faraday&rsquo;s Take · Today&rsquo;s Top Signals
        </div>
        <h1 className="mt-2 font-serif text-3xl font-bold text-forest">
          The AI infrastructure signals worth knowing today
        </h1>
        <p className="mt-3 max-w-[58ch] text-[15px] leading-relaxed text-near-black/75">
          Faraday reads the day&rsquo;s data-center, power, and AI-infrastructure
          intelligence and calls the signals that matter. A daily taste of the
          full Signal feed.
        </p>

        {/* Error → still show the return CTA, never a dead end. */}
        {err && (
          <div className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-700">
            {err}
          </div>
        )}

        {/* Loading skeleton */}
        {!data && !err && (
          <div className="mt-6 animate-pulse space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-warm-cream" />
            ))}
          </div>
        )}

        {/* Empty state — never a blank page or an endless spinner. */}
        {data && !hasSignals && !err && (
          <section className="mt-6 rounded-xl border border-forest/10 bg-white px-6 py-10 text-center">
            <div className="font-serif text-xl font-bold text-forest">
              No signals fired yet today
            </div>
            <p className="mx-auto mt-2 max-w-[46ch] text-[14px] leading-relaxed text-near-black/65">
              Faraday&rsquo;s desk is quiet for now — the day&rsquo;s top signals
              land each morning. Check back a little later.
            </p>
            <div className="mt-6 flex justify-center">
              <BackToChallenge placement="top" />
            </div>
          </section>
        )}

        {/* The card list */}
        {hasSignals && (
          <section className="mt-6 space-y-4" aria-label="Today's top signals">
            {signals.map((s, i) => (
              <SignalCard key={i} signal={s} />
            ))}
          </section>
        )}

        {/* Bottom return affordance — one tap from resuming the game. */}
        <div className="mt-10 border-t border-forest/10 pt-6">
          <BackToChallenge placement="bottom" />
        </div>
      </main>
    </div>
  );
}
