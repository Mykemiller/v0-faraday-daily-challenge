// FDY-414 (ADM-1.7) — the Faraday beta access gate, wired for Faraday Predicts.
//
// The gate itself is the vendored package in ./faraday-gate/ (byte-identical to
// Mykemiller/faraday-workbench/packages/faraday-gate; never edit it here — see its README and
// MANIFEST.sha256). This file is the app-side wrapper: config from this app's existing env names,
// the enforce flag, and the one policy the package deliberately does not make for us.
//
// THE POLICY: before the estate_entitled migration lands, the RPC does not exist, so every probe
// answers { allowed:false, reason:"error" } and the package would show "unavailable". That must not
// close Predicts. So an "error" answer PASSES THROUGH unless FARADAY_GATE_ENFORCE === "1", in which
// case it fails closed (the package's own behaviour). Only "error" is softened: a real denial
// (no_grant, expired, waitlist_mode, …) and "unknown_app" are always honoured.
//
// Pure apart from the injected guard: no next/* imports, so `node --test` can load it directly.

import { guardRoute, type GuardResult } from "./faraday-gate/server/guard.ts";
import type { GateServerConfig } from "./faraday-gate/server/check.ts";
import type { GateCopy } from "./faraday-gate/core.ts";
import predictsCopy from "./faraday-gate/gate-copy/predicts.json" with { type: "json" };

/** estate_entitled access_key for Predicts (app code FP). Daily Challenge is never gated. */
export const PREDICTS_APP = "predicts";
export const PREDICTS_APP_NAME = "Faraday Predicts";
export const PREDICTS_GATE_COPY = predictsCopy as GateCopy;

type Env = Record<string, string | undefined>;

/**
 * Gate config from env names this app already uses (no new secret):
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-only) for the check, and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY (publishable) for the gate's own email one-time code.
 */
export function gateConfig(env: Env = process.env): GateServerConfig {
  return {
    supabaseUrl: env.SUPABASE_URL ?? "",
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
  };
}

/** FARADAY_GATE_ENFORCE === "1" turns a probe error into a closed gate. Anything else: pass through. */
export function gateEnforced(env: Env = process.env): boolean {
  return env.FARADAY_GATE_ENFORCE === "1";
}

export interface PredictsGuardResult extends GuardResult {
  /** True when the gate could not get an answer and let the visitor through (enforce off). */
  failOpen: boolean;
}

/** Apply the enforce policy to a package GuardResult. */
export function applyEnforcePolicy(g: GuardResult, enforce: boolean): PredictsGuardResult {
  if (!g.pass && g.entitlement.reason === "error" && !enforce) {
    return { ...g, pass: true, view: "pass", failOpen: true };
  }
  return { ...g, failOpen: false };
}

export interface GuardDeps {
  cfg?: GateServerConfig;
  enforce?: boolean;
  guard?: typeof guardRoute;
}

/**
 * Guard the Predicts route group. `cookieHeader` is the raw Cookie header (the gate reads its own
 * httpOnly fgate_at cookie from it). `appEmail` stays null in v1: Predicts has no server-visible
 * verified email (its ?t= link token lives in the browser), so identity is the gate's own code.
 * Never throws: an unexpected exception is treated as a probe error and the same policy applies.
 */
export async function guardPredicts(
  opts: { cookieHeader?: string | null; appEmail?: string | null },
  deps: GuardDeps = {},
): Promise<PredictsGuardResult> {
  const cfg = deps.cfg ?? gateConfig();
  const enforce = deps.enforce ?? gateEnforced();
  const guard = deps.guard ?? guardRoute;
  let g: GuardResult;
  try {
    g = await guard({ app: PREDICTS_APP, appEmail: opts.appEmail ?? null, cookieHeader: opts.cookieHeader ?? null }, cfg);
  } catch {
    g = {
      pass: false,
      view: "unavailable",
      email: null,
      identitySource: "none",
      entitlement: { allowed: false, reason: "error", mode: null, role: null, grant_kind: null, expires_at: null },
    };
  }
  return applyEnforcePolicy(g, enforce);
}
