import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShare,
  glyphLines,
  encodeGrid,
  puzzleDateFromPublicId,
  puzzleNumberFromDate,
  formatElapsed,
  GLYPH,
} from "./buildShare.js";
import { SHARE_EPOCH } from "./manifest.js";

// ── D2: number derivation ────────────────────────────────────────────────────

test("public id → serve date → per-game day index (#1 on the epoch, #38 on 2026-07-31)", () => {
  assert.equal(puzzleDateFromPublicId("RACK-26-07-31-00365"), "2026-07-31");
  assert.equal(puzzleNumberFromDate("2026-06-24", SHARE_EPOCH), 1);
  assert.equal(puzzleNumberFromDate("2026-07-31", SHARE_EPOCH), 38);
});

test("malformed / pre-epoch public ids never produce a number", () => {
  for (const bad of [null, "", "RACK-26-13-40-00001", "not-an-id", "RACK-26-07-31", "RACK-26-07-31-1"]) {
    assert.equal(puzzleDateFromPublicId(bad), null, String(bad));
  }
  assert.equal(puzzleNumberFromDate("2026-06-23", SHARE_EPOCH), null);
  assert.equal(puzzleNumberFromDate("garbage", SHARE_EPOCH), null);
});

test("formatElapsed", () => {
  assert.equal(formatElapsed(134), "2:14");
  assert.equal(formatElapsed(59.4), "0:59");
  assert.equal(formatElapsed(-1), null);
  assert.equal(formatElapsed(null), null);
});

// ── Glyph lines per outcome shape ────────────────────────────────────────────

test("signal drop rows render the Wordle grid; a malformed row kills the grid, not the share", () => {
  const rows = [["absent", "present", "absent"], ["correct", "correct", "correct"]];
  assert.deepEqual(glyphLines("signal-drop", { rows }), [
    `${GLYPH.miss}${GLYPH.partial}${GLYPH.miss}`,
    `${GLYPH.correct}${GLYPH.correct}${GLYPH.correct}`,
  ]);
  assert.deepEqual(glyphLines("signal-drop", { rows: [["correct"], ["EVIL"]] }), []);
});

test("ok-row games render one line of per-question marks", () => {
  assert.deepEqual(glyphLines("circuit", { ok: [true, true, false] }), [
    `${GLYPH.correct}${GLYPH.correct}${GLYPH.miss}`,
  ]);
  assert.deepEqual(glyphLines("the-brief", { ok: [] }), []);
  assert.deepEqual(glyphLines("frequency", { ok: [true, "yes"] }), []);
});

test("rackl / dark fiber render counts-only pips (reduced blocks, approved)", () => {
  assert.deepEqual(glyphLines("rackl", { solved: 4, mistakes: 1 }), [
    `${GLYPH.correct.repeat(4)} ${GLYPH.miss}`,
  ]);
  assert.deepEqual(glyphLines("dark-fiber", { pairs: 3, mistakes: 0 }), [GLYPH.correct.repeat(3)]);
  assert.deepEqual(glyphLines("rackl", { solved: "four", mistakes: 1 }), []);
});

test("missing/junk outcome degrades to no glyph line and never throws (AC 7)", () => {
  assert.deepEqual(glyphLines("circuit", null), []);
  assert.deepEqual(glyphLines("signal-drop", { anything: true }), []);
  const p = buildShare({ surface: "scorecard", puzzleType: "Circuit", publicId: "CIRC-26-07-31-00367", score: 90 });
  assert.ok(p.text.includes("Circuit #38"));
  assert.ok(!p.text.includes(GLYPH.correct));
});

// ── The full game payload ────────────────────────────────────────────────────

test("game share carries name, number, glyphs, stats, canonical link (a–e)", () => {
  const p = buildShare({
    surface: "scorecard",
    puzzleType: "Dark Fiber",
    publicId: "FIBR-26-07-31-00356",
    score: 128,
    elapsedSec: 134,
    bandLabel: "On Pace",
    outcome: { pairs: 5, mistakes: 2 },
  });
  assert.equal(p.title, "Faraday Daily Challenge");
  const lines = p.text.split("\n");
  assert.equal(lines[0], "Faraday · Dark Fiber #38");
  assert.equal(lines[1], `${GLYPH.correct.repeat(5)} ${GLYPH.miss.repeat(2)}`);
  assert.equal(lines[2], "128 pts · 2:14 · On Pace");
  assert.equal(lines[3], "faradaydailychallenge.com");
  assert.equal(
    p.url,
    "https://www.faradaydailychallenge.com/?g=dark-fiber&d=2026-07-31&utm_source=share&utm_medium=scorecard"
  );
  assert.equal(p.iconUrl, "/share/icons/dark-fiber.png");
  assert.equal(p.imageFilename, "faraday-dark-fiber.png");
  assert.ok(p.imageUrl.startsWith("/api/share/card?game=dark-fiber&n=38&date=2026-07-31&score=128"));
  assert.ok(p.imageUrl.includes("grid=p5m2"));
  assert.equal(p.number, 38);
});

