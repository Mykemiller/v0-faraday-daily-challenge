// ── Grid primitives (FAR-395) ───────────────────────────────────────────────────
//
// Two DISTINCT grid systems, kept separate on purpose:
//
//   1. The 110×110 "sub-bounding box" grid from the Product Icon Registry. This is
//      an ICON / TILE spec — it fits the lobby game tiles and any square emblem
//      layout. It is `iconTileGrid()`.
//
//   2. The fluid puzzle-interaction grid the games actually use (Rackl 4-col,
//      Circuit / Dark Fiber 2-col). Cells are `minmax(0, 1fr)` so answer text,
//      letters, and terms flow at any breakpoint. It is `puzzleGrid()`.
//
// PHASE-0 FINDING (documented, enforced here): NONE of the 7 games currently uses
// a fixed-square interaction grid, and several structurally cannot take one — a
// Wordle row, a ranked list, and especially The Brief's scrolling multi-paragraph
// reading pane are not square-tile content. So `iconTileGrid()` (110×110) is the
// canonical anchor for TILES, while interaction areas standardize on `puzzleGrid()`.
// `SQUARE_GRID_FIT` records, per game, which model applies, so the migration never
// forces a square grid onto content that doesn't want one.

import { SPACE, type SpaceKey, type StyleObject } from './tokens.ts';

// The Product Icon Registry sub-bounding box, in px.
export const ICON_TILE = 110;

/**
 * Fluid puzzle-interaction grid: N equal columns that never overflow their track.
 * Standardizes Rackl (4), Circuit / Dark Fiber (2), etc.
 */
export function puzzleGrid(cols: number, gap: SpaceKey = 'sm'): StyleObject {
  if (!Number.isInteger(cols) || cols < 1) {
    throw new Error(`puzzleGrid: cols must be a positive integer, got ${cols}`);
  }
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gap: `${SPACE[gap]}px`,
  };
}

/**
 * 110×110 icon/tile grid (Product Icon Registry). Responsive by default:
 * auto-filling tracks with a 110px floor that grow to fill the row. Pass
 * `fixed:true` for exactly-110px cells that do not grow (strict registry sizing).
 */
export function iconTileGrid(opts: { gap?: SpaceKey; fixed?: boolean; cell?: number } = {}): StyleObject {
  const { gap = 'md', fixed = false, cell = ICON_TILE } = opts;
  const track = fixed ? `${cell}px` : `minmax(${cell}px, 1fr)`;
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, ${track})`,
    gap: `${SPACE[gap]}px`,
  };
}

/** A single 110×110 (square) tile box. */
export function iconTileBox(cell: number = ICON_TILE): StyleObject {
  return { width: `${cell}px`, height: `${cell}px`, aspectRatio: '1 / 1' };
}

// Per-game grid model. 'square' → can take the 110×110 tile grid; 'fluid' → uses
// puzzleGrid; 'list' → vertical, no grid; 'prose' → long-form reading, exempt from
// any square grid (flagged in Phase 0).
export type GridFit = 'square' | 'fluid' | 'list' | 'prose';

/**
 * CC-DC-GAME-REGISTRY-1.0: the per-game grid model was a hardcoded table of
 * seven. It is `game_catalog.grid_fit` now. These helpers take the resolved fit
 * so this module stays pure; an unresolved game is treated as 'fluid', which is
 * the safe default — it never forces square cells onto content that cannot take
 * them (the Phase-0 finding this table was written to record).
 */

/** true when a game may adopt the 110×110 square tile grid for its interaction area. */
export function fitsSquareGrid(gridFit: string | null | undefined): boolean {
  return gridFit === 'square';
}

/** Games that must NOT be forced onto a square grid (Phase-0 exemptions). */
export function squareGridExemptions(fits: Record<string, string | null>): string[] {
  return Object.keys(fits).filter((g) => fits[g] === 'prose');
}
