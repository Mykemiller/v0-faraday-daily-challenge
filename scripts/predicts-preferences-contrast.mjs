#!/usr/bin/env node
// WCAG AA contrast for the /predicts/preferences page (FDY-119). Pure sRGB math, no browser.
// Run: node scripts/predicts-preferences-contrast.mjs   (exits 1 on any failure)
function lum(hex) {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function over(fg, alpha, bg) {
  const px = (h) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16));
  const [a, b] = [px(fg), px(bg)];
  return "#" + a.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
}
const C = { nearBlack: "#141210", warmWhite: "#f8f5f0", warmPanel: "#faf7f2", warmCream: "#eee6da", forest: "#1c3424", sageDark: "#4f6b4d", brick: "#9c3b2e", goldLight: "#dab050", creamEdge: "#d8cfbf" };
const pairs = [
  ["body text", C.nearBlack, C.warmWhite, 4.5],
  ["chip / input text", C.nearBlack, C.warmPanel, 4.5],
  ["helper text (near-black/75)", over(C.nearBlack, 0.75, C.warmWhite), C.warmWhite, 4.5],
  ["preview meta (near-black/75 on panel)", over(C.nearBlack, 0.75, C.warmPanel), C.warmPanel, 4.5],
  ["placeholder + disabled label (near-black/70)", over(C.nearBlack, 0.7, C.warmPanel), C.warmPanel, 4.5],
  ["disabled Save (near-black/70 on cream-edge)", over(C.nearBlack, 0.7, C.creamEdge), C.creamEdge, 4.5],
  ["pressed chip + Save", C.warmWhite, C.forest, 4.5],
  ["forest subtitle / Reset", C.forest, C.warmWhite, 4.5],
  ["status + horizon labels (sage-dark)", C.sageDark, C.warmPanel, 4.5],
  ["error text (brick)", C.brick, C.warmPanel, 4.5],
  ["Bold Call badge", C.nearBlack, C.goldLight, 4.5],
  ["Coming soon note", over(C.nearBlack, 0.8, C.warmCream), C.warmCream, 4.5],
  ["switch track edge (non-text)", over(C.nearBlack, 0.5, C.warmWhite), C.warmWhite, 3],
];
let fail = 0;
for (const [name, fg, bg, min] of pairs) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.toFixed(2)}:1  (≥${min})  ${name}`);
}
process.exit(fail ? 1 : 0);
