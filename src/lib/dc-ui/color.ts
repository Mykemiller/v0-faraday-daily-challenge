// ── Palette-agnostic color helpers (FAR-395) ────────────────────────────────────
//
// The games are littered with hand-written gold tints like `rgba(196,146,42,0.12)`
// — a hardcoded copy of the `C.gold` hex that does NOT follow a palette change.
// These helpers derive tints from whatever hex the caller passes, so a FAR-394
// palette edit flows through every button/anchor tint automatically. No color
// value lives here — only the math.

export type RGB = { r: number; g: number; b: number };

/** Parse `#RGB` / `#RRGGBB` (with or without leading #) to channel values. */
export function hexToRgb(hex: string): RGB {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    throw new Error(`hexToRgb: not a hex color: ${hex}`);
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** `rgba(...)` string for a hex color at the given alpha (0..1, clamped). */
export function tint(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Convenience: opaque `rgb(...)` string for a hex color. */
export function rgb(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
}
