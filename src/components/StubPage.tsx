import Link from "next/link";
import type { ReactNode } from "react";
import BrandMark from "@/components/BrandMark";

// Shared layout for the stubbed storefront product pages. Deliberately framed as
// a preview so a stub is never mistaken for a finished page. Brand tokens from
// globals.css @theme (locked palette/fonts).

type StubPageProps = {
  title: string;
  tagline: string;
  /** Short status chip, e.g. "In build", "Concept", "In production". */
  status: string;
  children: ReactNode;
  /** Optional external action (e.g. LearnWorlds, the live JW frontend). */
  cta?: { label: string; href: string };
  /** Optional note rendered in the metered/pricing line. */
  meteredNote?: string;
};

export default function StubPage({ title, tagline, status, children, cta, meteredNote }: StubPageProps) {
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
        {/* Preview banner — keeps the stub honest */}
        <div className="mb-8 flex flex-wrap items-center gap-3 rounded-md border border-gold/40 bg-warm-cream px-4 py-2.5">
          <span className="rounded bg-gold/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-dark">
            Preview · stub page
          </span>
          <span className="font-mono text-[10px] text-near-black/60">
            Placeholder layout seeded from canon — not the finished storefront. Status: {status}.
          </span>
        </div>

        <h1 className="font-serif text-[clamp(28px,6vw,40px)] font-bold leading-tight tracking-tight text-near-black">
          {title}
        </h1>
        <p className="mt-3 font-serif text-[18px] italic text-near-black/70">{tagline}</p>
        <div className="my-6 h-px bg-warm-gray/60" />

        <div className="space-y-4 font-sans text-[15px] leading-relaxed text-near-black/80">{children}</div>

        <p className="mt-8 font-mono text-[11px] text-near-black/55">
          {meteredNote ?? "Metered in tokens · tokens never expire."}
        </p>

        {cta && (
          <a
            href={cta.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-block rounded-md border border-gold/50 px-4 py-2 font-mono text-[12px] text-amber-dark hover:bg-gold/10"
          >
            {cta.label} →
          </a>
        )}
      </main>
    </div>
  );
}
