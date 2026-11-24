// CC-DC-LOBBY-EMPTY-STATE-1.0 (D10) — the lobby state machine.
//   npm run test:lobby-model
//
// Every rule in D9 is pinned here, but ONE test is the reason the file exists:
// "production never returns a mock puzzle". FDY-43/46 B4 was a season stuck at
// `upcoming` serving {} while the lobby rendered seven playable FIXTURES on top
// of it, which is what hid the outage for a day. That regression is one `||`
// away at all times, so it is asserted against every empty shape the API can
// produce, with a full fixture map deliberately passed in.

import test from "node:test";
import assert from "node:assert/strict";

import {
  LOBBY_COPY,
  formatStartsOn,
  lobbyModel,
  nextSeasonLine,
  servedKeys,
  slateGames,
} from "./lobby-model.ts";

// Seven games, as game_catalog orders them. Injected, never derived from the
// fixture's keys (CC-DC-GAME-REGISTRY-1.0).
const ORDER = ["Rackl", "Signal Drop", "The Stack", "Circuit", "The Brief", "Dark Fiber", "Frequency"];

// Stand-in for MOCK_PUZZLES. Distinct objects so reference identity proves
// WHICH puzzle came back.
const MOCKS: Record<string, unknown> = Object.fromEntries(ORDER.map((k) => [k, { __mock: k }]));

const LIVE = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, { __live: k }]));

const SEASON = { id: "s1", name: "Football Season" };

// ── loading / error: the request, not the content ────────────────────────────

test("apiOk unresolved → loading, no tiles, in any environment", () => {
  for (const apiOk of [null, undefined]) {
    for (const isProd of [true, false]) {
      const m = lobbyModel({ apiOk, isProd, order: ORDER, mockPuzzles: MOCKS });
      assert.equal(m.mode, "loading");
      assert.deepEqual(m.games, []);
      assert.equal(m.servedCount, 0);
      assert.equal(m.retry, false);
      assert.equal(m.headline, LOBBY_COPY.loading);
    }
  }
});

test("apiOk false → error with the copy and a Retry, no game tiles", () => {
  const m = lobbyModel({ apiOk: false, isProd: true, order: ORDER, mockPuzzles: MOCKS });
  assert.equal(m.mode, "error");
  assert.equal(m.headline, "We couldn't load today's challenge.");
  assert.equal(m.retry, true);
  assert.deepEqual(m.games, []);
  assert.equal(m.servedCount, 0);
});

test("a failed request is an error outside production too — not a fixture lobby", () => {
  const m = lobbyModel({ apiOk: false, isProd: false, order: ORDER, mockPuzzles: MOCKS });
  assert.equal(m.mode, "error");
  assert.deepEqual(m.games, []);
});

// ── no_season ───────────────────────────────────────────────────────────────

test("season null → no_season: no tiles, no body when no next season is known", () => {
  const m = lobbyModel({
    apiOk: true,
    isProd: true,
    order: ORDER,
    data: { puzzles: {}, tip: null, slate: null, season: null, nextSeason: null },
  });
  assert.equal(m.mode, "no_season");
  assert.equal(m.headline, "No challenge today.");
  assert.equal(m.body, null);
  assert.equal(m.nextSeason, null);
  assert.deepEqual(m.games, []);
  assert.equal(m.servedCount, 0);
  assert.equal(m.retry, false);
});

test("no_season names the next season and its start date", () => {
  const m = lobbyModel({
    apiOk: true,
    isProd: true,
    order: ORDER,
    data: { puzzles: {}, season: null, nextSeason: { name: "Football Season", starts_on: "2026-11-02" } },
  });
  assert.equal(m.mode, "no_season");
  assert.equal(m.headline, "No challenge today.");
  assert.equal(m.body, "Football Season starts November 2, 2026.");
  assert.deepEqual(m.nextSeason, { name: "Football Season", starts_on: "2026-11-02" });
});

test("an unnamed next season still gets a sentence; an undated one gets none", () => {
  const named = lobbyModel({
    apiOk: true, isProd: true, order: ORDER,
    data: { season: null, nextSeason: { name: null, starts_on: "2027-01-04" } },
  });
  assert.equal(named.body, "The next season starts January 4, 2027.");

  const undated = lobbyModel({
    apiOk: true, isProd: true, order: ORDER,
    data: { season: null, nextSeason: { name: "Spring Season", starts_on: null } },
  });
  assert.equal(undated.mode, "no_season");
  assert.equal(undated.body, null, "never half a sentence");
});

// ── no_puzzles ──────────────────────────────────────────────────────────────

test("season present, puzzles empty → no_puzzles, no tiles", () => {
  const m = lobbyModel({
    apiOk: true, isProd: true, order: ORDER,
    data: { puzzles: {}, slate: null, season: SEASON, nextSeason: null },
  });
  assert.equal(m.mode, "no_puzzles");
  assert.equal(m.headline, "Today's puzzles aren't out yet — check back soon.");
  assert.deepEqual(m.games, []);
  assert.equal(m.servedCount, 0);
  assert.equal(m.retry, false);
});

