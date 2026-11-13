import { Suspense } from "react";
import type { Metadata } from "next";
import { PREDICTS_API_URL } from "@/lib/predicts-api";
import { preferencesUrlFrom } from "@/lib/predicts-preferences";
import Configurator, { ConfiguratorSkeleton } from "./Configurator";

// /predicts/preferences?t=<token> — the subscriber configurator (FDY-119, 26-43-v01).
//
// The credential is the recipient token from the "Manage your preferences" link in the
// digest footer. It is read in the browser only (never rendered, logged or sent anywhere
// but the predicts-preferences function), and the page sets no-referrer so the URL is not
// passed to any other site. The API base follows FDY-147's convention: the server reads
// VITE_PREDICTS_API_URL and hands the derived endpoint down as a prop.

export const metadata: Metadata = {
  title: "Your preferences — Faraday Predicts",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PreferencesPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">
      <Suspense fallback={<ConfiguratorSkeleton />}>
        <Configurator apiUrl={preferencesUrlFrom(PREDICTS_API_URL)} />
      </Suspense>
    </main>
  );
}
