import Link from "next/link";
import SiteHeaderNav from "@/components/SiteHeaderNav";

export const metadata = {
  title: "About Faraday Intelligence",
  description:
    "Faraday Intelligence is an always-on intelligence service for the AI data center economy. The Daily Challenge is its free front door.",
};

// More Faraday → About Faraday Intelligence.
// Copy grounded in the Faraday Brand Bible 4.0 (Brand Foundation + Positioning):
// Faraday Intelligence is an intelligence SERVICE — a new category. Per the
// Bible, never call it a chatbot, assistant, advisor, platform, tool, or
// consulting firm. Distinct from /who-is-faraday (the Gil Faraday persona).

function Section({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 first:mt-8">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-near-black/40">{kicker}</div>
      <h2 className="mt-1 font-serif text-xl font-bold text-forest">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-near-black/75">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav />
      <main className="mx-auto max-w-2xl px-5 pb-20 pt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-dark">
          Faraday Intelligence
        </div>
        <h1 className="mt-3 font-serif text-4xl font-bold leading-tight text-forest">
          The intelligence service for the AI data center economy.
        </h1>
        <p className="mt-4 max-w-[56ch] text-[17px] leading-relaxed text-near-black/80">
          Always on, always ahead. Faraday thinks so you can decide — turning the market&rsquo;s
          daily torrent of signals into a clear read on where things stand and where they&rsquo;re going.
        </p>

        <Section kicker="What it is" title="A new category — not a tool, not a firm">
          <p>
            Every day the AI-infrastructure market throws off more signal than any team can read:
            interconnection filings, regulatory proceedings, earnings calls, capital deployments,
            supply-chain moves. Faraday Intelligence ingests all of it and tells you, plainly, what
            it means.
          </p>
          <p>
            It isn&rsquo;t a chatbot to prompt or a dashboard to configure. It&rsquo;s an
            intelligence service that works in the background and surfaces what matters — your unfair
            advantage, in your pocket.
          </p>
        </Section>

        <Section kicker="The free front door" title="Start with the Daily Challenge">
          <p>
            The <Link href="/challenge" className="font-medium text-forest underline hover:text-gold">Daily Challenge</Link>{" "}
            is how most people meet Faraday: seven quick games a day, drawn from the same
            data-center-economy knowledge base the intelligence service runs on. Play a few minutes,
            build a streak, climb the{" "}
            <Link href="/leaderboard" className="font-medium text-forest underline hover:text-gold">leaderboard</Link>{" "}
            — and pick up the vocabulary of the industry while you do it.
          </p>
        </Section>

        <Section kicker="The rest of Faraday" title="Beyond the daily games">
          <p>
            The Daily Challenge is one surface. Faraday Intelligence spans a family of products for
            people who build, finance, power, and site AI infrastructure — from live market signals
            to grounded, cited answers about the corpus.
          </p>
          <p>
            The full lineup lives on the{" "}
            <Link href="/" className="font-medium text-forest underline hover:text-gold">Faraday Intelligence homepage</Link>.
            Curious who&rsquo;s behind the briefings? Meet{" "}
            <Link href="/who-is-faraday" className="font-medium text-forest underline hover:text-gold">Gil Faraday</Link>.
          </p>
        </Section>

        <p className="mt-12 font-mono text-[11px] text-near-black/50">
          <Link href="/challenge" className="underline hover:text-forest">← Back to the Daily Challenge</Link>
        </p>
      </main>
    </div>
  );
}
