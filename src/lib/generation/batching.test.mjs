// CC-DC-GEN-BATCH-HARDENING-1.0 — the standing guard on batch sizing,
// truncation recovery and the time-budget gate.
//
// Why these tests and not an integration run: the three failures this change
// fixes are all invisible from the outside. A FULL run that truncated recorded
// `no-content` for the lost items, a run that overran the Vercel limit recorded
// nothing at all, and both looked identical to "the model answered badly". The
// model call is therefore INJECTED here — every branch (truncate → split →
// succeed, size-1 truncation, a budget refusal mid-batch) runs offline, with no
// API key, no network and no database.
//
// Run: npm run test:generation-batching

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUDGET_ALPHA, BUDGET_SEED_MS, DEFAULT_MAX_TOKENS, DEFAULT_TYPE_BATCH_SIZE,
  TYPE_BATCH_SIZE, createBudget, genMaxTokens, runBatchWithSplit, startingBatchSize,
} from "./batching.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const read = (p) => readFileSync(join(REPO, p), "utf8");

/** slots shaped like the worker's `items` (only identity matters here). */
const slots = (n, prefix = "d") =>
  Array.from({ length: n }, (_, i) => ({ date: `${prefix}${String(i + 1).padStart(2, "0")}` }));

/** a parsed array element that the worker would accept as "an object came back". */
const obj = (item) => ({ puzzle: { name: item.date }, hints: ["a", "b", "c"] });

/**
 * A fake model. `truncateAtOrAbove` is the batch size at which the output no
 * longer fits — exactly the real failure mode: size is what decides, not luck.
 * At or above it the call reports stop_reason max_tokens and returns only the
 * objects that fit (`fitCount`).
 */
function fakeModel({ truncateAtOrAbove = Infinity, fitCount = (n) => n - 1, ms = 1000 } = {}) {
  const calls = [];
  const call = async (slice) => {
    calls.push(slice.map((s) => s.date));
    if (slice.length >= truncateAtOrAbove) {
      const kept = Math.max(0, Math.min(slice.length - 1, fitCount(slice.length)));
      return { objects: slice.slice(0, kept).map(obj), stopReason: "max_tokens", ms };
    }
    return { objects: slice.map(obj), stopReason: "end_turn", ms };
  };
  return { call, calls };
}

// ── D3 — per-type starting batch size ───────────────────────────────────────

test("the decided per-type starting sizes are exactly what D3 fixed", () => {
  assert.deepEqual(TYPE_BATCH_SIZE, {
    "The Brief": 5,
    Circuit: 8,
    Frequency: 8,
    Rackl: 8,
    "Signal Drop": 10,
    "The Stack": 10,
    "Dark Fiber": 10,
  });
  assert.equal(DEFAULT_TYPE_BATCH_SIZE, 8);
});

test("startingBatchSize respects the per-type map", () => {
  assert.equal(startingBatchSize("The Brief", 12), 5);
  assert.equal(startingBatchSize("Circuit", 12), 8);
  assert.equal(startingBatchSize("Signal Drop", 12), 10);
  assert.equal(startingBatchSize("The Stack", 12), 10);
  assert.equal(startingBatchSize("Dark Fiber", 12), 10);
  assert.equal(startingBatchSize("Rackl", 12), 8);
  assert.equal(startingBatchSize("Frequency", 12), 8);
});

test("startingBatchSize is clamped by the caller's upper bound, never raised by it", () => {
  // the worker's batchSize is an upper bound: 8 caps Signal Drop's 10 …
  assert.equal(startingBatchSize("Signal Drop", 8), 8);
  // … and never lifts The Brief's 5 up to it
  assert.equal(startingBatchSize("The Brief", 8), 5);
  assert.equal(startingBatchSize("The Brief", 12), 5);
  // a type with no entry falls back to the default, still clamped
  assert.equal(startingBatchSize("Some New Game", 12), DEFAULT_TYPE_BATCH_SIZE);
  assert.equal(startingBatchSize("Some New Game", 3), 3);
  // junk bounds do not produce a zero or negative batch
  assert.equal(startingBatchSize("Circuit", 0), 8);
  assert.equal(startingBatchSize("Circuit", NaN), 8);
  assert.equal(startingBatchSize("Circuit", undefined), 8);
});

// ── D1 — max_tokens and its env override ────────────────────────────────────

