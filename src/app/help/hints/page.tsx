import Link from "next/link";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import SiteFooter from "@/components/SiteFooter";
import { loadLiveGames } from "@/lib/game-registry-server";
import { keyOf } from "@/lib/game-registry";

export const metadata = {
  title: "Hints · Faraday Daily Challenge",
  description: "How hints work across the daily games — and how to use them without giving the answer away.",
};

// Help & Feedback → Hints (evergreen how-to). Distinct from /challenge/hints,
// which is the day-scoped list of today's actual hints (FAR-287).

// Per-game hint copy. Editorial text stays in code (CC-DC-GAME-REGISTRY-1.0 Q5)
// but the LIST and its order come from game_catalog — a game with no copy here
// is simply omitted rather than breaking the page.
const HINT_COPY: Record<string, string> = {
  Rackl: "A hint narrows one group — it tells you a category, not which tiles belong to it.",
  Circuit: "A hint flags whether the current statement is the tricky one, so you can slow down before the buzzer.",
  "Dark Fiber": "A hint reveals part of one definition, enough to anchor a single match.",
  Frequency: "A hint eliminates one wrong answer, turning four choices into three.",
  "The Stack": "A hint locks one item into its correct position so you can rank around it.",
  "Signal Drop": "A hint reveals a letter or the term's domain — a nudge, never the whole word.",
  "The Brief": "A hint points you back to the line in the brief that carries the answer.",
};

export default async function HintsHelpPage() {
  const games = (await loadLiveGames())
    .map((g) => ({ name: keyOf(g), hint: HINT_COPY[keyOf(g)] }))
    .filter((g): g is { name: string; hint: string } => Boolean(g.hint));

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav />
      <main className="mx-auto max-w-2xl px-5 pb-20 pt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-dark">Help</div>
        <h1 className="mt-3 font-serif text-4xl font-bold leading-tight text-forest">How hints work</h1>
        <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-near-black/80">
          Every game has a <strong>Hint?</strong> button. You get <strong>three hints per game, per
          day</strong> — a shared budget, so a hint you spend here is a hint you spend in-game, and
          vice versa. Hints are always free and <strong>never affect your score</strong>.
        </p>

        <section className="mt-8 rounded-lg border border-forest/10 bg-white px-5 py-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-near-black/40">
            The three-hint rule
          </div>
          <ul className="mt-3 space-y-2 text-[14px] leading-relaxed text-near-black/75">
            <li>• Three hints per game, refreshed every day at midnight (your local time).</li>
            <li>• Hints reveal in tiers — each tap gives a little more, so you spend only what you need.</li>
            <li>• Spending hints never costs points. Score comes from what you solve, not how.</li>
          </ul>
        </section>

        <h2 className="mt-10 font-serif text-xl font-bold text-forest">What a hint gives you, by game</h2>
        <div className="mt-4 divide-y divide-forest/8 rounded-lg border border-forest/10 bg-white px-5">
          {games.map((g) => (
            <div key={g.name} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3.5">
              <span className="w-28 shrink-0 font-mono text-[11px] uppercase tracking-wider text-forest">{g.name}</span>
              <span className="min-w-0 flex-1 text-[14px] leading-relaxed text-near-black/75">{g.hint}</span>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-lg border border-gold/30 bg-gold/8 px-5 py-4">
          <p className="text-[14px] leading-relaxed text-near-black/80">
            Looking for today&rsquo;s actual hints?{" "}
            <Link href="/challenge/hints" className="font-medium text-forest underline hover:text-gold">
              Hints Today
            </Link>{" "}
            lists them for every game in the current set.
          </p>
        </div>

        <p className="mt-12 font-mono text-[11px] text-near-black/50">
          <Link href="/challenge" className="underline hover:text-forest">← Back to the Daily Challenge</Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
