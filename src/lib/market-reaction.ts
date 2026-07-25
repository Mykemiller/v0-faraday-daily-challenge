// Market Reaction Speed (FAR-388) — reframes raw solve time as a market-analyst
// verdict instead of a stopwatch. Three bands (D6), measured against a per-game
// par time (D7). No countdown, no pressure, no red states (D10) — this is a
// measurement, not a threat. The raw seconds stay visible but secondary (D8);
// this module only classifies.

/**
 * Par (target) solve time per game, in seconds. Seed values — tune later against
 * real completion data (D7). Keys are the exact puzzleType strings the games pass
 * to ScoreCard.
 */
export const PAR_TIMES: Readonly<Record<string, number>> = Object.freeze({
  Rackl: 90,
  "Signal Drop": 60,
  "The Stack": 75,
  Circuit: 120,
  "The Brief": 150,
  "Dark Fiber": 90,
  Frequency: 60,
});

export type MarketReactionTier = "ahead" | "on" | "laggard";

export interface MarketReaction {
  tier: MarketReactionTier;
  label: string;
  /** elapsed / par, rounded to 2 dp — for display/analytics, not styling. */
  ratio: number;
  elapsedSec: number;
  parSec: number;
}

// Band cut points (D6). ratio < 0.5 ⇒ ahead; 0.5–1.25 (inclusive) ⇒ on; >1.25 ⇒ laggard.
const AHEAD_MAX = 0.5;
const ON_MAX = 1.25;

const LABELS: Record<MarketReactionTier, string> = {
  ahead: "Ahead of Consensus",
  on: "On Consensus",
  laggard: "Market Laggard",
};

/**
 * Classify an elapsed solve time for a game into its Market Reaction band.
 * Returns null when we can't classify (unknown game / no par, or no usable
 * elapsed time) so the caller can simply render nothing — display-only and
 * graceful (D9).
 */
export function resolveMarketReaction(
  gameType: string,
  elapsedSec: number | null | undefined
): MarketReaction | null {
  const parSec = PAR_TIMES[gameType];
  if (!parSec || parSec <= 0) return null;
  if (typeof elapsedSec !== "number" || !Number.isFinite(elapsedSec) || elapsedSec < 0) {
    return null;
  }
  const ratio = elapsedSec / parSec;
  const tier: MarketReactionTier =
    ratio < AHEAD_MAX ? "ahead" : ratio <= ON_MAX ? "on" : "laggard";
  return {
    tier,
    label: LABELS[tier],
    ratio: Math.round(ratio * 100) / 100,
    elapsedSec: Math.round(elapsedSec),
    parSec,
  };
}
