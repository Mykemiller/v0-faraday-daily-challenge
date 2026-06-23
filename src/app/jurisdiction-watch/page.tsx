import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import JurisdictionWatchMap from "@/components/JurisdictionWatchMap";

export const metadata = { title: "Jurisdiction Watch — Faraday" };

// Jurisdiction Watch now renders a live, in-engine posture map (the Home tile
// links here) instead of a stub that pointed at the not-yet-wired
// jurisdiction-watch.faraday-intelligence.ai subdomain. The map is illustrative;
// the production scoring app lives in the separate faraday-jurisdiction-watch
// project. When that app is public under the brand subdomain, this page can swap
// the mocked map for it (or embed it) without changing the Home tile.
export default function Page() {
  return (
    <div className="min-h-screen bg-warm-white text-near-black font-sans">
      <div className="h-0.5 bg-gold" />
      <header className="bg-forest">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
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

      <main className="mx-auto max-w-5xl px-5 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-dark">Jurisdiction Watch</p>
        <h1 className="mt-2 font-display text-[clamp(28px,5vw,42px)] font-bold leading-[1.05] tracking-tight text-near-black">
          Where the buildout meets the statehouse.
        </h1>
        <p className="mt-3 max-w-2xl font-serif text-[16px] italic leading-snug text-forest">
          Power gets approved — or stalled — one jurisdiction at a time. Faraday maps permitting posture and
          interconnection risk across the AI-infrastructure buildout, so you see who’s clearing the way before the
          capital commits.
        </p>

        <div className="mt-8">
          <JurisdictionWatchMap />
        </div>
      </main>
    </div>
  );
}
