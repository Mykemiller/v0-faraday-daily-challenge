// CC-DC-GEN-DIFFICULTY-CANON-1.0 — the generator must only ever hand Postgres a
// band the staging CHECK accepts.
//
//   CHECK dc_puzzle_bank_staging_difficulty_canon
//     (difficulty IS NULL OR difficulty IN ('foundational','practitioner','expert'))
//
// Pilot run 0118d976-ca9a-4f8f-b3c3-f1c9f1ae347a failed 5/5 against that
// constraint because the generator wrote easy/medium/hard. These tests are the
// standing guard: the legacy vocabulary may be READ (aliases) but never WRITTEN.
// Run: npm run test:generation-difficulty

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_BANDS, LEGACY_ALIASES, canonicalDifficulty, difficultyFor, resolveRowDifficulty,
  CURVE_CUSTOM_WARNING, DIFFICULTY_CURVES, curvePoints, difficultyTargets, largestRemainder,
  mixWeights, normalizeCurve, planDifficulty,
} from "./difficulty.js";
import * as cli from "../../../scripts/far287/lib/difficulty.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

// ── canonicalDifficulty ──────────────────────────────────────────────────────

test("the canonical vocabulary is exactly the three bands the CHECK accepts", () => {
  assert.deepEqual(CANONICAL_BANDS, ["foundational", "practitioner", "expert"]);
});

test("canonicalDifficulty is the identity on canonical bands", () => {
  for (const b of CANONICAL_BANDS) assert.equal(canonicalDifficulty(b), b);
});

test("canonicalDifficulty maps every legacy alias", () => {
  assert.deepEqual(LEGACY_ALIASES, { easy: "foundational", medium: "practitioner", hard: "expert" });
  assert.equal(canonicalDifficulty("easy"), "foundational");
  assert.equal(canonicalDifficulty("medium"), "practitioner");
  assert.equal(canonicalDifficulty("hard"), "expert");
});

test("canonicalDifficulty tolerates case and surrounding whitespace", () => {
  assert.equal(canonicalDifficulty("  Easy "), "foundational");
  assert.equal(canonicalDifficulty("HARD"), "expert");
  assert.equal(canonicalDifficulty("\tPractitioner\n"), "practitioner");
  assert.equal(canonicalDifficulty("Expert"), "expert");
});

test("canonicalDifficulty returns null for anything it does not know", () => {
  for (const v of ["", "   ", "trivial", "very hard", "intermediate", "1", null, undefined, 3, {}, []]) {
    assert.equal(canonicalDifficulty(v), null, `expected null for ${JSON.stringify(v)}`);
  }
});

// ── difficultyFor ────────────────────────────────────────────────────────────

test("difficultyFor with an empty mix falls back to 40/40/20 canonical", () => {
  const counts = tally([], 0, 100);
  assert.deepEqual(Object.keys(counts).sort(), [...CANONICAL_BANDS].sort());
  assert.equal(counts.foundational, 40);
  assert.equal(counts.practitioner, 40);
  assert.equal(counts.expert, 20);
});

test("difficultyFor never returns a non-canonical band, whatever the mix", () => {
  const mixes = [
    [],
    undefined,
    [{ difficulty_band: "easy", target_pct: 50 }, { difficulty_band: "hard", target_pct: 50 }],
    [{ difficulty_band: "banana", target_pct: 100 }],
    [{ difficulty_band: "expert", target_pct: 0 }],
    [{ difficulty_band: "EASY", target_pct: 10 }, { difficulty_band: " medium ", target_pct: 90 }],
    [{ difficulty_band: null, target_pct: 100 }, { difficulty_band: "foundational", target_pct: 5 }],
  ];
  for (const mix of mixes) {
    for (let slot = -5; slot < 100; slot++) {
      const got = difficultyFor(mix, slot);
      assert.ok(CANONICAL_BANDS.includes(got), `mix ${JSON.stringify(mix)} slot ${slot} -> ${got}`);
    }
  }
});

