// Unit tests for the Signal Drop answer-leak fix (pure logic).
//
// Run with:  npm run test:signal-drop
//   (node --test with --experimental-default-type=module so these ESM `.js`
//    source modules load under node; the project has no bundler-independent
//    test runner otherwise.)
//
// Covers the three guarantees the leak fix must hold:
//   1. The plaintext answer never appears in the client payload (strip).
//   2. Guess validation + per-letter feedback still work (evaluateGuess).
//   3. The answer is revealed only once the game is over (resolveGuesses).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGuess,
  toPublicSignalPuzzle,
  buildSignalHints,
  resolveGuesses,
  SIGNAL_ANSWER_FIELDS,
  SIGNAL_MAX_GUESSES,
  normalizeWord,
} from "./signal-drop.js";

// A distinctive sentinel answer so an accidental substring match can't produce a
// false "not leaked" pass — ZZQXWORD appears nowhere else in the app.
const SENTINEL = "ZZQXWORD";
const rawContent = {
  name: SENTINEL, // Puzzle Bank mirrors the answer into `name`
  word: SENTINEL, // the answer
  domain: "Power Architecture",
  clue: "A distinctive sentinel clue for testing",
  hint1: "curator hint one",
  hint2: "curator hint two",
};

// ── 1. Payload strip — the answer must not survive into the client shape ──────
test("toPublicSignalPuzzle removes every answer-bearing field", () => {
  const pub = toPublicSignalPuzzle(rawContent);
  for (const f of SIGNAL_ANSWER_FIELDS) {
    assert.equal(pub[f], undefined, `field "${f}" must be stripped`);
  }
});

test("the sentinel answer appears nowhere in the serialized client payload", () => {
  // This is the payload-boundary guarantee: the client renders ONLY from this
  // object, so if the sentinel is absent from its JSON it cannot reach the DOM,
  // the hydration data, or the network response.
  const pub = toPublicSignalPuzzle(rawContent);
  const serialized = JSON.stringify(pub);
  assert.ok(
    !serialized.includes(SENTINEL),
    `answer leaked into client payload: ${serialized}`
  );
});

test("toPublicSignalPuzzle keeps what the grid + UI need", () => {
  const pub = toPublicSignalPuzzle(rawContent);
  assert.equal(pub.wordLength, SENTINEL.length); // grid renders from length only
  assert.equal(pub.clue, rawContent.clue);
  assert.equal(pub.domain, rawContent.domain);
  assert.ok(Array.isArray(pub.hints) && pub.hints.length >= 2);
});

test("stripped hints never contain the full answer", () => {
  const hints = buildSignalHints(rawContent);
  for (const h of hints) {
    assert.ok(!h.includes(SENTINEL), `hint leaked the answer: ${h}`);
  }
  // The derived hint reveals only the first letter + length — by design, gated.
  assert.ok(hints.some((h) => h.includes(`is ${SENTINEL.length} letters long`)));
});

// ── 2. Guess validation + per-letter feedback ─────────────────────────────────
test("evaluateGuess flags a correct guess", () => {
  const { correct, states } = evaluateGuess("BUSBAR", "busbar");
  assert.equal(correct, true);
  assert.deepEqual(states, ["correct", "correct", "correct", "correct", "correct", "correct"]);
});

test("evaluateGuess produces correct/present/absent feedback", () => {
  // answer BUSBAR, guess BRAINS:
  //  B(0)==B → correct; R present; A present; I absent; N absent; S present
  const { correct, states } = evaluateGuess("BUSBAR", "BRAINS");
  assert.equal(correct, false);
  assert.deepEqual(states, ["correct", "present", "present", "absent", "absent", "present"]);
});

test("evaluateGuess mirrors the historical (non-count-aware) membership rule", () => {
  // Guard against silently changing game feel: a letter present anywhere in the
  // answer is "present" even beyond its count.
  const { states } = evaluateGuess("LATENCY", "TTTTTTT");
  // T appears at index 2 in LATENCY → position 2 correct, all others present.
  assert.equal(states[2], "correct");
  assert.ok(states.filter((s) => s === "present").length === 6);
});

// ── 3. Reveal gate — answer released only once the game is over ────────────────
test("resolveGuesses withholds the answer mid-game", () => {
  const r = resolveGuesses("LATENCY", ["ROUTERS"]); // wrong, 1/6
  assert.equal(r.done, false);
  assert.equal(r.revealWord, null); // no reveal before the game ends
});

test("resolveGuesses reveals the answer on a win", () => {
  const r = resolveGuesses("LATENCY", ["ROUTERS", "LATENCY"]);
  assert.equal(r.correct, true);
  assert.equal(r.done, true);
  assert.equal(r.revealWord, "LATENCY");
});

test("resolveGuesses reveals the answer after all guesses are spent (loss)", () => {
  const spent = Array.from({ length: SIGNAL_MAX_GUESSES }, () => "WRONGXX");
  const r = resolveGuesses("LATENCY", spent);
  assert.equal(r.correct, false);
  assert.equal(r.lost, true);
  assert.equal(r.done, true);
  assert.equal(r.revealWord, "LATENCY"); // loss reveal preserved
});

test("resolveGuesses does not reveal before the final guess is spent", () => {
  const five = Array.from({ length: SIGNAL_MAX_GUESSES - 1 }, () => "WRONGXX");
  const r = resolveGuesses("LATENCY", five);
  assert.equal(r.done, false);
  assert.equal(r.revealWord, null);
});

// ── normalizeWord ────────────────────────────────────────────────────────────
test("normalizeWord uppercases and trims", () => {
  assert.equal(normalizeWord("  busbar "), "BUSBAR");
  assert.equal(normalizeWord(null), "");
});
