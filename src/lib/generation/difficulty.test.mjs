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
