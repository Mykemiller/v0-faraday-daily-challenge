// Pure-logic tests for the Market Reaction Speed classifier (FAR-388).
// Run: node --test src/lib/market-reaction.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveMarketReaction,
  MIN_SAMPLE_FOR_BANDS,
  type SolveBandMap,
} from "./market-reaction.ts";

// CC-DC-GAME-REGISTRY-1.0 D10: par seconds are game_catalog.par_seconds and are
// passed in, so these tests build their own par table rather than naming the
// live seven. "Gamma" is a stand-in for any game with a 60-second par.
const PAR = { Alpha: 90, Gamma: 60, Delta: 150 } as const;

// ── Seed-par fallback (no bands / insufficient sample) ────────────────────────

test("par mode: fast solve → Ahead of Consensus", () => {
  // Gamma par = 60s; ratio < 0.5 ⇒ ahead.
  const r = resolveMarketReaction("Gamma", 20, null, PAR);
  assert.ok(r);
  assert.equal(r.tier, "ahead");
  assert.equal(r.label, "Ahead of Consensus");
  assert.equal(r.source, "par");
  assert.equal(r.parSec, 60);
  assert.equal(r.detail, "20s · par 60s");
});

test("par mode: mid solve → On Pace", () => {
  const r = resolveMarketReaction("Gamma", 60, null, PAR); // ratio 1.0, ≤ 1.25
  assert.ok(r);
  assert.equal(r.tier, "on");
  assert.equal(r.label, "On Pace");
});

test("par mode: slow solve → Taking the Long View (softened copy)", () => {
  const r = resolveMarketReaction("Gamma", 120, null, PAR); // ratio 2.0 > 1.25
  assert.ok(r);
  assert.equal(r.tier, "laggard");
  assert.equal(r.label, "Taking the Long View");
  assert.notEqual(r.label, "Market Laggard"); // the harsher version must be gone
});

test("par mode: every game with a par resolves", () => {
  for (const g of Object.keys(PAR)) {
    const r = resolveMarketReaction(g, 10, null, PAR);
    assert.ok(r, `expected a reaction for ${g}`);
    assert.equal(r.source, "par");
  }
});

test("unknown game with no par and no band → null", () => {
  assert.equal(resolveMarketReaction("Nonexistent", 30, null, PAR), null);
  // No par table at all (catalog unreachable) also degrades to null, never to a
  // fabricated band.
  assert.equal(resolveMarketReaction("Alpha", 30), null);
});

test("unusable elapsed (null / negative / NaN) → null", () => {
  assert.equal(resolveMarketReaction("Alpha", null, null, PAR), null);
  assert.equal(resolveMarketReaction("Alpha", undefined, null, PAR), null);
  assert.equal(resolveMarketReaction("Alpha", -5, null, PAR), null);
  assert.equal(resolveMarketReaction("Alpha", Number.NaN, null, PAR), null);
});

// ── Percentile path (bands present with enough samples) ───────────────────────

const bands: SolveBandMap = {
  Rackl: { p33Sec: 40, p67Sec: 80, sampleSize: 50 },
};

test("percentile mode: elapsed < p33 → Ahead of Consensus", () => {
  const r = resolveMarketReaction("Rackl", 30, bands);
  assert.ok(r);
  assert.equal(r.source, "percentile");
  assert.equal(r.tier, "ahead");
  assert.equal(r.p33Sec, 40);
  assert.equal(r.p67Sec, 80);
  assert.equal(r.detail, "30s"); // no "par" wording in percentile mode
});

test("percentile mode: p33 ≤ elapsed ≤ p67 → On Pace (boundaries inclusive at p67)", () => {
  assert.equal(resolveMarketReaction("Rackl", 40, bands)?.tier, "on"); // == p33 ⇒ on
  assert.equal(resolveMarketReaction("Rackl", 60, bands)?.tier, "on");
  assert.equal(resolveMarketReaction("Rackl", 80, bands)?.tier, "on"); // == p67 ⇒ on
});

test("percentile mode: elapsed > p67 → Taking the Long View", () => {
  const r = resolveMarketReaction("Rackl", 200, bands);
  assert.equal(r?.tier, "laggard");
  assert.equal(r?.label, "Taking the Long View");
});

test("bands below the sample floor are ignored → par fallback", () => {
  const thin: SolveBandMap = {
    Alpha: { p33Sec: 40, p67Sec: 80, sampleSize: MIN_SAMPLE_FOR_BANDS - 1 },
  };
  const r = resolveMarketReaction("Alpha", 30, thin, PAR);
  assert.ok(r);
  assert.equal(r.source, "par"); // fell back — thin band not trusted
});

test("malformed band (p67 < p33) is ignored → par fallback", () => {
  const bad: SolveBandMap = {
    Alpha: { p33Sec: 80, p67Sec: 40, sampleSize: 100 },
  };
  const r = resolveMarketReaction("Alpha", 30, bad, PAR);
  assert.equal(r?.source, "par");
});

test("a game type absent from bands still classifies via its par", () => {
  // `bands` only covers Rackl; Gamma should fall back to par.
  const r = resolveMarketReaction("Gamma", 10, bands, PAR);
  assert.equal(r?.source, "par");
  assert.equal(r?.tier, "ahead");
});

test("percentile scoring is per-game-type (a game with only its own band)", () => {
  // 30s is 'ahead' for Rackl (p33=40) but the SAME 30s for a game with a slower
  // band would classify differently — proving thresholds are not global.
  const twoGames: SolveBandMap = {
    Rackl: { p33Sec: 40, p67Sec: 80, sampleSize: 50 },
    "The Brief": { p33Sec: 20, p67Sec: 25, sampleSize: 50 },
  };
  assert.equal(resolveMarketReaction("Rackl", 30, twoGames)?.tier, "ahead");
  assert.equal(resolveMarketReaction("The Brief", 30, twoGames)?.tier, "laggard");
});
