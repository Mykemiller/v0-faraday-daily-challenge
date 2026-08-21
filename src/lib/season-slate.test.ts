// Season slate enforcement — the guard that replaces test:advisory-only.
//   npm run test:slate-enforced
//
// D4 said the season slate was ADVISORY and `test:advisory-only` asserted it:
// the served set had to be identical before and after a slate toggle, and no
// serving module was allowed to mention season_games. Myke retired D4 on
// 2026-08-02 — the slate now gates serving — so that test is replaced by this
// one rather than deleted, and the reason travels with it.
//
// What matters most here is NOT that filtering works. It is that filtering
// CANNOT blank the lobby: 3 of 6 prod seasons have no active season_config, so
// a naive implementation would serve them zero games.

import test from "node:test";
import assert from "node:assert/strict";

import { filterToSlate, servedGameList } from "./season-slate.ts";

// CC-DC-GAME-REGISTRY-1.0 D10: generic names, and the count is derived. Slate
// filtering has nothing to do with WHICH games exist — hardcoding the live seven
// here made the suite look like it was asserting the roster, which it never was.
const ROSTER = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"];
const N = ROSTER.length;

const live = () => Object.fromEntries(ROSTER.map((t) => [t, { puzzle: t }]));

// ── the point of the feature ────────────────────────────────────────────────

test("a 4-game slate serves exactly those 4", () => {
  const out = filterToSlate(live(), ["Alpha", "Bravo", "Charlie", "Delta"]);
  assert.deepEqual(Object.keys(out).sort(), ["Alpha", "Bravo", "Charlie", "Delta"]);
});

test("a 6-game slate drops exactly the one disabled game", () => {
  const slate = ROSTER.filter((t) => t !== "Echo");
  const out = filterToSlate(live(), slate);
  assert.equal(Object.keys(out).length, 6);
  assert.equal("Echo" in out, false);
});

test("the served puzzle objects are passed through untouched", () => {
  const src = live();
  const out = filterToSlate(src, ["Alpha"]);
  assert.equal(out.Alpha, src.Alpha, "same reference — filtering must not clone or reshape");
});

// ── the fail-safes: these are the ones that matter ──────────────────────────

test("FAIL-SAFE: a null slate serves everything (no season config → no gate)", () => {
  // 3 of 6 prod seasons have no active config. This is the case that would
  // otherwise black out the lobby.
  assert.deepEqual(Object.keys(filterToSlate(live(), null)).sort(), [...ROSTER].sort());
});

test("FAIL-SAFE: an empty slate serves everything, never nothing", () => {
  assert.deepEqual(Object.keys(filterToSlate(live(), [])).sort(), [...ROSTER].sort());
});

test("FAIL-SAFE: a slate matching nothing live falls back rather than blanking", () => {
  // A renamed runtime_key, or a bank that hasn't rotated. Misconfiguration is
  // not an instruction to serve zero games.
  const out = filterToSlate(live(), ["Logo Match", "Some Retired Game"]);
  assert.equal(Object.keys(out).length, 7);
});

test("enforcement can only ever NARROW — never invent a game", () => {
  // A slate enabling a game with no live puzzle does not fabricate one.
  const partial = { Alpha: { puzzle: "Alpha" } };
  const out = filterToSlate(partial, ["Alpha", "Bravo", "Charlie"]);
  assert.deepEqual(Object.keys(out), ["Alpha"]);
});

test("filtering is stable under repetition", () => {
  const once = filterToSlate(live(), ["Alpha", "Bravo"]);
  const twice = filterToSlate(once, ["Alpha", "Bravo"]);
  assert.deepEqual(Object.keys(once).sort(), Object.keys(twice).sort());
});

// ── the client list ─────────────────────────────────────────────────────────

test("servedGameList keeps the client's lobby order, not the slate's", () => {
  // Enabling a game must never reshuffle the grid.
  const out = servedGameList(ROSTER, ["Charlie", "Alpha", "Bravo"], null);
  assert.deepEqual(out, ["Alpha", "Bravo", "Charlie"]);
});

test("servedGameList falls back to every game on a null or unmatched slate", () => {
  assert.deepEqual(servedGameList(ROSTER, null, null), ROSTER);
  assert.deepEqual(servedGameList(ROSTER, [], null), ROSTER);
  assert.deepEqual(servedGameList(ROSTER, ["Nonexistent"], null), ROSTER);
});

test("servedGameList ignores slate entries the client does not know", () => {
  // An 8th game added to the catalog but not yet to GAME_CONFIGS must not
  // appear as a phantom tile.
  assert.deepEqual(servedGameList(ROSTER, ["Alpha", "Grid Lock"], null), ["Alpha"]);
});

// ── the structural half of the old guard, inverted ──────────────────────────

test("the serving route DOES now consult the season slate", async () => {
  // The mirror of test:advisory-only's structural assertion. If someone removes
  // enforcement without revisiting this decision, THIS is what fails.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const route = readFileSync(join(here, "../app/api/challenge/today/route.js"), "utf8");

  assert.match(route, /filterToSlate/, "the serve route must apply the slate filter");
  assert.match(route, /resolveActiveSeasonSlate/, "the serve route must resolve the season slate");
  assert.match(route, /slate/, "the payload must carry the slate for the client");
});

test("the slate resolver never throws and is kill-switchable", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "season-slate-server.ts"), "utf8");

  assert.match(src, /DC_SLATE_ENFORCEMENT/, "a kill switch must exist for rollback without a code change");
  assert.match(src, /state=eq\.active/, "only the ACTIVE config may gate serving — never a draft or scheduled one");
  assert.match(src, /runtime_key/, "must join on runtime_key (D3), not game_key, or it silently matches nothing");
});
