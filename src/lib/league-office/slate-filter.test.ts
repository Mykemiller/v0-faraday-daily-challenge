// CC-LO-SLATE-FILTER-1.0 — pure-logic tests. `npm run test:slate-filter`.
//
// The DB half of this fix (season_config_save_bundle: assignable filter,
// atomicity, trigger passthrough) is exercised by the live BEGIN…ROLLBACK
// harness in docs/lo-slate-filter/. What is testable without a database is the
// error MAPPING — the layer that turned a lifecycle refusal into a bogus
// "changed in another session" message — and the scope-row builder.

import test from "node:test";
import assert from "node:assert/strict";

import { configSaveMessage, buildScopeRows, scopeFromRows } from "./season-config-logic.ts";
import { ASSIGNABLE_LIFECYCLE_STATES, isAssignableGame } from "./game-library-logic.ts";

const CATALOG = [
  { id: "11111111-1111-1111-1111-111111111111", display_name: "Rackl" },
  { id: "549aeb4c-a832-4362-bef8-5f6f0bed4a17", display_name: "Grid Lock" },
];

// ── the assignable set ───────────────────────────────────────────────────────

test("assignable states are exactly what the DB trigger enforces", () => {
  assert.deepEqual([...ASSIGNABLE_LIFECYCLE_STATES], ["live", "in_test"]);
});

test("is_active / is_beta are NOT the assignability test", () => {
  // Every catalog row is is_active, including the 11 new_idea concepts. Matching
  // on it is the bug this ticket exists to fix.
  assert.equal(isAssignableGame({ lifecycle_state: "live" }), true);
  assert.equal(isAssignableGame({ lifecycle_state: "in_test" }), true);
  assert.equal(isAssignableGame({ lifecycle_state: "new_idea" }), false);
  assert.equal(isAssignableGame({ lifecycle_state: "retired" }), false);
  assert.equal(isAssignableGame({ lifecycle_state: null }), false);
  assert.equal(isAssignableGame({}), false);
});

// ── error mapping (FIX 2) ────────────────────────────────────────────────────

test("23514 surfaces the trigger's own message, with the game NAMED", () => {
  const raw =
    "Game 549aeb4c-a832-4362-bef8-5f6f0bed4a17 cannot be assigned to a season " +
    "while its lifecycle state is new_idea. Only live or in_test games may be scheduled.";
  const out = configSaveMessage("23514", raw, CATALOG);

  assert.equal(out.status, 409);
  assert.match(out.message, /Grid Lock/);
  assert.match(out.message, /lifecycle state is new_idea/);
  assert.match(out.message, /Only live or in_test games may be scheduled/);
  // The uuid is replaced, not merely appended to.
  assert.doesNotMatch(out.message, /549aeb4c/);
  // And it is NOT the concurrency message.
  assert.doesNotMatch(out.message, /another session/i);
});

test("an unknown uuid is left alone rather than mislabelled", () => {
  const raw = "Game 00000000-0000-0000-0000-000000000000 cannot be assigned … lifecycle state is retired.";
  const out = configSaveMessage("23514", raw, CATALOG);
  assert.match(out.message, /00000000-0000-0000-0000-000000000000/);
});

test("55P03 is the locked-season message, not a save failure", () => {
  const out = configSaveMessage(
    "55P03",
    "season config abc belongs to a locked season — slate/mix edits are frozen",
    CATALOG
  );
  assert.equal(out.status, 423);
  assert.equal(out.message, "This season is locked; configuration is frozen.");
});

test("55P03 is recognized from the message when the SQLSTATE is missing", () => {
  const out = configSaveMessage(null, "season 7 is locked — configuration is frozen", CATALOG);
  assert.equal(out.status, 423);
});

test("a read-only version reports as such", () => {
  const out = configSaveMessage("42501", "This version is active, which is read-only. Clone it to a new draft first.", CATALOG);
  assert.equal(out.status, 409);
  assert.match(out.message, /read-only/);
});

test("a missing config is a 404", () => {
  assert.equal(configSaveMessage("P0002", "Season config x not found.", CATALOG).status, 404);
});

test("an unrecognized failure passes the raw message through — never invents a conflict", () => {
  const out = configSaveMessage("23505", "duplicate key value violates unique constraint", CATALOG);
  assert.equal(out.status, 400);
  assert.match(out.message, /duplicate key/);
  assert.match(out.message, /nothing was written/);
  assert.doesNotMatch(out.message, /another session/i);
});

