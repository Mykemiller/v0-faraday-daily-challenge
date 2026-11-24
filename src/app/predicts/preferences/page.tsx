import { Suspense } from "react";
import type { Metadata } from "next";
import { PREDICTS_API_URL } from "@/lib/predicts-api";
import { preferencesUrlFrom } from "@/lib/predicts-preferences";
import { pushSubscribeUrlFrom } from "@/lib/predicts-pwa";
import Configurator, { ConfiguratorSkeleton } from "./Configurator";

// /predicts/preferences?t=<token> — the subscriber configurator (FDY-119, 26-43-v01).
//
// The credential is the recipient token from the "Manage your preferences" link in the
// digest footer. It is read in the browser only (never rendered, logged or sent anywhere
// but the predicts-preferences function — and, from FDY-127, predicts-push-subscribe when the
// subscriber switches on Flash alerts; an installed app keeps it on the device, see
// hooks/usePredictsToken.ts), and the page sets no-referrer so the URL is not
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
        {/* FDY-127: the push toggle ships dark until Myke sets NEXT_PUBLIC_PREDICTS_VAPID_PUBLIC_KEY (public by design). */}
        <Configurator
          apiUrl={preferencesUrlFrom(PREDICTS_API_URL)}
          pushUrl={pushSubscribeUrlFrom(PREDICTS_API_URL)}
          vapidKey={process.env.NEXT_PUBLIC_PREDICTS_VAPID_PUBLIC_KEY ?? null}
        />
      </Suspense>
    </main>
  );
}
