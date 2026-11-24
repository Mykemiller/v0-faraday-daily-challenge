import { headers } from "next/headers";
import { connection } from "next/server";
import GatePage from "@/lib/faraday-gate/ui/GatePage.tsx";
import {
  INTELLIGENT_ALERT_APP, INTELLIGENT_ALERT_APP_NAME, INTELLIGENT_ALERT_GATE_API, INTELLIGENT_ALERT_GATE_COPY, guardIntelligentAlert,
} from "@/lib/faradayGate";

// FDY-420 (ADM-1.7d): the Faraday beta access gate in front of Intelligent Alert · Daily Signal.
// Seeded mode "open": the gate passes straight through and the page renders exactly as before.
// A probe error also passes through unless FARADAY_GATE_ENFORCE=1 (src/lib/faradayGate.ts). connection()
// keeps the gate a per-request decision. Denied visitors see the standard GatePage, whose actions post to
// /api/faraday-gate/intelligentalert (the app is fixed server-side there). Touches /intelligent-alert only.
export default async function IntelligentAlertLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const gate = await guardIntelligentAlert({ cookieHeader: (await headers()).get("cookie") });
  if (!gate.pass) {
    return (
      <GatePage
        app={INTELLIGENT_ALERT_APP}
        appName={INTELLIGENT_ALERT_APP_NAME}
        copy={INTELLIGENT_ALERT_GATE_COPY}
        view={gate.view}
        email={gate.email}
        apiBase={INTELLIGENT_ALERT_GATE_API}
      />
    );
  }
  return children;
}