test("genMaxTokens defaults to 16000 and honours DC_GEN_MAX_TOKENS", () => {
  assert.equal(DEFAULT_MAX_TOKENS, 16000);
  assert.equal(genMaxTokens({}), 16000);
  assert.equal(genMaxTokens({ DC_GEN_MAX_TOKENS: "8192" }), 8192);
  assert.equal(genMaxTokens({ DC_GEN_MAX_TOKENS: "32000" }), 32000);
  // a cap so small that EVERY call would truncate is not an override, it is a typo
  assert.equal(genMaxTokens({ DC_GEN_MAX_TOKENS: "16" }), 16000);
  assert.equal(genMaxTokens({ DC_GEN_MAX_TOKENS: "nope" }), 16000);
  assert.equal(genMaxTokens({ DC_GEN_MAX_TOKENS: "" }), 16000);
});

// ── D2 — truncation → split → succeed ───────────────────────────────────────

test("truncation at size 10 splits into 5 + 5 and succeeds", async () => {
  const items = slots(10);
  // 10 does not fit; 5 does
  const model = fakeModel({ truncateAtOrAbove: 10 });
  const run = await runBatchWithSplit(items, { call: model.call });

  assert.equal(run.splits, 1, "one split");
  assert.equal(run.calls, 3, "the failed 10, then 5 + 5");
  assert.deepEqual(model.calls.map((c) => c.length), [10, 5, 5]);
  assert.equal(run.stopped, false);
  assert.deepEqual(run.unattempted, []);

  assert.equal(run.outcomes.length, 10);
  assert.equal(run.outcomes.filter((o) => o.failure).length, 0, "no failures — the split recovered");
  // outcomes come back in ITEM order, so the worker's per-item loop still lines
  // each parsed object up with the slot it was generated for
  assert.deepEqual(run.outcomes.map((o) => o.item.date), items.map((i) => i.date));
  assert.deepEqual(run.outcomes.map((o) => o.object.puzzle.name), items.map((i) => i.date));
});

test("a partial truncated result is DISCARDED, not written (B1)", async () => {
  // the model returns 9 complete objects out of 10 and says max_tokens: the
  // salvageable prefix is exactly the trap — it must not be kept.
  const model = fakeModel({ truncateAtOrAbove: 10, fitCount: () => 9 });
  const run = await runBatchWithSplit(slots(10), { call: model.call });
  assert.equal(run.splits, 1);
  // every slot still ends up with an object, but from the RE-GENERATED halves
  assert.equal(run.outcomes.filter((o) => o.failure).length, 0);
  assert.deepEqual(model.calls.map((c) => c.length), [10, 5, 5]);
});

test("a truncated response whose count MATCHES is kept without splitting (B1)", async () => {
  // stop_reason max_tokens, but all 8 objects closed — the cap landed in the
  // trailing bracket. Splitting here would spend a second call for nothing.
  const call = async (slice) => ({ objects: slice.map(obj), stopReason: "max_tokens", ms: 900 });
  const run = await runBatchWithSplit(slots(8), { call });
  assert.equal(run.calls, 1);
  assert.equal(run.splits, 0);
  assert.equal(run.outcomes.filter((o) => o.failure).length, 0);
});

test("splitting recurses: 10 → 5 → 3/2 when 5 still does not fit", async () => {
  const model = fakeModel({ truncateAtOrAbove: 4 }); // only 3 or fewer fit
  const run = await runBatchWithSplit(slots(10), { call: model.call });
  assert.deepEqual(model.calls.map((c) => c.length), [10, 5, 3, 2, 5, 3, 2]);
  assert.equal(run.splits, 3);
  assert.equal(run.outcomes.filter((o) => o.failure).length, 0);
  assert.equal(run.outcomes.length, 10);
});

test("a size-1 call that still truncates is ONE failure with reason `truncated`", async () => {
  const model = fakeModel({ truncateAtOrAbove: 1 }); // nothing ever fits
  const run = await runBatchWithSplit(slots(1), { call: model.call });

  assert.equal(run.calls, 1);
  assert.equal(run.splits, 0, "size 1 cannot be split");
  assert.equal(run.outcomes.length, 1);
  assert.equal(run.outcomes[0].failure.reason, "truncated");
  assert.match(run.outcomes[0].failure.message, /max_tokens/);
  assert.equal(run.outcomes[0].object, undefined);
});

