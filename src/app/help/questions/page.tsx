import Link from "next/link";
import SiteHeaderNav from "@/components/SiteHeaderNav";

export const metadata = {
  title: "Questions · Faraday Daily Challenge",
  description: "Frequently asked questions about scoring, Intelligence Readiness, teams, and the daily rotation.",
};

// Help & Feedback → Questions. Static FAQ using native <details> so it works
// with no client JS. Answers reflect the shipped product (scoring, streaks,
// teams ≤5 immediate join, midnight-CT rotation, opt-out).

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "How does the daily set work?",
    a: <>A fresh set of seven games goes live every day at <strong>midnight Central</strong>. You can
      play each game once per day. Yesterday&rsquo;s set retires when the new one drops.</>,
  },
  {
    q: "How is my score calculated?",
    a: <>Each game awards points for what you solve — faster and more accurate finishes score higher.
      Your <strong>daily total</strong> is the sum across every game you play that day, and it rolls
      up into your season total on the <Link href="/leaderboard" className="text-forest underline hover:text-gold">leaderboard</Link>.</>,
  },
  {
    q: "Do hints cost me points?",
    a: <>No. You get three hints per game per day and they never affect your score. See the{" "}
      <Link href="/help/hints" className="text-forest underline hover:text-gold">hints guide</Link> for details.</>,
  },
  {
    q: "What is Intelligence Readiness?",
    a: <>Intelligence Readiness counts consecutive days you&rsquo;ve played. Miss a day and it resets.
      It&rsquo;s about showing up — it&rsquo;s shown on your <Link href="/account" className="text-forest underline hover:text-gold">account</Link>.</>,
  },
  {
    q: "How do teams work?",
    a: <>You can join <strong>up to five teams</strong>, and joins take effect immediately — no
      waiting period. Your scores count toward every team you&rsquo;re on. Manage teams from your{" "}
      <Link href="/account" className="text-forest underline hover:text-gold">account</Link>, and see team
      standings on the <Link href="/leaderboard?view=teams" className="text-forest underline hover:text-gold">leaderboard</Link>.</>,
  },
  {
    q: "Can I change my handle?",
    a: <>Yes, from your <Link href="/account" className="text-forest underline hover:text-gold">account</Link>.
      Handles are 3–24 characters (letters, numbers, and underscores). Changing it may affect how your
      past standings are labeled.</>,
  },
  {
    q: "How do I stop playing without losing my history?",
    a: <>Use <strong>Leave the game</strong> on your <Link href="/account" className="text-forest underline hover:text-gold">account</Link>.
      It&rsquo;s a soft opt-out: your Intelligence Readiness and history are kept, you&rsquo;re hidden from leaderboards,
      and you can rejoin anytime. Nothing is deleted.</>,
  },
  {
    q: "Do I need an account to play?",
    a: <>No — you can play anonymously. Signing in lets you keep your Intelligence Readiness across devices, join teams,
      appear on the leaderboard, and unlock answers for puzzles you&rsquo;ve completed.</>,
  },
];

export default function QuestionsPage() {
  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav />
      <main className="mx-auto max-w-2xl px-5 pb-20 pt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-dark">Help</div>
        <h1 className="mt-3 font-serif text-4xl font-bold leading-tight text-forest">Questions</h1>
        <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-near-black/80">
          The short answers to how the Daily Challenge works — scoring, Intelligence Readiness, teams, and the daily
          rotation.
        </p>

        <div className="mt-8 space-y-2.5">
          {FAQ.map((item, i) => (
            <details key={i} className="group rounded-lg border border-forest/10 bg-white px-5 py-4 [&_summary]:list-none">
              <summary className="flex cursor-pointer items-center justify-between gap-4 font-serif text-[16px] font-semibold text-forest">
                {item.q}
                <span className="shrink-0 font-mono text-near-black/40 transition-transform group-open:rotate-45">+</span>
              </summary>
              <div className="mt-3 text-[14px] leading-relaxed text-near-black/75">{item.a}</div>
            </details>
          ))}
        </div>

        <div className="mt-8 rounded-lg border border-gold/30 bg-gold/8 px-5 py-4 text-[14px] leading-relaxed text-near-black/80">
          Didn&rsquo;t find your answer?{" "}
          <Link href="/help/feedback" className="font-medium text-forest underline hover:text-gold">Send us the question</Link>{" "}
          — or, if something&rsquo;s broken,{" "}
          <Link href="/help/report-a-bug" className="font-medium text-forest underline hover:text-gold">report a bug</Link>.
        </div>

        <p className="mt-12 font-mono text-[11px] text-near-black/50">
          <Link href="/challenge" className="underline hover:text-forest">← Back to the Daily Challenge</Link>
        </p>
      </main>
    </div>
  );
}
