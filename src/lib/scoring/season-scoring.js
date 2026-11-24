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

/** A score ceiling is only meaningful ABOVE zero: a 0 ceiling is not a cap,
 *  it is every completion for that game scoring nothing. Anything missing,
 *  non-numeric, non-finite or non-positive falls back to the platform
 *  default — the one value that can never surprise a player. */
function ceilingOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** A penalty percentage, on the other hand, is meaningful AT zero — that is
 *  "no penalty", the commonest configuration. Anything missing or malformed
 *  falls back to it. */
function penaltyOr(v, fallback) {
  const n = Number(v);
  return v !== "" && v !== null && v !== undefined && Number.isFinite(n) && n >= 0 ? n : fallback;
}

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
 * Defaults are the identity transform: pointsMax 150 + hintPenaltyPct 0
 * returns the raw score unchanged.
 *
 * DO NOT read that as "the answer for every season that configures neither".
 * It was written here once and it was wrong: `hint_penalty_pct` is
 * `numeric NOT NULL DEFAULT 25.00`, so a season that configures nothing
 * arrives with 25, not 0, and `?? 0` can only fire when there is no
 * configuration in force at all. Seven of ten rows sat on that un-chosen 25.00
 * when this was written. The default is being migrated to 0.00
 * (supabase/migrations/20261006230000_…) precisely because the code could not
 * tell "nobody chose" from "somebody chose 25" — this function never could and
 * never will. It applies the rules it is handed.
 */
export function seasonScore({ rawScore, rules, hintsUsed } = {}) {
  const raw = clamp(rawScore, 0, RAW_SCORE_MAX);
  // A malformed ceiling falls back to the platform default, NOT to 0. The
  // earlier `|| 0` here did the opposite: garbage in `pointsMax` zeroed the
  // player's score, which is the single worst outcome this function can
  // produce and the exact opposite of its stated fail-soft intent.
  const pointsMax = ceilingOr(rules?.pointsMax, RAW_SCORE_MAX);
  // A malformed penalty falls back to NO penalty, for the same reason.
  const penaltyPct = penaltyOr(rules?.hintPenaltyPct, 0);
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

// `scoringPathFor` lived here and is DELETED. It decided whether a POST took
// the new scaling path or the pre-pack one, on `scoringVersion === 2`. Myke
// ruled 2026-10-06 that the server scales EVERY write: a leaderboard whose
// rows mean different things depending on which bundle the player had cached
// is worse than a stale client briefly displaying a number smaller than the
// one that was stored. There is no second path left for it to choose.
