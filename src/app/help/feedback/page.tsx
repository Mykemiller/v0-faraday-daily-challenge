import Link from "next/link";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import SiteFooter from "@/components/SiteFooter";
import FeedbackForm from "@/components/FeedbackForm";

export const metadata = {
  title: "Feedback · Faraday Daily Challenge",
  description: "Tell us what you'd change about the Daily Challenge — game ideas, difficulty, anything.",
};

// Help & Feedback (gear menu) → Feedback. Form → /api/feedback (Resend).

export default function FeedbackPage() {
  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav />
      <main className="mx-auto max-w-2xl px-5 pb-20 pt-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-dark">Help</div>
        <h1 className="mt-3 font-serif text-4xl font-bold leading-tight text-forest">Feedback</h1>
        <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-near-black/80">
          Game ideas, difficulty, a format you love or can&rsquo;t stand, something you wish existed —
          tell us what you&rsquo;d change about the Daily Challenge. We read every note.
        </p>

        <FeedbackForm
          type="idea"
          placeholder="What would make the Daily Challenge better? Be as specific or as blue-sky as you like."
          cta="Send feedback"
        />

        <p className="mt-12 font-mono text-[11px] text-near-black/50">
          <Link href="/challenge" className="underline hover:text-forest">← Back to the Daily Challenge</Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
