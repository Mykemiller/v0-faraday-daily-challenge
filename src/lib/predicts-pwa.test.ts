// node --test src/lib/predicts-pwa.test.ts  (FDY-127 Phase 2, CC-PREDICTS-PWA-1.0 §10)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PREDICTS_MANIFEST_PATH, PREDICTS_SCOPE, PREDICTS_SW_PATH, PWA_COPY, TOKEN_KEY, chooseToken, followNamesFrom, followedForecasts,
  followedMatches, formatCachedAt, isIOSUserAgent, isInScope, parseToken, platformOf, predictsManifest, pushSubscribeUrlFrom,
  pushSupportState, vapidKeyBytes, type FollowPrefs, type PushEnv,
} from "./predicts-pwa.ts";
import type { V3Row } from "./predicts-v3.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ORIGIN = "https://www.faraday-intelligence.ai";

// ── manifest (D1) ────────────────────────────────────────────────────────────

test("manifest: own id and scope, start_url inside the scope, standalone, brand colours", () => {
  const m = predictsManifest();
  assert.equal(m.scope, "/predicts");
  assert.equal(m.id, "/predicts");
  assert.ok(m.start_url.startsWith(m.scope), "start_url must be inside scope or browsers fall back to '/'");
  assert.ok(isInScope(m.start_url, ORIGIN));
  assert.equal(m.display, "standalone");
  assert.equal(m.name, "Faraday Predicts");
  assert.equal(m.short_name, "Predicts");
  assert.ok(m.icons.some((i) => i.sizes === "192x192") && m.icons.some((i) => i.sizes === "512x512"), "installability needs 192 and 512 icons");
  assert.equal(PREDICTS_MANIFEST_PATH, "/predicts/manifest.webmanifest");
  assert.ok(PREDICTS_SW_PATH.startsWith(`${PREDICTS_SCOPE}/`));
});

test("the root Daily Challenge manifest is unchanged by this pack (D6 lives in its own revertible commit)", () => {
  const dc = read("../app/manifest.ts");
  assert.match(dc, /name: "Faraday Daily Challenge"/);
  assert.match(dc, /start_url: "\/daily-challenge"/);
});

test("the /predicts layout links the Predicts manifest; the route serves it as manifest+json", () => {
  assert.match(read("../app/predicts/layout.tsx"), /manifest: PREDICTS_MANIFEST_PATH/);
  const route = read("../app/predicts/manifest.webmanifest/route.ts");
  assert.match(route, /application\/manifest\+json/);
  assert.match(route, /predictsManifest\(\)/);
});

test("next.config: the worker is never cached and may control /predicts", () => {
  const cfg = read("../../next.config.ts");
  assert.match(cfg, /source: "\/predicts\/sw\.js"/);
  assert.match(cfg, /key: "Service-Worker-Allowed", value: "\/predicts"/);
  assert.match(cfg, /no-cache/);
});

test("isInScope: /predicts and below on this origin only", () => {
  for (const ok of ["/predicts", "/predicts/abc", "/predicts?view=open", `${ORIGIN}/predicts/receipts`]) assert.ok(isInScope(ok, ORIGIN), ok);
  for (const bad of ["/", "/predictsx", "/challenge", "https://evil.example/predicts", "//evil.example/predicts", "javascript:alert(1)", "http://www.faraday-intelligence.ai/predicts"]) {
    assert.ok(!isInScope(bad, ORIGIN), bad);
  }
});

// ── push support (§9) ────────────────────────────────────────────────────────

const ENV: PushEnv = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, isIOS: false, isStandalone: false, permission: "default" };

