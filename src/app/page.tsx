import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import GameIcon, { GameIconDefs } from "@/components/GameIcon";

// ── Faraday Intelligence homepage (engine-as-site) ───────────────────────────
// The revenue door. IA: one-idea hero + one primary action → a one-line "how
// Faraday works" scaffold → the surfaces grid (one primary path) → coverage/IDF
// strip → Academy → tokens → free Daily Challenge cross-link → footer. Soundbites
// are distributed one-per-section, never stacked. Brand tokens from globals.css
// @theme (locked). Per-product meter prices are NOT shown (FAR-46 DRAFT).

// The seven Daily Challenge games in the locked order (front-loads quick-momentum
// games). Mirrors GAME_CONFIGS in DailyChallenge.jsx.
const DC_GAMES = [
  "Rackl", "Circuit", "Dark Fiber", "Frequency", "The Stack", "Signal Drop", "The Brief",
] as const;

// Storefronts. Daily Challenge is the free-door cross-link below; Faraday Academy
// is the full-width panel further down — so neither is repeated in this grid.
const STOREFRONTS: { name: string; href: string; blurb: string; tag?: string; primary?: boolean }[] = [
  { name: "Faraday Intelligent Alert", href: "/intelligent-alert", blurb: "Real-time alerts on the moves that matter, with the weekly Pulse briefing bundled in.", tag: "Includes weekly Pulse" },
  { name: "Briefing Library", href: "/briefing-library", blurb: "On-demand depth: the searchable archive of Faraday briefings and analysis.", tag: "Metered" },
  { name: "Jurisdiction Watch", href: "/jurisdiction-watch", blurb: "Jurisdiction-level posture and permitting risk on a live choropleth.", tag: "Metered" },
  { name: "Signal Room", href: "/signal-room", blurb: "Your watchlist — compose a personalized feed across Theater, Sector, Thread, Company, and cadence.", tag: "Metered" },
  { name: "Thought Forge", href: "/thought-forge", blurb: "Turn Faraday intelligence into your own briefs, memos, and models.", tag: "Metered" },
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
            <b className="font-display text-[16px] font-bold tracking-wide text-warm-white">Faraday</b>
            <span className="block font-mono text-[11px] tracking-[0.18em] text-sage">INTELLIGENCE SERVICE · BETA</span>
          </div>
          <nav className="ml-auto flex items-center gap-4 font-mono text-[11px] text-warm-cream">
            <a href="#storefronts" className="hidden hover:text-gold-light sm:inline">Surfaces</a>
            <a href="#academy" className="hidden hover:text-gold-light sm:inline">Academy</a>
            <Link href="/leaderboard" className="rounded-md border border-gold/50 px-3 py-1.5 text-gold-light hover:bg-gold/10">
              Your Leaderboard →
            </Link>
          </nav>
        </div>
      </header>
      <div className="h-0.5 bg-gold" />

      {/* ── Hero — one idea, one action ──────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-5 pt-14 pb-8">
        {/* Pull line — the hook */}
        <p className="font-display text-[clamp(20px,4vw,30px)] font-bold italic text-amber-dark">
          The capital is real. The timeline is not.
        </p>
        <h1 className="mt-3 font-display text-[clamp(34px,7vw,52px)] font-bold leading-[1.05] tracking-tight text-near-black">
          Your unfair advantage in the<br className="hidden sm:block" /> AI data center economy.
        </h1>
        {/* Single human sub-line */}
        <p className="mt-4 font-serif text-[clamp(17px,2.6vw,22px)] italic leading-snug text-forest">
          The colleague you’ve always needed.
        </p>
        {/* How Faraday works — three pillars as scannable bullets */}
        <ul className="mt-8 max-w-2xl space-y-2.5 font-sans text-[15px] leading-relaxed text-near-black/75">
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
            <span><strong className="font-medium text-near-black">The Daily Challenge</strong> — compete with peers, free every day</span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
            <span><strong className="font-medium text-near-black">Token-metered, Curated Intelligence Services</strong> — fresh every day</span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
            <span>Turn curiosity into conviction at your own pace with <strong className="font-medium text-near-black">the Academy</strong></span>
          </li>
        </ul>
      </section>

      {/* ── Storefronts ──────────────────────────────────────────────────── */}
      <section id="storefronts" className="mx-auto max-w-5xl px-5 pb-4">
        <h2 className="font-display text-[clamp(22px,3.4vw,30px)] font-bold leading-tight text-near-black">
          Beyond a tool. Beyond a firm.
        </h2>
        <div className="double-rule" aria-hidden />
        <p className="mt-4 mb-6 max-w-2xl font-sans text-[15px] leading-relaxed text-near-black/70">
          Faraday reads the market every day and tells you what it means — specific, sourced, ahead.
          Open each when you need depth.
        </p>

        {/* Storefront tiles — Live Agent is the primary path, the rest subordinated */}
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STOREFRONTS.map((s) => (
            <li key={s.href} className={s.primary ? "sm:col-span-2 lg:col-span-3" : undefined}>
              <Link
                href={s.href}
                className={`group flex h-full flex-col rounded-xl border p-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${
                  s.primary
                    ? "border-gold bg-warm-cream hover:border-gold"
                    : "border-warm-gray bg-warm-white hover:border-gold"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`font-serif font-semibold text-near-black ${s.primary ? "text-[20px]" : "text-[17px]"}`}>{s.name}</span>
                  {s.tag && (
                    <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-amber-dark">{s.tag}</span>
                  )}
                </div>
                <p className={`mt-2 font-sans leading-relaxed text-near-black/70 ${s.primary ? "text-[15px] max-w-2xl" : "text-[13px]"}`}>{s.blurb}</p>
                <span className="mt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-amber-dark group-hover:text-gold">Open →</span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Faraday Academy — full-width panel; separately priced. Links straight
            to the live dynamic Academy catalog (same target as the Daily
            Challenge lobby tile) rather than the /academy redirect hop, so the
            panel can never surface a stale/cached stub. */}
        <a
          id="academy"
          href="https://faraday-academy.vercel.app/academy"
          target="_blank"
          rel="noopener noreferrer"
          className="group mt-3 block rounded-xl border border-gold/40 bg-forest p-6 transition-colors hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-display text-[22px] font-bold text-warm-white">Faraday Academy</span>
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-gold-light">Separate pricing · Open →</span>
          </div>
          <p className="mt-3 max-w-4xl font-sans text-[14px] leading-relaxed text-warm-cream/85">
            Faraday Academy exists to turn curiosity into conviction — equipping investors, operators, and
            ecosystem participants with the structured knowledge to understand, and act on, the forces reshaping the
            global AI data center economy.
          </p>
        </a>
      </section>

      {/* ── Coverage / IDF strip ─────────────────────────────────────────── */}
      <section className="mx-auto mt-8 max-w-5xl px-5">
        <div className="rounded-xl bg-forest px-6 py-10 text-center">
          <p className="mx-auto max-w-3xl font-display text-[clamp(19px,3vw,26px)] font-bold italic leading-snug text-warm-white">
            The AI-Infrastructure buildout researched and mapped Theater to Thread.
          </p>
          <div className="mx-auto double-rule is-invert is-wide" aria-hidden />
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-gold-light">
            Curated with Conviction. Cultivated for Depth.
          </p>
        </div>
      </section>

      {/* ── Tokens ───────────────────────────────────────────────────────── */}
      <section id="tokens" className="mx-auto max-w-5xl px-5 py-12">
        <p className="text-center font-display text-[clamp(22px,3.6vw,32px)] font-bold leading-snug text-near-black">
          Tokens never expire — spend them only when you ask for depth.
        </p>
        <p className="mx-auto mt-3 max-w-xl text-center font-sans text-[14px] leading-relaxed text-near-black/70">
          Every Faraday surface runs on tokens — one balance across all of them. A token is a unit of depth:
          spend one when you want Faraday to go further. You only pay when you ask.
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
              <span className="font-display text-[28px] font-bold text-near-black">{p.price}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center font-mono text-[11px] leading-relaxed text-near-black/65">
          Every intelligence surface is metered in tokens. The Daily Challenge is free, every day; Faraday Academy is priced separately.
        </p>
      </section>

      {/* ── Daily Challenge — the free door (cross-link) ─────────────────── */}
      <section className="mx-auto max-w-5xl px-5 pb-12">
        <div className="rounded-xl border border-gold/40 bg-forest p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-display text-[22px] font-bold text-warm-white">Sharpen up free, every day</span>
            <Link href="/daily-challenge" className="font-mono text-[11px] uppercase tracking-[0.14em] text-gold-light hover:text-gold">
              Free · all 7 games →
            </Link>
          </div>
          <p className="mt-2 max-w-2xl font-sans text-[13px] leading-relaxed text-warm-cream/80">
            Seven two-minute intelligence games for people who work in and around the AI data center economy.
            The puzzles come from what Faraday reads every day.
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
                  <span className="font-mono text-[11px] leading-tight text-warm-cream/85">{g}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-warm-gray/60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-6 font-mono text-[11px] text-near-black/65">
          <BrandMark size={16} />
          <span><b className="font-display text-[13px] font-bold not-italic text-near-black">Faraday Intelligence.</b> <i className="font-serif text-near-black/75">Your unfair advantage.</i></span>
        </div>
      </footer>
    </div>
  );
}
