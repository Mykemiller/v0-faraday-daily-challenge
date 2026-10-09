import { Suspense } from "react";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import SiteFooter from "@/components/SiteFooter";
import PredictsView, { PredictsSkeleton } from "./PredictsView";

// Faraday Predicts storefront — the public, free surface for the forecast lane
// (26-41-v01 P9, FDY-147).
//
// Shell mirrors /intelligent-alert (StubPage): gold hairline, forest masthead
// with the wordmark and "← All storefronts", gold hairline, SiteFooter. It does
// NOT reuse StubPage itself, for two reasons — StubPage opens with a
// "Preview · stub page" banner (this is a finished, live page reading live
// data) and it closes with a "Metered in tokens" line (Predicts is free at
// launch, §10, and must carry no metering copy at all).
//
// Content width is max-w-5xl rather than StubPage's max-w-3xl because this page
// renders a card grid, not a column of prose; the masthead/footer structure is
// unchanged.

const INTRO =
  "Faraday turns the Signals it reads every day into specific, dated forecasts — each with a probability, a resolves-by date and a named Sector. When the date arrives, Faraday grades itself in public.";

export const metadata = {
  title: "Faraday Predicts — Calls you can hold us to",
  description: INTRO,
};

/** The forecast API base.
 *
 *  ⚠️ The spec names `VITE_PREDICTS_API_URL`, which was written for the retired
 *  Vite brand repo. This app is Next.js, where ONLY `NEXT_PUBLIC_*` is inlined
 *  into the browser bundle — a `VITE_`-prefixed variable read from client code
 *  is always `undefined`. So it is read HERE, in a server component, and passed
 *  to the client component as a prop. That honours the configured name and
 *  works. `NEXT_PUBLIC_PREDICTS_API_URL` is accepted as an alias for anyone who
 *  sets the idiomatic name instead.
 *
 *  The fallback is the live function URL, not a placeholder: this endpoint is
 *  anonymous and public (verify_jwt=false), so there is no secret in it, and a
 *  missing env var should not blank the page. */
const PREDICTS_API_URL =
  process.env.VITE_PREDICTS_API_URL ||
  process.env.NEXT_PUBLIC_PREDICTS_API_URL ||
  "https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/predicts-public";

export default function Page() {
  return (
    <div className="min-h-screen bg-warm-white text-near-black font-sans">
      <div className="h-0.5 bg-gold" />
      <header className="bg-forest">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
          <Link href="/" className="flex items-center gap-3" aria-label="Faraday home">
            <BrandMark size={20} framed />
            <span className="font-serif text-[15px] font-bold tracking-wide text-warm-white">Faraday</span>
          </Link>
          <Link href="/" className="ml-auto font-mono text-[11px] text-warm-cream hover:text-gold-light">
            ← All storefronts
          </Link>
        </div>
      </header>
      <div className="h-0.5 bg-gold" />

      <main className="mx-auto max-w-5xl px-5 py-12">
        {/* ── Hero ────────────────────────────────────────────────────── */}
        <h1 className="font-display text-[clamp(30px,6vw,46px)] font-bold leading-tight tracking-tight text-near-black">
          Faraday Predicts
        </h1>
        <p className="mt-3 font-serif text-[clamp(17px,2.6vw,21px)] italic text-forest">Calls you can hold us to.</p>
        <div className="double-rule" aria-hidden />
        <p className="mt-4 max-w-3xl font-sans text-[15px] leading-relaxed text-near-black/75">{INTRO}</p>

        {/* useSearchParams needs a Suspense boundary; the skeleton doubles as
            the first paint while the forecasts load. */}
        <Suspense fallback={<PredictsSkeleton />}>
          <PredictsView apiUrl={PREDICTS_API_URL} />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}
