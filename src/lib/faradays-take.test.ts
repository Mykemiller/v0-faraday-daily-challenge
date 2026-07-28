// Unit tests for the Faraday's Take helpers (FAR-389). Pure logic — no I/O.
//
// Run with:  npm run test:take   (node --test with TS type-stripping, matching
// the tokenomics test setup).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GILBERT_FARADAY,
  MACH_EIGEN,
  TAKE_VOICE_BY_TYPE,
  defaultTakeByline,
  resolveTakeByline,
  deriveTakeFallback,
} from "./faradays-take.ts";

test("voice map covers all 7 game types with the ticket's split", () => {
  const gilbert = ["Rackl", "The Stack", "Dark Fiber", "Frequency"];
  const mach = ["Circuit", "The Brief", "Signal Drop"];
  for (const t of gilbert) assert.equal(TAKE_VOICE_BY_TYPE[t], GILBERT_FARADAY, t);
  for (const t of mach) assert.equal(TAKE_VOICE_BY_TYPE[t], MACH_EIGEN, t);
  assert.equal(Object.keys(TAKE_VOICE_BY_TYPE).length, 7);
});

test("defaultTakeByline falls back to Gilbert Faraday for unknown/empty types", () => {
  assert.equal(defaultTakeByline("Circuit"), MACH_EIGEN);
  assert.equal(defaultTakeByline("Rackl"), GILBERT_FARADAY);
  assert.equal(defaultTakeByline("Nonexistent"), GILBERT_FARADAY);
  assert.equal(defaultTakeByline(null), GILBERT_FARADAY);
  assert.equal(defaultTakeByline(undefined), GILBERT_FARADAY);
});

test("resolveTakeByline: explicit override wins over the game-type voice", () => {
  // Override present → used verbatim, even against the type's default voice.
  assert.equal(resolveTakeByline("Circuit", "Gilbert Faraday"), "Gilbert Faraday");
  assert.equal(resolveTakeByline("Rackl", "Mach Eigen"), "Mach Eigen");
  assert.equal(resolveTakeByline("Rackl", "  Guest Analyst  "), "Guest Analyst");
});

test("resolveTakeByline: blank/whitespace/absent override → game-type voice", () => {
  assert.equal(resolveTakeByline("Signal Drop", ""), MACH_EIGEN);
  assert.equal(resolveTakeByline("Signal Drop", "   "), MACH_EIGEN);
  assert.equal(resolveTakeByline("Signal Drop", null), MACH_EIGEN);
  assert.equal(resolveTakeByline("Frequency", undefined), GILBERT_FARADAY);
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
