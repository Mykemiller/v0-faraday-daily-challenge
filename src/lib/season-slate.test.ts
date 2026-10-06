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

import { filterToSlate, narrowToScheduled, servedGameList } from "./season-slate.ts";
// CC-DC-GEN-SCHEDULE-FIELDS-1.0 — the serve-path narrowing and the lobby's
// reading of it are one guarantee, so they are asserted together: a season
// that plays nothing today must land on `no_puzzles`, never on fixtures.
import { lobbyModel, type LobbyGame } from "./lobby-model.ts";

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
  // CC-LO-CONCURRENT-SEASONS-1.0: the route resolves the CALLER's season and
  // hands its id to the slate resolver — it no longer looks up "the" active one.
  assert.match(route, /resolveSeasonSlate\(seasonId\)/, "the serve route must resolve the season slate for the caller's season");
  assert.match(route, /resolveSeasonFor\(/, "the serve route must resolve the caller's season through lib/seasons/resolve");
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

// ═══════════════════════════════════════════════════════════════════════════
// CC-DC-GEN-SCHEDULE-FIELDS-1.0 — the season CALENDAR, on the serve path
// ═══════════════════════════════════════════════════════════════════════════
//
// Everything above stays true: the slate filter and its fail-safes are
// untouched. What is added is a SECOND narrowing, applied to the same result,
// for the games that are not scheduled TODAY — and it carries the same
// fail-safes with exactly one deliberate exception, which is the first test
// below.

test("SCHEDULE: nothing scheduled today serves nothing — and MEANS it", () => {
  // A Saturday in a Mon–Fri season. This is the one narrowing that must not
  // fall back: it is a correct, fully-configured answer of zero games, and
  // falling back would serve a slate the commissioner closed.
  const out = narrowToScheduled(live(), ROSTER, []);
  assert.deepEqual(Object.keys(out.puzzles), []);
  assert.deepEqual(out.slate, ROSTER, "the slate still names the season's games");
});

test("SCHEDULE: a zero-game day reads as no_puzzles in the lobby, never as mocks", () => {
  // The whole point of honouring the empty case. Season present, nothing
  // playable → CC-DC-LOBBY-EMPTY-STATE-1.0's `no_puzzles`, with a full fixture
  // map deliberately supplied and production asserted.
  const out = narrowToScheduled(live(), ROSTER, []);
  const model = lobbyModel({
    apiOk: true,
    isProd: true,
    order: ROSTER,
    mockPuzzles: Object.fromEntries(ROSTER.map((t) => [t, { mock: true }])),
    data: { puzzles: out.puzzles, slate: out.slate, season: { id: "s1", name: "Football Season" } },
  });
  assert.equal(model.mode, "no_puzzles");
  assert.equal(model.servedCount, 0);
  const noTiles: LobbyGame[] = [];
  assert.deepEqual(model.games, noTiles);
  assert.equal(model.games.some((g) => g.mock), false, "production must never serve a fixture");
});

test("FAIL-SAFE: a null schedule narrows nothing (no config, no play-day fields, any failure)", () => {
  const out = narrowToScheduled(live(), ROSTER, null);
  assert.deepEqual(Object.keys(out.puzzles).sort(), [...ROSTER].sort());
  assert.deepEqual(out.slate, ROSTER);
});

test("FAIL-SAFE: a schedule matching nothing live falls back rather than blanking", () => {
  // Non-empty, so it is NOT the "nothing plays today" answer: the calendar
  // says games play and the bank does not know their names. A renamed
  // runtime_key must not black out the lobby.
  const out = narrowToScheduled(live(), ROSTER, ["Logo Match", "Some Retired Game"]);
  assert.equal(Object.keys(out.puzzles).length, N);
  assert.deepEqual(out.slate, ROSTER, "the slate falls back in lockstep with the puzzles");
});

test("SCHEDULE: a partial day drops exactly the games that do not play", () => {
  // Three of seven play today (a per-game appears_on_days, say).
  const today = ["Alpha", "Bravo", "Charlie"];
  const out = narrowToScheduled(live(), ROSTER, today);
  assert.deepEqual(Object.keys(out.puzzles).sort(), [...today].sort());
  assert.deepEqual(out.slate, today, "the tile list narrows with the puzzle set, never apart from it");
});

test("SCHEDULE: the served puzzle objects are passed through untouched", () => {
  const src = live();
  const out = narrowToScheduled(src, ROSTER, ["Alpha"]);
  assert.equal(out.puzzles.Alpha, src.Alpha, "narrowing must not clone or reshape");
});

test("SCHEDULE: narrowing composes with the slate filter and is stable", () => {
  const slate = ROSTER.filter((t) => t !== "Echo");
  const once = narrowToScheduled(filterToSlate(live(), slate), slate, ["Alpha", "Bravo"]);
  const twice = narrowToScheduled(once.puzzles, once.slate, ["Alpha", "Bravo"]);
  assert.deepEqual(Object.keys(once.puzzles).sort(), ["Alpha", "Bravo"]);
  assert.deepEqual(Object.keys(twice.puzzles).sort(), ["Alpha", "Bravo"]);
});

test("SCHEDULE: narrowing can only REMOVE — it never invents a game", () => {
  const partial = { Alpha: { puzzle: "Alpha" } };
  const out = narrowToScheduled(partial, ["Alpha", "Bravo"], ["Alpha", "Bravo"]);
  assert.deepEqual(Object.keys(out.puzzles), ["Alpha"]);
});

test("SCHEDULE: a schedule with no slate still narrows, and names itself", () => {
  const out = narrowToScheduled(live(), null, ["Alpha", "Bravo"]);
  assert.deepEqual(Object.keys(out.puzzles).sort(), ["Alpha", "Bravo"]);
  assert.deepEqual(out.slate, ["Alpha", "Bravo"]);
});

// ── the structural half, extended ───────────────────────────────────────────

test("the serving route DOES now consult the season CALENDAR", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const route = readFileSync(join(here, "../app/api/challenge/today/route.js"), "utf8");

  assert.match(route, /resolveSeasonSchedule\(seasonId, todayCT\(\)\)/,
    "the serve route must resolve TODAY's scheduled games for the caller's season");
  assert.match(route, /narrowToScheduled\(/, "and apply the narrowing to the result");
  // The CT serve day has one owner (CC-DC-SEASON-GOLIVE-1.0); the route must
  // not re-derive it next to the slate.
  assert.match(route, /import \{ todayCT \} from "@\/lib\/seasons\/golive"/);
});

test("the schedule resolver shares the slate's kill switch and never throws", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "season-slate-server.ts"), "utf8");

  assert.match(src, /export async function resolveSeasonSchedule/);
  // One switch for both narrowings — two would be a rollback that half works.
  assert.equal((src.match(/if \(enforcementDisabled\(\)\) return null;/g) ?? []).length, 2,
    "both resolvers must honour DC_SLATE_ENFORCEMENT");
  assert.match(src, /state=eq\.active/, "only the ACTIVE config may gate serving");
  assert.match(src, /catch \{\s*return null;\s*\}/, "every failure path must fall back, never throw");
  // The rule itself has ONE home; the serve path may not grow a second copy.
  assert.match(src, /from "@\/lib\/seasons\/schedule"/);
  assert.doesNotMatch(src, /play_days_of_week\.includes|getUTCDay|getDay\(/,
    "weekday arithmetic belongs in lib/seasons/schedule.ts, not here");
});
