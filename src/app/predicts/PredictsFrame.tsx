import { predictsGet, type ApiEnvelope } from "@/lib/predicts-api";
import { predictsPwaEnabled } from "@/lib/predicts-settings";
import PredictsShell from "./PredictsShell";
import PredictsPwa from "./PredictsPwa";

// /predicts/* shell (UI 3.0, FDY-273), shared by the (gated) and (open) route groups (FDY-433).
// The record pill, the release tag and the Movers tab come from one cached view=movers read (300s).
// That view loads the probability history, so its capabilities.movers is the authoritative flag
// (other views report history=false simply because they did not load it).
//
// FDY-445 (CC-BRAND-MASTHEAD-1.0): PredictsShell renders the shared Faraday masthead with the email the
// gate verified (null in mode "open", which does no identity lookup, and always null on the open
// group, so the masthead shows "Sign in").
export default async function PredictsFrame({ email, children }: { email: string | null; children: React.ReactNode }) {
  const env = await predictsGet<ApiEnvelope>("view=movers");
  // FDY-297: the PWA kill switch is data (app FP, predicts_pwa_enabled); NEXT_PUBLIC_PREDICTS_PWA is the fallback.
  const pwaEnabled = await predictsPwaEnabled();
  return (
    <PredictsShell record={env?.record ?? null} releaseTag={env?.release_tag ?? null} showMovers={env?.capabilities?.movers ?? false} email={email}>
      <PredictsPwa disabled={!pwaEnabled} />
      {children}
    </PredictsShell>
  );
}
