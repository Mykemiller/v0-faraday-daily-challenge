// FDY-420 (ADM-1.7d) — the Intelligent Alert wiring of the Faraday beta access gate.
// Run: npm run test:faraday-gate. No network: the gate's fetch is injected.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INTELLIGENT_ALERT_APP, INTELLIGENT_ALERT_GATE_API, INTELLIGENT_ALERT_GATE_COPY, PREDICTS_APP, guardIntelligentAlert, guardPredicts,
} from "./faradayGate.ts";
import { clearGateCache, type GateServerConfig } from "./faraday-gate/server/check.ts";
import { containsPrice } from "./faraday-gate/core.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..", "app");
const read = (p: string) => fs.readFileSync(path.join(APP, p), "utf8");
const URL_ = "https://ycadmmngkdhvpcsrcuaq.supabase.co";

function recording(answer: Record<string, unknown>) {
  const apps: string[] = [];
  const f = (async (_url: string, init: RequestInit = {}) => {
    apps.push(String(JSON.parse(String(init.body)).p_app));
    return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  const cfg: GateServerConfig = { supabaseUrl: URL_, serviceKey: "svc", anonKey: "anon", fetchImpl: f };
  return { cfg, apps };
}

test("the IA guard asks estate_entitled about 'intelligentalert', and Predicts still asks about 'predicts'", async () => {
  clearGateCache();
  const ia = recording({ allowed: true, reason: "open", mode: "open" });
  await guardIntelligentAlert({ cookieHeader: null }, { cfg: ia.cfg, enforce: false });
  assert.deepEqual(ia.apps, [INTELLIGENT_ALERT_APP]);
  clearGateCache();
  const fp = recording({ allowed: true, reason: "open", mode: "open" });
  await guardPredicts({ cookieHeader: null }, { cfg: fp.cfg, enforce: false });
  assert.deepEqual(fp.apps, [PREDICTS_APP]);
});

test("mode open passes through; invite turns a stranger away; a probe error follows FARADAY_GATE_ENFORCE", async () => {
  clearGateCache();
  assert.equal((await guardIntelligentAlert({}, { cfg: recording({ allowed: true, reason: "open", mode: "open" }).cfg, enforce: true })).pass, true);
  clearGateCache();
  const denied = await guardIntelligentAlert({}, { cfg: recording({ allowed: false, reason: "no_grant", mode: "invite" }).cfg, enforce: false });
  assert.equal(denied.pass, false); assert.equal(denied.view, "request");
  clearGateCache();
  const down = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
  const soft = await guardIntelligentAlert({}, { cfg: { supabaseUrl: URL_, serviceKey: "svc", fetchImpl: down }, enforce: false });
  assert.equal(soft.pass, true); assert.equal(soft.failOpen, true);
  clearGateCache();
  const hard = await guardIntelligentAlert({}, { cfg: { supabaseUrl: URL_, serviceKey: "svc", fetchImpl: down }, enforce: true });
  assert.equal(hard.pass, false); assert.equal(hard.view, "unavailable");
});

test("IA gate copy is the canonical intelligentalert copy and carries no price", () => {
  assert.equal(INTELLIGENT_ALERT_GATE_COPY.access_key, INTELLIGENT_ALERT_APP);
  assert.equal(containsPrice(JSON.stringify(INTELLIGENT_ALERT_GATE_COPY)), false);
});

test("the IA route fixes the app server-side; the Predicts route is untouched", () => {
  const ia = read("api/faraday-gate/intelligentalert/[action]/route.ts");
  assert.match(ia, /handleGateAction\(req, action, INTELLIGENT_ALERT_APP, gateConfig\(\)\)/);
  assert.doesNotMatch(ia, /searchParams|body\.app|params\.app/);
  assert.match(read("api/faraday-gate/[action]/route.ts"), /handleGateAction\(req, action, PREDICTS_APP, gateConfig\(\)\)/);
  assert.equal(INTELLIGENT_ALERT_GATE_API, "/api/faraday-gate/intelligentalert");
});

test("only /intelligent-alert gained a gate: its layout guards, and points GatePage at its own route", () => {
  const layout = read("intelligent-alert/layout.tsx");
  assert.match(layout, /guardIntelligentAlert\(/);
  assert.match(layout, /apiBase=\{INTELLIGENT_ALERT_GATE_API\}/);
  assert.match(layout, /await connection\(\)/);
  for (const untouched of ["challenge", "league-office"]) {
    const dir = path.join(APP, untouched);
    if (!fs.existsSync(dir)) continue;
    const layoutFile = path.join(dir, "layout.tsx");
    if (fs.existsSync(layoutFile)) assert.doesNotMatch(fs.readFileSync(layoutFile, "utf8"), /guardIntelligentAlert|guardApp\(/, untouched);
  }
});
