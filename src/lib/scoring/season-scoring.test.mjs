// CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 (D7) — season scoring.
//   npm run test:season-scoring

import test from "node:test";
import assert from "node:assert/strict";

import {
  seasonScore,
  gameScoringRules,
  streakBonusEnabled,
  effectiveStreak,
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

test("a malformed ceiling falls back to 150 — it must never zero the score", () => {
  // The earlier `|| 0` here sent garbage to pointsMax 0, i.e. a score of zero:
  // the worst outcome this function can produce, from the one input a caller
  // is most likely to get wrong.
  for (const bad of ["", NaN, {}, [], "abc", -5, 0, Infinity]) {
    assert.equal(
      seasonScore({ rawScore: 120, rules: { pointsMax: bad, hintPenaltyPct: 0 }, hintsUsed: 0 }),
      120,
      `pointsMax = ${String(bad)}`
    );
  }
  // 0 included above on purpose: a zero ceiling is not a cap, it is a scoring
  // outage. resolveSeasonScoringRules refuses to emit one and the editor's
  // min is 1, but the arithmetic refuses it too, so a row predating either
  // guard cannot wipe a completion.
  // …and a malformed penalty means NO penalty, for the same reason.
  for (const bad of ["", NaN, {}, [], "abc", -5])
    assert.equal(
      seasonScore({ rawScore: 150, rules: { pointsMax: 500, hintPenaltyPct: bad }, hintsUsed: 3 }),
      500,
      `hintPenaltyPct = ${String(bad)}`
    );
});

test("garbage in every slot stays finite", () => {
  for (const bad of [null, undefined, "", NaN, {}, [], "abc"]) {
    const out = seasonScore({ rawScore: 120, rules: { pointsMax: bad, hintPenaltyPct: bad }, hintsUsed: bad });
    assert.ok(Number.isFinite(out), `all slots = ${String(bad)}`);
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

// ── the safety property, after Myke dropped the legacy branch ───────────────
// /api/score now scales EVERY write, including a POST from a browser on a
// cached bundle that sends no scoringVersion and no hintsUsed. The property
// that has to survive that: no caller can cause a score above the configured
// per-game maximum.

test("a legacy-shaped POST against a 500-max game writes between 0 and 500", () => {
  // Exactly what the route computes for a stale client: hintsUsed absent ⇒ 0.
  const written = (raw) =>
    seasonScore({ rawScore: raw, rules: { pointsMax: 500, hintPenaltyPct: 10 }, hintsUsed: 0 });

  // A perfect game caps at the ceiling and no higher.
  assert.equal(written(150), 500);
  // A raw score that already has the streak multiplier baked in — calcScore
  // itself caps at 150, but assert the arithmetic does not depend on that.
  for (const raw of [150, 151, 300, 2250, 1e9, Infinity]) {
    const v = written(raw);
    assert.ok(v >= 0 && v <= 500, `raw ${raw} wrote ${v}`);
  }
  // …and a hostile or broken client cannot push it negative either.
  for (const raw of [0, -1, -1e9, NaN, "abc", null, undefined]) {
    const v = written(raw);
    assert.ok(v >= 0 && v <= 500, `raw ${String(raw)} wrote ${v}`);
  }
});

test("the ceiling holds for every (ceiling, penalty, hints) combination", () => {
  for (const pointsMax of [1, 150, 250, 500, 10000]) {
    for (const hintPenaltyPct of [0, 10, 25, 40, 100]) {
      for (const hintsUsed of [0, 1, 2, 3, 99]) {
        for (const rawScore of [0, 75, 150, 99999]) {
          const v = seasonScore({ rawScore, rules: { pointsMax, hintPenaltyPct }, hintsUsed });
          assert.ok(
            v >= 0 && v <= pointsMax,
            `${rawScore}/${pointsMax}/${hintPenaltyPct}/${hintsUsed} → ${v}`
          );
        }
      }
    }
  }
});

test("hintsUsed is opt-in: absent means no penalty, never an assumed one", () => {
  const rules = { pointsMax: 500, hintPenaltyPct: 25 };
  assert.equal(seasonScore({ rawScore: 150, rules, hintsUsed: 0 }), 500);
  assert.equal(seasonScore({ rawScore: 150, rules, hintsUsed: undefined }), 500);
  assert.equal(seasonScore({ rawScore: 150, rules, hintsUsed: null }), 500);
  assert.equal(seasonScore({ rawScore: 150, rules }), 500);
});
