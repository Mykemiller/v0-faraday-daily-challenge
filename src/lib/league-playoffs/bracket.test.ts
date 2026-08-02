// Pure-logic tests for single-elimination bracket construction + advancement.
//   npm run test:playoffs

import test from "node:test";
import assert from "node:assert/strict";

import {
  assignSeeds,
  bracketSize,
  buildMatchups,
  decideMatchup,
  effectiveQualifiers,
  roundCount,
  seedOrder,
  splitWindow,
} from "./bracket.ts";

// Hot summer Final Beta's real playoff window: 2026-08-28 … 2026-09-04 (8 days).
const HOT_SUMMER_PLAYOFF = { from: "2026-08-28", to: "2026-09-04" };

// ── sizing ───────────────────────────────────────────────────────────────────

test("bracketSize rounds up to a power of two", () => {
  assert.equal(bracketSize(2), 2);
  assert.equal(bracketSize(3), 4);
  assert.equal(bracketSize(4), 4);
  assert.equal(bracketSize(5), 8);
  assert.equal(bracketSize(8), 8);
  assert.equal(bracketSize(9), 16);
});

test("a field of fewer than two is not a bracket", () => {
  assert.equal(bracketSize(1), 0);
  assert.equal(bracketSize(0), 0);
  assert.equal(roundCount(1), 0);
  assert.deepEqual(buildMatchups(1, []), []);
});

test("roundCount is log2 of the padded size", () => {
  assert.equal(roundCount(2), 1);
  assert.equal(roundCount(4), 2);
  assert.equal(roundCount(5), 3); // padded to 8
  assert.equal(roundCount(8), 3);
  assert.equal(roundCount(16), 4);
});

// ── seed order ───────────────────────────────────────────────────────────────

