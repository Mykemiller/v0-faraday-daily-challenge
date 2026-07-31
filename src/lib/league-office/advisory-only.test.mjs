// AC6 — D4's advisory-only contract.
// Run: npm run test:advisory-only
//
// The claim under test: toggling season_games CANNOT change what
// /api/challenge/today serves. Two independent proofs, because either one alone
// is weak:
//
//  1. BEHAVIOURAL — drive the real serving selector with a stubbed Supabase and
//     assert the same 7 games come back before and after a season-games toggle.
//     The toggle is applied to a season_games fixture the serving path is free
//     to read; it simply never asks for it.
//
//  2. STRUCTURAL — assert the serving modules contain no reference to
//     season_config / season_games / game_catalog at all. This is the durable
//     guard: the day someone wires enforcement in without revisiting D4, THIS is
//     the test that fails, and it fails with the reason written next to it.
//
// fetch is stubbed — no network.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.DC_PUZZLE_SOURCE = "supabase";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_LIB = join(HERE, "..");

const bank = await import("../supabase-puzzle-bank.js");

const THE_SEVEN = [
  "Rackl",
  "Signal Drop",
  "The Stack",
  "Circuit",
  "Dark Fiber",
  "Frequency",
  "The Brief",
];

// The live set, exactly as dc_puzzle_bank_staging returns it: keyed by the
// free-text puzzle_type, selected on published='Live'. Note there is no
// game_id, no season_config_id, no game_key — the serving row has NO column
// that could join to season_games even if something wanted to.
const LIVE_ROWS = THE_SEVEN.map((puzzle_type, i) => ({
  puzzle_type,
  public_id: `PID-26-07-30-0000${i}`,
  puzzle_content:
    puzzle_type === "Signal Drop"
      ? { name: "BUSBAR", word: "BUSBAR", clue: "Copper distribution spine" }
      : { name: `${puzzle_type} puzzle`, groups: [{ label: "A", items: ["x", "y"] }] },
}));

/** The season slate the League Office controls. The serving path never reads
 *  this — that is the whole point — so the test mutates it freely. */
let seasonGames = THE_SEVEN.map((g) => ({ game: g, is_enabled: true }));

const realFetch = globalThis.fetch;
let requestedUrls;

beforeEach(() => {
  requestedUrls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    requestedUrls.push(u);
    if (u.includes("dc_puzzle_bank_staging")) {
      return { ok: true, status: 200, json: async () => LIVE_ROWS, text: async () => "" };
    }
    // Anything else would be a season-config read sneaking into the hot path.
    return { ok: true, status: 200, json: async () => [], text: async () => "" };
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  seasonGames = THE_SEVEN.map((g) => ({ game: g, is_enabled: true }));
});

// ── 1. behavioural ───────────────────────────────────────────────────────────

test("AC6 — the served set is identical before and after a season-games toggle", async () => {
  const before = Object.keys(await bank.getLivePuzzles()).sort();
  assert.deepEqual(before, [...THE_SEVEN].sort(), "fixture should serve all 7");

  // Turn four games OFF for the season — the exact operation the Game Library
  // page performs, and the one a commissioner would expect to matter.
  for (const g of ["Rackl", "Circuit", "Frequency", "The Brief"]) {
    seasonGames.find((r) => r.game === g).is_enabled = false;
  }
  assert.equal(seasonGames.filter((r) => r.is_enabled).length, 3, "slate should now say 3");

  const after = Object.keys(await bank.getLivePuzzles()).sort();
  assert.deepEqual(after, before, "the season slate changed the served set — D4 is broken");
  assert.equal(after.length, 7, "still 7 games served despite a 3-game slate");
});

test("AC6 — even an EMPTY season slate serves all 7", async () => {
  for (const r of seasonGames) r.is_enabled = false;
  const served = Object.keys(await bank.getLivePuzzles());
  assert.equal(served.length, 7);
});

test("the serving read never queries a season or catalog table", async () => {
  await bank.getLivePuzzles();
  assert.ok(requestedUrls.length > 0, "expected at least one read");
  for (const u of requestedUrls) {
    for (const table of ["season_games", "season_config", "game_catalog", "seasons"]) {
      assert.ok(!u.includes(table), `serving path queried ${table}: ${u}`);
    }
  }
});

test("selection is on publish state alone", async () => {
  await bank.getLivePuzzles();
  const read = requestedUrls.find((u) => u.includes("dc_puzzle_bank_staging"));
  assert.ok(read.includes("published=eq.Live"), "expected the Live filter to be the selector");
});

// ── 2. structural ────────────────────────────────────────────────────────────

test("D4 GUARD — no serving module references season or catalog tables", () => {
  // If this fails, someone wired season config into serving. That may be the
  // right thing to do eventually (it is the deferred enforcement phase), but it
  // is a DELIBERATE contract change: update D4, the Game Library page copy, and
  // the League Office docs in the same change — do not just delete this test.
  const SERVING_MODULES = [
    "puzzle-bank.js",
    "supabase-puzzle-bank.js",
    "airtable-puzzle-bank.js",
  ];
  const FORBIDDEN = ["season_games", "season_config", "game_catalog"];

  for (const file of SERVING_MODULES) {
    const src = readFileSync(join(SRC_LIB, file), "utf8");
    for (const needle of FORBIDDEN) {
      assert.ok(
        !src.includes(needle),
        `${file} references ${needle} — the season slate is no longer advisory (D4)`
      );
    }
  }
});

test("D4 GUARD — the today route does not consult season config", () => {
  const src = readFileSync(
    join(SRC_LIB, "..", "app", "api", "challenge", "today", "route.js"),
    "utf8"
  );
  for (const needle of ["season_games", "season_config"]) {
    assert.ok(!src.includes(needle), `/api/challenge/today references ${needle} — D4 is broken`);
  }
});
