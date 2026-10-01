#!/usr/bin/env node
// WCAG AA contrast gate for the Faraday Academy player's scoped theme.
// Pure sRGB luminance math, no browser. Parses the live token values straight out
// of src/app/academy/academy.css so the gate can never drift from the stylesheet.
//   run: npm run test:academy-contrast
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS = readFileSync(fileURLToPath(new URL("../src/app/academy/academy.css", import.meta.url)), "utf8");

function lum(hex) {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The light block is the first .academy-root body; the dark block is inside the
// prefers-color-scheme override.
function tokens(scope) {
  const body = scope === "dark"
    ? CSS.split("@media (prefers-color-scheme: dark)")[1].split("}")[0]
    : CSS.split(".academy-root {")[1].split("}")[0];
  const out = {};
  for (const m of body.matchAll(/(--ac-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

const LIGHT = tokens("light");
const DARK = tokens("dark");

// Readable pairings only. --ac-accent (gold) is excluded as small text by design:
// it ships as a fill, a rule or a large numeral, and small accent text uses
// --ac-accent-text instead.
const PAIRS = [
  ["--ac-text", "--ac-bg", "body copy on the canvas"],
  ["--ac-text", "--ac-panel", "body copy on a raised panel"],
  ["--ac-text", "--ac-panel-2", "body copy on the row wash"],
  ["--ac-muted", "--ac-bg", "secondary copy and mono labels on the canvas"],
  ["--ac-muted", "--ac-panel", "secondary copy on a raised panel"],
  ["--ac-accent-text", "--ac-bg", "small accent text on the canvas"],
  ["--ac-accent-text", "--ac-panel", "small accent text on a panel"],
  ["--ac-sage-text", "--ac-sage-wash", "AI panel copy on the sage wash"],
  ["--ac-correct", "--ac-bg", "correct quiz state"],
  ["--ac-correct", "--ac-panel", "correct quiz state on a panel"],
  ["--ac-incorrect", "--ac-bg", "incorrect quiz state"],
  ["--ac-incorrect", "--ac-panel", "incorrect quiz state on a panel"],
];

// The focus ring is a non-text UI component: WCAG 2.1 requires 3:1 against what
// it sits on, not 4.5:1.
const UI_PAIRS = [
  ["--ac-focus", "--ac-bg", "focus ring against the canvas"],
  ["--ac-focus", "--ac-panel", "focus ring against a raised panel"],
  ["--ac-sage-rule", "--ac-sage-wash", "AI panel rule against its wash"],
];

for (const [scope, t] of [["light", LIGHT], ["dark", DARK]]) {
  test(`${scope}: every readable text pairing clears 4.5:1`, () => {
    for (const [fgK, bgK, label] of PAIRS) {
      const fg = t[fgK], bg = t[bgK];
      assert.ok(fg && bg, `${scope}: missing token ${fgK} or ${bgK}`);
      const r = ratio(fg, bg);
      assert.ok(r >= 4.5, `${scope}: ${label} — ${fgK} ${fg} on ${bgK} ${bg} = ${r.toFixed(2)}:1, need 4.5:1`);
    }
  });

  test(`${scope}: UI components clear 3:1`, () => {
    for (const [fgK, bgK, label] of UI_PAIRS) {
      const r = ratio(t[fgK], t[bgK]);
      assert.ok(r >= 3, `${scope}: ${label} — ${fgK} on ${bgK} = ${r.toFixed(2)}:1, need 3:1`);
    }
  });

  test(`${scope}: the canvas is never pure white`, () => {
    for (const k of ["--ac-bg", "--ac-panel", "--ac-panel-2"]) {
      assert.notEqual(t[k], "#ffffff", `${scope}: ${k} must not be pure white`);
    }
  });
}

test("report", () => {
  for (const [scope, t] of [["light", LIGHT], ["dark", DARK]]) {
    for (const [fgK, bgK, label] of [...PAIRS, ...UI_PAIRS]) {
      console.log(`  ${scope.padEnd(5)} ${ratio(t[fgK], t[bgK]).toFixed(2).padStart(5)}:1  ${label}`);
    }
  }
});
