import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import "./predicts.css";
import GatePage from "@/lib/faraday-gate/ui/GatePage.tsx";
import { PREDICTS_APP, PREDICTS_APP_NAME, PREDICTS_GATE_COPY, guardPredicts } from "@/lib/faradayGate";
import { predictsGet, type ApiEnvelope } from "@/lib/predicts-api";
import { PREDICTS_MANIFEST_PATH, PWA_COPY } from "@/lib/predicts-pwa";
import PredictsShell from "./PredictsShell";
import PredictsPwa from "./PredictsPwa";

// FDY-127 (CC-PREDICTS-PWA-1.0 D1): /predicts/* links its OWN manifest, overriding the root Daily
// Challenge manifest for this subtree only, and is "capable" as a Home Screen app on iOS.
export const metadata: Metadata = {
  manifest: PREDICTS_MANIFEST_PATH,
  appleWebApp: { capable: true, title: PWA_COPY.shortName, statusBarStyle: "default" },
};

// /predicts/* shell (UI 3.0, FDY-273). The record pill, the release tag and the
// Movers tab come from one cached view=movers read (300s). That view loads the
// probability history, so its capabilities.movers is the authoritative flag
// (other views report history=false simply because they did not load it).
//
// FDY-414 (ADM-1.7): the Faraday beta access gate runs first. In mode "open" (the seeded default) it
// passes straight through and the shell below renders exactly as before. Before the estate_entitled
// migration lands the probe errors, and that also passes through unless FARADAY_GATE_ENFORCE=1
// (src/lib/faradayGate.ts). connection() keeps the gate a per-request decision: without it a build
// with no Supabase env would prerender the pass-through and freeze it.
//
// FDY-445 (CC-BRAND-MASTHEAD-1.0): both branches wear the shared Faraday masthead. GatePage (faraday-gate
// 1.1.0) renders it from the vendored src/lib/faraday-masthead; PredictsShell renders it with the email the
// gate verified (null in mode "open", which does no identity lookup, so the masthead shows "Sign in").
export default async function PredictsLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const gate = await guardPredicts({ cookieHeader: (await headers()).get("cookie") });
  if (!gate.pass) {
    return <GatePage app={PREDICTS_APP} appName={PREDICTS_APP_NAME} copy={PREDICTS_GATE_COPY} view={gate.view} email={gate.email} />;
  }
  const env = await predictsGet<ApiEnvelope>("view=movers");
  return (
    <PredictsShell record={env?.record ?? null} releaseTag={env?.release_tag ?? null} showMovers={env?.capabilities?.movers ?? false} email={gate.email}>
      <PredictsPwa />
      {children}
    </PredictsShell>
  );
}