test("a batch where nothing fits bottoms out at one `truncated` failure per slot", async () => {
  const model = fakeModel({ truncateAtOrAbove: 1 });
  const run = await runBatchWithSplit(slots(4), { call: model.call });
  assert.deepEqual(model.calls.map((c) => c.length), [4, 2, 1, 1, 2, 1, 1]);
  assert.equal(run.outcomes.length, 4);
  assert.deepEqual(run.outcomes.map((o) => o.failure.reason), ["truncated", "truncated", "truncated", "truncated"]);
});

test("one structured line per split (B4)", async () => {
  const events = [];
  // only size 1 fits, so 4 → 2+2 → 1+1 twice: three splits, no failures
  const model = fakeModel({ truncateAtOrAbove: 2 });
  const run = await runBatchWithSplit(slots(4), { call: model.call, log: (e) => events.push(e) });
  const steps = events.map((e) => e.step);
  assert.equal(steps.filter((s) => s === "split").length, 3, "4→2+2, then each 2→1+1");
  assert.equal(steps.filter((s) => s === "truncated").length, 0, "size 1 fit, so nothing bottomed out");
  assert.equal(run.outcomes.filter((o) => o.failure).length, 0);
  const split = events.find((e) => e.step === "split");
  assert.deepEqual(split.halves, [2, 2]);
  assert.equal(split.size, 4);
  assert.equal(typeof split.depth, "number");
});

test("one structured line per bottomed-out truncation (B4)", async () => {
  const events = [];
  const model = fakeModel({ truncateAtOrAbove: 1 }); // nothing ever fits
  await runBatchWithSplit(slots(4), { call: model.call, log: (e) => events.push(e) });
  const steps = events.map((e) => e.step);
  assert.equal(steps.filter((s) => s === "split").length, 3);
  assert.equal(steps.filter((s) => s === "truncated").length, 4, "one line per size-1 failure");
  const t = events.find((e) => e.step === "truncated");
  assert.equal(t.size, 1);
  assert.equal(t.parsed, 0);
});

test("a truncated-but-complete response is logged, so the next size up is known not to fit", async () => {
  const events = [];
  const call = async (slice) => ({ objects: slice.map(obj), stopReason: "max_tokens", ms: 800 });
  await runBatchWithSplit(slots(8), { call, log: (e) => events.push(e) });
  assert.deepEqual(events.map((e) => e.step), ["truncated-complete"]);
  assert.equal(events[0].size, 8);
  assert.equal(events[0].parsed, 8);
});

test("a thrown call is a `model` failure for its sub-slice and does NOT split", async () => {
  const boom = new Error("Anthropic 529: overloaded");
  const seen = [];
  const call = async (slice) => { seen.push(slice.length); throw boom; };
  const run = await runBatchWithSplit(slots(8), { call });
  assert.deepEqual(seen, [8], "a transport error says nothing about output length");
  assert.equal(run.splits, 0);
  assert.equal(run.outcomes.length, 8);
  assert.deepEqual(new Set(run.outcomes.map((o) => o.failure.reason)), new Set(["model"]));
  assert.equal(run.outcomes[0].failure.error, boom, "the error rides along so the caller can key on its status");
});

test("fewer objects than asked for WITHOUT truncation is left to the caller's no-content path", async () => {
  // stop_reason end_turn + 6 of 8 objects: the model answered short. That is a
  // content failure, not a truncation, and must not trigger a split.
  const call = async (slice) => ({ objects: slice.slice(0, 6).map(obj), stopReason: "end_turn", ms: 500 });
  const run = await runBatchWithSplit(slots(8), { call });
  assert.equal(run.calls, 1);
  assert.equal(run.splits, 0);
  assert.equal(run.outcomes.length, 8);
  assert.equal(run.outcomes.filter((o) => o.object === undefined).length, 2);
  assert.equal(run.outcomes.filter((o) => o.failure).length, 0);
});

// ── D4 — the budget guard ───────────────────────────────────────────────────