test("pushSupportState: unsupported | ios_needs_install | prompt | granted | denied", () => {
  assert.equal(pushSupportState(ENV), "prompt");
  assert.equal(pushSupportState({ ...ENV, permission: "granted" }), "granted");
  assert.equal(pushSupportState({ ...ENV, permission: "denied" }), "denied");
  assert.equal(pushSupportState({ ...ENV, hasPushManager: false }), "unsupported");
  assert.equal(pushSupportState({ ...ENV, isIOS: true, hasPushManager: false }), "ios_needs_install", "iOS Safari tab: no PushManager");
  assert.equal(pushSupportState({ ...ENV, isIOS: true }), "ios_needs_install", "iOS in a tab even if PushManager were present");
  assert.equal(pushSupportState({ ...ENV, isIOS: true, isStandalone: true }), "prompt", "installed Home Screen app");
});

test("iOS / platform detection, including iPadOS reporting a Mac UA", () => {
  assert.ok(isIOSUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)"));
  assert.ok(isIOSUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5));
  assert.ok(!isIOSUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0));
  assert.equal(platformOf("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), "android");
  assert.equal(platformOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "desktop");
  assert.equal(platformOf(""), "unknown");
});

test("vapidKeyBytes: 65-byte uncompressed point only", () => {
  const good = "B" + "A".repeat(86);
  const bytes = vapidKeyBytes(good);
  assert.equal(bytes?.length, 65);
  assert.equal(bytes?.[0], 4);
  assert.equal(vapidKeyBytes(null), null);
  assert.equal(vapidKeyBytes(""), null);
  assert.equal(vapidKeyBytes("A".repeat(87)), null, "first byte must be 0x04");
  assert.equal(vapidKeyBytes("not a key"), null);
});

test("push-subscribe URL sits beside predicts-public", () => {
  assert.equal(pushSubscribeUrlFrom("https://x.supabase.co/functions/v1/predicts-public"), "https://x.supabase.co/functions/v1/predicts-push-subscribe");
});

// ── token ────────────────────────────────────────────────────────────────────

test("token: ?t= wins, else the device copy; anything malformed is ignored", () => {
  const a = "123e4567-e89b-42d3-a456-426614174000";
  const b = "123e4567-e89b-42d3-a456-426614174001";
  assert.equal(chooseToken(a, b), a);
  assert.equal(chooseToken(null, b), b);
  assert.equal(chooseToken("junk", b), b);
  assert.equal(chooseToken(null, "junk"), null);
  assert.equal(parseToken(` ${a.toUpperCase()} `), a);
  assert.equal(TOKEN_KEY, "faraday_predicts_token");
});

test("the token never reaches a console call, a URL we build or a log in the new client code", () => {
  for (const f of ["../app/predicts/hooks/usePredictsToken.ts", "../app/predicts/preferences/PushToggle.tsx", "../app/predicts/following/FollowedForecasts.tsx", "../app/predicts/PredictsPwa.tsx"]) {
    const src = read(f);
    assert.ok(!/console\./.test(src), `${f} logs`);
    assert.ok(!/href=\{[^}]*token/.test(src), `${f} puts the token in a link`);
  }
  assert.match(read("../app/predicts/preferences/PushToggle.tsx"), /JSON\.stringify\(\{ token, \.\.\.body \}\)/, "token travels in the POST body");
});

// ── offline banner ───────────────────────────────────────────────────────────

test("formatCachedAt: epoch ms in the reader's zone; junk is null", () => {
  // 2026-11-14 03:05 UTC = Nov 13, 9:05 PM in Chicago
  assert.equal(formatCachedAt(Date.UTC(2026, 10, 14, 3, 5), "America/Chicago"), "Nov 13, 9:05 PM");
  assert.equal(formatCachedAt(null), null);
  assert.equal(formatCachedAt(0), null);
  assert.equal(formatCachedAt(Number.NaN), null);
  assert.equal(PWA_COPY.offlineBanner("Nov 13, 9:05 PM"), "You're offline — showing the calls as of Nov 13, 9:05 PM.");
});

// ── Followed forecasts (D5) ──────────────────────────────────────────────────

