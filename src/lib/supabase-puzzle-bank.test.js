// Unit tests for supabase-puzzle-bank.js + the puzzle-bank.js source selector.
// Run: npm run test:puzzle-bank
// (node --experimental-default-type=module --test, same harness as signal-drop)
//
// fetch is stubbed — no network. The Signal Drop assertions here are the
// acceptance criterion for CC-DC-SUPABASE-SERVING: the answer word must be
// absent from anything getLivePuzzles returns, and answer_key must never be
// selected from the staging table.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.SUPABASE_URL = "https://example.supabase.co";

const bank = await import("./supabase-puzzle-bank.js");
const facade = await import("./puzzle-bank.js");

const realFetch = globalThis.fetch;
let calls;

// CC-DC-GAME-REGISTRY-1.0: the bank now reads its roster from game_catalog, so
// the stub answers that request too. The roster is DERIVED from the fixture
// rows below (minus the deliberately-unknown type) rather than being a second
// hardcoded list that could drift from them.
function stubFetch(handler) {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes("/game_catalog")) {
      return jsonResponse(
        ROSTER_TYPES.map((t, i) => ({
          runtime_key: t,
          display_name: t,
          lobby_sort_order: (i + 1) * 10,
        }))
      );
    }
    return handler(u, init);
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const LIVE_ROWS = [
  {
    puzzle_type: "Rackl",
    public_id: "RACK-26-07-29-00365",
    puzzle_content: { name: "Grid Terms", groups: [{ label: "A", items: ["x", "y"] }] },
  },
  {
    puzzle_type: "Signal Drop",
    public_id: "SGNL-26-07-29-00366",
    puzzle_content: {
      name: "BUSBAR",
      word: "BUSBAR",
      clue: "Copper distribution spine",
      hint1: "h1",
      hint2: "h2",
    },
  },
  // Second Rackl row — must NOT clobber the first (first valid per type wins).
  {
    puzzle_type: "Rackl",
    public_id: "RACK-26-07-28-00300",
    puzzle_content: { name: "Old Rackl" },
  },
  // Unknown type — ignored.
  { puzzle_type: "Mystery", public_id: null, puzzle_content: { name: "?" } },
  // Empty content — ignored.
  { puzzle_type: "Circuit", public_id: "CIRC-26-07-29-00367", puzzle_content: null },
];

// Every fixture type except the deliberately-unknown "Mystery", which must stay
// filtered out because it is absent from the catalog.
const ROSTER_TYPES = [...new Set(LIVE_ROWS.map((r) => r.puzzle_type))].filter((t) => t !== "Mystery");

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.DC_PUZZLE_SOURCE;
});

test("getLivePuzzles keys by type, first valid wins, carries __publicId", async () => {
  stubFetch(() => jsonResponse(LIVE_ROWS));
  const puzzles = await bank.getLivePuzzles();

  assert.deepEqual(Object.keys(puzzles).sort(), ["Rackl", "Signal Drop"]);
  assert.equal(puzzles.Rackl.__publicId, "RACK-26-07-29-00365");
  assert.equal(puzzles.Rackl.name, "Grid Terms"); // jsonb used as-is, not re-parsed
  assert.deepEqual(puzzles.Rackl.groups, [{ label: "A", items: ["x", "y"] }]);
});

test("getLivePuzzles filters published=Live and never selects answer_key", async () => {
  stubFetch(() => jsonResponse(LIVE_ROWS));
  await bank.getLivePuzzles();

  // Two requests now: the puzzle rows and the game_catalog roster. Assert on the
  // staging call specifically rather than on a bare call count.
  const staging = calls.filter((c) => c.url.includes("dc_puzzle_bank_staging"));
  assert.equal(staging.length, 1);
  const url = staging[0].url;
  assert.match(url, /published=eq\.Live/);
  assert.ok(!url.includes("answer_key"), "answer_key must never be selected on the serve path");
});

test("ACCEPTANCE: Signal Drop answer is absent from the payload", async () => {
  stubFetch(() => jsonResponse(LIVE_ROWS));
  const puzzles = await bank.getLivePuzzles();
  const signal = puzzles["Signal Drop"];

  // Every answer-bearing field is stripped (word + its mirrors).
  for (const field of ["word", "name", "answer", "solution"]) {
    assert.ok(!(field in signal), `Signal Drop payload must not carry "${field}"`);
  }
  // Nowhere in the serialized payload either.
  assert.ok(!JSON.stringify(puzzles).includes("BUSBAR"), "answer word leaked into payload");
  // The client-safe derived fields are present.
  assert.equal(signal.wordLength, 6);
  assert.ok(Array.isArray(signal.hints) && signal.hints.length > 0);
  assert.equal(signal.clue, "Copper distribution spine"); // non-answer fields pass through
  assert.equal(signal.__publicId, "SGNL-26-07-29-00366");
});

