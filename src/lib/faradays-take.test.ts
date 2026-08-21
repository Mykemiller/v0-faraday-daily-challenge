// Unit tests for the Faraday's Take helpers (FAR-389). Pure logic — no I/O.
//
// Run with:  npm run test:take   (node --test with TS type-stripping, matching
// the tokenomics test setup).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GILBERT_FARADAY,
  MACH_EIGEN,
  defaultTakeByline,
  resolveTakeByline,
  deriveTakeFallback,
} from "./faradays-take.ts";

// CC-DC-GAME-REGISTRY-1.0 D10: the per-game voice is game_catalog.take_voice
// and is passed in, so these tests no longer name the live seven. The voice
// STRINGS are still asserted — they are the editorial identities, not a roster.
test("defaultTakeByline falls back to Gilbert Faraday for unknown/empty voices", () => {
  assert.equal(defaultTakeByline(MACH_EIGEN), MACH_EIGEN);
  assert.equal(defaultTakeByline(GILBERT_FARADAY), GILBERT_FARADAY);
  assert.equal(defaultTakeByline("Guest Analyst"), "Guest Analyst");
  assert.equal(defaultTakeByline(""), GILBERT_FARADAY);
  assert.equal(defaultTakeByline("   "), GILBERT_FARADAY);
  assert.equal(defaultTakeByline(null), GILBERT_FARADAY);
  assert.equal(defaultTakeByline(undefined), GILBERT_FARADAY);
});

test("resolveTakeByline: explicit override wins over the game's voice", () => {
  assert.equal(resolveTakeByline(MACH_EIGEN, GILBERT_FARADAY), GILBERT_FARADAY);
  assert.equal(resolveTakeByline(GILBERT_FARADAY, MACH_EIGEN), MACH_EIGEN);
  assert.equal(resolveTakeByline(GILBERT_FARADAY, "  Guest Analyst  "), "Guest Analyst");
});

test("resolveTakeByline: blank/whitespace/absent override → the game's voice", () => {
  assert.equal(resolveTakeByline(MACH_EIGEN, ""), MACH_EIGEN);
  assert.equal(resolveTakeByline(MACH_EIGEN, "   "), MACH_EIGEN);
  assert.equal(resolveTakeByline(MACH_EIGEN, null), MACH_EIGEN);
  assert.equal(resolveTakeByline(GILBERT_FARADAY, undefined), GILBERT_FARADAY);
  // A game with no configured voice still gets a byline, never a blank one.
  assert.equal(resolveTakeByline(null, null), GILBERT_FARADAY);
});

test("deriveTakeFallback: joins per-question explanations for question games", () => {
  const brief = {
    questions: [
      { q: "a", options: [], correct: 0, explanation: "First point." },
      { q: "b", options: [], correct: 1, explanation: "Second point." },
    ],
  };
  assert.equal(deriveTakeFallback(brief), "First point. Second point.");
});

test("deriveTakeFallback: de-duplicates repeated explanations", () => {
  const c = {
    questions: [
      { q: "a", explanation: "Same." },
      { q: "b", explanation: "Same." },
      { q: "c", explanation: "Different." },
    ],
  };
  assert.equal(deriveTakeFallback(c), "Same. Different.");
});

test("deriveTakeFallback: honors the ~320-char soft cap but keeps the first", () => {
  const long = "x".repeat(400);
  const c = { questions: [{ explanation: long }, { explanation: "dropped" }] };
  const out = deriveTakeFallback(c);
  // First (over-cap) explanation is kept whole; the second is dropped.
  assert.equal(out, long);
});

test("deriveTakeFallback: null when no explanation content (non-question games)", () => {
  assert.equal(deriveTakeFallback({ groups: [{ label: "x", items: [] }] }), null); // Rackl
  assert.equal(deriveTakeFallback({ pairs: [{ term: "PUE", def: "..." }] }), null); // Dark Fiber
  assert.equal(deriveTakeFallback({ word: "SUBSTATION" }), null); // Signal Drop
  assert.equal(deriveTakeFallback({ questions: [] }), null);
  assert.equal(deriveTakeFallback({ questions: [{ q: "a" }] }), null); // no explanation key
});

test("deriveTakeFallback: null on junk / empty input (never throws)", () => {
  assert.equal(deriveTakeFallback(null), null);
  assert.equal(deriveTakeFallback(undefined), null);
  assert.equal(deriveTakeFallback("string"), null);
  assert.equal(deriveTakeFallback(42), null);
  assert.equal(deriveTakeFallback({ questions: "not-an-array" }), null);
  assert.equal(deriveTakeFallback({ questions: [null, 3, "x"] }), null);
});