test("createBudget seeds the EMA at 60s with alpha 0.5", () => {
  assert.equal(BUDGET_SEED_MS, 60_000);
  assert.equal(BUDGET_ALPHA, 0.5);
  let t = 0;
  const b = createBudget({ budgetMs: 230_000, startedAt: 0, now: () => t });
  assert.equal(b.ema, 60_000);
  assert.equal(b.samples, 0);
  b.record(20_000);
  assert.equal(b.ema, 40_000, "0.5*20000 + 0.5*60000");
  b.record(20_000);
  assert.equal(b.ema, 30_000);
  b.record(20_000);
  assert.equal(b.ema, 25_000);
  assert.equal(b.samples, 3);
  // junk durations are ignored rather than poisoning the average
  b.record(NaN); b.record(-5); b.record(undefined);
  assert.equal(b.ema, 25_000);
  assert.equal(b.samples, 3);
  t = 100_000;
  assert.equal(b.elapsed(), 100_000);
  assert.equal(b.projected(), 125_000);
});

test("the guard refuses a call when elapsed + ema exceeds the budget", () => {
  let t = 0;
  const b = createBudget({ budgetMs: 230_000, startedAt: 0, now: () => t });
  t = 169_000; assert.equal(b.canAfford(), true, "169s + 60s seed fits 230s");
  t = 170_000; assert.equal(b.canAfford(), true, "exactly on the line still fits");
  t = 171_000; assert.equal(b.canAfford(), false, "171s + 60s does not");
  // a run whose batches are genuinely fast earns more of the budget
  b.record(10_000); // ema 35_000
  assert.equal(b.canAfford(), true);
  t = 196_000; assert.equal(b.canAfford(), false);
});

test("the guard stops the slice mid-batch and reports the untouched slots", async () => {
  let t = 0;
  const b = createBudget({ budgetMs: 230_000, startedAt: 0, now: () => t, seedMs: 60_000 });
  // each call burns 60s of wall clock; the 3rd would land past 230s - ema
  const model = fakeModel({ ms: 60_000 });
  const call = async (slice) => { t += 60_000; return model.call(slice); };
  const events = [];
  const run = await runBatchWithSplit(slots(30), {
    call: async (slice) => call(slice),
    budget: b,
    log: (e) => events.push(e),
  });
  // one starting batch of 30 is a single call here (no truncation), so prove
  // the refusal on the batch that follows instead:
  assert.equal(run.stopped, false);
  assert.equal(run.outcomes.length, 30);
  // elapsed is now 60s, ema 60s — one more fits
  assert.equal(b.canAfford(), true);
  const second = await runBatchWithSplit(slots(10, "e"), { call, budget: b });
  assert.equal(second.stopped, false);
  // elapsed 120s, ema 60s → 180 <= 230 still fits
  const third = await runBatchWithSplit(slots(10, "f"), { call, budget: b });
  assert.equal(third.stopped, false);
  // elapsed 180s, ema 60s → 240 > 230: refused, nothing sent
  const fourth = await runBatchWithSplit(slots(10, "g"), { call, budget: b, log: (e) => events.push(e) });
  assert.equal(fourth.stopped, true);
  assert.equal(fourth.calls, 0, "no model call is STARTED that cannot finish");
  assert.equal(fourth.outcomes.length, 0, "an unattempted slot is not a failure");
  assert.equal(fourth.unattempted.length, 10);
  const stop = events.find((e) => e.step === "budget-stop");
  assert.ok(stop, "the refusal is logged");
  assert.equal(stop.budgetMs, 230_000);
  assert.equal(stop.size, 10);
});

test("once stopped, the other half of a split is never sent", async () => {
  let t = 0;
  // budget allows the first call, then the clock jumps past the line
  const b = createBudget({ budgetMs: 100_000, startedAt: 0, now: () => t, seedMs: 10_000 });
  const model = fakeModel({ truncateAtOrAbove: 8, ms: 95_000 });
  const run = await runBatchWithSplit(slots(8), {
    call: async (slice) => { t += 95_000; return model.call(slice); },
    budget: b,
  });
  assert.deepEqual(model.calls.map((c) => c.length), [8], "the truncating call happened, neither half did");
  assert.equal(run.splits, 1);
  assert.equal(run.stopped, true);
  assert.equal(run.unattempted.length, 8, "all 8 stay pending for the next slice");
  assert.equal(run.outcomes.length, 0, "and none of them is recorded as a failure");
});

test("a call that THREW still charges the budget", async () => {
  let t = 0;
  const b = createBudget({ budgetMs: 230_000, startedAt: 0, now: () => t, seedMs: 60_000 });
  const call = async () => { t += 20_000; throw new Error("Anthropic 500: upstream"); };
  await runBatchWithSplit(slots(4), { call, budget: b });
  assert.equal(b.samples, 1, "a failed call consumed wall clock and the guard must know");
  assert.equal(b.ema, 40_000);
});

