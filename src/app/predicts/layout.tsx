import type { Metadata } from "next";
import "./predicts.css";
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
export default async function PredictsLayout({ children }: { children: React.ReactNode }) {
  const env = await predictsGet<ApiEnvelope>("view=movers");
  return (
    <PredictsShell record={env?.record ?? null} releaseTag={env?.release_tag ?? null} showMovers={env?.capabilities?.movers ?? false}>
      <PredictsPwa />
      {children}
    </PredictsShell>
  );
}
