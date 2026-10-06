// CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 (D7) — season scoring, PURE.
//
// The one place that turns a game's RAW score (0..150, what calcScore has
// always produced) into the score the season actually awards. Three season
// settings were stored-only until this module existed:
//
//   season_games.points_override    the game's ceiling (null ⇒ the 150 default)
//   season_config.hint_penalty_pct  per hint revealed, 0..3 hints
//   season_config.streak_bonus_enabled  (enforced by the CALLER, see below)
//
// Plain JS, no imports, no I/O, no framework: it is loaded verbatim by
// `src/components/DailyChallenge.jsx` (a client component) AND by
// `src/app/api/score/route.ts` (server, service role), which is the only way
// the number the player sees and the number the database stores can be the
// same number by construction rather than by two copies agreeing today.
//
// NOT in here: the streak multiplier. By the time a raw score reaches this
// function the client's calcScore has ALREADY folded the readiness multiplier
// in, so `streak_bonus_enabled = false` cannot be undone downstream — it is
// enforced by feeding calcScore streak = 0 at the call site. See CLAUDE.md.
//
// Tests: `npm run test:season-scoring`.

/** The raw ceiling every game's calcScore tops out at. */
export const RAW_SCORE_MAX = 150;

function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The season's score for one completion.
 *
 *   round( clamp(raw,0,150) × pointsMax/150 × (1 − min(hintPenaltyPct × hints, 100)/100) )
 *
 * Every input is clamped rather than validated: this runs on a client-supplied
 * raw score and a client-supplied hint count, and a refusal here would mean a
 * completion that cannot be written at all. The RULES, by contrast, are never
 * client-supplied on the server path — /api/score resolves them itself.
 *
 * Defaults are the identity transform: pointsMax 150 + hintPenaltyPct 0 returns
 * the raw score unchanged, which is exactly the pre-pack behaviour and the
 * answer for every season that configures neither.
 */
export function seasonScore({ rawScore, rules, hintsUsed } = {}) {
  const raw = clamp(rawScore, 0, RAW_SCORE_MAX);
  const pointsMax = Math.max(0, Number(rules?.pointsMax ?? RAW_SCORE_MAX) || 0);
  const penaltyPct = Math.max(0, Number(rules?.hintPenaltyPct ?? 0) || 0);
  const hints = clamp(hintsUsed, 0, 3);

  const scaled = raw * (pointsMax / RAW_SCORE_MAX);
  const penalty = Math.min(penaltyPct * hints, 100) / 100;
  return Math.round(scaled * (1 - penalty));
}

/**
 * The rules for one game out of the `rules.scoring` block /api/challenge/today
 * ships, or out of nothing at all. Missing game, missing block, missing field —
 * all fall through to the identity defaults, so a lobby served before this
 * pack shipped (or by a season with no config) scores exactly as it did.
 */
export function gameScoringRules(scoring, gameType) {
  const entry = scoring && typeof scoring === "object" ? scoring[gameType] : null;
  const pointsMax =
    entry && Number.isFinite(Number(entry.pointsMax)) ? Number(entry.pointsMax) : RAW_SCORE_MAX;
  const hintPenaltyPct =
    entry && Number.isFinite(Number(entry.hintPenaltyPct)) ? Number(entry.hintPenaltyPct) : 0;
  return { pointsMax, hintPenaltyPct };
}

/** `streak_bonus_enabled`. Absent ⇒ true, the column default and the behaviour
 *  every season had before the flag was readable. */
export function streakBonusEnabled(scoring) {
  return !(scoring && typeof scoring === "object" && scoring.streakBonus === false);
}

/** The streak to hand calcScore: 0 kills the readiness multiplier outright,
 *  which is the only moment at which `streak_bonus_enabled = false` can be
 *  applied (the multiplier is already baked into the raw score after this). */
export function effectiveStreak(streak, scoring) {
  return streakBonusEnabled(scoring) ? streak : 0;
}

/**
 * Which scoring path a POST /api/score body takes. Pure, and deliberately
 * strict: ONLY the literal number 2 opts in. "2", 2.0-as-a-string, true, a
 * larger future version — all of them fall back to `legacy`, because the
 * failure mode worth protecting against is a client accidentally opting into
 * a rescore, never a client accidentally missing one.
 *
 * `legacy` means byte-for-byte today's behaviour: the score the caller sent is
 * the score that is written. That is what a browser holding a cached bundle
 * from before this deploy does, and it must keep working unchanged.
 */
export function scoringPathFor(body) {
  return body && body.scoringVersion === 2 ? "v2" : "legacy";
}