test("seedOrder is the standard reflection bracket", () => {
  assert.deepEqual(seedOrder(2), [1, 2]);
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test("seedOrder pairs every seed exactly once and sums to size+1", () => {
  for (const size of [2, 4, 8, 16, 32]) {
    const order = seedOrder(size);
    assert.equal(order.length, size, `size ${size} length`);
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      Array.from({ length: size }, (_, i) => i + 1),
      `size ${size} is a permutation of 1..n`
    );
    // The defining property: each round-1 pair sums to size + 1.
    for (let i = 0; i < size; i += 2) {
      assert.equal(order[i] + order[i + 1], size + 1, `size ${size} pair at ${i}`);
    }
  }
});

test("seeds 1 and 2 can only meet in the final", () => {
  // In an 8-bracket they sit in opposite halves: 1 in slots 0-1, 2 in slots 2-3.
  const order = seedOrder(8);
  const slotOf = (seed: number) => Math.floor(order.indexOf(seed) / 2);
  assert.ok(slotOf(1) < 2, "seed 1 in the top half");
  assert.ok(slotOf(2) >= 2, "seed 2 in the bottom half");
});

// ── round windows ────────────────────────────────────────────────────────────

test("splitWindow partitions the window with no gap or overlap", () => {
  const w = splitWindow(HOT_SUMMER_PLAYOFF, 3)!;
  assert.equal(w.length, 3);
  // 8 days over 3 rounds → 3, 3, 2 (remainder to the earliest rounds).
  assert.deepEqual(w, [
    { from: "2026-08-28", to: "2026-08-30" },
    { from: "2026-08-31", to: "2026-09-02" },
    { from: "2026-09-03", to: "2026-09-04" },
  ]);
  // Contiguous: each round starts the day after the previous ends.
  assert.equal(w[0].to < w[1].from, true);
  assert.equal(w[1].to < w[2].from, true);
  // Covers the whole window exactly.
  assert.equal(w[0].from, HOT_SUMMER_PLAYOFF.from);
  assert.equal(w[2].to, HOT_SUMMER_PLAYOFF.to);
});

test("splitWindow refuses a window shorter than the round count", () => {
  // 2 days cannot host 3 rounds — overlapping them would double-count points.
  assert.equal(splitWindow({ from: "2026-08-28", to: "2026-08-29" }, 3), null);
  assert.equal(splitWindow(HOT_SUMMER_PLAYOFF, 0), null);
  assert.equal(splitWindow({ from: "2026-09-04", to: "2026-08-28" }, 2), null);
});

test("splitWindow handles an exact division and a single round", () => {
  assert.deepEqual(splitWindow({ from: "2026-08-28", to: "2026-08-31" }, 2), [
    { from: "2026-08-28", to: "2026-08-29" },
    { from: "2026-08-30", to: "2026-08-31" },
  ]);
  assert.deepEqual(splitWindow(HOT_SUMMER_PLAYOFF, 1), [HOT_SUMMER_PLAYOFF]);
});

// ── bracket construction ─────────────────────────────────────────────────────

test("an 8-team bracket pairs 1v8 4v5 2v7 3v6 and wires the winners forward", () => {
  const windows = splitWindow(HOT_SUMMER_PLAYOFF, 3)!;
  const m = buildMatchups(8, windows);

  const r1 = m.filter(x => x.round === 1);
  assert.equal(r1.length, 4);
  assert.deepEqual(r1.map(x => [x.seedA, x.seedB]), [[1, 8], [4, 5], [2, 7], [3, 6]]);

  // Round 1 slots 0 and 1 both feed round-2 slot 0, on opposite sides.
  assert.deepEqual([r1[0].nextSlot, r1[0].nextSide], [0, "a"]);
  assert.deepEqual([r1[1].nextSlot, r1[1].nextSide], [0, "b"]);
  assert.deepEqual([r1[2].nextSlot, r1[2].nextSide], [1, "a"]);
  assert.deepEqual([r1[3].nextSlot, r1[3].nextSide], [1, "b"]);

  assert.equal(m.filter(x => x.round === 2).length, 2);
  const final = m.filter(x => x.round === 3);
  assert.equal(final.length, 1);
  // The final feeds nowhere.
  assert.equal(final[0].nextSlot, null);
  assert.equal(final[0].nextSide, null);
  // Each round uses its own window.
  assert.deepEqual(r1[0].window, windows[0]);
  assert.deepEqual(final[0].window, windows[2]);
});

test("a non-power-of-two field gets byes, and they land on the top seeds", () => {
  const windows = splitWindow(HOT_SUMMER_PLAYOFF, 3)!;
  const r1 = buildMatchups(5, windows).filter(x => x.round === 1);
  // Padded to 8: seeds 6,7,8 do not exist, so 1, 2 and 3 get byes.
  assert.deepEqual(r1.map(x => [x.seedA, x.seedB]), [[1, null], [4, 5], [2, null], [3, null]]);
  const byes = r1.filter(x => x.seedA == null || x.seedB == null).map(x => x.seedA);
  assert.deepEqual(byes.sort((a, b) => a! - b!), [1, 2, 3]);
});

test("a full power-of-two field has no byes at all", () => {
  const windows = splitWindow(HOT_SUMMER_PLAYOFF, 3)!;
  const r1 = buildMatchups(8, windows).filter(x => x.round === 1);
  assert.equal(r1.some(x => x.seedA == null || x.seedB == null), false);
});

test("buildMatchups refuses a window list that does not match the round count", () => {
  assert.deepEqual(buildMatchups(8, [HOT_SUMMER_PLAYOFF]), []); // needs 3 windows
  assert.deepEqual(buildMatchups(8, []), []);
});

// ── advancement ──────────────────────────────────────────────────────────────

const side = (id: string | null, seed: number | null, points: number | null) =>
  ({ participantId: id, seed, points });

test("a bye advances immediately, without waiting for the window", () => {
  assert.deepEqual(decideMatchup(side("A", 1, null), side(null, null, null), false), {
    decided: true, winnerId: "A", reason: "bye",
  });
  assert.deepEqual(decideMatchup(side(null, null, null), side("B", 2, null), false), {
    decided: true, winnerId: "B", reason: "bye",
  });
});

test("an empty matchup is undecided — an upstream round has not settled", () => {
  assert.deepEqual(decideMatchup(side(null, null, null), side(null, null, null), true), {
    decided: false, reason: "empty",
  });
});

test("an open window is never decided, even with a clear leader", () => {
  // THE no-fabrication rule: a lead mid-round is not a result.
  assert.deepEqual(decideMatchup(side("A", 1, 900), side("B", 8, 10), false), {
    decided: false, reason: "window_open",
  });
});

test("a closed window decides on real points", () => {
  assert.deepEqual(decideMatchup(side("A", 1, 120), side("B", 8, 340), true), {
    decided: true, winnerId: "B", reason: "points",
  });
  assert.deepEqual(decideMatchup(side("A", 1, 340), side("B", 8, 120), true), {
    decided: true, winnerId: "A", reason: "points",
  });
});

test("a tie breaks to the better seed", () => {
  assert.deepEqual(decideMatchup(side("A", 3, 200), side("B", 6, 200), true), {
    decided: true, winnerId: "A", reason: "seed_tiebreak",
  });
  assert.deepEqual(decideMatchup(side("A", 7, 200), side("B", 2, 200), true), {
    decided: true, winnerId: "B", reason: "seed_tiebreak",
  });
});

test("a tie with no seeds refuses rather than picking arbitrarily", () => {
  assert.deepEqual(decideMatchup(side("A", null, 50), side("B", null, 50), true), {
    decided: false, reason: "tie_unbreakable",
  });
});

test("missing points count as zero, not as undecided, once the window closes", () => {
  assert.deepEqual(decideMatchup(side("A", 1, null), side("B", 2, 5), true), {
    decided: true, winnerId: "B", reason: "points",
  });
  // Both silent → 0-0 → the better seed takes it. A real outcome: neither played.
  assert.deepEqual(decideMatchup(side("A", 1, null), side("B", 2, null), true), {
    decided: true, winnerId: "A", reason: "seed_tiebreak",
  });
});

// ── seeding ──────────────────────────────────────────────────────────────────

const standings = [
  { participantId: "t1", displayName: "Alpha",   points: 900 },
  { participantId: "t2", displayName: "Bravo",   points: 800 },
  { participantId: "t3", displayName: "Charlie", points: 700 },
  { participantId: "t4", displayName: "Delta",   points: 600 },
  { participantId: "t5", displayName: "Echo",    points: 500 },
];

test("assignSeeds numbers from 1 and truncates to the qualifier count", () => {
  const seeds = assignSeeds(standings, 4);
  assert.equal(seeds.length, 4);
  assert.deepEqual(seeds.map(s => s.seed), [1, 2, 3, 4]);
  assert.deepEqual(seeds.map(s => s.participantId), ["t1", "t2", "t3", "t4"]);
  // Names and points are snapshotted, so a later rename can't rewrite history.
  assert.equal(seeds[0].displayName, "Alpha");
  assert.equal(seeds[0].points, 900);
});

test("assignSeeds preserves the caller's order as the tiebreak", () => {
  const tied = [
    { participantId: "x", displayName: "X", points: 100 },
    { participantId: "y", displayName: "Y", points: 100 },
  ];
  assert.deepEqual(assignSeeds(tied, 2).map(s => s.participantId), ["x", "y"]);
});

test("assignSeeds handles a qualifier count larger than the field", () => {
  assert.equal(assignSeeds(standings, 32).length, 5);
  assert.deepEqual(assignSeeds(standings, 0), []);
});

test("effectiveQualifiers never exceeds who actually exists", () => {
  assert.equal(effectiveQualifiers(8, 5), 5);
  assert.equal(effectiveQualifiers(8, 20), 8);
  assert.equal(effectiveQualifiers(8, 0), 0);
});

// ── end-to-end shape ─────────────────────────────────────────────────────────

test("a 5-team field over Hot Summer's window produces a complete, wired bracket", () => {
  const seeds = assignSeeds(standings, effectiveQualifiers(8, standings.length));
  const rounds = roundCount(seeds.length);
  const windows = splitWindow(HOT_SUMMER_PLAYOFF, rounds)!;
  const m = buildMatchups(seeds.length, windows);

  assert.equal(rounds, 3);
  assert.equal(m.length, 4 + 2 + 1);
  // Exactly one final, and it terminates.
  const finals = m.filter(x => x.round === rounds);
  assert.equal(finals.length, 1);
  assert.equal(finals[0].nextSlot, null);
  // Every non-final matchup feeds a real slot in the next round.
  for (const x of m.filter(y => y.round < rounds)) {
    const slotsNext = m.filter(y => y.round === x.round + 1).length;
    assert.ok(x.nextSlot != null && x.nextSlot < slotsNext, `round ${x.round} slot ${x.slot} wiring`);
  }
  // Round windows are strictly increasing and cover the playoff window.
  assert.equal(m.find(x => x.round === 1)!.window.from, HOT_SUMMER_PLAYOFF.from);
  assert.equal(finals[0].window.to, HOT_SUMMER_PLAYOFF.to);
});