const row = (o: Partial<V3Row>): V3Row => ({
  prediction_id: "p", prediction_text: "t", probability_score: 70, probability_band: null, horizon_bucket: "90d", target_resolution_date: "2027-01-31",
  date_created: "2026-11-01", is_bold: false, status: "active", resolution_date: null, resolution_note: null, sector_name: "Grid Power", is_new: false,
  taxonomy: { theater: "Power", sector: "Grid Power", thread: "Interconnection queues" }, companies: [{ name: "Dominion Energy", slug: "dominion", domain: null }], ...o,
});
const NONE: FollowPrefs = { sectors: [], theaters: [], threads: [], key_players: [], horizons: [], min_probability: 60, include_bold: true };
const NAMES = followNamesFrom({
  sectors: [{ code: "D3", name: "Grid Power" }, { code: "D7", name: "Cooling" }],
  theaters: [{ code: "TH1", name: "Power" }],
  thread_groups: [{ threads: [{ code: "D3.2", name: "Interconnection queues" }] }],
  selected_key_players: [{ id: "c-dom", name: "Dominion Energy" }, { id: "c-x", name: "Other Co" }],
});

test("followed: empty filters match everything above the floor; the FDY-113 floor and Bold waiver hold", () => {
  assert.ok(followedMatches(row({}), NONE, NAMES));
  assert.ok(!followedMatches(row({ probability_score: 40 }), NONE, NAMES));
  assert.ok(followedMatches(row({ probability_score: 40, is_bold: true }), NONE, NAMES));
  assert.ok(!followedMatches(row({ probability_score: 40, is_bold: true }), { ...NONE, include_bold: false }, NAMES));
});

test("followed: Sector, Theater, Thread, Key Player and horizon filters, matched by name", () => {
  assert.ok(followedMatches(row({}), { ...NONE, sectors: ["D3"] }, NAMES));
  assert.ok(!followedMatches(row({}), { ...NONE, sectors: ["D7"] }, NAMES));
  assert.ok(followedMatches(row({ taxonomy: undefined, sector_name: "grid power" }), { ...NONE, sectors: ["D3"] }, NAMES), "falls back to sector_name, case-insensitive");
  assert.ok(followedMatches(row({}), { ...NONE, theaters: ["TH1"], threads: ["D3.2"] }, NAMES));
  assert.ok(!followedMatches(row({ taxonomy: { theater: null, sector: "Grid Power", thread: null } }), { ...NONE, theaters: ["TH1"] }, NAMES), "a row with no Theater fails a Theater filter");
  assert.ok(followedMatches(row({}), { ...NONE, key_players: ["c-x", "c-dom"] }, NAMES));
  assert.ok(!followedMatches(row({}), { ...NONE, key_players: ["c-x"] }, NAMES));
  assert.ok(!followedMatches(row({ companies: [] }), { ...NONE, key_players: ["c-dom"] }, NAMES));
  assert.ok(followedMatches(row({}), { ...NONE, horizons: ["90d", "6m"] }, NAMES));
  assert.ok(!followedMatches(row({}), { ...NONE, horizons: ["30d"] }, NAMES));
  assert.ok(!followedMatches(row({}), { ...NONE, sectors: ["UNKNOWN"] }, NAMES), "an unknown code never widens the filter");
  assert.equal(followedForecasts([row({ prediction_id: "a" }), row({ prediction_id: "b", sector_name: "Cooling", taxonomy: { theater: null, sector: "Cooling", thread: null } })], { ...NONE, sectors: ["D3"] }, NAMES).map((r) => r.prediction_id).join(), "a");
});

// ── copy guard ───────────────────────────────────────────────────────────────

test("copy: no accuracy percentage, no taxonomy counts, no internal codes in the new strings", () => {
  const strings = Object.values(PWA_COPY).map((v) => (typeof v === "function" ? v("Nov 7") : v));
  for (const s of strings) {
    assert.ok(!/\b\d+\s+(sectors|theaters|threads)\b/i.test(s), s);
    assert.ok(!/\d+%/.test(s), s);
    assert.ok(!/\bD\d+\b|\bT[1-7]\b/.test(s), s);
  }
});
