// CC-DC-HINTS-FROM-CONFIG-1.0 — the hint rules.
//   npm run test:hint-rules
//
// Four things are asserted:
//   1. the PURE half (`hintRules`): the default when there is no config row,
//      Football's live shape (4 ⇒ 3, because the bank stores 3), 0 ⇒ 0, a
//      disabled season, and coercion/junk-rejection;
//   2. the decision function `canRevealHint`;
//   3. `hintRulesFor` reads `v_season_effective_config` (never `season_config`,
//      which would pick a draft or a superseded version) and fails SOFT to
//      "hints on, 3" on every failure shape;
//   4. the guards: `/api/challenge/today` serves the two fields additively on
//      the existing `rules` object, and both hint surfaces read a budget
//      rather than the old hard 3 — WITHOUT changing the localStorage day key
//      (FAR-198, and `claude/lo-config-enforcement` owns that line).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BANK_HINT_SLOTS,
  DEFAULT_HINT_RULES,
  HINTS_OFF_MESSAGE,
  canRevealHint,
  hintRules,
  hintRulesFor,
} from "./hint-rules.ts";

const H = { apikey: "k", Authorization: "Bearer k" };
const realFetch = globalThis.fetch;

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: string | URL | Request) =>
    handler(String(url))) as typeof fetch;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── 1. the pure half ─────────────────────────────────────────────────────────

test("the bank stores three hint tiers and that is the ceiling", () => {
  assert.equal(BANK_HINT_SLOTS, 3);
  assert.deepEqual(DEFAULT_HINT_RULES, { hintsEnabled: true, maxHints: 3 });
});

test("no config row reads as the historical default — hints on, three of them", () => {
  assert.deepEqual(hintRules(null), { hintsEnabled: true, maxHints: 3 });
  assert.deepEqual(hintRules(undefined), { hintsEnabled: true, maxHints: 3 });
  assert.deepEqual(hintRules({}), { hintsEnabled: true, maxHints: 3 });
  // v_season_effective_config LEFT JOINs, so a season with nothing in force
  // comes back as a row of nulls rather than as no row at all.
  assert.deepEqual(
    hintRules({ hints_enabled: null, max_hints_per_game: null }),
    { hintsEnabled: true, maxHints: 3 }
  );
});

test("a season asking for more hints than the bank holds gets the bank's three", () => {
  // Football, season_config 3bf84bc8-f202-4a2d-9a89-9dcc38f36711, SELECTed
  // from ycadmmngkdhvpcsrcuaq at 2026-10-06: hints on, max_hints_per_game 4.
  assert.deepEqual(
    hintRules({ hints_enabled: true, max_hints_per_game: 4 }),
    { hintsEnabled: true, maxHints: 3 },
    "there is no fourth hint in the bank to serve"
  );
  assert.equal(hintRules({ max_hints_per_game: 99 }).maxHints, 3);
});

test("a smaller budget is honoured exactly, including zero", () => {
  assert.equal(hintRules({ max_hints_per_game: 3 }).maxHints, 3);
  assert.equal(hintRules({ max_hints_per_game: 2 }).maxHints, 2);
  assert.equal(hintRules({ max_hints_per_game: 1 }).maxHints, 1);
  assert.deepEqual(
    hintRules({ hints_enabled: true, max_hints_per_game: 0 }),
    { hintsEnabled: true, maxHints: 0 },
    "0 is a real setting — no hints, but not the same thing as hints_enabled false"
  );
});

test("hints_enabled false switches hints off, and only an explicit false does", () => {
  assert.deepEqual(
    hintRules({ hints_enabled: false, max_hints_per_game: 3 }),
    { hintsEnabled: false, maxHints: 3 },
    "the budget survives the switch — turning hints back on restores the number"
  );
  assert.equal(hintRules({ hints_enabled: null }).hintsEnabled, true);
  assert.equal(hintRules({}).hintsEnabled, true);
});

test("coercion and junk", () => {
  // PostgREST can hand an integer back as a string on some paths.
  assert.equal(hintRules({ max_hints_per_game: "2" }).maxHints, 2);
  assert.equal(hintRules({ max_hints_per_game: "4" }).maxHints, 3);
  assert.equal(hintRules({ max_hints_per_game: 2.9 }).maxHints, 2, "floored");
  // Not a number, or a negative typo → unset, not "nobody gets hints".
  assert.equal(hintRules({ max_hints_per_game: "nope" }).maxHints, 3);
  assert.equal(hintRules({ max_hints_per_game: -1 }).maxHints, 3);
  assert.equal(hintRules({ max_hints_per_game: NaN }).maxHints, 3);
});

// ── 2. the decision ──────────────────────────────────────────────────────────

