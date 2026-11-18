// FDY-414 (ADM-1.7) — the Predicts wiring of the Faraday beta access gate.
// Run: npm run test:faraday-gate. No network: every fetch is injected.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PREDICTS_APP, PREDICTS_GATE_COPY, applyEnforcePolicy, gateConfig, gateEnforced, guardPredicts,
} from "./faradayGate.ts";
import { clearGateCache, type GateServerConfig } from "./faraday-gate/server/check.ts";
import { containsCountClaim, containsPrice, type Entitlement } from "./faraday-gate/core.ts";
import type { GuardResult } from "./faraday-gate/server/guard.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.join(HERE, "faraday-gate");
const URL_ = "https://ycadmmngkdhvpcsrcuaq.supabase.co";

function fakeFetch(handler: (url: string, body: Record<string, unknown> | null) => unknown) {
  const calls: { url: string; body: Record<string, unknown> | null }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    const out = handler(url, body);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const cfg = (f: typeof fetch): GateServerConfig => ({ supabaseUrl: URL_, serviceKey: "svc", anonKey: "anon", fetchImpl: f });
const missingRpc = () => new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function" }), { status: 404 });

// ── config + flag ──────────────────────────────────────────────────────────────────────────────
test("gateConfig reads the app's existing env names", () => {
  const c = gateConfig({ SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: "svc", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
  assert.deepEqual(c, { supabaseUrl: URL_, serviceKey: "svc", anonKey: "anon" });
  assert.deepEqual(gateConfig({}), { supabaseUrl: "", serviceKey: "", anonKey: undefined });
});

test("FARADAY_GATE_ENFORCE is on only for the exact string \"1\"", () => {
  assert.equal(gateEnforced({ FARADAY_GATE_ENFORCE: "1" }), true);
  for (const v of [undefined, "", "0", "true", "yes", " 1"]) assert.equal(gateEnforced({ FARADAY_GATE_ENFORCE: v }), false, String(v));
});

// ── policy ─────────────────────────────────────────────────────────────────────────────────────
const ent = (e: Partial<Entitlement>): Entitlement => ({ allowed: false, reason: "error", mode: null, role: null, grant_kind: null, expires_at: null, ...e });
const res = (e: Entitlement, view: GuardResult["view"], pass = false): GuardResult => ({ pass, entitlement: e, view, email: null, identitySource: "none" });

test("probe error passes through when enforce is off, closes when on", () => {
  const g = res(ent({ reason: "error" }), "unavailable");
  const soft = applyEnforcePolicy(g, false);
  assert.equal(soft.pass, true); assert.equal(soft.view, "pass"); assert.equal(soft.failOpen, true);
  const hard = applyEnforcePolicy(g, true);
  assert.equal(hard.pass, false); assert.equal(hard.view, "unavailable"); assert.equal(hard.failOpen, false);
});

test("real denials are never softened, enforce or not", () => {
  for (const [reason, view] of [["no_grant", "request"], ["expired", "expired"], ["waitlist_mode", "waitlist"], ["unknown_app", "unavailable"], ["revoked", "request"]] as const) {
    for (const enforce of [false, true]) {
      const out = applyEnforcePolicy(res(ent({ reason, mode: "invite" }), view), enforce);
      assert.equal(out.pass, false, `${reason}/${enforce}`); assert.equal(out.failOpen, false);
    }
  }
});

test("a pass stays a pass and is not flagged fail-open", () => {
  const out = applyEnforcePolicy(res(ent({ allowed: true, reason: "open", mode: "open" }), "pass", true), true);
  assert.equal(out.pass, true); assert.equal(out.failOpen, false);
});

// ── end to end through the vendored guard (injected fetch) ─────────────────────────────────────
test("open mode: one probe for app 'predicts', no identity lookup, pass", async () => {
  clearGateCache();
  const { f, calls } = fakeFetch(() => ({ allowed: true, reason: "open", mode: "open" }));
  const g = await guardPredicts({ cookieHeader: "fgate_at=tok" }, { cfg: cfg(f), enforce: true });
  assert.equal(g.pass, true); assert.equal(g.failOpen, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/estate_entitled$/);
  assert.deepEqual(calls[0].body, { p_email: null, p_app: PREDICTS_APP });
});

test("RPC missing (pre-migration) → pass through by default", async () => {
  clearGateCache();
  const { f } = fakeFetch(missingRpc);
  const g = await guardPredicts({ cookieHeader: null }, { cfg: cfg(f), enforce: false });
  assert.equal(g.pass, true); assert.equal(g.failOpen, true); assert.equal(g.entitlement.reason, "error");
});

test("RPC missing with FARADAY_GATE_ENFORCE=1 → closed (unavailable)", async () => {
  clearGateCache();
  const { f } = fakeFetch(missingRpc);
  const g = await guardPredicts({ cookieHeader: null }, { cfg: cfg(f), enforce: true });
  assert.equal(g.pass, false); assert.equal(g.view, "unavailable");
});

test("no Supabase env at all → error → pass through unless enforced", async () => {
  clearGateCache();
  const empty: GateServerConfig = { supabaseUrl: "", serviceKey: "" };
  assert.equal((await guardPredicts({}, { cfg: empty, enforce: false })).pass, true);
  assert.equal((await guardPredicts({}, { cfg: empty, enforce: true })).pass, false);
});

test("invite mode, signed out → request view (gate shown)", async () => {
  clearGateCache();
  const { f } = fakeFetch(() => ({ allowed: false, reason: "no_grant", mode: "invite" }));
  const g = await guardPredicts({ cookieHeader: null }, { cfg: cfg(f), enforce: false });
  assert.equal(g.pass, false); assert.equal(g.view, "request");
});

test("invite mode, gate cookie with a grant → pass, identity from the gate", async () => {
  clearGateCache();
  const { f } = fakeFetch((url, body) => {
    if (url.endsWith("/auth/v1/user")) return { email: "Reader@Example.com" };
    return body?.p_email ? { allowed: true, reason: "grant", mode: "invite", grant_kind: "demo" } : { allowed: false, reason: "no_grant", mode: "invite" };
  });
  const g = await guardPredicts({ cookieHeader: "other=1; fgate_at=tok" }, { cfg: cfg(f), enforce: true });
  assert.equal(g.pass, true); assert.equal(g.email, "reader@example.com"); assert.equal(g.identitySource, "gate");
});

test("a guard that throws is treated as a probe error (never a crash)", async () => {
  const boom = (async () => { throw new Error("boom"); }) as never;
  assert.equal((await guardPredicts({}, { cfg: gateConfig({}), enforce: false, guard: boom })).pass, true);
  const closed = await guardPredicts({}, { cfg: gateConfig({}), enforce: true, guard: boom });
  assert.equal(closed.pass, false); assert.equal(closed.view, "unavailable");
});

// ── gate copy ──────────────────────────────────────────────────────────────────────────────────
test("Predicts gate copy: right key, no price, no counts, still draft (Myke approves)", () => {
  assert.equal(PREDICTS_GATE_COPY.access_key, "predicts");
  const all = [PREDICTS_GATE_COPY.story, ...PREDICTS_GATE_COPY.what_you_get].join("\n");
  assert.equal(containsPrice(all), false); assert.equal(containsCountClaim(all), false);
  assert.ok(PREDICTS_GATE_COPY.status === "draft" || PREDICTS_GATE_COPY.status === "approved");
});

// ── vendored copy is byte-identical to its manifest (and to the canonical package when present) ─
function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join("/")];
  });
}
const sha = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const manifest = fs.readFileSync(path.join(VENDOR, "MANIFEST.sha256"), "utf8").trim().split("\n").map((l) => {
  const m = l.match(/^([0-9a-f]{64})  (.+)$/);
  assert.ok(m, `bad manifest line: ${l}`);
  return { hash: m[1], file: m[2] };
});