test("a slate whose every game is missing today is also no_puzzles", () => {
  const m = lobbyModel({
    apiOk: true, isProd: true, order: ORDER,
    data: { puzzles: LIVE("Frequency"), slate: ["Rackl", "Circuit"], season: SEASON },
  });
  assert.equal(m.mode, "no_puzzles");
  assert.deepEqual(m.games, []);
});

// ── live ────────────────────────────────────────────────────────────────────

test("live: tiles are slate ∩ served, and a slate game with no puzzle is disabled", () => {
  const m = lobbyModel({
    apiOk: true, isProd: true, order: ORDER,
    data: {
      puzzles: LIVE("Rackl", "The Stack", "Frequency"),
      slate: ["Rackl", "The Stack", "Circuit"],
      season: SEASON,
    },
  });
  assert.equal(m.mode, "live");
  // Lobby order, not slate order; "Frequency" is live but NOT in the slate, so
  // it is not a tile.
  assert.deepEqual(m.games.map((g) => g.key), ["Rackl", "The Stack", "Circuit"]);
  assert.deepEqual(m.games.map((g) => g.available), [true, true, false]);
  assert.equal(m.games[2].puzzle, null);
  assert.deepEqual(m.games[0].puzzle, { __live: "Rackl" });
  assert.equal(m.servedCount, 2, "the disabled tile is not served");
  assert.deepEqual(servedKeys(m), ["Rackl", "The Stack"]);
});

test("served count is the games actually served — never the hardcoded 7", () => {
  const five = ["Rackl", "Signal Drop", "The Stack", "Circuit", "The Brief"];
  const m = lobbyModel({
    apiOk: true, isProd: true, order: ORDER,
    data: { puzzles: LIVE(...five), slate: five, season: SEASON },
  });
  assert.equal(m.mode, "live");
  assert.equal(m.servedCount, 5);
  assert.notEqual(m.servedCount, 7);
  assert.equal(m.games.length, 5);

  // And the 7-game case is still 7, so the denominator tracks the slate.
  const all = lobbyModel({
    apiOk: true, isProd: true, order: ORDER,
    data: { puzzles: LIVE(...ORDER), slate: null, season: SEASON },
  });
  assert.equal(all.servedCount, 7);
});

test("no tile is ever invented for a game the registry does not list", () => {
  const m = lobbyModel({
    apiOk: true, isProd: true, order: ["Rackl", "Circuit"],
    data: { puzzles: LIVE("Rackl", "Circuit", "Frequency"), slate: null, season: SEASON },
  });
  assert.deepEqual(m.games.map((g) => g.key), ["Rackl", "Circuit"]);
});

// ── THE production guard ────────────────────────────────────────────────────

function allPuzzles(m: ReturnType<typeof lobbyModel>): unknown[] {
  return m.games.map((g) => g.puzzle).filter((p) => p !== null);
}

test("production NEVER returns a mock puzzle — for any empty shape the API can produce", () => {
  const mockValues = new Set(Object.values(MOCKS));
  const shapes: { label: string; data: Record<string, unknown> }[] = [
    { label: "the live B4 payload", data: { puzzles: {}, tip: null, solveBands: {}, slate: null, season: null } },
    { label: "no season, next season known", data: { puzzles: {}, season: null, nextSeason: { name: "X", starts_on: "2026-12-01" } } },
    { label: "season, no puzzles", data: { puzzles: {}, slate: null, season: SEASON } },
    { label: "season, slate, no puzzles", data: { puzzles: {}, slate: ["Rackl"], season: SEASON } },
    { label: "season, partial puzzles", data: { puzzles: LIVE("Rackl"), slate: null, season: SEASON } },
    { label: "null data", data: {} },
  ];
  for (const { label, data } of shapes) {
    const m = lobbyModel({ apiOk: true, isProd: true, order: ORDER, mockPuzzles: MOCKS, data });
    assert.ok(m.games.every((g) => g.mock === false), `${label}: a tile claimed mock content`);
    for (const p of allPuzzles(m)) {
      assert.ok(!mockValues.has(p), `${label}: a MOCK puzzle reached production`);
    }
  }
});

test("production: a game with no puzzle today is disabled, never filled from the fixture", () => {
  const m = lobbyModel({
    apiOk: true, isProd: true, order: ORDER, mockPuzzles: MOCKS,
    data: { puzzles: LIVE("Rackl"), slate: null, season: SEASON },
  });
  assert.equal(m.mode, "live");
  assert.equal(m.servedCount, 1);
  const missing = m.games.filter((g) => g.key !== "Rackl");
  assert.equal(missing.length, 6);
  assert.ok(missing.every((g) => g.available === false && g.puzzle === null && g.mock === false));
  assert.deepEqual(servedKeys(m), ["Rackl"]);
});

test("isProd omitted is treated as production — a caller that forgets fails safe", () => {
  const m = lobbyModel({ apiOk: true, order: ORDER, mockPuzzles: MOCKS, data: { puzzles: {}, season: null } });
  assert.equal(m.mode, "no_season");
  assert.deepEqual(m.games, []);
});

