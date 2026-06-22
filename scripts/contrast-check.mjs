#!/usr/bin/env node
// WCAG AA contrast check for Daily Challenge + homepage readable text/background
// pairings (FAR cosmetic buff). No browser needed — pure sRGB luminance math.
// Run: node scripts/contrast-check.mjs   (npm run test:contrast)
//
// Asserts every READABLE pairing clears 4.5:1 (normal text) or 3:1 (large/bold).
// Decorative-only tokens (e.g. `dim`) are intentionally excluded.

function lum(hex) {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
// Flatten an rgba(...) over an opaque background to an opaque hex.
function over(fg, alpha, bg) {
  const px = (h) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16));
  const [fr, fg_, fb] = px(fg), [br, bg_, bb] = px(bg);
  const mix = (f, b) => Math.round(f * alpha + b * (1 - alpha));
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(mix(fr, br))}${h(mix(fg_, bg_))}${h(mix(fb, bb))}`;
}

const INGAME_BG = "#0D110E";
const CREAM = "#EEE6DA";
const WHITE = "#F8F5F0";
const FOREST = "#1C3424";

// [foreground, background, label, minRatio]
const CASES = [
  // In-game (dark forest) — readable token set
  ["#E8E4DE", INGAME_BG, "in-game text", 4.5],
  ["#9A938C", INGAME_BG, "in-game muted (bumped)", 4.5],
  ["#C4922A", INGAME_BG, "in-game gold", 4.5],
  ["#8CA68A", INGAME_BG, "in-game sage", 4.5],
  ["#4ADE80", INGAME_BG, "in-game green", 4.5],
  ["#F59E0B", INGAME_BG, "in-game amber", 4.5],
  ["#F87171", INGAME_BG, "in-game red", 4.5],
  ["#DAB050", INGAME_BG, "in-game goldLight", 4.5],
  // Lobby / cards (light)
  ["#141210", CREAM, "lobby near-black", 4.5],
  ["#1C3424", CREAM, "lobby forest", 4.5],
  ["#94560A", CREAM, "lobby deepAmber", 4.5],
  [over("#141210", 0.62, CREAM), CREAM, "lobby black/0.62", 4.5],
  ["#94560A", WHITE, "card deepAmber", 4.5],
  [over("#141210", 0.62, WHITE), WHITE, "card black/0.62", 4.5],
  // Masthead / panels on forest
  ["#8CA68A", FOREST, "forest sage label", 4.5],
  ["#DAB050", FOREST, "forest goldLight", 4.5],
  [over("#EEE6DA", 0.85, FOREST), FOREST, "forest cream/0.85", 4.5],
  // Homepage specifics
  ["#94560A", WHITE, "home amber-dark (Open →)", 4.5],
  [over("#141210", 0.65, WHITE), WHITE, "home near-black/0.65", 4.5],
];

let failed = 0;
for (const [fg, bg, label, min] of CASES) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.toFixed(2)}:1  (min ${min})  ${label}  [${fg} on ${bg}]`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
if (failed) {
  console.error(`\n${failed} contrast failure(s) — readable text must clear WCAG AA.`);
  process.exit(1);
}
console.log("All readable pairings clear WCAG AA.");
