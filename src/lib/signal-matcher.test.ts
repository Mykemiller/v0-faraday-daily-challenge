// Unit tests for the Faraday Signal matcher (FAR-385). Pure logic — no I/O.
//
// Run with:  npm run test:signal-matcher   (node --test with TS type-stripping,
// matching the faradays-take test setup).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchSignalsForDay,
  scoreSignal,
  minusDays,
  MATCHED_SCORE_FLOOR,
  type SignalCandidate,
  type PuzzleSignalMeta,
} from "./signal-matcher.ts";

const DATE = "2026-07-29";

function sig(overrides: Partial<SignalCandidate> & { id: string }): SignalCandidate {
  return {
    signal_date: DATE,
    headline: "h",
    body: "b",
    source_url: null,
    source_label: null,
    domain: null,
    sub_domain: null,
    tags: [],
    pinned_for_date: null,
    pinned_puzzle_type: null,
    published: true,
    updated_at: "2026-07-29T00:00:00Z",
    ...overrides,
  };
}

function puzzle(overrides: Partial<PuzzleSignalMeta> & { puzzle_type: string }): PuzzleSignalMeta {
  return { domain_name: null, sub_domain: null, topic: null, puzzle_name: null, ...overrides };
}

const BRIEF = puzzle({
  puzzle_type: "The Brief",
  domain_name: "Power Architecture",
  sub_domain: "High-Voltage DC Distribution",
  topic: "Infrastructure",
  puzzle_name: "The 800V DC Transition",
});

test("pin wins outright, even over a perfect sub-domain match elsewhere in the pool", () => {
  const perfect = sig({ id: "perfect", sub_domain: "High-Voltage DC Distribution" });
  const pinned = sig({ id: "pinned", pinned_for_date: DATE, pinned_puzzle_type: "The Brief" });
  const m = matchSignalsForDay([BRIEF], [perfect, pinned], DATE, () => {});
  assert.deepEqual(m.get("The Brief"), { signal_id: "pinned", tier: "matched" });
});

test("game-scoped pin applies only to its game; a global pin covers every game", () => {
  const briefPin = sig({ id: "brief-pin", pinned_for_date: DATE, pinned_puzzle_type: "The Brief" });
  const rackl = puzzle({ puzzle_type: "Rackl", topic: "Networking" });
  const m = matchSignalsForDay([BRIEF, rackl], [briefPin], DATE, () => {});
  assert.equal(m.get("The Brief")?.signal_id, "brief-pin");
  // Rackl falls through to the scored pool — the pinned signal is in-window,
  // so it becomes Rackl's lead rather than a pin.
  assert.deepEqual(m.get("Rackl"), { signal_id: "brief-pin", tier: "lead" });

  const globalPin = sig({ id: "global-pin", pinned_for_date: DATE, updated_at: "2026-07-29T09:00:00Z" });
  const m2 = matchSignalsForDay([BRIEF, rackl], [briefPin, globalPin], DATE, () => {});
  assert.equal(m2.get("Rackl")?.signal_id, "global-pin");
  assert.equal(m2.get("Rackl")?.tier, "matched");
});

test("colliding pins: most recently updated wins and a warning fires", () => {
  const older = sig({ id: "older", pinned_for_date: DATE, updated_at: "2026-07-28T10:00:00Z" });
  const newer = sig({ id: "newer", pinned_for_date: DATE, updated_at: "2026-07-29T10:00:00Z" });
  const warnings: string[] = [];
  const m = matchSignalsForDay([BRIEF], [older, newer], DATE, (w) => warnings.push(w));
  assert.equal(m.get("The Brief")?.signal_id, "newer");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /collide/);
});

test("sub-domain exact match scores +10 and lands the matched tier", () => {
  const s = sig({ id: "s1", sub_domain: "high-voltage dc distribution" }); // case/space-insensitive
  assert.equal(scoreSignal(BRIEF, s), 10);
  const m = matchSignalsForDay([BRIEF], [s], DATE, () => {});
  assert.deepEqual(m.get("The Brief"), { signal_id: "s1", tier: "matched" });
});

test("domain(+5) + tags(+2 each) compose; MATCHED_SCORE_FLOOR gates the tier", () => {
  const s = sig({
    id: "s2",
    domain: "Power Architecture",
    tags: ["800v", "transition", "power architecture", "unrelated-tag"],
  });
  // +5 domain, +2 "800v" (name token), +2 "transition" (name token),
  // +2 "power architecture" (whole-label match). "unrelated-tag" scores 0.
  assert.equal(scoreSignal(BRIEF, s), 11);
  const m = matchSignalsForDay([BRIEF], [s], DATE, () => {});
  assert.equal(m.get("The Brief")?.tier, "matched");
  assert.ok(11 >= MATCHED_SCORE_FLOOR);
});

test("domain label may match the puzzle's own topic line while links are unpopulated", () => {
  const p = puzzle({ puzzle_type: "Signal Drop", topic: "Hyperscaler Activity" });
  const s = sig({ id: "s3", domain: "Hyperscaler Activity" });
  assert.equal(scoreSignal(p, s), 5);
});

test("lead fallback: weak match still surfaces the highest-scoring signal", () => {
  const weak = sig({ id: "weak", tags: ["infrastructure"] }); // +2 via topic
  const zero = sig({ id: "zero", tags: ["chocolate"] });
  const m = matchSignalsForDay([BRIEF], [zero, weak], DATE, () => {});
  assert.deepEqual(m.get("The Brief"), { signal_id: "weak", tier: "lead" });
});

test("empty day: no published signals in window -> tier none, null id", () => {
  const unpublished = sig({ id: "draft", published: false });
  const stale = sig({ id: "stale", signal_date: minusDays(DATE, 3) }); // outside 3-day window
  const future = sig({ id: "future", signal_date: "2026-07-30" });
  const m = matchSignalsForDay([BRIEF], [unpublished, stale, future], DATE, () => {});
  assert.deepEqual(m.get("The Brief"), { signal_id: null, tier: "none" });
});

test("window: signal_date within serve_date-2 .. serve_date is eligible", () => {
  const edge = sig({ id: "edge", signal_date: minusDays(DATE, 2) });
  const m = matchSignalsForDay([BRIEF], [edge], DATE, () => {});
  assert.equal(m.get("The Brief")?.signal_id, "edge");
});

test("recency tiebreak: equal scores prefer latest signal_date, then updated_at", () => {
  const older = sig({ id: "older", signal_date: minusDays(DATE, 1) });
  const newer = sig({ id: "newer", signal_date: DATE });
  const m = matchSignalsForDay([BRIEF], [older, newer], DATE, () => {});
  assert.equal(m.get("The Brief")?.signal_id, "newer");

  const early = sig({ id: "early", updated_at: "2026-07-29T01:00:00Z" });
  const late = sig({ id: "late", updated_at: "2026-07-29T02:00:00Z" });
  const m2 = matchSignalsForDay([BRIEF], [early, late], DATE, () => {});
  assert.equal(m2.get("The Brief")?.signal_id, "late");
});

test("duplicates across games are allowed — the same signal may serve all 7", () => {
  const s = sig({ id: "shared" });
  const types = ["Rackl", "Signal Drop", "The Stack", "Circuit", "The Brief", "Dark Fiber", "Frequency"];
  const m = matchSignalsForDay(types.map((t) => puzzle({ puzzle_type: t })), [s], DATE, () => {});
  assert.equal(m.size, 7);
  for (const t of types) assert.equal(m.get(t)?.signal_id, "shared");
});
