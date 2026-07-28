// FAR-387 — behavioral tests for the canonical IDF label resolvers.
//
// The build guard `scripts/no-idf-codes-check.mjs` proves no raw code is written
// into subscriber-facing source. THIS file proves the resolvers those surfaces
// route through actually turn a code into a name, drop an unmapped code (never
// falling back to the raw code), and pass a plain name through unchanged.
// Codes here are test fixtures — the guard's allowlist exempts *.test.ts files.
//
// Run: node --test src/lib/idf-labels.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DOMAIN_LABELS,
  THEME_LABELS,
  resolveDomainName,
  resolveThemeName,
  formatDomainTheme,
} from "./idf-labels.ts";

test("resolveDomainName maps a bare domain code to its plain name", () => {
  assert.equal(resolveDomainName("D2"), "Power Architecture");
  assert.equal(resolveDomainName("D3"), "Grid & Regulatory");
  assert.equal(resolveDomainName("D23"), "Outage Intelligence & Emergency Response");
});

test("resolveDomainName maps a sub-domain code to its PARENT domain name", () => {
  // A "D2.5" must never leak — it resolves to the D2 parent name.
  assert.equal(resolveDomainName("D2.5"), "Power Architecture");
  assert.equal(resolveDomainName("D7.10"), "Cooling & Water Technology");
});

test("resolveDomainName is case-insensitive on the code prefix", () => {
  assert.equal(resolveDomainName("d5"), "Hyperscaler Activity");
});

test("resolveDomainName returns null for an unmapped code (never the raw code)", () => {
  assert.equal(resolveDomainName("D99"), null);
  assert.equal(resolveDomainName("D24"), null);
});

test("resolveDomainName passes a plain-language name through unchanged", () => {
  assert.equal(resolveDomainName("Cooling & Water"), "Cooling & Water");
  assert.equal(resolveDomainName("Power Architecture"), "Power Architecture");
});

test("resolveDomainName handles null / empty / whitespace", () => {
  assert.equal(resolveDomainName(null), null);
  assert.equal(resolveDomainName(undefined), null);
  assert.equal(resolveDomainName(""), null);
  assert.equal(resolveDomainName("   "), null);
  assert.equal(resolveDomainName("  D2  "), "Power Architecture");
});

test("resolveThemeName maps every accepted theme-code form to its name", () => {
  assert.equal(resolveThemeName("T-001"), "The Power Reckoning");
  assert.equal(resolveThemeName("T001"), "The Power Reckoning");
  assert.equal(resolveThemeName("T1"), "The Power Reckoning");
  assert.equal(resolveThemeName("T-007"), "The New Energy Stack");
});

test("resolveThemeName returns null for an unmapped theme code", () => {
  assert.equal(resolveThemeName("T-099"), null);
  assert.equal(resolveThemeName("T42"), null);
});

test("resolveThemeName passes a plain theme name through unchanged", () => {
  assert.equal(resolveThemeName("The Consent Crisis"), "The Consent Crisis");
});

test("formatDomainTheme builds the locked two-slot string, omitting unmapped slots", () => {
  assert.equal(
    formatDomainTheme({ domain: "D2", theme: "T-001" }),
    "Domain: Power Architecture | Theme: The Power Reckoning"
  );
  // Unmapped code → that slot is dropped, not rendered as a raw code.
  assert.equal(formatDomainTheme({ domain: "D2", theme: "T-099" }), "Domain: Power Architecture");
  assert.equal(formatDomainTheme({ domain: "D99", theme: "T-001" }), "Theme: The Power Reckoning");
  // Neither slot renders → null so the caller can hide the row entirely.
  assert.equal(formatDomainTheme({ domain: "D99", theme: null }), null);
  assert.equal(formatDomainTheme({}), null);
});

test("no mapped label is itself a raw code (the map can never emit a code)", () => {
  const CODE_RE = /^[DT]\d/;
  for (const name of Object.values(DOMAIN_LABELS)) assert.ok(!CODE_RE.test(name), name);
  for (const name of Object.values(THEME_LABELS)) assert.ok(!CODE_RE.test(name), name);
});
