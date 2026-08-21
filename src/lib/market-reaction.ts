// Market Reaction Speed (FAR-388) — reframes raw solve time as a market-analyst
// verdict instead of a stopwatch. Three bands (D6), scored PER GAME TYPE. No
// countdown, no pressure, no red states (D10) — this is a measurement, not a
// threat. The raw seconds stay visible but secondary (D8); this module only
// classifies.
//
// Two threshold sources, in priority order:
//   1. PERCENTILE bands — per-game-type terciles (p33/p67 seconds) computed from
//      real persisted solve_seconds (dc_solve_time_bands, recomputed periodically
//      by fn_recompute_solve_time_bands). Used once a game type has accumulated
//      enough timed completions. This is the ticket's canonical model: relative
//      percentile bands, never fixed absolute seconds tuned by hand.
//   2. PAR fallback — the seed target times below. Used on day one and for any
//      game type still below the sample floor, so the band always renders even
//      before data exists. As real data accrues, games transition to percentile
//      scoring automatically.
//
// Percentiles are ALWAYS per game type, never global — a Frequency quiz and a
// Rackl sort take fundamentally different amounts of time (ticket guardrail).

/**
 * Par (target) solve time per game, in seconds — the seed FALLBACK used until a
 * game accumulates enough real solve_seconds to compute percentile terciles.
 *
 * CC-DC-GAME-REGISTRY-1.0: this was a hardcoded table of seven. Par is now
 * `game_catalog.par_seconds`, and the caller passes it in. A game the caller
 * cannot resolve falls back to DEFAULT_PAR_SECONDS rather than losing its band.
 */
export type ParLookup = Readonly<Record<string, number>>;

export type MarketReactionTier = "ahead" | "on" | "laggard";

/** Per-game-type percentile tercile cut points (from dc_solve_time_bands). */
export interface SolveBand {
  /** Fastest-third boundary (seconds): elapsed < p33 ⇒ "Ahead of Consensus". */
  p33Sec: number;
  /** Middle-third boundary (seconds): elapsed ≤ p67 ⇒ "On Pace"; else slow band. */
  p67Sec: number;
  /** How many timed completions the terciles were computed from. */
  sampleSize: number;
}

/** game_type → SolveBand. Surfaced to the client via /api/challenge/today. */
export type SolveBandMap = Readonly<Record<string, SolveBand>>;

export interface MarketReaction {
  tier: MarketReactionTier;
  label: string;
  /** Rounded elapsed seconds — for the secondary display line and analytics. */
  elapsedSec: number;
  /** Which threshold source classified this solve. */
  source: "percentile" | "par";
  /** Ready-to-render secondary line (D8) — raw seconds, source-appropriate. */
  detail: string;
  /** Par-mode only: the seed par time and elapsed/par ratio. */
  parSec?: number;
  ratio?: number;
  /** Percentile-mode only: the tercile cut points that classified this solve. */
  p33Sec?: number;
  p67Sec?: number;
}

// Par-mode band cut points (D6): ratio < 0.5 ⇒ ahead; 0.5–1.25 (inclusive) ⇒ on;
// >1.25 ⇒ slow. Only used in the seed-par fallback path.
const AHEAD_MAX = 0.5;
const ON_MAX = 1.25;

// A percentile band is trusted only once it clears this sample floor. Mirrors the
// RPC's p_min_sample default — the RPC won't even write a row below it, so this is
// a defensive belt-and-braces guard on whatever the client is handed.
export const MIN_SAMPLE_FOR_BANDS = 20;

// Slow-band copy: "Taking the Long View" (Myke, FAR-388 gut-check 2026-07-28) —
// deliberately non-punitive for an engagement-focused institutional audience,
// replacing the harsher "Market Laggard".
const LABELS: Record<MarketReactionTier, string> = {
  ahead: "Ahead of Consensus",
  on: "On Pace",
  laggard: "Taking the Long View",
};

function isUsableElapsed(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * Classify an elapsed solve time for a game into its Market Reaction band.
 *
 * @param gameType   the puzzleType string (e.g. "Signal Drop").
 * @param elapsedSec elapsed solve time in seconds (client-timed).
 * @param bands      optional per-game-type percentile terciles. When the entry
 *                   for `gameType` clears MIN_SAMPLE_FOR_BANDS, it drives the
 *                   classification; otherwise we fall back to the seed par time.
 *
 * Returns null when we can't classify (unknown game with no par AND no usable
 * band, or no usable elapsed time) so the caller can simply render nothing —
 * display-only and graceful (D9).
 */
export function resolveMarketReaction(
  gameType: string,
  elapsedSec: number | null | undefined,
  bands?: SolveBandMap | null,
  parTimes?: ParLookup | null
): MarketReaction | null {
  if (!isUsableElapsed(elapsedSec)) return null;
  const elapsed = elapsedSec;
  const roundedElapsed = Math.round(elapsed);

  // ── 1. Percentile path (preferred) ──────────────────────────────────────────
  const band = bands ? bands[gameType] : undefined;
  if (
    band &&
    Number.isFinite(band.p33Sec) &&
    Number.isFinite(band.p67Sec) &&
    band.p33Sec > 0 &&
    band.p67Sec >= band.p33Sec &&
    typeof band.sampleSize === "number" &&
    band.sampleSize >= MIN_SAMPLE_FOR_BANDS
  ) {
    const tier: MarketReactionTier =
      elapsed < band.p33Sec ? "ahead" : elapsed <= band.p67Sec ? "on" : "laggard";
    return {
      tier,
      label: LABELS[tier],
      elapsedSec: roundedElapsed,
      source: "percentile",
      detail: `${roundedElapsed}s`,
      p33Sec: Math.round(band.p33Sec),
      p67Sec: Math.round(band.p67Sec),
    };
  }

  // ── 2. Seed-par fallback ────────────────────────────────────────────────────
  const parSec = parTimes ? parTimes[gameType] : undefined;
  if (!parSec || parSec <= 0) return null;
  const ratio = elapsed / parSec;
  const tier: MarketReactionTier =
    ratio < AHEAD_MAX ? "ahead" : ratio <= ON_MAX ? "on" : "laggard";
  return {
    tier,
    label: LABELS[tier],
    elapsedSec: roundedElapsed,
    source: "par",
    detail: `${roundedElapsed}s · par ${parSec}s`,
    parSec,
    ratio: Math.round(ratio * 100) / 100,
  };
}
