// FDY-414 (ADM-1.7) — the Faraday gate's server actions for Faraday Predicts.
//   POST /api/faraday-gate/code     { email }                  email a one-time code
//   POST /api/faraday-gate/verify   { email, code }            verify it; sets the httpOnly fgate_at cookie
//   POST /api/faraday-gate/request  { email, kind, message? }  Request demo access / Join the waitlist
//   POST /api/faraday-gate/signout                             clears the cookie
// All logic is the vendored package (src/lib/faraday-gate/server/handlers.ts): same-origin only,
// POST only, 5 requests per IP per hour. This app gates only Predicts, so the app is fixed to
// "predicts" here. /api/* is never redirected across hosts (src/lib/hosts.ts NEVER_REDIRECT).
import { handleGateAction } from "@/lib/faraday-gate/server/handlers.ts";
import { PREDICTS_APP, gateConfig } from "@/lib/faradayGate";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }): Promise<Response> {
  const { action } = await params;
  return handleGateAction(req, action, PREDICTS_APP, gateConfig());
}

export async function GET(req: Request, { params }: { params: Promise<{ action: string }> }): Promise<Response> {
  const { action } = await params;
  return handleGateAction(req, action, PREDICTS_APP, gateConfig()); // answers 405
}