test("canRevealHint spends the budget and stops at it", () => {
  const three = { hintsEnabled: true, maxHints: 3 };
  assert.equal(canRevealHint(0, three), true);
  assert.equal(canRevealHint(2, three), true);
  assert.equal(canRevealHint(3, three), false);
  assert.equal(canRevealHint(9, three), false, "a stale localStorage count cannot overdraw");

  const one = { hintsEnabled: true, maxHints: 1 };
  assert.equal(canRevealHint(0, one), true);
  assert.equal(canRevealHint(1, one), false);

  assert.equal(canRevealHint(0, { hintsEnabled: true, maxHints: 0 }), false);
  assert.equal(canRevealHint(0, { hintsEnabled: false, maxHints: 3 }), false, "off is off");

  assert.equal(HINTS_OFF_MESSAGE, "Hints are off this season.");
});

// ── 3. the read ──────────────────────────────────────────────────────────────

test("hintRulesFor reads v_season_effective_config, scoped to the season", async () => {
  const urls: string[] = [];
  stubFetch((url) => {
    urls.push(url);
    return Response.json([{ hints_enabled: true, max_hints_per_game: 4 }]);
  });
  const rules = await hintRulesFor(H, "02701ead-a03e-4489-adb9-24d3c6787eec");
  assert.deepEqual(rules, { hintsEnabled: true, maxHints: 3 });
  assert.equal(urls.length, 1, "one read, not two");
  assert.match(urls[0], /v_season_effective_config/);
  assert.match(urls[0], /season_id=eq\.02701ead-a03e-4489-adb9-24d3c6787eec/);
  assert.ok(
    !/\/season_config\?/.test(urls[0]),
    "never the raw table — that would pick a draft or superseded version"
  );
  assert.ok(
    !/hint_penalty_pct/.test(urls[0]),
    "the penalty belongs to season-rules-server.ts, not here"
  );
});

test("hintRulesFor fails SOFT to hints-on-three on every failure shape", async () => {
  const fallback = { hintsEnabled: true, maxHints: 3 };

  assert.deepEqual(await hintRulesFor(null, "s1"), fallback, "no service key");
  assert.deepEqual(await hintRulesFor(H, null), fallback, "no season");

  stubFetch(() => new Response("nope", { status: 500 }));
  assert.deepEqual(await hintRulesFor(H, "s1"), fallback, "transport 500");

  stubFetch(() => Response.json([]));
  assert.deepEqual(await hintRulesFor(H, "s1"), fallback, "no effective config — no row");

  stubFetch(() => new Response("not json", { status: 200 }));
  assert.deepEqual(await hintRulesFor(H, "s1"), fallback, "unparseable body");

  stubFetch(() => {
    throw new Error("network down");
  });
  assert.deepEqual(await hintRulesFor(H, "s1"), fallback, "thrown");
});

test("a season that switched hints off comes back off", async () => {
  stubFetch(() => Response.json([{ hints_enabled: false, max_hints_per_game: 3 }]));
  assert.deepEqual(await hintRulesFor(H, "s1"), { hintsEnabled: false, maxHints: 3 });
});

// ── 4. the guards ────────────────────────────────────────────────────────────

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("/api/challenge/today adds the fields to the EXISTING rules object", () => {
  const src = read("../../app/api/challenge/today/route.js");
  assert.ok(src.includes("@/lib/seasons/hint-rules"), "resolved through this module");
  assert.match(
    src,
    /rules:\s*\{\s*scoring,\s*hintsEnabled:[^}]*maxHints:/,
    "additive — `scoring` (CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 D7) stays where it was"
  );
  // The empty-set fallback must carry them too, or a 500 would read as
  // "hints off" on a client that trusts the payload.
  assert.match(src, /rules:\s*\{\s*scoring:\s*\{\s*streakBonus:\s*true\s*\},\s*hintsEnabled:\s*true,\s*maxHints:\s*3\s*\}/);
});

test("both hint surfaces spend a season budget, not a hard 3", () => {
  const dc = read("../../components/DailyChallenge.jsx");
  assert.ok(dc.includes("HintRulesContext"), "the budget reaches all 7 games by context");
  assert.ok(
    dc.includes("Math.max(0, budget - usedTotal)"),
    "HintControl's remaining must come from the season budget"
  );
  assert.ok(dc.includes("Hints are off this season."), "the off-state copy");

  const page = read("../../app/challenge/hints/page.tsx");
  assert.ok(page.includes("Math.max(0, budget - used)"), "Hints Today spends the same budget");
  assert.ok(page.includes("Hints are off this season."), "the off-state copy");
});

test("the localStorage day key shape is untouched (FAR-198)", () => {
  // The DAY portion of this key is owned by claude/lo-config-enforcement,
  // which is moving it from UTC to the CT serve day. This pack changes the
  // BUDGET and the ENABLED flag only; the key shape must survive both.
  for (const rel of ["../../components/DailyChallenge.jsx", "../../app/challenge/hints/page.tsx"]) {
    const src = read(rel);
    assert.ok(
      src.includes("`faraday_hints_${TODAY}_${gameType}`"),
      `${rel} must keep the shared hint budget key`
    );
  }
});