test("NO mapping produces the concurrency message — it is reachable only from the fingerprint check", () => {
  const codes = ["23514", "23503", "55P03", "42501", "P0002", "23505", null, "XX000"];
  for (const c of codes)
    assert.doesNotMatch(
      configSaveMessage(c, "something went wrong", CATALOG).message,
      /changed in another session/i,
      `code ${c} leaked the concurrency message`
    );
});

// ── scope rows (extracted so they can ride the save's transaction) ───────────

test("platform scope is one row with a null ref", () => {
  assert.deepEqual(buildScopeRows({ mode: "platform" }), [
    { scope_type: "platform", scope_ref_id: null, is_excluded: false },
  ]);
});

test("league scope dedupes and keeps exclusions last", () => {
  const rows = buildScopeRows({
    mode: "leagues",
    refIds: ["a", "a", "b"],
    excludes: [{ type: "league", id: "c" }],
  });
  assert.deepEqual(rows, [
    { scope_type: "league", scope_ref_id: "a", is_excluded: false },
    { scope_type: "league", scope_ref_id: "b", is_excluded: false },
    { scope_type: "league", scope_ref_id: "c", is_excluded: true },
  ]);
});

test("an empty inclusion set falls back to platform, never to nothing", () => {
  const rows = buildScopeRows({ mode: "leagues", refIds: [] });
  assert.deepEqual(rows, [{ scope_type: "platform", scope_ref_id: null, is_excluded: false }]);
});

test("scope rows carry no season_id — the caller stamps it", () => {
  for (const r of buildScopeRows({
    mode: "conferences",
    refIds: ["x"],
    excludes: [{ type: "conference", id: "y" }],
  }))
    assert.equal("season_id" in r, false);
});

// CC-LO-SEASON-SCOPE-1.0 — an exclusion carries its own type.
//
// The regression this pins: excludeIds used to be bare ids whose scope_type was
// inferred from the INCLUDE mode, so picking three teams to exclude while the
// mode was "leagues" wrote three `league` rows pointing at team ids. That is
// exactly the shape recorded in the season.create audit row for
// `Hot summer Final Beta`.
test("exclusions keep their own type, independent of the include mode", () => {
  const rows = buildScopeRows({
    mode: "leagues",
    refIds: ["league-1"],
    excludes: [
      { type: "team", id: "team-1" },
      { type: "conference", id: "conf-1" },
      { type: "league", id: "league-2" },
    ],
  });
  assert.deepEqual(rows, [
    { scope_type: "league", scope_ref_id: "league-1", is_excluded: false },
    { scope_type: "team", scope_ref_id: "team-1", is_excluded: true },
    { scope_type: "conference", scope_ref_id: "conf-1", is_excluded: true },
    { scope_type: "league", scope_ref_id: "league-2", is_excluded: true },
  ]);
});

test("a platform scope may carry exclusions — that is 'everyone except X'", () => {
  const rows = buildScopeRows({
    mode: "platform",
    excludes: [{ type: "team", id: "team-1" }],
  });
  assert.deepEqual(rows, [
    { scope_type: "platform", scope_ref_id: null, is_excluded: false },
    { scope_type: "team", scope_ref_id: "team-1", is_excluded: true },
  ]);
});

test("exclusions dedupe on (type, id), not on id alone", () => {
  const rows = buildScopeRows({
    mode: "platform",
    excludes: [
      { type: "team", id: "dup" },
      { type: "team", id: "dup" },
      { type: "league", id: "dup" },
    ],
  });
  assert.equal(rows.filter((r) => r.is_excluded).length, 2);
});

test("scopeFromRows round-trips a typed exclusion set", () => {
  const original = {
    mode: "conferences" as const,
    refIds: ["conf-1"],
    excludes: [{ type: "team" as const, id: "team-1" }],
  };
  const rows = buildScopeRows(original).map((r, i) => ({
    id: String(i),
    season_id: "s",
    scope_type: r.scope_type as string,
    scope_ref_id: r.scope_ref_id as string | null,
    is_excluded: r.is_excluded as boolean,
  }));
  assert.deepEqual(scopeFromRows(rows), original);
});
