// faraday-gate · server/guard.ts (FDY-414). SERVER ONLY. The "wrap a route group" helper.
// Usage in a Next.js server layout:
//   const g = await guardRoute({ app: "jw", appEmail, cookieHeader }, cfg);
//   if (!g.pass) return <GatePage {...g.props} />;
//   return children;
// Mode open → pass through without resolving identity (no sign-in needed, no extra auth call).
import { gateView, type Entitlement, type GateView } from "../core.ts";
import { appMode, checkAccess, type GateServerConfig } from "./check.ts";
import { readCookie, resolveIdentity } from "./identity.ts";

export interface GuardResult {
  pass: boolean;
  entitlement: Entitlement;
  view: GateView;
  email: string | null;
  identitySource: "app" | "gate" | "none";
}

export async function guardRoute(
  opts: { app: string; appEmail?: string | null; cookieHeader?: string | null },
  cfg: GateServerConfig,
): Promise<GuardResult> {
  const probe = await appMode(opts.app, cfg);
  if (probe.allowed && probe.reason === "open") {
    return { pass: true, entitlement: probe, view: "pass", email: null, identitySource: "none" };
  }
  const id = await resolveIdentity({ appEmail: opts.appEmail, gateToken: readCookie(opts.cookieHeader) }, cfg);
  const ent = id.email ? await checkAccess({ email: id.email, app: opts.app }, cfg) : probe;
  const view = gateView(ent, Boolean(id.email));
  return { pass: view === "pass", entitlement: ent, view, email: id.email, identitySource: id.source };
}
