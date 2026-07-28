// Pure-logic tests for the FAR-395 Daily Challenge layout primitives.
// Run: node --test src/lib/dc-ui/dc-ui.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SPACE,
  RADIUS,
  TYPE,
  TYPE_FLOOR,
  MOTION,
  px,
  pad,
  meetsFloor,
  snapSpace,
  snapRadius,
} from './tokens.ts';
import { hexToRgb, tint, rgb } from './color.ts';
import { resolveButtonStyles, type PaletteTokens } from './button.ts';
import {
  puzzleGrid,
  iconTileGrid,
  iconTileBox,
  ICON_TILE,
  SQUARE_GRID_FIT,
  fitsSquareGrid,
  squareGridExemptions,
} from './grid.ts';
import { brandAnchorStyle, CANONICAL_ANCHOR, boltSvgAttrs } from './anchor.ts';

// A deliberately fake palette — none of these are the real brand hex — so any test
// that passes when the output contains a REAL brand color would be catching a
// hardcoded-color regression (the whole point of palette-agnosticism).
const FAKE: PaletteTokens = {
  gold: '#111111',
  green: '#222222',
  red: '#333333',
  sage: '#444444',
  cream: '#555555',
  black: '#000000',
  text: '#666666',
  muted: '#777777',
  border: '#888888',
  surface: '#999999',
};
const REAL_GOLD = '#C4922A';

// ── tokens ───────────────────────────────────────────────────────────────────
test('SPACE scale is ascending and starts at 0', () => {
  const vals = Object.values(SPACE);
  assert.equal(vals[0], 0);
  for (let i = 1; i < vals.length; i++) assert.ok(vals[i] > vals[i - 1], `step ${i} ascends`);
});

test('type floors match the CLAUDE.md accessibility contract', () => {
  assert.equal(TYPE_FLOOR.meta, 11);
  assert.equal(TYPE_FLOOR.explanation, 12);
  assert.equal(TYPE_FLOOR.option, 13);
  assert.equal(TYPE_FLOOR.prompt, 16);
  // The ticket's 16/24 base pair is present.
  assert.equal(TYPE.base, 16);
  assert.equal(TYPE.heading, 24);
});

test('px and pad build CSS strings from spacing keys', () => {
  assert.equal(px('lg'), '16px');
  assert.equal(pad('md', 'lg'), '12px 16px');
  assert.equal(pad('sm'), '8px');
  assert.equal(pad(), '0');
});

test('meetsFloor enforces per-role minimums', () => {
  assert.equal(meetsFloor('prompt', 16), true);
  assert.equal(meetsFloor('prompt', 15), false);
  assert.equal(meetsFloor('option', 13), true);
  assert.equal(meetsFloor('meta', 10), false);
});

test('snapSpace / snapRadius map drift onto the canonical scale', () => {
  assert.equal(snapSpace(6), SPACE.sm); // 6 -> 8 (tie rounds up)
  assert.equal(snapSpace(10), SPACE.md); // 10 -> 12 (tie rounds up)
  assert.equal(snapSpace(18), SPACE.xl); // 18 -> 20
  assert.equal(snapSpace(16), SPACE.lg); // exact
  assert.equal(snapSpace(14), SPACE.lg); // 14 -> 16
  assert.equal(snapRadius(4), RADIUS.sm); // 4 -> 6
  assert.equal(snapRadius(10), RADIUS.lg); // 10 -> 12 (tie rounds up)
  assert.equal(snapRadius(20), RADIUS.lg); // 20 -> 12
});

test('MOTION has exactly two durations', () => {
  assert.deepEqual(Object.keys(MOTION).sort(), ['base', 'fast']);
});

// ── color ────────────────────────────────────────────────────────────────────
test('hexToRgb parses 6-digit, 3-digit, and #-prefixed hex', () => {
  assert.deepEqual(hexToRgb('#C4922A'), { r: 196, g: 146, b: 42 });
  assert.deepEqual(hexToRgb('C4922A'), { r: 196, g: 146, b: 42 });
  assert.deepEqual(hexToRgb('#fff'), { r: 255, g: 255, b: 255 });
});

test('hexToRgb throws on garbage', () => {
  assert.throws(() => hexToRgb('not-a-color'));
  assert.throws(() => hexToRgb('#12'));
});

test('tint derives rgba from the passed hex and clamps alpha', () => {
  assert.equal(tint('#C4922A', 0.12), 'rgba(196, 146, 42, 0.12)');
  assert.equal(tint('#C4922A', 2), 'rgba(196, 146, 42, 1)');
  assert.equal(tint('#C4922A', -1), 'rgba(196, 146, 42, 0)');
  assert.equal(rgb('#000000'), 'rgb(0, 0, 0)');
});

// ── button ──────────────────────────────────────────────────────────────────
test('resolveButtonStyles returns all four states', () => {
  const s = resolveButtonStyles({ variant: 'option', tokens: FAKE });
  for (const k of ['rest', 'hover', 'active', 'disabled'] as const) {
    assert.ok(s[k] && typeof s[k] === 'object', `${k} present`);
  }
});

