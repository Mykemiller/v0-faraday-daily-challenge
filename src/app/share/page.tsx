"use client";

// More Faraday → Share / Invite (FAR-408). One hub for every share action,
// assembling pieces that already exist: invite a colleague (Web Share / copy),
// share your rank (lives on /leaderboard), and team invites (managed on
// /account, team pages are shareable URLs). No new backend.

import { useState } from "react";
import Link from "next/link";
import SiteHeaderNav from "@/components/SiteHeaderNav";

const SITE = "https://www.faradaydailychallenge.com";
const INVITE_URL = `${SITE}/challenge`;
const INVITE_TEXT =
  "Play the Faraday Daily Challenge — seven quick games a day on the AI data center economy.";

function ShareCard({
  title,
  blurb,
  shareText,
  shareUrl,
  buttonLabel,
}: {
  title: string;
  blurb: string;
  shareText: string;
  shareUrl: string;
  buttonLabel: string;
}) {
  const [msg, setMsg] = useState("");

  async function doShare() {
    setMsg("");
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ text: shareText, url: shareUrl });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await nav?.clipboard?.writeText(`${shareText} ${shareUrl}`);
      setMsg("Link copied ✓");
      setTimeout(() => setMsg(""), 2500);
    } catch {
      setMsg("Copy failed — the link is below.");
    }
  }

  return (
    <section className="rounded-lg border border-forest/10 bg-white px-5 py-5">
      <h2 className="font-serif text-lg font-bold text-forest">{title}</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-near-black/70">{blurb}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={doShare}
          className="rounded-lg border border-gold/50 bg-gold/10 px-4 py-2 font-mono text-[12px] text-forest transition-colors hover:bg-gold/20"
        >
          {buttonLabel}
        </button>
        {msg && <span className="font-mono text-[11px] text-forest">{msg}</span>}
      </div>
      <p className="mt-3 break-all font-mono text-[11px] text-near-black/45">{shareUrl}</p>
    </section>
  );
}

export default function SharePage() {
  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav />
      <main className="mx-auto max-w-2xl px-5 pb-20 pt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-dark">More Faraday</div>
        <h1 className="mt-3 font-serif text-4xl font-bold leading-tight text-forest">Share &amp; invite</h1>
        <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-near-black/80">
          Bring people into the game. Invite a colleague, share your standing, or grow your team —
          every share action in one place.
        </p>

        <div className="mt-8 space-y-4">
          <ShareCard
            title="Invite a colleague"
            blurb="Send someone the Daily Challenge. If they play, the industry gets a little sharper."
            shareText={INVITE_TEXT}
            shareUrl={INVITE_URL}
            buttonLabel="Share the challenge"
          />

          <section className="rounded-lg border border-forest/10 bg-white px-5 py-5">
            <h2 className="font-serif text-lg font-bold text-forest">Share your rank</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-near-black/70">
              Show off where you land this season. Your rank card, with a one-tap share, lives on the
              leaderboard.
            </p>
            <Link
              href="/leaderboard"
              className="mt-4 inline-block rounded-lg border border-forest/25 px-4 py-2 font-mono text-[12px] text-forest transition-colors hover:border-forest/50"
            >
              Go to the leaderboard →
            </Link>
          </section>

          <section className="rounded-lg border border-forest/10 bg-white px-5 py-5">
            <h2 className="font-serif text-lg font-bold text-forest">Grow your team</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-near-black/70">
              Join up to five teams and your scores count toward each. Manage teams from your account;
              every team has a shareable page you can send to teammates so they can rally behind it.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/account"
                className="inline-block rounded-lg border border-forest/25 px-4 py-2 font-mono text-[12px] text-forest transition-colors hover:border-forest/50"
              >
                Manage teams →
              </Link>
              <Link
                href="/leaderboard?view=teams"
                className="inline-block rounded-lg border border-forest/25 px-4 py-2 font-mono text-[12px] text-forest transition-colors hover:border-forest/50"
              >
                Team standings →
              </Link>
            </div>
          </section>
        </div>

        <p className="mt-12 font-mono text-[11px] text-near-black/50">
          <Link href="/challenge" className="underline hover:text-forest">← Back to the Daily Challenge</Link>
        </p>
      </main>
    </div>
  );
}
