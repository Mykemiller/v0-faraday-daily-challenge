import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import LiveAgent from "@/components/LiveAgent";

export const metadata = { title: "Live Agent — Faraday" };

// CC-06 / FAR-29 — Live Agent is now a live, retrieval-grounded surface (no
// longer a stub). The widget is entitlement-gated and metered server-side; this
// page frames it in Faraday's voice. Brand tokens from globals.css @theme.
export default function Page() {
  return (
    <div className="min-h-screen bg-warm-white text-near-black font-sans">
      <div className="h-0.5 bg-gold" />
      <header className="bg-forest">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
          <Link href="/" className="flex items-center gap-3" aria-label="Faraday home">
            <BrandMark size={20} framed />
            <span className="font-serif text-[15px] font-bold tracking-wide text-warm-white">
              Faraday
            </span>
          </Link>
          <Link
            href="/"
            className="ml-auto font-mono text-[11px] text-warm-cream hover:text-gold-light"
          >
            ← All storefronts
          </Link>
        </div>
      </header>
      <div className="h-0.5 bg-gold" />

      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="font-serif text-[clamp(28px,6vw,40px)] font-bold leading-tight tracking-tight text-near-black">
          Live Agent
        </h1>
        <p className="mt-3 font-serif text-[18px] italic text-near-black/70">
          Ask Faraday anything — with citations.
        </p>
        <div className="my-6 h-px bg-warm-gray/60" />

        <div className="space-y-4 font-sans text-[15px] leading-relaxed text-near-black/80">
          <p className="font-serif text-[16px] italic text-forest">
            From the grid and the foundry to the capital stack, Faraday follows every
            Theater, Sector, and Thread of the buildout — Signal by Signal.
          </p>
          <p>
            Live Agent is conversational intelligence on the AI data center economy.
            Ask a question and get a direct, sourced answer in Faraday&apos;s voice —
            grounded in the enriched knowledge base and returned with citations rather
            than guesses. When the corpus doesn&apos;t cover your question, it says so
            instead of inventing an answer.
          </p>
          <p>It is the colleague you&apos;ve always needed, on call.</p>
        </div>

        <div className="mt-8">
          <LiveAgent />
        </div>

        <p className="mt-8 font-mono text-[11px] text-near-black/55">
          Metered for Faraday subscribers · grounded answers only.
        </p>
      </main>
    </div>
  );
}