test("getSignalDropAnswer: exact public_id match wins, else first live", async () => {
  const rows = [
    { puzzle_type: "Signal Drop", public_id: "SGNL-1", puzzle_content: { word: "alpha" } },
    { puzzle_type: "Signal Drop", public_id: "SGNL-2", puzzle_content: { word: "bravo" } },
  ];
  stubFetch(() => jsonResponse(rows));

  const exact = await bank.getSignalDropAnswer({ publicId: "SGNL-2" });
  assert.deepEqual(exact, { word: "BRAVO", publicId: "SGNL-2", wordLength: 5 });

  const first = await bank.getSignalDropAnswer();
  assert.deepEqual(first, { word: "ALPHA", publicId: "SGNL-1", wordLength: 5 });

  const unknown = await bank.getSignalDropAnswer({ publicId: "SGNL-999" });
  assert.deepEqual(unknown, { word: "ALPHA", publicId: "SGNL-1", wordLength: 5 });
});

test("getSignalDropAnswer returns null when no live Signal Drop exists", async () => {
  stubFetch(() => jsonResponse([{ puzzle_type: "Rackl", public_id: null, puzzle_content: {} }]));
  assert.equal(await bank.getSignalDropAnswer(), null);
});

test("getTipOfTheDay stays a null seam", async () => {
  assert.equal(await bank.getTipOfTheDay(), null);
});

test("rotateLiveSet maps the RPC result to the Airtable-shaped summary", async () => {
  stubFetch((url, init) => {
    assert.match(url, /rpc\/fn_dc_rotate_live_set/);
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), { p_today: "2026-07-29" });
    return jsonResponse({
      promoted: 7,
      retired: 7,
      promoted_ids: ["a", "b"],
      retired_ids: ["c"],
      live_types: ["Rackl"],
      missing_types: ["Circuit"],
    });
  });

  const summary = await bank.rotateLiveSet("2026-07-29");
  assert.deepEqual(summary, {
    promoted: 7,
    retired: 7,
    promotedIds: ["a", "b"],
    retiredIds: ["c"],
    liveTypes: ["Rackl"],
    missingTypes: ["Circuit"],
  });
});

test("rotateLiveSet failure throws a RotationError with structured fields", async () => {
  stubFetch(() => jsonResponse({ message: "boom" }, 500));
  await assert.rejects(
    () => bank.rotateLiveSet("2026-07-29"),
    (err) => {
      assert.equal(err.name, "RotationError");
      assert.equal(err.step, "rotate");
      assert.deepEqual(err.recordIds, []);
      assert.match(err.message, /500/);
      return true;
    }
  );
});

test("DC_PUZZLE_SOURCE selector: defaults to airtable, flips to supabase", () => {
  delete process.env.DC_PUZZLE_SOURCE;
  assert.equal(facade.puzzleSource(), "airtable");

  process.env.DC_PUZZLE_SOURCE = "supabase";
  assert.equal(facade.puzzleSource(), "supabase");

  process.env.DC_PUZZLE_SOURCE = " SUPABASE ";
  assert.equal(facade.puzzleSource(), "supabase");

  // Anything else fails safe to airtable.
  for (const v of ["", "airtable", "supabse", "1", "true"]) {
    process.env.DC_PUZZLE_SOURCE = v;
    assert.equal(facade.puzzleSource(), "airtable", `"${v}" must fail safe to airtable`);
  }
});

test("facade routes getLivePuzzles to the supabase impl when flagged", async () => {
  process.env.DC_PUZZLE_SOURCE = "supabase";
  stubFetch(() => jsonResponse(LIVE_ROWS));
  const puzzles = await facade.getLivePuzzles();
  const staging = calls.filter((c) => c.url.includes("dc_puzzle_bank_staging"));
  assert.equal(staging.length, 1); // hit Supabase, not Airtable
  assert.ok(!calls.some((c) => c.url.includes("airtable.com")));
  assert.equal(puzzles.Rackl.__publicId, "RACK-26-07-29-00365");
});
