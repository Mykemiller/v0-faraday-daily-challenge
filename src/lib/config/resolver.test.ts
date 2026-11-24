// FDY-297 (ADM-2.4) — the settings resolver and its fail-closed env fallback. No network: the client is injected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CACHE_MS, createResolver, resolveSettings, type Client, type ConfigRow } from "./resolver.ts";

const KEY = "sk-test-SERVICE-ROLE-NEVER-LOGGED";
const URL = "https://ycadmmngkdhvpcsrcuaq.supabase.co";

function row(key: string, value: unknown, source: ConfigRow["source"] = "setting"): ConfigRow {
  return { app_code: "ZZ", scope: "default", key, type: typeof value, enforcement_status: "enforced", value, source, is_default: source === "default", default_value: value };
}
function clientOf(rows: unknown, calls: string[] = [], ok = true): Client {
  return async (url) => { calls.push(url); return { ok, json: async () => rows }; };
}
const specs = {
  on: { key: "zz_on", type: "boolean" as const, env: () => false },
  cap: { key: "zz_cap", type: "integer" as const, min: 1, max: 10, env: () => 6 },
  mode: { key: "zz_mode", type: "enum" as const, options: ["thread", "roundtable"], env: () => "thread" },
};
const quiet = () => {};

test("a value set in the console is used", async () => {
  const r = createResolver({ client: clientOf([row("zz_on", true), row("zz_cap", 3, "version"), row("zz_mode", "roundtable", "inherited")]), url: URL, key: KEY });
  const got = await resolveSettings(r, "ZZ", specs, { log: quiet });
  assert.deepEqual(got.values, { on: true, cap: 3, mode: "roundtable" });
  assert.deepEqual(got.sources, { on: "data", cap: "data", mode: "data" });
  assert.equal(got.reason, null);
});

test("a definition default (nobody set a value) defers to the env value", async () => {
  const r = createResolver({ client: clientOf([row("zz_on", true, "default")]), url: URL, key: KEY });
  const got = await resolveSettings(r, "ZZ", specs, { log: quiet });
  assert.equal(got.values.on, false);
  assert.equal(got.sources.on, "env");
});

test("read failure → env fallback (HTTP error, thrown error, timeout, bad rows, no key, wrong project)", async () => {
  const cases: Array<[string, ReturnType<typeof createResolver>]> = [
    ["read_failed", createResolver({ client: clientOf([], [], false), url: URL, key: KEY })],
    ["read_failed", createResolver({ client: async () => { throw new Error(`boom ${KEY}`); }, url: URL, key: KEY })],
    ["timeout", createResolver({ client: () => new Promise(() => {}), url: URL, key: KEY, timeoutMs: 20 })],
    ["bad_response", createResolver({ client: clientOf({ not: "an array" }), url: URL, key: KEY })],
    ["bad_row", createResolver({ client: clientOf([{ ...row("zz_on", true), app_code: "XX" }]), url: URL, key: KEY })],
    ["no_service_key", createResolver({ client: clientOf([row("zz_on", true)]), url: URL, key: "" })],
    ["wrong_project", createResolver({ client: clientOf([row("zz_on", true)]), url: "https://other.supabase.co", key: KEY })],
  ];
  for (const [reason, r] of cases) {
    const got = await resolveSettings(r, "ZZ", specs, { log: quiet });
    assert.deepEqual(got.values, { on: false, cap: 6, mode: "thread" }, reason);
    assert.deepEqual(got.sources, { on: "env", cap: "env", mode: "env" }, reason);
    assert.equal(got.reason, reason);
  }
});

test("unknown key, wrong type or out-of-range value → env fallback for that setting only", async () => {
  const r = createResolver({ client: clientOf([row("zz_on", "yes"), row("zz_cap", 99), row("zz_mode", "roundtable")]), url: URL, key: KEY });
  const lines: string[] = [];
  const got = await resolveSettings(r, "ZZ", { ...specs, extra: { key: "zz_missing", type: "text" as const, env: () => "env" } }, { log: (l) => lines.push(l) });
  assert.deepEqual(got.values, { on: false, cap: 6, mode: "roundtable", extra: "env" });
  assert.match(lines.join("\n"), /zz_on, zz_cap/);
});

test("a resolver that throws is a failed read, never an exception", async () => {
  const got = await resolveSettings({ resolve: async () => { throw new Error("x"); } }, "ZZ", specs, { log: quiet });
  assert.equal(got.sources.on, "env");
  assert.equal(got.reason, "read_failed");
});

test("cache: one read per app within 60 s, a fresh read at 60 s, never longer even if asked", async () => {
  let t = 1_000_000;
  const calls: string[] = [];
  const r = createResolver({ client: clientOf([row("zz_on", true)], calls), url: URL, key: KEY, now: () => t, cacheMs: 10 * 60_000 });
  assert.equal(r.CACHE_MS, CACHE_MS);
  assert.equal(CACHE_MS, 60_000);
  await r.resolve("ZZ");
  t += 59_999;
  await r.resolve("ZZ");
  assert.equal(calls.length, 1);
  t += 1;
  await r.resolve("ZZ");
  assert.equal(calls.length, 2);
});

test("a failed read is never cached", async () => {
  let ok = false;
  const calls: string[] = [];
  const client: Client = async (url) => { calls.push(url); return { ok, json: async () => [row("zz_on", true)] }; };
  const r = createResolver({ client, url: URL, key: KEY });
  assert.equal((await r.resolve("ZZ")).ok, false);
  ok = true;
  assert.equal((await r.resolve("ZZ")).ok, true);
  assert.equal(calls.length, 2);
});

test("the request reads only v_effective_config for the app, with no-store", async () => {
  let seen: { url: string; init: Parameters<Client>[1] } | null = null;
  const r = createResolver({ client: async (url, init) => { seen = { url, init }; return { ok: true, json: async () => [] }; }, url: URL + "/", key: KEY });
  await r.resolve("zz");
  assert.ok(seen);
  const s = seen as unknown as { url: string; init: Parameters<Client>[1] };
  assert.match(s.url, /^https:\/\/ycadmmngkdhvpcsrcuaq\.supabase\.co\/rest\/v1\/v_effective_config\?/);
  assert.match(s.url, /app_code=eq\.ZZ&scope=eq\.default/);
  assert.equal(s.init.method, "GET");
  assert.equal(s.init.cache, "no-store");
  assert.ok(!s.url.includes(KEY), "the key never goes in the URL");
});

test("secrets are never logged: not the key, not an error message carrying it, not a value", async () => {
  const lines: string[] = [];
  const orig = { warn: console.warn, error: console.error, log: console.log, info: console.info };
  const capture = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  console.warn = capture; console.error = capture; console.log = capture; console.info = capture;
  try {
    const failing = createResolver({ client: async () => { throw new Error(`401 for ${KEY}`); }, url: URL, key: KEY });
    await resolveSettings(failing, "ZZ", specs);
    const wrongType = createResolver({ client: clientOf([row("zz_mode", `bad-${KEY}`)]), url: URL, key: KEY });
    await resolveSettings(wrongType, "ZZ", specs);
  } finally {
    Object.assign(console, orig);
  }
  assert.ok(lines.length >= 2, "failures are reported");
  for (const l of lines) assert.ok(!l.includes(KEY), `logged a secret: ${l}`);
});
