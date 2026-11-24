// FDY-420 (ADM-1.7d) — the Faraday gate's server actions for Intelligent Alert · Daily Signal.
//   POST /api/faraday-gate/intelligentalert/{code,verify,request,signout}
// Same package handler as Predicts (src/app/api/faraday-gate/[action]/route.ts, left byte-identical),
// with the app fixed server-side to "intelligentalert". The app is never read from the request, so a
// client cannot file a demo request or waitlist entry against another app. The IA GatePage posts here
// via its apiBase prop. /api/* is never redirected across hosts (src/lib/hosts.ts NEVER_REDIRECT).
import { handleGateAction } from "@/lib/faraday-gate/server/handlers.ts";
import { INTELLIGENT_ALERT_APP, gateConfig } from "@/lib/faradayGate";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }): Promise<Response> {
  const { action } = await params;
  return handleGateAction(req, action, INTELLIGENT_ALERT_APP, gateConfig());
}

export async function GET(req: Request, { params }: { params: Promise<{ action: string }> }): Promise<Response> {
  const { action } = await params;
  return handleGateAction(req, action, INTELLIGENT_ALERT_APP, gateConfig()); // answers 405
}
