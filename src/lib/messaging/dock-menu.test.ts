// Unit tests for the dock menu-item derivation (CC-DC-MSG-DOCK-1.0). Pure
// logic — no I/O. Covers the D2/D4 matrix: which of the four items
// render/disable given teams, captaincy, and commissioner availability.
//
// Run with:  npm run test:messaging

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type DockTeam,
  deriveCaptainItem,
  deriveMyTeamItem,
  deriveCommissionerItem,
  deriveDockMenu,
  JOIN_A_TEAM_HINT,
} from "./dock-menu.ts";

const CAP_A = { subscriber_id: "0a70bd56-1111-4a76-9c00-000000000001", handle: "cap_a" };
const CAP_B = { subscriber_id: "f2e8cd10-2222-4b81-8d11-000000000002", handle: "cap_b" };

function team(id: string, over: Partial<DockTeam> = {}): DockTeam {
  return { team_id: id, team_name: `Team ${id}`, is_captain: false, captain: CAP_A, ...over };
}

// ── D2: Message my Captain ───────────────────────────────────────────────────

test("captain: no teams → disabled with the locked hint", () => {
  assert.deepEqual(deriveCaptainItem([]), { state: "disabled", hint: JOIN_A_TEAM_HINT });
});

test("captain: one team with a captain → open that captain's DM", () => {
  const t = team("t1");
  assert.deepEqual(deriveCaptainItem([t]), { state: "open", team: t });
});

test("captain: one team, captain_id null → disabled with the hint", () => {
  const t = team("t1", { captain: null });
  assert.deepEqual(deriveCaptainItem([t]), { state: "disabled", hint: JOIN_A_TEAM_HINT });
});

test("captain: viewer captains their only team → hidden (My Team covers it)", () => {
  const t = team("t1", { is_captain: true, captain: null });
  assert.deepEqual(deriveCaptainItem([t]), { state: "hidden" });
});

test("captain: viewer captains every team → hidden", () => {
  const teams = [
    team("t1", { is_captain: true, captain: null }),
    team("t2", { is_captain: true, captain: null }),
  ];
  assert.deepEqual(deriveCaptainItem(teams), { state: "hidden" });
});

test("captain: several eligible teams → picker over the non-captained ones", () => {
  const mine = team("t1", { is_captain: true, captain: null });
  const a = team("t2", { captain: CAP_A });
  const b = team("t3", { captain: CAP_B });
  const item = deriveCaptainItem([mine, a, b]);
  assert.deepEqual(item, { state: "picker", teams: [a, b] });
});

test("captain: two teams, viewer captains one → the other opens directly", () => {
  const mine = team("t1", { is_captain: true, captain: null });
  const other = team("t2", { captain: CAP_B });
  assert.deepEqual(deriveCaptainItem([mine, other]), { state: "open", team: other });
});

test("captain: several teams but no eligible team has a captain → disabled", () => {
  const teams = [team("t1", { captain: null }), team("t2", { captain: null })];
  assert.deepEqual(deriveCaptainItem(teams), { state: "disabled", hint: JOIN_A_TEAM_HINT });
});

test("captain: picker keeps captain-less teams (rendered disabled in the UI)", () => {
  const a = team("t1", { captain: CAP_A });
  const b = team("t2", { captain: null });
  const item = deriveCaptainItem([a, b]);
  assert.equal(item.state, "picker");
  assert.deepEqual(item.state === "picker" ? item.teams : [], [a, b]);
});

// ── D3: My Team ──────────────────────────────────────────────────────────────

test("my team: non-member → item absent (hidden), never disabled", () => {
  assert.deepEqual(deriveMyTeamItem([]), { state: "hidden" });
});

test("my team: one team → open its channel; captaincy is irrelevant", () => {
  const t = team("t1", { is_captain: true, captain: null });
  assert.deepEqual(deriveMyTeamItem([t]), { state: "open", team: t });
});

test("my team: several teams → picker over ALL of them (incl. captained)", () => {
  const a = team("t1", { is_captain: true, captain: null });
  const b = team("t2");
  assert.deepEqual(deriveMyTeamItem([a, b]), { state: "picker", teams: [a, b] });
});

// ── D4: The Commissioner ─────────────────────────────────────────────────────

test("commissioner: no subscriber row → disabled", () => {
  assert.deepEqual(deriveCommissionerItem({ available: false }), { state: "disabled" });
});

test("commissioner: available → open the standard direct thread", () => {
  assert.deepEqual(
    deriveCommissionerItem({ available: true, subscriber_id: CAP_A.subscriber_id, handle: "myke" }),
    { state: "open", recipient: { subscriber_id: CAP_A.subscriber_id, handle: "myke" } }
  );
});

test("commissioner: the viewer IS the commissioner → hidden", () => {
  assert.deepEqual(
    deriveCommissionerItem({
      available: true,
      subscriber_id: CAP_A.subscriber_id,
      handle: "myke",
      is_self: true,
    }),
    { state: "hidden" }
  );
});

test("commissioner: available but malformed (no id) → disabled, never a broken open", () => {
  assert.deepEqual(deriveCommissionerItem({ available: true }), { state: "disabled" });
});

// ── Whole-menu shape ─────────────────────────────────────────────────────────

test("deriveDockMenu: A Player always renders; the rest follow their rules", () => {
  const menu = deriveDockMenu([], { available: false });
  assert.deepEqual(menu.player, { state: "open" });
  assert.equal(menu.captain.state, "disabled");
  assert.equal(menu.myTeam.state, "hidden");
  assert.equal(menu.commissioner.state, "disabled");
});
