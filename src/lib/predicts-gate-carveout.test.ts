// FDY-433 (ADM-1.7h) — the Predicts carve-out: /predicts/preferences stays outside the Faraday beta
// access gate in every mode; every other Predicts page sits behind it. Run: npm run test:faraday-gate.
// No network: the gate's fetch is injected. The end-to-end version of the same check (real `next start`
// against a mock estate_entitled) is scripts/faraday-gate-carveout-smoke.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { guardPredicts } from "./faradayGate.ts";
import { clearGateCache, type GateServerConfig } from "./faraday-gate/server/check.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PREDICTS = path.join(HERE, "..", "app", "predicts");
const rel = (p: string) => path.relative(PREDICTS, p).split(path.sep).join("/");
const read = (p: string) => fs.readFileSync(path.join(PREDICTS, p), "utf8");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}
const pages = walk(PREDICTS).filter((p) => /(^|\/)page\.tsx$/.test(rel(p))).map(rel).sort();
const GATE_IMPORT = /@\/lib\/faradayGate|faraday-gate\//;

// ── route layout (structure is what keeps the URLs public or gated) ───────────────────────────────
test("every Predicts page except preferences is inside the (gated) route group", () => {
  assert.ok(pages.length >= 8, `found ${pages.length} pages`);
  for (const p of pages) {
    if (p === "(open)/preferences/page.tsx") continue;
    assert.ok(p.startsWith("(gated)/"), `${p} must live under app/predicts/(gated)/`);
  }
});

test("/predicts/preferences is the only page in the (open) route group", () => {
  assert.deepEqual(pages.filter((p) => p.startsWith("(open)/")), ["(open)/preferences/page.tsx"]);
  assert.ok(!pages.some((p) => /^(?!\(open\)\/).*preferences\//.test(p)), "no second preferences route");
});

test("URLs are unchanged: stripping the route groups gives the same paths as before", () => {
  const urls = pages.map((p) => "/predicts/" + p.replace(/\((gated|open)\)\//, "").replace(/\/?page\.tsx$/, "")).map((u) => u.replace(/\/$/, ""));
  for (const u of ["/predicts", "/predicts/preferences", "/predicts/[id]", "/predicts/receipts", "/predicts/record", "/predicts/movers", "/predicts/following", "/predicts/company/[slug]"]) {
    assert.ok(urls.includes(u), `${u} still resolves`);
  }
});

test("only the (gated) layout runs the gate; the root and (open) trees never import it", () => {
  const gated = read("(gated)/layout.tsx");
  assert.match(gated, /guardPredicts\(/);
  assert.match(gated, /<GatePage /);
  assert.match(gated, /await connection\(\)/, "gate stays a per-request decision");
  assert.doesNotMatch(read("layout.tsx"), GATE_IMPORT, "the /predicts root layout must not gate");
  for (const f of walk(path.join(PREDICTS, "(open)"))) {
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), GATE_IMPORT, `${rel(f)} must not import the gate`);
  }
  assert.doesNotMatch(read("PredictsFrame.tsx"), GATE_IMPORT);
});

test("root layout keeps the Predicts manifest and CSS for both groups", () => {
  const root = read("layout.tsx");
  assert.match(root, /manifest: PREDICTS_MANIFEST_PATH/);
  assert.match(root, /import "\.\/predicts\.css"/);
});

// ── behaviour of the gate the (gated) layout calls ────────────────────────────────────────────────
const URL_ = "https://ycadmmngkdhvpcsrcuaq.supabase.co";
function cfgFor(answer: Record<string, unknown>): GateServerConfig {
  const f = (async () => new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  return { supabaseUrl: URL_, serviceKey: "svc", anonKey: "anon", fetchImpl: f };
}

test("mode invite + FARADAY_GATE_ENFORCE=1: a stranger on a gated page gets the gate", async () => {
  clearGateCache();
  const g = await guardPredicts({ cookieHeader: null }, { cfg: cfgFor({ allowed: false, reason: "no_grant", mode: "invite" }), enforce: true });
  assert.equal(g.pass, false);
  assert.equal(g.view, "request");
});

test("mode invite + enforce: a probe error closes the gated pages", async () => {
  clearGateCache();
  const down = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
  const g = await guardPredicts({ cookieHeader: null }, { cfg: { supabaseUrl: URL_, serviceKey: "svc", fetchImpl: down }, enforce: true });
  assert.equal(g.pass, false);
  assert.equal(g.view, "unavailable");
});

test("mode open: the gated pages pass straight through, exactly as before", async () => {
  clearGateCache();
  const g = await guardPredicts({ cookieHeader: null }, { cfg: cfgFor({ allowed: true, reason: "open", mode: "open" }), enforce: true });
  assert.equal(g.pass, true);
  assert.equal(g.email, null);
});