test("generic share (D7): DC mark, lobby link, no g/d params", () => {
  const p = buildShare({ kind: "generic", surface: "share-hub", headline: "Join my team “Grid Lock”", detail: "Team code ABQ123" });
  assert.ok(p.text.startsWith("Faraday Daily Challenge\n"));
  assert.ok(p.text.includes("Join my team"));
  assert.equal(p.url, "https://www.faradaydailychallenge.com/?utm_source=share&utm_medium=share-hub");
  assert.equal(p.iconUrl, "/share/icons/daily-challenge.png");
});

test("unknown game type degrades to the generic payload, never a broken card", () => {
  const p = buildShare({ surface: "scorecard", puzzleType: "Mesh", score: 50 });
  assert.equal(p.iconUrl, "/share/icons/daily-challenge.png");
  assert.ok(!p.url.includes("g="));
});

test("mock/offline play (no publicId) drops #number and d, keeps everything else", () => {
  const p = buildShare({ surface: "scorecard", puzzleType: "Rackl", score: 75, outcome: { solved: 2, mistakes: 4 } });
  assert.ok(p.text.startsWith("Faraday · Rackl\n"));
  assert.ok(p.url.includes("g=rackl") && !p.url.includes("d="));
  assert.equal(p.number, null);
});

test("surface tag is sanitized into utm_medium", () => {
  const p = buildShare({ kind: "generic", surface: "Team Invite!" });
  assert.ok(p.url.endsWith("utm_medium=teaminvite"));
});

// ── AC 3: the Signal Drop spoiler test ───────────────────────────────────────
// The answer string must appear in neither the text payload, the share URL, the
// card image URL, nor any param — even when a caller tries to smuggle it in
// through every field a naive builder might read.

test("AC3: Signal Drop answer never reaches any part of the payload (won game)", () => {
  const ANSWER = "PEAKER";
  const p = buildShare({
    surface: "scorecard",
    puzzleType: "Signal Drop",
    publicId: "SGNL-26-07-30-00352",
    score: 118,
    elapsedSec: 88,
    bandLabel: "Ahead of Consensus",
    outcome: {
      rows: [
        ["absent", "present", "absent", "absent", "absent", "absent"],
        ["correct", "correct", "correct", "correct", "correct", "correct"],
      ],
      // Smuggling attempts a naive builder might read — must all be ignored:
      word: ANSWER,
      answer: ANSWER,
      guesses: ["SIGNAL", ANSWER],
    },
    // More smuggling attempts at the top level:
    word: ANSWER,
    puzzleName: ANSWER,
    name: ANSWER,
    answers: [ANSWER],
  });
  for (const field of [p.title, p.text, p.url, p.imageUrl, p.iconUrl, p.imageFilename]) {
    assert.ok(!String(field).toUpperCase().includes(ANSWER), `answer leaked into: ${field}`);
  }
  // The grid must be states-only.
  assert.ok(p.imageUrl.includes("grid=apaaaa-cccccc"));
  // And the display name must be the manifest's, not any passed name.
  assert.ok(p.text.startsWith("Faraday · Signal Drop"));
});

test("AC3: lost game / pre-completion shapes leak nothing either", () => {
  const ANSWER = "BUSBAR";
  const p = buildShare({
    surface: "scorecard",
    puzzleType: "Signal Drop",
    publicId: "SGNL-26-07-30-00352",
    score: 10,
    outcome: { rows: [["absent", "absent", "absent", "absent", "absent", "absent"]], word: ANSWER },
    puzzleName: ANSWER,
  });
  assert.ok(!p.text.includes(ANSWER) && !p.url.includes(ANSWER) && !p.imageUrl.includes(ANSWER));
});

test("publicId cannot smuggle arbitrary text into the payload", () => {
  const p = buildShare({ surface: "scorecard", puzzleType: "Rackl", publicId: "PEAKER is the answer" });
  assert.ok(!p.text.includes("PEAKER") && !p.url.includes("PEAKER") && !p.imageUrl.includes("PEAKER"));
});

// ── AC 4: canonical domain only ──────────────────────────────────────────────

test("AC4: no payload field ever carries faraday-intelligence.ai", () => {
  const payloads = [
    buildShare({ surface: "scorecard", puzzleType: "The Stack", publicId: "STAK-26-07-31-00353", score: 90, outcome: { ok: [true, false, true] } }),
    buildShare({ kind: "generic", surface: "leaderboard", headline: "1,240 pts · #3 on the season leaderboard" }),
  ];
  for (const p of payloads) {
    for (const field of Object.values(p)) {
      assert.ok(!String(field).includes("faraday-intelligence.ai"));
    }
    assert.ok(p.url.startsWith("https://www.faradaydailychallenge.com/"));
  }
});

// ── encodeGrid ───────────────────────────────────────────────────────────────

test("encodeGrid emits the compact states-only grammar", () => {
  assert.equal(encodeGrid("signal-drop", { rows: [["correct", "present", "absent", "empty"]] }), "cpae");
  assert.equal(encodeGrid("circuit", { ok: [true, false, true] }), "oxo");
  assert.equal(encodeGrid("rackl", { solved: 4, mistakes: 0 }), "s4m0");
  assert.equal(encodeGrid("dark-fiber", { pairs: 6, mistakes: 3 }), "p6m3");
  assert.equal(encodeGrid("signal-drop", { rows: [["correct", "WORD"]] }), null);
  assert.equal(encodeGrid("circuit", null), null);
});
