// Unit tests for the Game Library pure logic.
// Run: npm run test:game-library
//
// The transition map and the catalog whitelist are the server-side gates for
// every Tier 2 write on this surface — a gate nobody can exercise is a gate
// nobody can trust, so they are tested directly rather than through the route.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LIFECYCLE_STATES,
  allowedTransitions,
  canTransition,
  checkTransition,
  planAssignment,
  assignmentSummary,
  matrixCell,
  sanitizeCatalogPatch,
  editableFields,
  toGameKey,
  isLifecycleState,
  type LifecycleState,
  type SeasonAssignment,
} from "./game-library-logic.ts";

// ── D1: lifecycle is not assignment ──────────────────────────────────────────

test("D1 — 'assigned to a season' is NOT a lifecycle state", () => {
  assert.deepEqual([...LIFECYCLE_STATES], ["new_idea", "in_test", "live", "retired"]);
  for (const s of LIFECYCLE_STATES) {
    assert.ok(!/assign|season/i.test(s), `${s} leaks assignment into lifecycle`);
  }
});

test("D1 — a game is one lifecycle state AND many season assignments at once", () => {
  // The exact live shape: one 'live' game on 4 seasons. A single-state model
  // could not represent this without losing one of the two facts.
  const rows: SeasonAssignment[] = [1, 2, 3, 4].map((n) => ({
    seasonId: `s${n}`,
    seasonName: `Season ${n}`,
    seasonStatus: n === 2 ? "active" : "upcoming",
    configState: "active",
    enabled: true,
  }));
  const summary = assignmentSummary(rows);
  assert.equal(summary.count, 4);
  assert.equal(summary.label, "4 seasons");
});

test("assignmentSummary counts only ENABLED rows", () => {
  const rows: SeasonAssignment[] = [
    { seasonId: "a", seasonName: "A", seasonStatus: "active", configState: "active", enabled: true },
    { seasonId: "b", seasonName: "B", seasonStatus: "upcoming", configState: "draft", enabled: false },
  ];
  const s = assignmentSummary(rows);
  assert.equal(s.count, 1);
  assert.deepEqual(s.seasons, ["A"]);
});

test("matrixCell distinguishes disabled from not-assigned", () => {
  assert.equal(matrixCell(undefined), "unassigned");
  assert.equal(
    matrixCell({ seasonId: "a", seasonName: "A", seasonStatus: "active", configState: "active", enabled: false }),
    "disabled"
  );
  assert.equal(
    matrixCell({ seasonId: "a", seasonName: "A", seasonStatus: "active", configState: "active", enabled: true }),
    "enabled"
  );
});

// ── the transition map ───────────────────────────────────────────────────────

test("allowed transitions are exactly the specified map", () => {
  assert.deepEqual([...allowedTransitions("new_idea")], ["in_test"]);
  assert.deepEqual([...allowedTransitions("in_test")], ["live", "new_idea"]);
  assert.deepEqual([...allowedTransitions("live")], ["retired"]);
  assert.deepEqual([...allowedTransitions("retired")], ["live"]);
});

test("illegal transitions are rejected — including the tempting new_idea → live", () => {
  assert.equal(canTransition("new_idea", "live"), false);
  assert.equal(canTransition("new_idea", "retired"), false);
  assert.equal(canTransition("live", "in_test"), false);
  assert.equal(canTransition("live", "new_idea"), false);
  assert.equal(canTransition("retired", "in_test"), false);
  assert.equal(canTransition("retired", "new_idea"), false);
  assert.equal(canTransition("in_test", "retired"), false);
});

test("checkTransition requires a reason on EVERY transition", () => {
  const r = checkTransition({ from: "new_idea", to: "in_test", reason: "   " });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.message : "", /reason is required/i);
});

test("checkTransition rejects an illegal move server-side", () => {
  const r = checkTransition({ from: "new_idea", to: "live", reason: "ship it" });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.message : "", /not an allowed transition/i);
});

test("checkTransition rejects garbage states before policy", () => {
  assert.equal(checkTransition({ from: "banana", to: "live", reason: "x" }).ok, false);
  assert.equal(checkTransition({ from: "live", to: "banana", reason: "x" }).ok, false);
});

test("checkTransition refuses a no-op", () => {
  const r = checkTransition({ from: "live", to: "live", reason: "x" });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.message : "", /already Live/i);
});

test("going live REQUIRES a runtime key (D3)", () => {
  const without = checkTransition({ from: "in_test", to: "live", reason: "ready", runtimeKey: null });
  assert.equal(without.ok, false);
  assert.match(without.ok === false ? without.message : "", /runtime key/i);

  const withKey = checkTransition({ from: "in_test", to: "live", reason: "ready", runtimeKey: "Grid Lock" });
  assert.equal(withKey.ok, true);
});

test("retiring an assigned game is refused with instructions, not a constraint error", () => {
  const r = checkTransition({ from: "live", to: "retired", reason: "sunset", assignmentCount: 4 });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.message : "", /Unassign it before retiring/i);

  const clean = checkTransition({ from: "live", to: "retired", reason: "sunset", assignmentCount: 0 });
  assert.equal(clean.ok, true);
});

