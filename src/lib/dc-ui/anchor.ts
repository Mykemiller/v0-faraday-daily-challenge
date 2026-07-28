// ── Brand anchor placement (FAR-395) ────────────────────────────────────────────
//
// The canonical gold bolt (`C.gold` = #C4922A) as a consistent, game-independent
// brand anchor. Phase-0 finding: NO game currently has a fixed gold-bolt anchor —
// gold appears only as transient selection state. This gives every game the same
// anchor in the same place.
//
// Position: TOP-RIGHT, canonically. Rationale (per the ticket's pre-resolved
// decision): top-right is spatially fixed regardless of where a given game's score
// display sits, so it is a reliable, game-independent anchor. The other positions
// exist only for a documented, justified per-game exception.

import { SPACE, type StyleObject } from './tokens.ts';

export type AnchorPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export const CANONICAL_ANCHOR: AnchorPosition = 'top-right';

// Inset from the frame edge (px). Matches the lobby GameTile "✓ Played" badge inset.
const INSET = SPACE.sm; // 8

/**
 * Absolute-positioning style for the brand anchor within a `position:relative`
 * game frame. Defaults to the canonical top-right.
 */
export function brandAnchorStyle(position: AnchorPosition = CANONICAL_ANCHOR): StyleObject {
  const base: StyleObject = { position: 'absolute', pointerEvents: 'none', lineHeight: 0 };
  switch (position) {
    case 'top-right':
      return { ...base, top: `${INSET}px`, right: `${INSET}px` };
    case 'top-left':
      return { ...base, top: `${INSET}px`, left: `${INSET}px` };
    case 'bottom-right':
      return { ...base, bottom: `${INSET}px`, right: `${INSET}px` };
    case 'bottom-left':
      return { ...base, bottom: `${INSET}px`, left: `${INSET}px` };
  }
}

/**
 * Bolt-glyph SVG path data (a lightning bolt), sized to `size` px. Returned as
 * data rather than JSX so this stays a pure, node-testable module; the React
 * `BrandAnchor` wrapper renders it with `fill={C.gold}`.
 */
export const BOLT_PATH = 'M13 2 L4 14 L11 14 L9 22 L20 8 L13 8 Z';
export const BOLT_VIEWBOX = '0 0 24 24';

export function boltSvgAttrs(size: number = 16): { width: number; height: number; viewBox: string } {
  return { width: size, height: size, viewBox: BOLT_VIEWBOX };
}
