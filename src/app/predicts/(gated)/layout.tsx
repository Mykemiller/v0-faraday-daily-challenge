import { headers } from "next/headers";
import { connection } from "next/server";
import GatePage from "@/lib/faraday-gate/ui/GatePage.tsx";
import { PREDICTS_APP, PREDICTS_APP_NAME, PREDICTS_GATE_COPY, guardPredicts } from "@/lib/faradayGate";
import PredictsFrame from "../PredictsFrame";

// FDY-414 (ADM-1.7) + FDY-433 (ADM-1.7h): the Faraday beta access gate for the gated Predicts pages.
// Everything under /predicts except /predicts/preferences lives in this route group (URLs unchanged).
// In mode "open" (the seeded default) the gate passes straight through and the shell renders exactly
// as before. Before the estate_entitled migration answered, the probe errored, and that also passes
// through unless FARADAY_GATE_ENFORCE=1 (src/lib/faradayGate.ts). connection() keeps the gate a
// per-request decision: without it a build with no Supabase env would prerender the pass-through
// and freeze it. Denied visitors see the standard GatePage instead of the shell.
// FDY-460: faraday-gate 1.2.0 takes homeHref, so the gate's mark + wordmark go to /predicts.
export default async function PredictsGatedLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const gate = await guardPredicts({ cookieHeader: (await headers()).get("cookie") });
  if (!gate.pass) {
    return <GatePage app={PREDICTS_APP} appName={PREDICTS_APP_NAME} homeHref="/predicts" copy={PREDICTS_GATE_COPY} view={gate.view} email={gate.email} />;
  }
  return <PredictsFrame email={gate.email}>{children}</PredictsFrame>;
}
