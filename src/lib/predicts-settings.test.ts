// FDY-297 (ADM-2.4) — the Predicts PWA kill switch read as data, env as the fallback. Run: npm run test:predicts-settings.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createResolver } from "./config/resolver.ts";
import { PREDICTS_SETTING_SPECS, predictsPwaEnabled } from "./predicts-settings.ts";

const URL = "https://ycadmmngkdhvpcsrcuaq.supabase.co";
const row = (value: unknown, source = "setting") =>
  ({ app_code: "FP", scope: "default", key: "predicts_pwa_enabled", value, source, is_default: source === "default" });
const resolverWith = (rows: unknown, ok = true) =>
  createResolver({ url: URL, key: "test-key", client: async () => ({ ok, json: async () => rows }) });
const withEnv = async (v: string | undefined, f: () => Promise<void>) => {
  const saved = process.env.NEXT_PUBLIC_PREDICTS_PWA;
  const warn = console.warn;
  console.warn = () => {};
  if (v === undefined) delete process.env.NEXT_PUBLIC_PREDICTS_PWA; else process.env.NEXT_PUBLIC_PREDICTS_PWA = v;
  try { await f(); } finally {
    console.warn = warn;
    if (saved === undefined) delete process.env.NEXT_PUBLIC_PREDICTS_PWA; else process.env.NEXT_PUBLIC_PREDICTS_PWA = saved;
  }
};

test("is the FP setting predicts_pwa_enabled", () => {
  assert.equal(PREDICTS_SETTING_SPECS.pwaEnabled.key, "predicts_pwa_enabled");
});

test("a console value wins over the env", async () => {
  await withEnv(undefined, async () => assert.equal(await predictsPwaEnabled(resolverWith([row(false)])), false));
  await withEnv("off", async () => assert.equal(await predictsPwaEnabled(resolverWith([row(true)])), true));
});

test("read failure → the env value (on unless exactly \"off\")", async () => {
  await withEnv(undefined, async () => assert.equal(await predictsPwaEnabled(resolverWith([], false)), true));
  await withEnv("off", async () => assert.equal(await predictsPwaEnabled(resolverWith([], false)), false));
});

test("a definition default or a wrong-typed value defers to the env", async () => {
  await withEnv("off", async () => {
    assert.equal(await predictsPwaEnabled(resolverWith([row(true, "default")])), false);
    assert.equal(await predictsPwaEnabled(resolverWith([row("on")])), false);
  });
});

test("the layout reads the switch on the server and hands it to the client shell as a prop", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const layout = fs.readFileSync(path.join(dir, "../app/predicts/layout.tsx"), "utf8");
  const pwa = fs.readFileSync(path.join(dir, "../app/predicts/PredictsPwa.tsx"), "utf8");
  assert.match(layout, /await predictsPwaEnabled\(\)/);
  assert.match(layout, /<PredictsPwa disabled=\{!pwaEnabled\} \/>/);
  assert.ok(!/predicts-settings|config\/resolver/.test(pwa), "the client component never imports the server resolver");
});
