"use client";

import { selectTeaser, type TeaserContext, type TeaserSlotName } from "@/lib/teasers";

// ── TeaserSlot — flag-gated cross-sell injection point ────────────────────────
// Renders NOTHING unless NEXT_PUBLIC_FARADAY_TEASERS === "true" AND selectTeaser
// returns a teaser for this slot. Off by default: the seam ships dark. Drop a
// <TeaserSlot slot="scorecard" ctx={...} /> wherever a teaser may appear; turning
// the system on is one env flag, no re-architecture. No price/token copy here.

const TEASERS_ON = process.env.NEXT_PUBLIC_FARADAY_TEASERS === "true";

export default function TeaserSlot({ slot, ctx }: { slot: TeaserSlotName; ctx: TeaserContext }) {
  if (!TEASERS_ON) return null;

  const teaser = selectTeaser(ctx);
  if (!teaser || teaser.slot !== slot) return null;

  return (
    <a
      href={teaser.href}
      className="mt-3 block rounded-lg border border-gold/40 bg-warm-cream px-4 py-3 transition-colors hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-dark">
        From Faraday · {teaser.surface}
      </span>
      <p className="mt-1 font-sans text-[13px] leading-relaxed text-near-black/80">{teaser.copy}</p>
    </a>
  );
}
