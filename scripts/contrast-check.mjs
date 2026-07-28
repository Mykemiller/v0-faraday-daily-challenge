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
const CREAM = "#EEE6DA";           // legacy Warm Cream — homepage double-rule + League Office only
const WHITE = "#F8F5F0";           // Warm White — the standardized DC surface (FAR-394)
const FOREST = "#1C3424";          // Editorial Forest (also the darkest game-tile gradient stop)

// FAR-394 per-game jewel tones (desaturated, editorial). Single source of truth
// is GAME_ACCENT in src/components/GameIcon.jsx; mirrored here for the gate.
const GAME_ACCENT = {
  Rackl: "#2F9C8B",        // teal
  "Signal Drop": "#C86A85", // garnet rose
  "The Stack": "#A08A3A",   // citrine/bronze
  Circuit: "#4C90BD",       // sapphire
  "The Brief": "#7CA34A",   // olive
  "Dark Fiber": "#9A74C0",  // amethyst
  Frequency: "#C06A3C",     // rust/copper
};

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
  // Lobby / cards (light) — now Warm White #F8F5F0 (FAR-394 standardized surface)
  ["#141210", WHITE, "lobby near-black", 4.5],
  ["#1C3424", WHITE, "lobby forest", 4.5],
  ["#94560A", WHITE, "lobby deepAmber", 4.5],
  [over("#141210", 0.62, WHITE), WHITE, "lobby black/0.62", 4.5],
  ["#94560A", WHITE, "card deepAmber", 4.5],
  [over("#141210", 0.62, WHITE), WHITE, "card black/0.62", 4.5],
  // Masthead / panels on forest — cream text now Warm White #F8F5F0
  ["#8CA68A", FOREST, "forest sage label", 4.5],
  ["#DAB050", FOREST, "forest goldLight", 4.5],
  [over("#F8F5F0", 0.85, FOREST), FOREST, "forest warm-white/0.85", 4.5],
  ["#F8F5F0", FOREST, "forest warm-white text", 4.5],
  // Homepage specifics (still on Warm Cream — out of FAR-394 scope, verified unchanged)
  ["#94560A", CREAM, "home amber-dark on cream", 4.5],
  ["#141210", CREAM, "home near-black on cream", 4.5],
  ["#94560A", WHITE, "home amber-dark (Open →)", 4.5],
  [over("#141210", 0.65, WHITE), WHITE, "home near-black/0.65", 4.5],
];

// FAR-394 per-game jewel pictograms sit on the forest game-tile (darkest stop
// #1C3424). They are decorative graphics (aria-hidden), so the WCAG bar is the
// 3:1 non-text UI-component threshold, not 4.5:1. Validate every accent clears
// it so no glyph gets lost once raw neon's luminance is gone.
for (const [game, hex] of Object.entries(GAME_ACCENT)) {
  CASES.push([hex, FOREST, `game accent ${game} on forest tile`, 3.0]);
}

let failed = 0;
for (const [fg, bg, label, min] of CASES) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.toFixed(2)}:1  (min ${min})  ${label}  [${fg} on ${bg}]`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} passed`);

// Distinguishability guard (FAR-394): each per-game jewel must be visually
// separable from every other jewel AND from gold/sage. Uses a weighted sRGB
// distance (a cheap ΔE proxy); ~40+ reads as clearly distinct to the eye.
const REFS = { ...GAME_ACCENT, Gold: "#C4922A", Sage: "#8CA68A" };
function dist(a, b) {
  const px = (h) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16));
  const [r1, g1, b1] = px(a), [r2, g2, b2] = px(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
const DISTINCT_MIN = 40;
const keys = Object.keys(REFS);
let tooClose = 0;
let minPair = { d: Infinity, a: "", b: "" };
for (let i = 0; i < keys.length; i++) {
  for (let j = i + 1; j < keys.length; j++) {
    const d = dist(REFS[keys[i]], REFS[keys[j]]);
    if (d < minPair.d) minPair = { d, a: keys[i], b: keys[j] };
    if (d < DISTINCT_MIN) {
      tooClose++;
      console.log(`CLOSE  Δ${d.toFixed(0)} (min ${DISTINCT_MIN})  ${keys[i]} ↔ ${keys[j]}`);
    }
  }
}
console.log(`\nClosest jewel/accent pair: ${minPair.a} ↔ ${minPair.b} (Δ${minPair.d.toFixed(0)})`);

if (failed) {
  console.error(`\n${failed} contrast failure(s) — readable text must clear WCAG AA.`);
  process.exit(1);
}
if (tooClose) {
  console.error(`\n${tooClose} jewel/accent pair(s) below Δ${DISTINCT_MIN} — may be hard to tell apart.`);
  process.exit(1);
}
console.log("All readable pairings clear WCAG AA; all per-game jewels are distinguishable.");
