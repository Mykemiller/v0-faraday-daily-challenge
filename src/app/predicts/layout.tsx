import "./predicts.css";
import { predictsGet, type ApiEnvelope } from "@/lib/predicts-api";
import PredictsShell from "./PredictsShell";

// /predicts/* shell (UI 3.0, FDY-273). The record pill, the release tag and the
// Movers tab come from one cached view=movers read (300s). That view loads the
// probability history, so its capabilities.movers is the authoritative flag
// (other views report history=false simply because they did not load it).
export default async function PredictsLayout({ children }: { children: React.ReactNode }) {
  const env = await predictsGet<ApiEnvelope>("view=movers");
  return (
    <PredictsShell record={env?.record ?? null} releaseTag={env?.release_tag ?? null} showMovers={env?.capabilities?.movers ?? false}>
      {children}
    </PredictsShell>
  );
}
