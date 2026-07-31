import test from "node:test";
import assert from "node:assert/strict";
import { decodeGrid, parseCardParams, finePrint, CARD_SIZES } from "./card-params.js";
import { SHARE_MANIFEST, GENERIC_SLUG } from "./manifest.js";
import { buildShare, encodeGrid } from "./buildShare.js";

const qs = (s) => new URLSearchParams(s);

test("decodeGrid round-trips every Phase-1 encodeGrid grammar", () => {
  const signal = encodeGrid("signal-drop", {
    rows: [["absent", "present", "absent"], ["correct", "correct", "correct"]],
  });
  assert.deepEqual(decodeGrid("signal-drop", signal), {
    rows: [["miss", "partial", "miss"], ["correct", "correct", "correct"]],
  });
  assert.deepEqual(decodeGrid("circuit", encodeGrid("circuit", { ok: [true, false] })), {
    rows: [["correct", "miss"]],
  });
  assert.deepEqual(decodeGrid("rackl", encodeGrid("rackl", { solved: 4, mistakes: 1 })), {
    rows: [[..."cccc"].map(() => "correct").concat(["miss"])],
  });
  assert.deepEqual(decodeGrid("dark-fiber", encodeGrid("dark-fiber", { pairs: 2, mistakes: 1 })), {
    rows: [["correct", "correct", "miss"]],
  });
});

test("decodeGrid rejects everything outside the closed grammars", () => {
  assert.equal(decodeGrid("signal-drop", "PEAKER"), null);
  assert.equal(decodeGrid("signal-drop", "cpae-"), null);
  assert.equal(decodeGrid("signal-drop", "c".repeat(11)), null);
  assert.equal(decodeGrid("signal-drop", "c-c-c-c-c-c-c"), null); // 7 rows
  assert.equal(decodeGrid("circuit", "ooze"), null);
  assert.equal(decodeGrid("rackl", "s5m0"), null);
  assert.equal(decodeGrid("dark-fiber", "p13m0"), null);
  assert.equal(decodeGrid("dark-fiber", "p2m21"), null);
  assert.equal(decodeGrid("circuit", ""), null);
  assert.equal(decodeGrid("circuit", null), null);
});

test("parseCardParams: full valid query", () => {
  const p = parseCardParams(qs("game=dark-fiber&n=38&date=2026-07-31&score=128&band=On+Pace&grid=p5m2"));
  assert.equal(p.slug, "dark-fiber");
  assert.equal(p.entry, SHARE_MANIFEST["dark-fiber"]);
  assert.equal(p.n, 38);
  assert.equal(p.date, "2026-07-31");
  assert.equal(p.score, 128);
  assert.equal(p.band, "On Pace");
  assert.equal(p.grid.rows[0].length, 7);
  assert.deepEqual({ width: p.size.width, height: p.size.height }, CARD_SIZES.og);
});

test("parseCardParams: size=square selects the 1080 variant, anything else = og", () => {
  assert.equal(parseCardParams(qs("size=square")).size.width, 1080);
  assert.equal(parseCardParams(qs("size=banner")).size.width, 1200);
  assert.equal(parseCardParams(qs("")).size.width, 1200);
});

test("parseCardParams: every invalid piece degrades to absence, never a throw", () => {
  const p = parseCardParams(qs("game=mystery&n=1e9&date=07/31/2026&score=-5&band=&grid=s4m1"));
  assert.equal(p.slug, GENERIC_SLUG); // unknown game → DC card (D7/AC7)
  assert.equal(p.n, null);
  assert.equal(p.date, null);
  assert.equal(p.score, null);
  assert.equal(p.band, null);
  assert.equal(p.grid, null); // generic never carries a grid
});

test("parseCardParams: band is single-line and capped at 40 chars", () => {
  const p = parseCardParams(qs(`game=rackl&band=${encodeURIComponent("a\nb  c" + "x".repeat(80))}`));
  assert.ok(!p.band.includes("\n"));
  assert.ok(p.band.length <= 40);
});

test("finePrint = prefix + YY-MM-DD segment; absent for generic or missing date", () => {
  assert.equal(finePrint(SHARE_MANIFEST["rackl"], "2026-07-31"), "RACK-26-07-31");
  assert.equal(finePrint(SHARE_MANIFEST[GENERIC_SLUG], "2026-07-31"), null);
  assert.equal(finePrint(SHARE_MANIFEST["rackl"], null), null);
});

test("a real buildShare imageUrl parses clean end-to-end", () => {
  const payload = buildShare({
    surface: "scorecard",
    puzzleType: "Signal Drop",
    publicId: "SGNL-26-07-30-00352",
    score: 118,
    bandLabel: "Ahead of Consensus",
    outcome: { rows: [["absent", "present", "absent", "absent", "absent", "absent"], ["correct", "correct", "correct", "correct", "correct", "correct"]] },
  });
  const p = parseCardParams(new URL(payload.imageUrl, "https://x.test").searchParams);
  assert.equal(p.slug, "signal-drop");
  assert.equal(p.n, 37);
  assert.equal(p.grid.rows.length, 2);
  assert.equal(p.band, "Ahead of Consensus");
});
