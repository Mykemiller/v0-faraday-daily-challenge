import Link from "next/link";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import SiteFooter from "@/components/SiteFooter";
import FeedbackForm from "@/components/FeedbackForm";

export const metadata = {
  title: "Report a Bug · Faraday Daily Challenge",
  description: "Found something broken in the Daily Challenge? Tell us what happened.",
};

// Help & Feedback (gear menu) → Report a Bug. Form → /api/feedback (Resend).

export default function ReportABugPage() {
  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav />
      <main className="mx-auto max-w-2xl px-5 pb-20 pt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-dark">Help</div>
        <h1 className="mt-3 font-serif text-4xl font-bold leading-tight text-forest">Report a bug</h1>
        <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-near-black/80">
          A puzzle that won&rsquo;t score, a tile that won&rsquo;t drag, a page that looks wrong?
          Tell us what happened and what you expected — the more detail, the faster we can fix it.
          Include which game and roughly when, if you can.
        </p>

        <FeedbackForm
          type="bug"
          placeholder="What were you doing, what happened, and what did you expect instead? Which game were you playing?"
          cta="Send report"
        />

        <p className="mt-12 font-mono text-[11px] text-near-black/50">
          <Link href="/challenge" className="underline hover:text-forest">← Back to the Daily Challenge</Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
