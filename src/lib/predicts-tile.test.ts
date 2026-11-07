// Run: npm run test:predicts-tile
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALL_MAX, FALLBACK_COPY, featuredUrl, metaLine, parseTileResponse, RECEIPTS_HREF, requestAccessUrl, TILE_COPY, truncateCall,
} from "./predicts-tile.ts";
import { ACCURACY_CLAIM_RE, TAXONOMY_COUNT_RE } from "./predicts.ts";

const ok = (featured: unknown, extra: Record<string, unknown> = {}) => ({
  ok: true, view: "featured", release_tag: "26-45-v02", featured, receipts_path: RECEIPTS_HREF, ...extra,
});
const call = (over: Record<string, unknown> = {}) => ({
  prediction_text: "By November 16, 2026, a thing will happen.", probability_score: 90,
  target_resolution_date: "2026-11-16", sector_name: "Tax, Incentives & Fiscal Policy", ...over,
});

test("valid payload -> call, meta line built from string parts (no UTC off-by-one)", () => {
  const d = parseTileResponse(ok(call()))!;
  assert.equal(d.releaseTag, "26-45-v02");
  assert.equal(metaLine(d.featured!), "90% - resolves by Nov 16, 2026");
  assert.equal(d.featured!.sector, "Tax, Incentives & Fiscal Policy");
});

test("null featured -> no call block, release tag still shown", () => {
  const d = parseTileResponse(ok(null))!;
  assert.equal(d.featured, null);
  assert.equal(d.releaseTag, "26-45-v02");
});

test("probability must be an integer 1-99; null/0/fraction/100 never render", () => {
  for (const p of [null, 0, 0.75, 100, "90", NaN]) {
    assert.equal(parseTileResponse(ok(call({ probability_score: p })))!.featured, null, String(p));
  }
});

test("missing date hides the call; missing sector hides only the chip", () => {
  assert.equal(parseTileResponse(ok(call({ target_resolution_date: null })))!.featured, null);
  assert.equal(parseTileResponse(ok(call({ sector_name: null })))!.featured!.sector, null);
});

test("bad envelopes -> null (tile falls back to FDY-147 copy)", () => {
  for (const j of [null, "x", {}, { ok: false }, { ok: true, view: "open" }]) assert.equal(parseTileResponse(j), null);
});

test("missing release tag is null, never invented", () => {
  assert.equal(parseTileResponse(ok(null, { release_tag: null }))!.releaseTag, null);
});

test("truncation: <=200 on a word boundary, short text untouched", () => {
  assert.equal(truncateCall("short"), "short");
  const long = ("word ".repeat(80)).trim();
  const t = truncateCall(long);
  assert.ok(t.length <= CALL_MAX);
  assert.ok(t.endsWith("…"));
  assert.ok(!/\bwor…$/.test(t));
});

test("urls derive from the configured base", () => {
  const base = "https://x.supabase.co/functions/v1/predicts-public";
  assert.equal(featuredUrl(base), `${base}?view=featured`);
  assert.equal(requestAccessUrl(base), "https://x.supabase.co/functions/v1/predicts-request-access");
  assert.equal(RECEIPTS_HREF, "/predicts?view=receipts");
});

test("tile copy: no taxonomy counts, no accuracy claim", () => {
  const all = [...Object.values(TILE_COPY), ...Object.values(FALLBACK_COPY), metaLine({ text: "", probability: 72, resolvesBy: "Dec 1, 2026", sector: null })].join(" \n ");
  assert.ok(!/\b\d+\s+(sectors|theaters|threads)\b/i.test(all));
  assert.ok(!TAXONOMY_COUNT_RE.test(all));
  assert.ok(!ACCURACY_CLAIM_RE.test(all));
});
