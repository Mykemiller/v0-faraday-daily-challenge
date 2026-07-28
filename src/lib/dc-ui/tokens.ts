// ── Daily Challenge shared layout tokens (FAR-395) ──────────────────────────────
//
// Canonical spacing / radius / typography / motion scales for all 7 games. These
// standardize the drift catalogued in the Phase-0 audit (see
// docs/far395-ui-primitives/phase-0-audit.md): root gaps of 10/12/16/20, ~14
// distinct padding values, radii of 4/6/8/10/12/20, and transitions of
// 0.1/0.12/0.15/0.2 collapse onto the small scales below.
//
// SCOPE — these are LAYOUT tokens only. They deliberately carry NO color: color
// is owned by FAR-394 (the `C` palette object in DailyChallenge.jsx). Every
// primitive that needs color takes a `tokens` argument at call time, so a change
// to the palette values flows through automatically and this ticket never repaints
// the same surface twice.

export type StyleObject = Record<string, string | number>;

// Base unit for the spacing scale (px). The scale is a curated subset, not a raw
// 4px multiplier ramp, so callers get a small, opinionated vocabulary.
export const SPACE = {
  none: 0,
  xs: 4, // hairline gaps: dots, chips, inline separators
  sm: 8, // tight gaps: grid cells, option lists
  md: 12, // component-internal gaps
  lg: 16, // canonical root gap between game sections
  xl: 20, // generous card padding
  xxl: 24, // section padding / hero spacing
} as const;
export type SpaceKey = keyof typeof SPACE;

// Corner radii. Collapses the observed 4/6/8/10/12/20 onto four steps.
export const RADIUS = {
  sm: 6, // buttons, options, tiles' inner controls
  md: 8, // tiles, cards
  lg: 12, // panels, reading panes
  pill: 999, // fully rounded chips / dots
} as const;
export type RadiusKey = keyof typeof RADIUS;

// Typography scale (px). The 16/24 base pair is the ticket's stated scale; the
// 11/12/13/14 supporting sizes are NOT arbitrary intermediates — they are the
// accessibility FLOOR contract already canon in CLAUDE.md ("Daily Challenge
// cosmetic buff") and enforced by `npm run test:contrast`:
//   • nothing readable below 11px
//   • explanations ≥ 12px
//   • options / tiles / terms ≥ 13px
//   • primary prompts ≥ 16px
// The 48/22 display pair is the existing ScoreCard scale, preserved as-is.
export const TYPE = {
  caption: 11, // mono meta: SL labels, counters, byline (readable floor)
  fine: 12, // explanations, verdicts
  option: 13, // options, tiles, terms
  body: 14, // secondary body: clue text, item text
  base: 16, // primary prompts / brief prose (ticket base)
  heading: 24, // section headings (ticket step-2)
  total: 22, // ScoreCard running-total (display)
  display: 48, // ScoreCard score (display)
} as const;
export type TypeKey = keyof typeof TYPE;

// The four accessibility floors, keyed by content role, expressed against TYPE so
// a caller can assert a chosen size clears the floor for its role.
export const TYPE_FLOOR = {
  meta: TYPE.caption, // 11
  explanation: TYPE.fine, // 12
  option: TYPE.option, // 13
  prompt: TYPE.base, // 16
} as const;
export type FloorRole = keyof typeof TYPE_FLOOR;

// Motion. Two durations only. Callers that render motion must respect
// prefers-reduced-motion (the React layer does this).
export const MOTION = {
  fast: '120ms',
  base: '150ms',
} as const;
export type MotionKey = keyof typeof MOTION;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** px string for a spacing key, e.g. px('lg') -> '16px'. */
export function px(key: SpaceKey): string {
  return `${SPACE[key]}px`;
}

/**
 * Shorthand padding string from 1, 2, or 4 spacing keys (CSS order:
 * all | y x | top right bottom left).
 */
export function pad(...keys: SpaceKey[]): string {
  if (keys.length === 0) return '0';
  return keys.map((k) => `${SPACE[k]}px`).join(' ');
}

/** true when `size` px clears the accessibility floor for its content role. */
export function meetsFloor(role: FloorRole, size: number): boolean {
  return size >= TYPE_FLOOR[role];
}

// Snap `value` to the nearest step, rounding UP on an exact tie (generous
// spacing / radius is the safer default, especially for touch targets). `steps`
// must be ascending.
function snapTo(value: number, steps: number[]): number {
  let best = steps[0];
  let bestDist = Math.abs(value - best);
  for (const s of steps) {
    const d = Math.abs(value - s);
    if (d <= bestDist) {
      // `<=` + ascending steps ⇒ a tie resolves to the larger step.
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Snap an arbitrary (drifted) px value to the nearest canonical spacing step.
 * Used by the migration to map bespoke values (6, 10, 14, 18) onto the scale.
 * Ties round up (e.g. 6 → 8, 10 → 12).
 */
export function snapSpace(value: number): number {
  return snapTo(value, Object.values(SPACE));
}

/** Snap an arbitrary radius to the nearest canonical RADIUS step (ignores pill). */
export function snapRadius(value: number): number {
  return snapTo(value, [RADIUS.sm, RADIUS.md, RADIUS.lg]);
}