test("vendored faraday-gate matches MANIFEST.sha256 exactly (no edits, no extra or missing files)", () => {
  const onDisk = listFiles(VENDOR).filter((f) => f !== "MANIFEST.sha256").sort();
  assert.deepEqual(onDisk, manifest.map((m) => m.file).sort());
  for (const m of manifest) assert.equal(sha(path.join(VENDOR, m.file)), m.hash, `${m.file} drifted from the manifest`);
  for (const required of ["core.ts", "VERSION", "README.md", "server/check.ts", "server/guard.ts", "server/handlers.ts",
    "server/identity.ts", "server/request.ts", "ui/GatePage.tsx", "ui/gate.html", "gate-copy/predicts.json"]) {
    assert.ok(manifest.some((m) => m.file === required), `${required} missing from the vendored copy`);
  }
  assert.match(fs.readFileSync(path.join(VENDOR, "VERSION"), "utf8").trim(), /^\d+\.\d+\.\d+$/);
});

const CANONICAL = process.env.FARADAY_GATE_CANONICAL || path.resolve(HERE, "../../../faraday-workbench/packages/faraday-gate");
test("vendored files are byte-identical to the canonical package", { skip: !fs.existsSync(path.join(CANONICAL, "core.ts")) && "canonical package not on disk (set FARADAY_GATE_CANONICAL)" }, () => {
  assert.equal(fs.readFileSync(path.join(CANONICAL, "VERSION"), "utf8"), fs.readFileSync(path.join(VENDOR, "VERSION"), "utf8"), "VERSION differs: re-vendor");
  for (const m of manifest) assert.equal(sha(path.join(CANONICAL, m.file)), m.hash, `${m.file} differs from canonical: re-vendor`);
});
