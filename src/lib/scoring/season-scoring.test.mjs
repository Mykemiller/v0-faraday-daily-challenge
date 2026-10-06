// CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 (D7) — season scoring.
//   npm run test:season-scoring

import test from "node:test";
import assert from "node:assert/strict";

import {
  seasonScore,
  gameScoringRules,
  streakBonusEnabled,
  effectiveStreak,
  scoringPathFor,
  RAW_SCORE_MAX,
} from "./season-scoring.js";

test("the worked example: 120 raw, 500 ceiling, 10% per hint, 1 hint → 360", () => {
  assert.equal(
    seasonScore({ rawScore: 120, rules: { pointsMax: 500, hintPenaltyPct: 10 }, hintsUsed: 1 }),
    360
  );
});

test("no points_override is the identity transform — raw in, raw out", () => {
  for (const raw of [0, 1, 73, 149, 150]) {
    assert.equal(
      seasonScore({ rawScore: raw, rules: { pointsMax: RAW_SCORE_MAX, hintPenaltyPct: 0 }, hintsUsed: 0 }),
      raw,
      `raw ${raw}`
    );
    // …and so is an absent rules object, which is what a season with no config
    // (or a client served before this pack shipped) produces.
    assert.equal(seasonScore({ rawScore: raw }), raw, `raw ${raw}, no rules`);
  }
});

test("the hint penalty is capped at 100% — 3 hints at 40% is zero, never negative", () => {
  assert.equal(
    seasonScore({ rawScore: 150, rules: { pointsMax: 500, hintPenaltyPct: 40 }, hintsUsed: 3 }),
    0
  );
  // 4 hints cannot exist (the budget is 3) but must not go below zero either.
  assert.equal(
    seasonScore({ rawScore: 150, rules: { pointsMax: 500, hintPenaltyPct: 40 }, hintsUsed: 9 }),
    0
  );
});

test("hints are clamped to 0..3 and the raw score to 0..150", () => {
  const rules = { pointsMax: 500, hintPenaltyPct: 10 };
  // hintsUsed below zero reads as zero, not as a bonus.
  assert.equal(seasonScore({ rawScore: 150, rules, hintsUsed: -5 }), 500);
  // A raw score above the ceiling cannot buy more than a perfect game.
  assert.equal(seasonScore({ rawScore: 9999, rules, hintsUsed: 0 }), 500);
  assert.equal(seasonScore({ rawScore: -40, rules, hintsUsed: 0 }), 0);
});

test("Football's real ceilings, measured 2026-10-06", () => {
  const pct = 10; // season_config.hint_penalty_pct for the Football season
  // Rackl / The Brief / Dark Fiber: 500. Frequency / The Stack: 250.
  assert.equal(seasonScore({ rawScore: 150, rules: { pointsMax: 500, hintPenaltyPct: pct }, hintsUsed: 0 }), 500);
  assert.equal(seasonScore({ rawScore: 150, rules: { pointsMax: 250, hintPenaltyPct: pct }, hintsUsed: 0 }), 250);
  assert.equal(seasonScore({ rawScore: 150, rules: { pointsMax: 500, hintPenaltyPct: pct }, hintsUsed: 3 }), 350);
  assert.equal(seasonScore({ rawScore: 100, rules: { pointsMax: 250, hintPenaltyPct: pct }, hintsUsed: 2 }), 133);
});

test("garbage in every slot degrades to the identity transform, never to NaN", () => {
  for (const bad of [null, undefined, "", NaN, {}, [], "abc"]) {
    const out = seasonScore({ rawScore: 120, rules: { pointsMax: bad, hintPenaltyPct: bad }, hintsUsed: bad });
    assert.ok(Number.isFinite(out), `pointsMax/hintPenaltyPct/hintsUsed = ${String(bad)}`);
  }
  assert.equal(seasonScore({ rawScore: "abc", rules: null, hintsUsed: null }), 0);
  assert.equal(seasonScore(), 0);
});

test("gameScoringRules reads the /api/challenge/today block, and defaults everything missing", () => {
  const scoring = {
    Rackl: { pointsMax: 500, hintPenaltyPct: 10 },
    "The Stack": { pointsMax: 250, hintPenaltyPct: 10 },
    streakBonus: true,
  };
  assert.deepEqual(gameScoringRules(scoring, "Rackl"), { pointsMax: 500, hintPenaltyPct: 10 });
  assert.deepEqual(gameScoringRules(scoring, "The Stack"), { pointsMax: 250, hintPenaltyPct: 10 });
  // A game the season does not configure scores at the platform default.
  assert.deepEqual(gameScoringRules(scoring, "Circuit"), { pointsMax: 150, hintPenaltyPct: 0 });
  assert.deepEqual(gameScoringRules(null, "Rackl"), { pointsMax: 150, hintPenaltyPct: 0 });
  assert.deepEqual(gameScoringRules(undefined, "Rackl"), { pointsMax: 150, hintPenaltyPct: 0 });
  // `streakBonus` shares the namespace with the runtime keys and must never be
  // mistaken for a game's rules.
  assert.deepEqual(gameScoringRules(scoring, "streakBonus"), { pointsMax: 150, hintPenaltyPct: 0 });
});

test("streakBonusEnabled defaults to true and only `false` turns it off", () => {
  assert.equal(streakBonusEnabled(null), true);
  assert.equal(streakBonusEnabled({}), true);
  assert.equal(streakBonusEnabled({ streakBonus: true }), true);
  assert.equal(streakBonusEnabled({ streakBonus: false }), false);
  assert.equal(effectiveStreak(12, { streakBonus: true }), 12);
  assert.equal(effectiveStreak(12, { streakBonus: false }), 0);
  assert.equal(effectiveStreak(12, null), 12);
});

test("the route-level decision: only the literal 2 opts into v2", () => {
  assert.equal(scoringPathFor({ scoringVersion: 2 }), "v2");
  // Everything else is the legacy path — including a stale cached client,
  // which sends no scoringVersion at all and must keep scoring as it did.
  assert.equal(scoringPathFor({}), "legacy");
  assert.equal(scoringPathFor({ scoringVersion: "2" }), "legacy");
  assert.equal(scoringPathFor({ scoringVersion: 1 }), "legacy");
  assert.equal(scoringPathFor({ scoringVersion: 3 }), "legacy");
  assert.equal(scoringPathFor({ scoringVersion: true }), "legacy");
  assert.equal(scoringPathFor({ scoringVersion: null }), "legacy");
  assert.equal(scoringPathFor(null), "legacy");
  assert.equal(scoringPathFor(undefined), "legacy");
});

test("the legacy path is the identity on the written score, for any raw value", () => {
  // What /api/score does when scoringPathFor says `legacy`: it writes the
  // number it was sent. Asserted as the contract, so a future edit that starts
  // transforming the legacy score has to break this test to do it.
  for (const raw of [0, 42, 150, 500]) {
    const written = scoringPathFor({ score: raw }) === "v2"
      ? seasonScore({ rawScore: raw, rules: { pointsMax: 500, hintPenaltyPct: 10 }, hintsUsed: 3 })
      : raw;
    assert.equal(written, raw, `legacy must not touch ${raw}`);
  }
});
