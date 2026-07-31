import Link from "next/link";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import SiteFooter from "@/components/SiteFooter";

export const metadata = {
  title: "Who is Faraday",
  description:
    "Gilbert 'Gil' Faraday is the analyst persona behind Faraday Intelligence — an empiricist who reads the actual filings before he concludes.",
};

// More Faraday → Who is Faraday.
// Copy grounded in the Faraday Brand Bible 4.0 (§10 The Analyst Personas):
// Gilbert "Gil" Faraday — the brand's analyst persona. Distinct from /about
// (Faraday Intelligence, the service). Two separate pages, not duplicates
// (confirmed by Myke 2026-07-02).

function Section({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 first:mt-8">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-near-black/40">{kicker}</div>
      <h2 className="mt-1 font-serif text-xl font-bold text-forest">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-near-black/75">{children}</div>
    </section>
  );
}

export default function WhoIsFaradayPage() {
  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav />
      <main className="mx-auto max-w-2xl px-5 pb-20 pt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-dark">
          The Analyst
        </div>
        <h1 className="mt-3 font-serif text-4xl font-bold leading-tight text-forest">
          Meet Gil Faraday.
        </h1>
        <p className="mt-4 max-w-[56ch] text-[17px] leading-relaxed text-near-black/80">
          Gilbert Faraday — Gil to subscribers — is the analyst behind the briefings: an empiricist
          who reads the actual filings, tracks the actual queue data, and doesn&rsquo;t conclude
          until he&rsquo;s seen the evidence.
        </p>

        <Section kicker="The name" title="Two centuries of physics heritage">
          <p>
            The name carries the lineage of electricity itself. William Gilbert coined the word{" "}
            <em>electricity</em> in 1600. Two centuries later, Michael Faraday built on that work to
            make electric power useful to the world — the induction, the fields, the machines the
            whole grid still runs on.
          </p>
          <p>
            Gil Faraday inherits both halves: Gilbert&rsquo;s insistence on observation before theory,
            and Faraday&rsquo;s obsession with turning raw phenomena into something the world can use.
          </p>
        </Section>

        <Section kicker="The method" title="Evidence first, opinion second">
          <p>
            Gil&rsquo;s discipline is simple and unfashionable: look at the primary source. Where
            others summarize the summary, he reads the docket, the interconnection filing, the
            earnings transcript, the permit. He would rather say &ldquo;not in the record yet&rdquo;
            than guess — the same principle that governs everything Faraday Intelligence publishes.
          </p>
          <p>
            That empiricism is why the Daily Challenge draws its puzzles from real
            data-center-economy facts, not trivia. Every game is a small exercise in the way Gil
            reads the market.
          </p>
        </Section>

        <Section kicker="The story continues" title="Four chapters, still being written">
          <p>
            Gil&rsquo;s full biography — the four-chapter career, the Munich years, and his longtime
            colleague Mach Eigen — is being written chapter by chapter, and will appear here as it
            lands. What&rsquo;s fixed is the character: rigorous, curious, and allergic to a claim
            without a source.
          </p>
        </Section>

        <p className="mt-12 font-mono text-[11px] text-near-black/50">
          <Link href="/about" className="underline hover:text-forest">About Faraday Intelligence</Link>
          <span className="px-2 text-near-black/30">·</span>
          <Link href="/challenge" className="underline hover:text-forest">Back to the Daily Challenge</Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
