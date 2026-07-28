// ── Shared button-state resolver (FAR-395) ──────────────────────────────────────
//
// One consistent set of button STATES for every game: default, hover,
// active/pressed, disabled — plus the selection/reveal states the puzzles need.
// The Phase-0 audit found the shared `Btn` was used only for primary actions,
// while every in-puzzle answer/tile/key was a bespoke raw <button> with its own
// radius, transition, and zero hover/active handling. This resolver replaces all
// of that with a single pure function.
//
// It is palette-agnostic: it takes a `tokens` object (the `C` palette) and derives
// every fill/border tint from it via color.ts, so FAR-394 owns the values.

import { MOTION, RADIUS, TYPE, type StyleObject } from './tokens.ts';
import { tint } from './color.ts';

// The palette keys the resolver reads. A structural subset of the `C` object in
// DailyChallenge.jsx — pass `C` directly.
export interface PaletteTokens {
  gold: string;
  green: string;
  red: string;
  sage: string;
  cream: string;
  black: string;
  text: string;
  muted: string;
  border: string;
  surface: string;
}

// Variants:
//   primary/ghost/success/danger — the existing `Btn` action variants.
//   option                       — in-puzzle answer choices (Circuit, Brief, Frequency, Dark Fiber).
//   tile                         — Rackl-style cream tiles on the light board.
export type ButtonVariant =
  | 'primary'
  | 'ghost'
  | 'success'
  | 'danger'
  | 'option'
  | 'tile';

export type RevealState = 'correct' | 'incorrect' | null;

export interface ButtonStyleInput {
  variant: ButtonVariant;
  tokens: PaletteTokens;
  selected?: boolean;
  reveal?: RevealState; // post-answer grading, for option/tile
  small?: boolean; // primary/ghost action sizing
  reducedMotion?: boolean;
}

// The four rendered states. Spread `rest` at all times; the React layer swaps in
// `hover` on pointer-over and `active` on pointer-down, and applies `disabled`
// (which always wins) when the control is disabled.
export interface ButtonStates {
  rest: StyleObject;
  hover: StyleObject;
  active: StyleObject;
  disabled: StyleObject;
}

// Resting fill/border/color per variant, before selection/reveal overrides.
function baseSkin(variant: ButtonVariant, t: PaletteTokens): StyleObject {
  switch (variant) {
    case 'primary':
      return { background: tint(t.gold, 0.12), border: `1px solid ${tint(t.gold, 0.4)}`, color: t.gold };
    case 'ghost':
      return { background: tint('#ffffff', 0.04), border: `1px solid ${t.border}`, color: t.muted };
    case 'success':
      return { background: tint(t.green, 0.1), border: `1px solid ${tint(t.green, 0.3)}`, color: t.green };
    case 'danger':
      return { background: tint(t.red, 0.1), border: `1px solid ${tint(t.red, 0.3)}`, color: t.red };
    case 'option':
      return { background: t.surface, border: `1px solid ${t.border}`, color: t.text };
    case 'tile':
      return { background: t.cream, border: `2px solid ${tint(t.black, 0.12)}`, color: t.black };
  }
}

// Selection / reveal overrides for option & tile.
function stateSkin(input: ButtonStyleInput): StyleObject {
  const { variant, tokens: t, selected, reveal } = input;
  if (variant !== 'option' && variant !== 'tile') return {};
  if (reveal === 'correct') {
    return { background: tint(t.green, 0.14), border: `1px solid ${tint(t.green, 0.5)}`, color: t.green };
  }
  if (reveal === 'incorrect') {
    return { background: tint(t.red, 0.14), border: `1px solid ${tint(t.red, 0.5)}`, color: t.red };
  }
  if (selected) {
    const width = variant === 'tile' ? '2px' : '1px';
    return { background: tint(t.gold, 0.2), border: `${width} solid ${t.gold}`, color: t.gold };
  }
  return {};
}

/**
 * Resolve the full four-state style set for a button. Pure — same inputs always
 * produce the same output; no DOM, no React.
 */
export function resolveButtonStyles(input: ButtonStyleInput): ButtonStates {
  const { variant, small, reducedMotion } = input;
  const isAction = variant === 'primary' || variant === 'ghost' || variant === 'success' || variant === 'danger';

  const radius = variant === 'tile' ? RADIUS.md : RADIUS.sm;
  const padding = isAction
    ? small
      ? '6px 14px'
      : '10px 20px'
    : variant === 'tile'
      ? '14px 8px'
      : '12px 16px';
  const fontSize = isAction ? (small ? TYPE.caption : TYPE.fine) : TYPE.option;

  const rest: StyleObject = {
    ...baseSkin(variant, input.tokens),
    ...stateSkin(input),
    borderRadius: `${radius}px`,
    padding,
    fontSize: `${fontSize}px`,
    fontWeight: variant === 'tile' ? 600 : isAction ? 400 : 500,
    letterSpacing: isAction ? '0.08em' : '0',
    cursor: 'pointer',
    transition: reducedMotion ? 'none' : `all ${MOTION.base} ease`,
    transform: 'translateY(0)',
    boxShadow: 'none',
  };

  // Hover — a small lift + a touch more border presence. Kept subtle; on touch
  // devices hover never fires, which is why `active` carries the tactile press.
  const lift = reducedMotion ? 'translateY(0)' : 'translateY(-1px)';
  const hover: StyleObject = {
    transform: lift,
    boxShadow: reducedMotion ? 'none' : `0 4px 12px ${tint(input.tokens.black, 0.18)}`,
    filter: 'brightness(1.06)',
  };

  // Active/pressed — settle back down for a physical click feel.
  const active: StyleObject = {
    transform: 'translateY(0)',
    boxShadow: 'none',
    filter: 'brightness(0.98)',
  };

  // Disabled — always wins over hover/active in the React layer.
  const disabled: StyleObject = {
    opacity: 0.5,
    cursor: 'not-allowed',
    transform: 'translateY(0)',
    boxShadow: 'none',
    filter: 'none',
  };

  return { rest, hover, active, disabled };
}