test("a legacy mix is canonicalized, not dropped", () => {
  const counts = tally([
    { difficulty_band: "easy", target_pct: 40 },
    { difficulty_band: "medium", target_pct: 40 },
    { difficulty_band: "hard", target_pct: 20 },
  ], 0, 100);
  assert.deepEqual(counts, { foundational: 40, practitioner: 40, expert: 20 });
});

test("a mix of only unknown bands degrades to the default, never to junk", () => {
  const counts = tally([{ difficulty_band: "banana", target_pct: 100 }], 0, 100);
  assert.deepEqual(counts, { foundational: 40, practitioner: 40, expert: 20 });
});

test("the Football Season mix roughly tracks its targets over 100 slots", () => {
  // Real season_difficulty_mix for Football Season, post CC-LO-MIX-NORMALIZE.
  const mix = [
    { difficulty_band: "foundational", target_pct: 14.41 },
    { difficulty_band: "practitioner", target_pct: 29.82 },
    { difficulty_band: "expert", target_pct: 55.77 },
  ];
  const counts = tally(mix, 0, 100);
  // Every slot canonical.
  assert.equal(counts.foundational + counts.practitioner + counts.expert, 100);
  // The 10-slot bag can only quantize to tenths, so allow a generous band —
  // what matters is that it tracks the mix and keeps its ordering.
  for (const b of CANONICAL_BANDS) {
    const target = mix.find((m) => m.difficulty_band === b).target_pct;
    assert.ok(Math.abs(counts[b] - target) <= 15, `${b}: got ${counts[b]}%, target ${target}%`);
  }
  assert.ok(counts.expert > counts.practitioner, "expert is the biggest share in this mix");
  assert.ok(counts.practitioner > counts.foundational, "practitioner outweighs foundational here");
});

test("difficultyFor is deterministic per slot", () => {
  const mix = [{ difficulty_band: "foundational", target_pct: 50 }, { difficulty_band: "expert", target_pct: 50 }];
  for (let slot = 0; slot < 30; slot++) {
    assert.equal(difficultyFor(mix, slot), difficultyFor(mix, slot));
    assert.equal(difficultyFor(mix, slot), difficultyFor(mix, slot + 10), "the bag has period 10");
  }
});

// ── resolveRowDifficulty ─────────────────────────────────────────────────────

test("resolveRowDifficulty ignores the model for `difficulty` (D1) and keeps it in difficulty_raw (D2)", () => {
  assert.deepEqual(resolveRowDifficulty("expert", "easy"), { difficulty: "expert", difficulty_raw: "easy" });
  assert.deepEqual(resolveRowDifficulty("foundational", "expert"),
    { difficulty: "foundational", difficulty_raw: "expert" });
  assert.deepEqual(resolveRowDifficulty("practitioner", "Medium-ish, honestly"),
    { difficulty: "practitioner", difficulty_raw: "Medium-ish, honestly" });
});

test("resolveRowDifficulty canonicalizes the assigned band", () => {
  assert.equal(resolveRowDifficulty("easy", null).difficulty, "foundational");
  assert.equal(resolveRowDifficulty(" HARD ", null).difficulty, "expert");
});

test("resolveRowDifficulty records nothing as null, never as an empty string", () => {
  for (const v of [null, undefined, "", "   "]) {
    assert.equal(resolveRowDifficulty("expert", v).difficulty_raw, null, `raw for ${JSON.stringify(v)}`);
  }
});

test("resolveRowDifficulty always yields a band the CHECK accepts", () => {
  for (const assigned of ["expert", "easy", "banana", "", null, undefined, 7]) {
    const got = resolveRowDifficulty(assigned, "whatever").difficulty;
    assert.ok(CANONICAL_BANDS.includes(got), `assigned ${JSON.stringify(assigned)} -> ${got}`);
  }
  assert.equal(resolveRowDifficulty("banana", null).difficulty, "practitioner", "unknown falls back, loudly canonical");
});

// ── the two copies of the vocabulary ─────────────────────────────────────────

