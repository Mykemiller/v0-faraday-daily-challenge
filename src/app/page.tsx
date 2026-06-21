import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import GameIcon, { GameIconDefs } from "@/components/GameIcon";
import AskFaraday from "@/components/AskFaraday";

// ── Faraday Intelligence homepage (engine-as-site) ───────────────────────────
// Leads with the product surface: Daily Challenge as an embedded 7-icon panel
// (each icon deep-links to its puzzle), the storefront tiles, a full-width
// Academy panel, then the token block, then Ask Faraday. Brand tokens from
// globals.css @theme (locked palette/fonts). Per-product meter prices are NOT
// shown (FAR-46 DRAFT). No fabricated engagement stats.

// The seven Daily Challenge games (mirrors GAME_CONFIGS in DailyChallenge.jsx).
const DC_GAMES = [
  "Rackl", "Signal Drop", "The Stack", "Circuit", "The Brief", "Dark Fiber", "Frequency",
] as const;

// Storefronts in locked order. Daily Challenge is the feature panel above; Faraday
// Academy is the full-width panel below — so neither is repeated in this grid.
const STOREFRONTS: { name: string; href: string; blurb: string; tag?: string }[] = [
  { name: "Faraday Intelligent Alert", href: "/intelligent-alert", blurb: "Real-time alerts on the moves that matter, with the weekly Pulse briefing bundled in.", tag: "Includes weekly Pulse" },
  { name: "Live Agent", href: "/live-agent", blurb: "Conversational intelligence — ask Faraday anything about the AI data center economy, live." },
  { name: "Briefing Library", href: "/briefing-library", blurb: "On-demand depth: the searchable archive of Faraday briefings and analysis." },
  { name: "Jurisdiction Watch", href: "https://jurisdiction-watch.com", blurb: "Jurisdiction-level posture and permitting risk on a live choropleth.", tag: "Metered" },
  { name: "Signal Room", href: "/signal-room", blurb: "The live room where raw market signals are read, sourced, and turned into intelligence." },
  { name: "Thought Forge", href: "/thought-forge", blurb: "Turn Faraday intelligence into your own briefs, memos, and models." },
];