test("every legal transition passes with a reason and its prerequisites", () => {
  const cases: [LifecycleState, LifecycleState][] = [
    ["new_idea", "in_test"],
    ["in_test", "new_idea"],
    ["in_test", "live"],
    ["live", "retired"],
    ["retired", "live"],
  ];
  for (const [from, to] of cases) {
    const r = checkTransition({ from, to, reason: "because", runtimeKey: "Some Game", assignmentCount: 0 });
    assert.equal(r.ok, true, `${from} → ${to} should be allowed`);
  }
});

// ── D5 season editability ────────────────────────────────────────────────────

test("D5 — draft and scheduled seasons are edited in place", () => {
  for (const configState of ["draft", "scheduled"] as const) {
    const p = planAssignment({ configState, seasonStatus: "upcoming", seasonLocked: false });
    assert.equal(p.kind, "in_place");
  }
});

test("D5 — an ACTIVE season is versioned, never edited in place", () => {
  const p = planAssignment({ configState: "active", seasonStatus: "active", seasonLocked: false });
  assert.equal(p.kind, "clone_and_promote");
  assert.match(p.note ?? "", /new configuration version/i);
});

test("D5 — closed, superseded and cancelled are read-only", () => {
  assert.equal(
    planAssignment({ configState: "active", seasonStatus: "closed", seasonLocked: false }).kind,
    "refused"
  );
  assert.equal(
    planAssignment({ configState: "superseded", seasonStatus: "closed", seasonLocked: false }).kind,
    "refused"
  );
  assert.equal(
    planAssignment({ configState: "cancelled", seasonStatus: "upcoming", seasonLocked: false }).kind,
    "refused"
  );
});

test("D5 — a locked season is refused regardless of config state", () => {
  const p = planAssignment({ configState: "draft", seasonStatus: "upcoming", seasonLocked: true });
  assert.equal(p.kind, "refused");
  assert.match(p.note ?? "", /locked/i);
});

// ── D3/D8 field freezing ─────────────────────────────────────────────────────

test("game_key is NEVER editable, in any lifecycle state", () => {
  for (const s of LIFECYCLE_STATES) {
    assert.ok(!editableFields(s).includes("game_key"), `game_key editable while ${s}`);
    const out = sanitizeCatalogPatch({ game_key: "hacked", display_name: "Fine" }, s);
    assert.equal("game_key" in out, false);
  }
});

test("runtime_key freezes once live, and only once live (D3)", () => {
  assert.ok(editableFields("in_test").includes("runtime_key"));
  assert.ok(editableFields("new_idea").includes("runtime_key"));
  assert.ok(!editableFields("live").includes("runtime_key"));

  assert.equal("runtime_key" in sanitizeCatalogPatch({ runtime_key: "X" }, "live"), false);
  assert.equal(sanitizeCatalogPatch({ runtime_key: "X" }, "in_test").runtime_key, "X");
});

test("lifecycle_state cannot be smuggled through a metadata patch", () => {
  const out = sanitizeCatalogPatch({ lifecycle_state: "live", display_name: "Ok" }, "new_idea");
  assert.equal("lifecycle_state" in out, false);
  assert.equal(out.display_name, "Ok");
});

test("sanitizeCatalogPatch coerces numerics and booleans, and drops junk", () => {
  const out = sanitizeCatalogPatch(
    { default_points: "250", max_hints: 2.9, sort_order: "40", supports_hints: "true", nope: 1 },
    "live"
  );
  assert.equal(out.default_points, 250);
  assert.equal(out.max_hints, 2);
  assert.equal(out.sort_order, 40);
  assert.equal(out.supports_hints, true);
  assert.equal("nope" in out, false);
});

test("a blank display_name never clears the NOT NULL column", () => {
  const out = sanitizeCatalogPatch({ display_name: "   " }, "live");
  assert.equal("display_name" in out, false);
});

test("non-numeric numerics are dropped rather than written as NaN", () => {
  const out = sanitizeCatalogPatch({ default_points: "abc", sort_order: "12" }, "live");
  assert.equal("default_points" in out, false);
  assert.equal(out.sort_order, 12);
});

test("sanitizeCatalogPatch survives junk input shapes", () => {
  for (const junk of [null, undefined, "string", 42, []]) {
    assert.deepEqual(sanitizeCatalogPatch(junk, "live"), {});
  }
});

// ── misc ─────────────────────────────────────────────────────────────────────

test("toGameKey produces the snake_case slug convention already in the catalog", () => {
  assert.equal(toGameKey("Signal Drop"), "signal_drop");
  assert.equal(toGameKey("The Stack"), "the_stack");
  assert.equal(toGameKey("Load Balance"), "load_balance");
  assert.equal(toGameKey("  Grid   Lock!! "), "grid_lock");
  assert.equal(toGameKey(""), "");
});

test("isLifecycleState is a real guard", () => {
  assert.equal(isLifecycleState("live"), true);
  assert.equal(isLifecycleState("Live"), false);
  assert.equal(isLifecycleState(null), false);
  assert.equal(isLifecycleState(7), false);
});