test("scripts/far287/lib/difficulty.mjs produces identical output to src's copy", () => {
  assert.deepEqual(cli.CANONICAL_BANDS, CANONICAL_BANDS);
  assert.deepEqual(cli.LEGACY_ALIASES, LEGACY_ALIASES);
  const inputs = ["easy", "medium", "hard", "foundational", "practitioner", "expert",
    " Easy ", "HARD", "banana", "", null, undefined, 7];
  for (const v of inputs) assert.equal(cli.canonicalDifficulty(v), canonicalDifficulty(v), `canonical(${v})`);
  const mixes = [[], [{ difficulty_band: "easy", target_pct: 40 }, { difficulty_band: "hard", target_pct: 60 }],
    [{ difficulty_band: "foundational", target_pct: 14.41 }, { difficulty_band: "practitioner", target_pct: 29.82 },
      { difficulty_band: "expert", target_pct: 55.77 }]];
  for (const mix of mixes) {
    for (let slot = 0; slot < 50; slot++) {
      assert.equal(cli.difficultyFor(mix, slot), difficultyFor(mix, slot), `difficultyFor(${JSON.stringify(mix)}, ${slot})`);
    }
  }
  for (const v of inputs) {
    assert.deepEqual(cli.resolveRowDifficulty(v, v), resolveRowDifficulty(v, v), `resolveRowDifficulty(${v})`);
  }
});

// ── source guard: the legacy vocabulary must never reach the model again ─────

test("no prompt asks the model for easy|medium|hard", () => {
  for (const rel of ["src/lib/generation/prompts.js", "scripts/far287/lib/prompts.mjs"]) {
    const src = readFileSync(join(REPO, rel), "utf8");
    assert.ok(!src.includes("easy|medium|hard"), `${rel} still requests the legacy vocabulary`);
    assert.ok(src.includes('"difficulty": "foundational|practitioner|expert"'),
      `${rel} must request the canonical vocabulary`);
  }
});

test("neither insert path writes the model's self-reported difficulty", () => {
  for (const rel of ["src/lib/generation/worker.ts", "scripts/far287/generate-puzzles.mjs"]) {
    const src = readFileSync(join(REPO, rel), "utf8");
    assert.ok(!/difficulty:\s*el[?.]/.test(src),
      `${rel} must not assign the model value to difficulty`);
    assert.ok(src.includes("resolveRowDifficulty("), `${rel} must resolve difficulty through the canon module`);
  }
});

// helper: how many of `count` slots land in each band
function tally(mix, from, count) {
  const counts = {};
  for (let slot = from; slot < from + count; slot++) {
    const b = difficultyFor(mix, slot);
    counts[b] = (counts[b] || 0) + 1;
  }
  return counts;
}

// ═══════════════════════════════════════════════════════════════════════════
// CC-DC-GEN-DIFFICULTY-ALLOCATION-1.0 — planDifficulty
// ═══════════════════════════════════════════════════════════════════════════
//
// The standing guard that generated difficulty MATCHES the configured season
// mix (to within one puzzle per game) and FOLLOWS the configured curve. Before
// this, Football's 14.41/29.82/55.77 went through a 10-slot bag and the season
// banked 120 foundational / 178 practitioner / 297 expert where the mix wanted
// 85 / 180 / 330 (measured 2026-10-06 against dc_puzzle_bank_staging).

// The live Football Season fixture: season 02701ead-a03e-4489-adb9-24d3c6787eec,
// 2026-10-05 .. 2027-01-31 = 119 dates, 5 enabled games, config
// 3bf84bc8-f202-4a2d-9a89-9dcc38f36711 (active, v1, difficulty_curve = ramp),
// season_difficulty_mix 14.41 / 29.82 / 55.77.
const FOOTBALL_SEED = "02701ead-a03e-4489-adb9-24d3c6787eec";
const FOOTBALL_MIX = [
  { difficulty_band: "foundational", target_pct: 14.41 },
  { difficulty_band: "practitioner", target_pct: 29.82 },
  { difficulty_band: "expert", target_pct: 55.77 },
];
const FOOTBALL_TYPES = ["grid", "thread", "brief", "signal", "ladder"];
const FOOTBALL_DATES = seasonDates("2026-10-05", 119);

