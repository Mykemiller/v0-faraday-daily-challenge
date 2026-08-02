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

const THE_SEVEN = [
  "Rackl", "Signal Drop", "The Stack", "Circuit", "Dark Fiber", "Frequency", "The Brief",
];

const live = () => Object.fromEntries(THE_SEVEN.map((t) => [t, { puzzle: t }]));

// ── the point of the feature ────────────────────────────────────────────────

test("a 4-game slate serves exactly those 4", () => {
  const out = filterToSlate(live(), ["Rackl", "Circuit", "The Brief", "Frequency"]);
  assert.deepEqual(Object.keys(out).sort(), ["Circuit", "Frequency", "Rackl", "The Brief"]);
});

test("a 6-game slate drops exactly the one disabled game", () => {
  const slate = THE_SEVEN.filter((t) => t !== "Dark Fiber");
  const out = filterToSlate(live(), slate);
  assert.equal(Object.keys(out).length, 6);
  assert.equal("Dark Fiber" in out, false);
});

test("the served puzzle objects are passed through untouched", () => {
  const src = live();
  const out = filterToSlate(src, ["Rackl"]);
  assert.equal(out.Rackl, src.Rackl, "same reference — filtering must not clone or reshape");
});

// ── the fail-safes: these are the ones that matter ──────────────────────────

test("FAIL-SAFE: a null slate serves everything (no season config → no gate)", () => {
  // 3 of 6 prod seasons have no active config. This is the case that would
  // otherwise black out the lobby.
  assert.deepEqual(Object.keys(filterToSlate(live(), null)).sort(), [...THE_SEVEN].sort());
});

test("FAIL-SAFE: an empty slate serves everything, never nothing", () => {
  assert.deepEqual(Object.keys(filterToSlate(live(), [])).sort(), [...THE_SEVEN].sort());
});

test("FAIL-SAFE: a slate matching nothing live falls back rather than blanking", () => {
  // A renamed runtime_key, or a bank that hasn't rotated. Misconfiguration is
  // not an instruction to serve zero games.
  const out = filterToSlate(live(), ["Logo Match", "Some Retired Game"]);
  assert.equal(Object.keys(out).length, 7);
});

test("enforcement can only ever NARROW — never invent a game", () => {
  // A slate enabling a game with no live puzzle does not fabricate one.
  const partial = { Rackl: { puzzle: "Rackl" } };
  const out = filterToSlate(partial, ["Rackl", "Circuit", "The Brief"]);
  assert.deepEqual(Object.keys(out), ["Rackl"]);
});

test("filtering is stable under repetition", () => {
  const once = filterToSlate(live(), ["Rackl", "Circuit"]);
  const twice = filterToSlate(once, ["Rackl", "Circuit"]);
  assert.deepEqual(Object.keys(once).sort(), Object.keys(twice).sort());
});

// ── the client list ─────────────────────────────────────────────────────────

test("servedGameList keeps the client's lobby order, not the slate's", () => {
  // Enabling a game must never reshuffle the grid.
  const out = servedGameList(THE_SEVEN, ["The Brief", "Rackl", "Circuit"], null);
  assert.deepEqual(out, ["Rackl", "Circuit", "The Brief"]);
});

test("servedGameList falls back to every game on a null or unmatched slate", () => {
  assert.deepEqual(servedGameList(THE_SEVEN, null, null), THE_SEVEN);
  assert.deepEqual(servedGameList(THE_SEVEN, [], null), THE_SEVEN);
  assert.deepEqual(servedGameList(THE_SEVEN, ["Nonexistent"], null), THE_SEVEN);
});

test("servedGameList ignores slate entries the client does not know", () => {
  // An 8th game added to the catalog but not yet to GAME_CONFIGS must not
  // appear as a phantom tile.
  assert.deepEqual(servedGameList(THE_SEVEN, ["Rackl", "Grid Lock"], null), ["Rackl"]);
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