const TOKEN_PACKS = [
  { tokens: "500", price: "$49" },
  { tokens: "1,000", price: "$89", featured: true },
  { tokens: "10,000", price: "$799" },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-warm-white text-near-black font-sans">
      <GameIconDefs />

      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <div className="h-0.5 bg-gold" />
      <header className="sticky top-0 z-50 bg-forest">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
          <BrandMark size={22} framed />
          <div className="leading-tight">
            <b className="font-serif text-[16px] font-bold tracking-wide text-warm-white">Faraday</b>
            <span className="block font-mono text-[9.5px] tracking-[0.18em] text-sage">INTELLIGENCE SERVICE · BETA</span>
          </div>
          <nav className="ml-auto flex items-center gap-4 font-mono text-[11px] text-warm-cream">
            <a href="#storefronts" className="hidden hover:text-gold-light sm:inline">Get Started</a>
            <a href="#academy" className="hidden hover:text-gold-light sm:inline">Academy</a>
            <Link href="/leaderboard" className="rounded-md border border-gold/50 px-3 py-1.5 text-gold-light hover:bg-gold/10">
              Your Leaderboard →
            </Link>
          </nav>
        </div>
      </header>
      <div className="h-0.5 bg-gold" />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-5 pt-14 pb-6">
        {/* Pull line */}
        <p className="font-serif text-[clamp(20px,4vw,30px)] font-bold italic text-amber-dark">
          The capital is real. The timeline is not.
        </p>
        <h1 className="mt-3 font-serif text-[clamp(34px,7vw,52px)] font-bold leading-[1.05] tracking-tight text-near-black">
          Your unfair advantage in the<br className="hidden sm:block" /> AI data center economy.
        </h1>
        {/* Category positioning */}
        <p className="mt-4 font-serif text-[clamp(16px,2.6vw,21px)] leading-snug text-forest">
          Beyond a tool. Beyond a firm. The colleague you’ve always needed.
        </p>
        {/* Depth line — locked engine tagline (FAR-177): Theater → Sector → Thread → Signal */}
        <p className="mt-4 font-serif text-[clamp(15px,2.4vw,19px)] italic leading-snug text-amber-dark/90">
          The AI-infrastructure buildout, mapped Theater to Thread — tracked Signal by Signal.
        </p>
        <p className="mt-5 max-w-2xl font-sans text-[16px] leading-relaxed text-near-black/70">
          Faraday reads the market every day and tells you what it means — specific, sourced, ahead.
          Pick a surface below. Three are free, every day; the rest are metered in tokens.
        </p>
      </section>

      {/* ── Storefronts ──────────────────────────────────────────────────── */}
      <section id="storefronts" className="mx-auto max-w-5xl px-5 pb-4">
        {/* Daily Challenge — feature panel; each neon icon deep-links to its puzzle */}
        <div className="rounded-xl border border-gold/40 bg-forest p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-serif text-[22px] font-bold text-warm-white">Daily Challenge</span>
            <Link href="/daily-challenge" className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold-light hover:text-gold">
              Free · all 7 games →
            </Link>
          </div>
          <p className="mt-2 max-w-2xl font-sans text-[13px] leading-relaxed text-warm-cream/80">
            Seven two-minute intelligence games for people who work in and around the AI data center economy.
          </p>
          <ul className="mt-5 grid grid-cols-4 gap-3 sm:grid-cols-7">
            {DC_GAMES.map((g) => (
              <li key={g}>
                <Link
                  href={`/daily-challenge?game=${encodeURIComponent(g)}`}
                  aria-label={`Play ${g}`}
                  className="flex flex-col items-center gap-1.5 rounded-lg p-1 text-center transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
                >
                  <GameIcon game={g} size={56} />
                  <span className="font-mono text-[9px] leading-tight text-warm-cream/75">{g}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Storefront tiles */}
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STOREFRONTS.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="group flex h-full flex-col rounded-xl border border-warm-gray bg-warm-white p-5 transition-colors hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-serif text-[17px] font-semibold text-near-black">{s.name}</span>
                  {s.tag && (
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-amber-dark">{s.tag}</span>
                  )}
                </div>
                <p className="mt-2 font-sans text-[13px] leading-relaxed text-near-black/65">{s.blurb}</p>
                <span className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-gold/90 group-hover:text-gold">Open →</span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Faraday Academy — full-width panel across the bottom of the storefront */}
        <Link
          id="academy"
          href="/academy"
          className="group mt-3 block rounded-xl border border-gold/40 bg-forest p-6 transition-colors hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-serif text-[22px] font-bold text-warm-white">Faraday Academy</span>
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-gold-light">Separate pricing · Open →</span>
          </div>
          <p className="mt-3 max-w-4xl font-sans text-[14px] leading-relaxed text-warm-cream/85">
            Faraday Academy exists to turn curiosity into conviction. The Academy equips investors, operators, and
            ecosystem participants with the structured knowledge to understand — and act on — the forces reshaping the
            global AI data center economy.
          </p>
        </Link>
      </section>

      {/* ── Tokens (emphasized line above the three packs) ───────────────── */}
      <section id="tokens" className="mx-auto max-w-5xl px-5 py-12">
        <p className="text-center font-serif text-[clamp(22px,3.6vw,32px)] font-bold leading-snug text-near-black">
          Tokens never expire — spend them only when you ask for depth.
        </p>
        <div className="mx-auto mt-6 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
          {TOKEN_PACKS.map((p) => (
            <div
              key={p.tokens}
              className={`flex flex-col items-center gap-1 rounded-xl border px-4 py-5 ${
                p.featured ? "border-gold bg-warm-cream" : "border-warm-gray bg-warm-white"
              }`}
            >
              <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-forest">{p.tokens} tokens</span>
              <span className="font-serif text-[28px] font-bold text-near-black">{p.price}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center font-mono text-[10px] leading-relaxed text-near-black/55">
          Three surfaces are free, every day; the rest are metered in tokens. Faraday Academy is priced separately.
        </p>
      </section>

      {/* ── Ask Faraday (bottom) ─────────────────────────────────────────── */}
      <section id="ask" className="mx-auto max-w-5xl px-5 pb-16">
        <AskFaraday />
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-warm-gray/60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-6 font-mono text-[10px] text-near-black/50">
          <BrandMark size={16} />
          <span>Faraday Intelligence</span>
          <span className="ml-auto">Nine Core Domains · intelligence on the AI data center economy</span>
        </div>
      </footer>
    </div>
  );
}