// ── the non-production fallback (developer convenience) ─────────────────────

test("outside production the fixture lobby returns, and every tile is labelled MOCK", () => {
  const m = lobbyModel({
    apiOk: true, isProd: false, order: ORDER, mockPuzzles: MOCKS,
    data: { puzzles: {}, tip: null, solveBands: {}, slate: null, season: null },
  });
  assert.equal(m.mode, "live");
  assert.equal(m.games.length, 7);
  assert.ok(m.games.every((g) => g.mock === true && g.available === true));
  assert.equal(LOBBY_COPY.mockBadge, "MOCK");
});

test("outside production the fixture fills individual gaps, and only those", () => {
  const m = lobbyModel({
    apiOk: true, isProd: false, order: ORDER, mockPuzzles: MOCKS,
    data: { puzzles: LIVE("Rackl"), slate: ["Rackl", "Circuit"], season: SEASON },
  });
  assert.equal(m.mode, "live");
  assert.deepEqual(m.games.map((g) => g.key), ["Rackl", "Circuit"]);
  assert.equal(m.games[0].mock, false, "a live puzzle is never replaced by the fixture");
  assert.deepEqual(m.games[0].puzzle, { __live: "Rackl" });
  assert.equal(m.games[1].mock, true);
  assert.deepEqual(m.games[1].puzzle, { __mock: "Circuit" });
  assert.equal(m.servedCount, 2);
});

test("outside production with no fixture for the slate → the empty state, not a blank lobby", () => {
  const m = lobbyModel({
    apiOk: true, isProd: false, order: ORDER, mockPuzzles: {},
    data: { puzzles: {}, slate: null, season: null },
  });
  assert.equal(m.mode, "no_season");
  assert.deepEqual(m.games, []);
});

// ── slate fail-safes (must stay in step with lib/season-slate.ts) ───────────

test("slateGames: no slate, or a slate matching nothing, → every known game", () => {
  assert.deepEqual(slateGames(ORDER, null), ORDER);
  assert.deepEqual(slateGames(ORDER, []), ORDER);
  assert.deepEqual(slateGames(ORDER, ["Nope", "Also Nope"]), ORDER);
  assert.deepEqual(slateGames(ORDER, ["Circuit", "Rackl"]), ["Rackl", "Circuit"], "lobby order wins");
  assert.deepEqual(slateGames(null, ["Rackl"]), []);
});

test("a misconfigured slate cannot blank a lobby that has puzzles", () => {
  const m = lobbyModel({
    apiOk: true, isProd: true, order: ORDER,
    data: { puzzles: LIVE("Rackl"), slate: ["renamed_runtime_key"], season: SEASON },
  });
  assert.equal(m.mode, "live");
  assert.equal(m.servedCount, 1);
});

// ── date formatting ─────────────────────────────────────────────────────────

test("formatStartsOn reads the calendar date as written — no UTC midnight shift", () => {
  assert.equal(formatStartsOn("2026-11-02"), "November 2, 2026");
  assert.equal(formatStartsOn("2026-01-01"), "January 1, 2026");
  assert.equal(formatStartsOn("2026-12-31"), "December 31, 2026");
  // The regression this pins: new Date("2026-11-02") is UTC midnight, which
  // formats as November 1 in every US timezone.
  assert.notEqual(formatStartsOn("2026-11-02"), "November 1, 2026");
});

test("formatStartsOn refuses anything that is not a calendar date", () => {
  const bads: unknown[] = [null, undefined, "", "tomorrow", "2026-11", "2026-11-02T00:00:00Z", "2026-13-01", 20261102];
  for (const bad of bads) {
    assert.equal(formatStartsOn(bad as string), null, `accepted ${String(bad)}`);
  }
});

test("nextSeasonLine", () => {
  assert.equal(nextSeasonLine({ name: "Hot Summer", starts_on: "2026-06-01" }), "Hot Summer starts June 1, 2026.");
  assert.equal(nextSeasonLine({ name: null, starts_on: "2026-06-01" }), "The next season starts June 1, 2026.");
  assert.equal(nextSeasonLine({ name: "Hot Summer", starts_on: "nope" }), null);
  assert.equal(nextSeasonLine(null), null);
});

// ── it never throws on a malformed payload ──────────────────────────────────

test("a malformed payload degrades to an empty state rather than throwing", () => {
  const bad: unknown[] = [
    undefined,
    null,
    { apiOk: true },
    { apiOk: true, data: null },
    { apiOk: true, data: { puzzles: "nope", slate: "nope", season: "nope", nextSeason: 7 } },
    { apiOk: true, order: "nope", data: { season: { id: "s" }, puzzles: {} } },
  ];
  for (const input of bad) {
    const m = lobbyModel(input as Parameters<typeof lobbyModel>[0]);
    assert.ok(["loading", "error", "no_season", "no_puzzles", "live"].includes(m.mode));
    assert.ok(Array.isArray(m.games));
    assert.equal(typeof m.servedCount, "number");
  }
  assert.deepEqual(servedKeys(null), []);
});