test('button output is palette-agnostic — derives from passed tokens, no hardcoded brand hex', () => {
  const s = resolveButtonStyles({ variant: 'primary', tokens: FAKE });
  const blob = JSON.stringify(s);
  // The real brand gold must never appear when a fake palette is supplied.
  assert.ok(!blob.includes(REAL_GOLD), 'no hardcoded brand gold');
  assert.ok(!blob.toLowerCase().includes('196, 146, 42'), 'no hardcoded gold rgb');
  // It must instead reference the fake gold we passed in.
  assert.ok(blob.includes('17, 17, 17'), 'uses passed gold (#111111 -> 17,17,17)');
});

test('disabled state carries not-allowed + reduced opacity and neutral transform', () => {
  const s = resolveButtonStyles({ variant: 'option', tokens: FAKE });
  assert.equal(s.disabled.cursor, 'not-allowed');
  assert.equal(s.disabled.opacity, 0.5);
  assert.equal(s.disabled.transform, 'translateY(0)');
});

test('selected option uses the gold anchor color; reveal overrides selection', () => {
  const sel = resolveButtonStyles({ variant: 'option', tokens: FAKE, selected: true });
  assert.equal(sel.rest.color, FAKE.gold);
  const correct = resolveButtonStyles({ variant: 'option', tokens: FAKE, selected: true, reveal: 'correct' });
  assert.equal(correct.rest.color, FAKE.green, 'reveal wins over selection');
  const wrong = resolveButtonStyles({ variant: 'option', tokens: FAKE, reveal: 'incorrect' });
  assert.equal(wrong.rest.color, FAKE.red);
});

test('reducedMotion strips transition and hover transform', () => {
  const s = resolveButtonStyles({ variant: 'tile', tokens: FAKE, reducedMotion: true });
  assert.equal(s.rest.transition, 'none');
  assert.equal(s.hover.transform, 'translateY(0)');
  assert.equal(s.hover.boxShadow, 'none');
});

test('option and tile buttons meet the 13px option floor', () => {
  for (const variant of ['option', 'tile'] as const) {
    const s = resolveButtonStyles({ variant, tokens: FAKE });
    assert.equal(s.rest.fontSize, `${TYPE.option}px`);
  }
});

test('every button variant resolves without throwing', () => {
  for (const variant of ['primary', 'ghost', 'success', 'danger', 'option', 'tile'] as const) {
    assert.doesNotThrow(() => resolveButtonStyles({ variant, tokens: FAKE }));
  }
});

// ── grid ─────────────────────────────────────────────────────────────────────
test('puzzleGrid builds an N-column fluid grid that cannot overflow', () => {
  const g = puzzleGrid(4, 'sm');
  assert.equal(g.gridTemplateColumns, 'repeat(4, minmax(0, 1fr))');
  assert.equal(g.gap, '8px');
  assert.equal(g.display, 'grid');
});

test('puzzleGrid rejects non-positive / non-integer columns', () => {
  assert.throws(() => puzzleGrid(0));
  assert.throws(() => puzzleGrid(2.5));
});

test('iconTileGrid uses the 110px Product Icon Registry cell', () => {
  assert.equal(ICON_TILE, 110);
  const fluid = iconTileGrid();
  assert.equal(fluid.gridTemplateColumns, 'repeat(auto-fill, minmax(110px, 1fr))');
  const fixed = iconTileGrid({ fixed: true });
  assert.equal(fixed.gridTemplateColumns, 'repeat(auto-fill, 110px)');
  assert.deepEqual(iconTileBox(), { width: '110px', height: '110px', aspectRatio: '1 / 1' });
});

test('SQUARE_GRID_FIT covers all 7 games and exempts The Brief (prose)', () => {
  const games = ['Rackl', 'Signal Drop', 'The Stack', 'Circuit', 'The Brief', 'Dark Fiber', 'Frequency'];
  for (const g of games) assert.ok(g in SQUARE_GRID_FIT, `${g} classified`);
  assert.equal(SQUARE_GRID_FIT['The Brief'], 'prose');
  assert.equal(fitsSquareGrid('The Brief'), false);
  assert.deepEqual(squareGridExemptions(), ['The Brief']);
});

// ── anchor ─────────────────────────────────────────────────────────────────
test('canonical brand anchor is top-right', () => {
  assert.equal(CANONICAL_ANCHOR, 'top-right');
  const a = brandAnchorStyle();
  assert.equal(a.position, 'absolute');
  assert.equal(a.top, '8px');
  assert.equal(a.right, '8px');
  assert.equal(a.pointerEvents, 'none');
});

test('brandAnchorStyle supports the documented exception positions', () => {
  assert.deepEqual(
    { l: brandAnchorStyle('top-left').left, b: brandAnchorStyle('bottom-right').bottom },
    { l: '8px', b: '8px' },
  );
});

test('boltSvgAttrs sizes the glyph', () => {
  assert.deepEqual(boltSvgAttrs(20), { width: 20, height: 20, viewBox: '0 0 24 24' });
});