test("no budget at all means no guard (the CLI path)", async () => {
  const model = fakeModel({ truncateAtOrAbove: 10 });
  const run = await runBatchWithSplit(slots(10), { call: model.call });
  assert.equal(run.stopped, false);
  assert.equal(run.outcomes.length, 10);
});

test("runBatchWithSplit refuses to run without an injected call", async () => {
  await assert.rejects(() => runBatchWithSplit(slots(2), {}), /requires a `call` function/);
  const run = await runBatchWithSplit([], { call: async () => ({ objects: [] }) });
  assert.deepEqual(run, { outcomes: [], unattempted: [], stopped: false, calls: 0, splits: 0 });
});

// ── wiring guards (the whole point is that the DEPLOYED path uses this) ─────

test("the module is pure — no network, no clock of its own, no env beyond the cap", () => {
  const src = read("src/lib/generation/batching.js");
  assert.doesNotMatch(src, /\bfetch\(/, "batching.js must not make requests");
  assert.doesNotMatch(src, /^import /m, "batching.js must not import anything");
  assert.doesNotMatch(src, /api\.anthropic\.com|api\.airtable\.com|rest\/v1/);
  // Date.now() appears only as createBudget's default clock
  assert.equal((src.match(/Date\.now\(\)/g) || []).length, 1);
  assert.equal((src.match(/process\.env/g) || []).length, 1, "only DC_GEN_MAX_TOKENS");
});

test("the worker reads stop_reason and routes every batch through the split helper", () => {
  const src = read("src/lib/generation/worker.ts");
  assert.match(src, /stop_reason/, "the worker must read stop_reason off the response");
  assert.match(src, /runBatchWithSplit\(/, "the worker must not call the model directly per batch");
  assert.match(src, /startingBatchSize\(type, batchSize\)/);
  assert.match(src, /max_tokens: maxTokens/, "the cap must come from genMaxTokens, not a literal");
  assert.doesNotMatch(src, /max_tokens: 4096/);
  assert.match(src, /createBudget\(/);
  assert.doesNotMatch(src, /const overBudget =/, "the once-per-batch elapsed check is gone");
});

test("the FAR-287 CLI shares the same helper and cap (D5)", () => {
  const cli = read("scripts/far287/generate-puzzles.mjs");
  assert.match(cli, /runBatchWithSplit\(/);
  assert.match(cli, /startingBatchSize\(type, BATCH\)/);
  assert.doesNotMatch(cli, /maxTokens:\s*4096/);
  const clients = read("scripts/far287/lib/clients.mjs");
  assert.match(clients, /stop_reason/);
  assert.match(clients, /genMaxTokens\(\)/);
  assert.doesNotMatch(clients, /maxTokens = 4096/);
});

test("both worker routes keep maxDuration 300 and spend only 230s of it (D4)", () => {
  for (const p of [
    "src/app/api/cron/generation-worker/route.ts",
    "src/app/api/lo/generation/worker/route.ts",
  ]) {
    const src = read(p);
    assert.match(src, /export const maxDuration = 300;/, p);
    assert.match(src, /budgetMs: 230_000/, p);
    assert.doesNotMatch(src, /budgetMs: 2[45]0_000/, p);
  }
});

test("every started batch size sits under 70% of the 16k cap on the offline estimate", () => {
  // The sizing that justified D3, recomputed from the SAME exemplars the prompt
  // ships so the two cannot drift: chars/4, x1.6 for hints + explanation + the
  // JSON wrapper, with the exemplars' partially-shown arrays expanded to the
  // element count their schema requires.
  const est = {
    "The Brief": 662, Circuit: 383, Frequency: 284, Rackl: 221,
    "Dark Fiber": 212, "Signal Drop": 98, "The Stack": 98,
  };
  for (const [type, perPuzzle] of Object.entries(est)) {
    const batchTokens = perPuzzle * startingBatchSize(type, 12);
    assert.ok(
      batchTokens <= 0.7 * DEFAULT_MAX_TOKENS,
      `${type}: ${batchTokens} est. tokens exceeds 70% of ${DEFAULT_MAX_TOKENS}`
    );
  }
  // and the reason the OLD cap could not work: the old minimum batch of 8
  assert.ok(est["The Brief"] * 8 > 4096, "The Brief at 8 could never fit 4096");
});