function seasonDates(startsOn, n) {
  const out = [];
  const t = new Date(startsOn + "T12:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

/** The bands one type got, in date order. */
function laneOf(plan, type, dates = FOOTBALL_DATES) {
  return dates.map((d) => plan.get(`${type}|${d}`));
}

function countBands(bands) {
  const out = { foundational: 0, practitioner: 0, expert: 0 };
  for (const b of bands) out[b] += 1;
  return out;
}

/** 0 = foundational, 1 = practitioner, 2 = expert. */
const depth = (b) => CANONICAL_BANDS.indexOf(b);
const meanDepth = (bands) => bands.reduce((a, b) => a + depth(b), 0) / bands.length;

function longestRun(bands) {
  let best = 0, run = 0, prev = null;
  for (const b of bands) {
    run = b === prev ? run + 1 : 1;
    prev = b;
    if (run > best) best = run;
  }
  return best;
}

const football = (curve) =>
  planDifficulty({ dates: FOOTBALL_DATES, types: FOOTBALL_TYPES, mix: FOOTBALL_MIX, curve, seed: FOOTBALL_SEED });

// ── D2: totals match the mix, per type, to the puzzle ───────────────────────

test("every type lands EXACTLY the largest-remainder counts for the Football mix", () => {
  // 14.41% of 119 = 17.15 -> 17; 29.82% = 35.49 -> 35 + the single leftover
  // (largest remainder) = 36; 55.77% = 66.37 -> 66. 17 + 36 + 66 = 119.
  for (const curve of DIFFICULTY_CURVES) {
    const plan = football(curve);
    for (const type of FOOTBALL_TYPES) {
      assert.deepEqual(countBands(laneOf(plan, type)), { foundational: 17, practitioner: 36, expert: 66 },
        `${curve}/${type}`);
    }
    assert.equal(plan.size, FOOTBALL_TYPES.length * FOOTBALL_DATES.length, `${curve}: one band per slot`);
  }
});

test("difficultyTargets states the same counts without building the calendar", () => {
  assert.deepEqual(difficultyTargets(FOOTBALL_MIX, 119), { foundational: 17, practitioner: 36, expert: 66 });
  // ...and the season total is 5 x that, which is what the mix asked for:
  // 85 / 180 / 330 rather than the 120 / 178 / 297 the 10-slot bag produced.
  assert.deepEqual(
    Object.fromEntries(CANONICAL_BANDS.map((b) => [b, difficultyTargets(FOOTBALL_MIX, 119)[b] * 5])),
    { foundational: 85, practitioner: 180, expert: 330 }
  );
});

test("the plan is within ONE puzzle of the mix for any season length and any mix", () => {
  const mixes = [
    FOOTBALL_MIX,
    [{ difficulty_band: "foundational", target_pct: 33.34 }, { difficulty_band: "practitioner", target_pct: 33.33 },
      { difficulty_band: "expert", target_pct: 33.33 }],
    [{ difficulty_band: "easy", target_pct: 1 }, { difficulty_band: "hard", target_pct: 99 }],
    [{ difficulty_band: "expert", target_pct: 100 }],
  ];
  for (const mix of mixes) {
    const weights = mixWeights(mix);
    const share = weights.map((w) => w / weights.reduce((a, v) => a + v, 0));
    for (const n of [1, 2, 7, 13, 119, 365, 500]) {
      const dates = seasonDates("2026-01-01", n);
      for (const curve of DIFFICULTY_CURVES) {
        const plan = planDifficulty({ dates, types: ["grid"], mix, curve, seed: "s" });
        const got = countBands(laneOf(plan, "grid", dates));
        CANONICAL_BANDS.forEach((b, i) => {
          assert.ok(Math.abs(got[b] - share[i] * n) < 1,
            `${curve} n=${n} ${b}: got ${got[b]}, ideal ${(share[i] * n).toFixed(3)}`);
        });
        assert.equal(got.foundational + got.practitioner + got.expert, n, "every date gets exactly one band");
      }
    }
  }
});

test("the plan only ever emits canonical bands (D6 — the staging CHECK)", () => {
  for (const curve of [...DIFFICULTY_CURVES, "spiral", "", null]) {
    for (const mix of [undefined, [], [{ difficulty_band: "banana", target_pct: 100 }],
      [{ difficulty_band: null, target_pct: 0 }]]) {
      const plan = planDifficulty({ dates: FOOTBALL_DATES, types: ["grid"], mix, curve, seed: "s" });
      for (const b of plan.values()) assert.ok(CANONICAL_BANDS.includes(b), `${curve}: ${b}`);
    }
  }
});

test("a mix of only junk degrades to 40/40/20, never to junk or to nothing", () => {
  const dates = seasonDates("2026-01-01", 100);
  const plan = planDifficulty({ dates, types: ["grid"], mix: [{ difficulty_band: "banana", target_pct: 100 }],
    curve: "flat", seed: "s" });
  assert.deepEqual(countBands(laneOf(plan, "grid", dates)), { foundational: 40, practitioner: 40, expert: 20 });
});

// ── D3: the curve decides WHICH dates, never HOW MANY ───────────────────────

test("flat spreads the bands — no run of more than 3 identical bands", () => {
  const plan = football("flat");
  for (const type of FOOTBALL_TYPES) {
    const lane = laneOf(plan, type);
    assert.ok(longestRun(lane) <= 3, `${type}: longest run ${longestRun(lane)} — ${lane.slice(0, 20).join(",")}`);
  }
});

test("flat does not drift — its first and last quarter are the same depth, within a hair", () => {
  const plan = football("flat");
  for (const type of FOOTBALL_TYPES) {
    const lane = laneOf(plan, type);
    const q = Math.floor(lane.length / 4);
    assert.ok(Math.abs(meanDepth(lane.slice(0, q)) - meanDepth(lane.slice(-q))) < 0.35,
      `${type}: flat must not ramp`);
  }
});

test("flat gives different types different calendars (the seed carries the type)", () => {
  const plan = football("flat");
  const lanes = FOOTBALL_TYPES.map((t) => laneOf(plan, t).join(","));
  assert.equal(new Set(lanes).size, FOOTBALL_TYPES.length, "two games must not stack their expert days");
});

test("ramp gets deeper as the season runs — first quarter shallower than last", () => {
  const plan = football("ramp");
  for (const type of FOOTBALL_TYPES) {
    const lane = laneOf(plan, type);
    const q = Math.floor(lane.length / 4);
    assert.ok(meanDepth(lane.slice(0, q)) < meanDepth(lane.slice(-q)),
      `${type}: ramp must deepen (${meanDepth(lane.slice(0, q))} -> ${meanDepth(lane.slice(-q))})`);
    // and it is monotone, not merely deeper on average
    assert.equal(lane[0], "foundational");
    assert.equal(lane[lane.length - 1], "expert");
  }
});

test("wave peaks in the middle and eases off at both ends", () => {
  const plan = football("wave");
  for (const type of FOOTBALL_TYPES) {
    const lane = laneOf(plan, type);
    const q = Math.floor(lane.length / 4);
    const middle = lane.slice(q, lane.length - q);
    const ends = [...lane.slice(0, q), ...lane.slice(-q)];
    assert.ok(meanDepth(middle) > meanDepth(ends), `${type}: the wave crest is mid-season`);
    // symmetric: neither end is the hard end
    assert.ok(Math.abs(meanDepth(lane.slice(0, q)) - meanDepth(lane.slice(-q))) < 0.35, `${type}: wave is symmetric`);
    assert.equal(lane[0], "foundational");
    assert.equal(lane[lane.length - 1], "foundational");
  }
});

test("custom places exactly as flat — the shape is unsupported, the totals are not", () => {
  const flat = football("flat");
  const custom = football("custom");
  for (const type of FOOTBALL_TYPES) assert.deepEqual(laneOf(custom, type), laneOf(flat, type), type);
});

test("an unknown curve reads as flat rather than failing the season", () => {
  assert.equal(normalizeCurve("spiral"), "flat");
  assert.equal(normalizeCurve(null), "flat");
  assert.equal(normalizeCurve(" RAMP "), "ramp");
  for (const c of DIFFICULTY_CURVES) assert.equal(normalizeCurve(c), c);
  const flat = football("flat");
  const bogus = football("spiral");
  for (const type of FOOTBALL_TYPES) assert.deepEqual(laneOf(bogus, type), laneOf(flat, type), type);
});

test("the curve moves dates, never totals", () => {
  const counts = DIFFICULTY_CURVES.map((c) => JSON.stringify(countBands(laneOf(football(c), "grid"))));
  assert.equal(new Set(counts).size, 1, "every curve must bank the same number of each band");
  assert.notDeepEqual(laneOf(football("ramp"), "grid"), laneOf(football("flat"), "grid"));
  assert.notDeepEqual(laneOf(football("wave"), "grid"), laneOf(football("ramp"), "grid"));
});

// ── D4: determinism ─────────────────────────────────────────────────────────

test("planDifficulty is deterministic — same inputs, identical plan", () => {
  for (const curve of DIFFICULTY_CURVES) {
    const a = football(curve);
    const b = football(curve);
    assert.deepEqual([...a.entries()], [...b.entries()], curve);
  }
});

test("a different season id reshuffles a flat calendar but not a curved one's totals", () => {
  const other = planDifficulty({ dates: FOOTBALL_DATES, types: FOOTBALL_TYPES, mix: FOOTBALL_MIX,
    curve: "flat", seed: "11111111-2222-3333-4444-555555555555" });
  assert.notDeepEqual(laneOf(other, "grid"), laneOf(football("flat"), "grid"));
  assert.deepEqual(countBands(laneOf(other, "grid")), { foundational: 17, practitioner: 36, expert: 66 });
});

test("planDifficulty is total: empty dates or empty types give an empty plan", () => {
  assert.equal(planDifficulty({ dates: [], types: FOOTBALL_TYPES, mix: FOOTBALL_MIX }).size, 0);
  assert.equal(planDifficulty({ dates: FOOTBALL_DATES, types: [], mix: FOOTBALL_MIX }).size, 0);
  assert.equal(planDifficulty(undefined).size, 0);
  assert.equal(planDifficulty({}).size, 0);
});

// ── D5: the per-game seam ───────────────────────────────────────────────────

test("perTypeMix overrides the season mix for that type only (D5 seam)", () => {
  const plan = planDifficulty({
    dates: FOOTBALL_DATES, types: FOOTBALL_TYPES, mix: FOOTBALL_MIX, curve: "flat", seed: FOOTBALL_SEED,
    perTypeMix: { brief: [{ difficulty_band: "foundational", target_pct: 100 }] },
  });
  assert.deepEqual(countBands(laneOf(plan, "brief")), { foundational: 119, practitioner: 0, expert: 0 });
  for (const type of FOOTBALL_TYPES.filter((t) => t !== "brief"))
    assert.deepEqual(countBands(laneOf(plan, type)), { foundational: 17, practitioner: 36, expert: 66 }, type);
});

test("omitting perTypeMix is the same as supplying the season mix for every type", () => {
  const withPer = planDifficulty({
    dates: FOOTBALL_DATES, types: FOOTBALL_TYPES, mix: FOOTBALL_MIX, curve: "ramp", seed: FOOTBALL_SEED,
    perTypeMix: Object.fromEntries(FOOTBALL_TYPES.map((t) => [t, FOOTBALL_MIX])),
  });
  assert.deepEqual([...withPer.entries()], [...football("ramp").entries()]);
});

// ── curvePoints is now authoritative, not a preview ─────────────────────────

test("curvePoints returns EXACTLY n points — a long season is not truncated", () => {
  for (const n of [1, 2, 3, 24, 119, 365, 500]) {
    for (const c of DIFFICULTY_CURVES) assert.equal(curvePoints(c, n).length, n, `${c}/${n}`);
  }
  assert.deepEqual(curvePoints("ramp", 0), []);
});

test("curvePoints keeps the shapes the editor previews", () => {
  assert.deepEqual(curvePoints("ramp", 5), [0, 0.25, 0.5, 0.75, 1]);
  assert.ok(curvePoints("flat", 5).every((v) => v === 0.5));
  assert.ok(curvePoints("custom", 5).every((v) => v === 0.5));
  const wave = curvePoints("wave", 41);
  assert.ok(wave.every((v) => v >= 0 && v <= 1));
  assert.equal(wave[0], 0);
  assert.equal(wave[20], 1);
  assert.equal(wave[40], 0);
});

test("season-config-logic re-exports the same curve module the generator uses", async () => {
  const cfg = await import("../league-office/season-config-logic.ts");
  assert.equal(cfg.curvePoints, curvePoints, "one function, not two copies");
  assert.deepEqual([...cfg.DIFFICULTY_CURVES], [...DIFFICULTY_CURVES]);
});

// ── largestRemainder is the same apportionment theme allocation uses ────────

test("largestRemainder agrees with the theme allocator's copy", async () => {
  const theme = await import("./theme-allocation.js");
  const cases = [
    [[14.41, 29.82, 55.77], 119], [[1, 1, 1], 100], [[0, 0, 0], 7], [[100], 13],
    [[50, 50], 1], [[33.33, 33.33, 33.34], 365], [[1, 99], 2], [[], 10], [[5, 5], 0],
  ];
  for (const [w, n] of cases)
    assert.deepEqual(largestRemainder(w, n), theme.largestRemainder(w, n), `${JSON.stringify(w)} / ${n}`);
});

// ── the two copies of the allocator ─────────────────────────────────────────

test("scripts/far287/lib/difficulty.mjs plans identically to src's copy", () => {
  assert.deepEqual([...cli.DIFFICULTY_CURVES], [...DIFFICULTY_CURVES]);
  assert.equal(cli.CURVE_CUSTOM_WARNING, CURVE_CUSTOM_WARNING);
  for (const c of [...DIFFICULTY_CURVES, "spiral", null]) assert.equal(cli.normalizeCurve(c), normalizeCurve(c));
  for (const n of [1, 5, 24, 119]) for (const c of DIFFICULTY_CURVES)
    assert.deepEqual(cli.curvePoints(c, n), curvePoints(c, n), `curvePoints(${c}, ${n})`);
  for (const curve of DIFFICULTY_CURVES) {
    const mine = planDifficulty({ dates: FOOTBALL_DATES, types: FOOTBALL_TYPES, mix: FOOTBALL_MIX, curve, seed: FOOTBALL_SEED });
    const theirs = cli.planDifficulty({ dates: FOOTBALL_DATES, types: FOOTBALL_TYPES, mix: FOOTBALL_MIX, curve, seed: FOOTBALL_SEED });
    assert.deepEqual([...theirs.entries()], [...mine.entries()], `planDifficulty(${curve})`);
  }
  assert.deepEqual(cli.difficultyTargets(FOOTBALL_MIX, 119), difficultyTargets(FOOTBALL_MIX, 119));
  assert.deepEqual(cli.mixWeights(FOOTBALL_MIX), mixWeights(FOOTBALL_MIX));
});

// ── the worker actually uses the plan ───────────────────────────────────────

test("the worker allocates from the season plan, not from the 10-slot bag", () => {
  const src = readFileSync(join(REPO, "src/lib/generation/worker.ts"), "utf8");
  assert.match(src, /planDifficulty\(\{/, "the worker must build a season-wide plan");
  assert.doesNotMatch(src, /difficultyFor\(/, "the 10-slot bag must not decide a banked puzzle's band");
  assert.match(src, /difficulty_curve/, "the worker must read the configured curve");
});
