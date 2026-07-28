import Link from "next/link";
import SiteHeaderNav from "@/components/SiteHeaderNav";

export const metadata = {
  title: "Tips and Tricks · Faraday Daily Challenge",
  description: "Strategy notes for each of the seven daily games — how regulars keep streaks alive and squeeze out the points.",
};

// Help & Feedback → Tips and Tricks. One strategy card per game format
// (mirrors GAME_CONFIGS in DailyChallenge.jsx — keep the seven in sync).

const TIPS: { name: string; format: string; tips: string[] }[] = [
  { name: "Rackl", format: "Connect — group the tiles into four sets", tips: [
    "Start with the group you're surest of and lock it first — a wrong guess costs you.",
    "Watch for overlap traps: a tile that seems to fit two groups usually belongs to the less obvious one.",
  ]},
  { name: "Circuit", format: "Sprint — true/false against the clock", tips: [
    "Speed beats deliberation here — trust your first read and keep moving.",
    "The clock rewards a rhythm; don't stall on one statement, flag it and come back.",
  ]},
  { name: "Dark Fiber", format: "Match — terms to their definitions", tips: [
    "Match the ones you know cold first; each removal makes the rest easier.",
    "Read the definition for the distinctive noun — it usually pins exactly one term.",
  ]},
  { name: "Frequency", format: "Quiz — multiple choice", tips: [
    "Eliminate the obviously-wrong options first; two-way guesses beat four-way ones.",
    "The most specific answer is often right — vague options are usually distractors.",
  ]},
  { name: "The Stack", format: "Rank — drag into the correct order", tips: [
    "Anchor the extremes (biggest / smallest, first / last) before sorting the middle.",
    "If you're unsure of two neighbors, order them last — nearby swaps cost the least.",
  ]},
  { name: "Signal Drop", format: "Guess — Wordle-style term guessing", tips: [
    "Open with a guess that tests common infrastructure letters, not a random word.",
    "Use the domain clue: the answer is always a real data-center-economy term.",
  ]},
  { name: "The Brief", format: "Read — intelligence brief, then answer", tips: [
    "Skim the questions first, then read the brief hunting for those specific facts.",
    "Answers are in the text — resist filling gaps with outside knowledge.",
  ]},
];

export default function TipsPage() {
  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav />
      <main className="mx-auto max-w-2xl px-5 pb-20 pt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-dark">Help</div>
        <h1 className="mt-3 font-serif text-4xl font-bold leading-tight text-forest">Tips &amp; Tricks</h1>
        <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-near-black/80">
          Seven games, seven habits. A little strategy per format is how regulars keep streaks alive
          and squeeze out the last points.
        </p>

        <div className="mt-8 space-y-4">
          {TIPS.map((g) => (
            <section key={g.name} className="rounded-lg border border-forest/10 bg-white px-5 py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-serif text-lg font-bold text-forest">{g.name}</h2>
                <span className="font-mono text-[11px] text-near-black/50">{g.format}</span>
              </div>
              <ul className="mt-3 space-y-2 text-[14px] leading-relaxed text-near-black/75">
                {g.tips.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-gold">→</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-8 rounded-lg border border-gold/30 bg-gold/8 px-5 py-4 text-[14px] leading-relaxed text-near-black/80">
          The single biggest score lever is showing up daily — streaks compound. New to a format?
          The <Link href="/help/hints" className="font-medium text-forest underline hover:text-gold">hints guide</Link>{" "}
          explains what each game&rsquo;s hint reveals.
        </div>

        <p className="mt-12 font-mono text-[11px] text-near-black/50">
          <Link href="/challenge" className="underline hover:text-forest">← Back to the Daily Challenge</Link>
        </p>
      </main>
    </div>
  );
}
