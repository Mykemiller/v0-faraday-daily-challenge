// CC-DC-TEAM-CAP-FROM-CONFIG-1.0 — the team-cap rules.
//   npm run test:team-rules
//
// Four things are asserted:
//   1. the PURE half: defaults when there is no config row, the Football
//      shape (cap 3, unlimited size), coercion and junk-rejection;
//   2. the decision functions: the join cap, the grandfathering rule for a
//      player already above a lowered cap, and the team-size check;
//   3. `teamRulesFor` reads `v_season_effective_config` (never `season_config`,
//      which would pick a draft or a superseded version) and fails SOFT to the
//      historical default of 5 on every failure shape;
//   4. the guard: `/api/teams` no longer hardcodes 5 anywhere.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_MAX_TEAMS_PER_PLAYER,
  DEFAULT_TEAM_RULES,
  TEAM_FULL_CODE,
  TEAM_LIMIT_CODE,
  canJoinAnotherTeam,
  isTeamFull,
  isTeamSetAllowed,
  teamFullMessage,
  teamLimitMessage,
  teamRulesFor,
  teamRulesFrom,
} from "./team-rules.ts";

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

test("no config row → the historical default of 5 teams, no size limit", () => {
  assert.deepEqual(teamRulesFrom(null), { maxTeamsPerPlayer: 5, maxTeamSize: null });
  assert.deepEqual(teamRulesFrom(undefined), { maxTeamsPerPlayer: 5, maxTeamSize: null });
  assert.deepEqual(teamRulesFrom({}), { maxTeamsPerPlayer: 5, maxTeamSize: null });
  assert.equal(DEFAULT_MAX_TEAMS_PER_PLAYER, 5);
  assert.deepEqual(DEFAULT_TEAM_RULES, { maxTeamsPerPlayer: 5, maxTeamSize: null });
});

test("null columns fall back individually, not as a pair", () => {
  assert.deepEqual(teamRulesFrom({ max_teams_per_subscriber: null, max_team_size: 8 }), {
    maxTeamsPerPlayer: 5,
    maxTeamSize: 8,
  });
  assert.deepEqual(teamRulesFrom({ max_teams_per_subscriber: 3, max_team_size: null }), {
    maxTeamsPerPlayer: 3,
    maxTeamSize: null,
  });
});

test("the Football Season shape: cap 3, unlimited team size", () => {
  // season_config 3bf84bc8-f202-4a2d-9a89-9dcc38f36711, measured 2026-10-06.
  const rules = teamRulesFrom({ max_teams_per_subscriber: 3, max_team_size: null });
  assert.equal(rules.maxTeamsPerPlayer, 3);
  assert.equal(rules.maxTeamSize, null);
});

test("numeric strings coerce; junk, zero and negatives fall back", () => {
  assert.equal(teamRulesFrom({ max_teams_per_subscriber: "3" }).maxTeamsPerPlayer, 3);
  assert.equal(teamRulesFrom({ max_team_size: "12" }).maxTeamSize, 12);
  assert.equal(teamRulesFrom({ max_teams_per_subscriber: 0 }).maxTeamsPerPlayer, 5);
  assert.equal(teamRulesFrom({ max_teams_per_subscriber: -4 }).maxTeamsPerPlayer, 5);
  assert.equal(teamRulesFrom({ max_teams_per_subscriber: "oops" }).maxTeamsPerPlayer, 5);
  assert.equal(teamRulesFrom({ max_team_size: 0 }).maxTeamSize, null);
  assert.equal(teamRulesFrom({ max_team_size: -1 }).maxTeamSize, null);
  assert.equal(teamRulesFrom({ max_teams_per_subscriber: 2.9 }).maxTeamsPerPlayer, 2);
});

// ── 2. the decisions ─────────────────────────────────────────────────────────

test("the join cap is the config number, not 5", () => {
  const cap3 = teamRulesFrom({ max_teams_per_subscriber: 3 });
  assert.equal(canJoinAnotherTeam(0, cap3), true);
  assert.equal(canJoinAnotherTeam(2, cap3), true);
  assert.equal(canJoinAnotherTeam(3, cap3), false);
  assert.equal(canJoinAnotherTeam(4, cap3), false, "grandfathered players may not grow");

  const cap1 = teamRulesFrom({ max_teams_per_subscriber: 1 });
  assert.equal(canJoinAnotherTeam(0, cap1), true);
  assert.equal(canJoinAnotherTeam(1, cap1), false);
});

test("grandfathering: a player above a lowered cap may keep or shrink, never grow", () => {
  const cap3 = teamRulesFrom({ max_teams_per_subscriber: 3 });
  // Under the cap — ordinary.
  assert.equal(isTeamSetAllowed(0, 0, cap3), true);
  assert.equal(isTeamSetAllowed(3, 2, cap3), true);
  assert.equal(isTeamSetAllowed(4, 3, cap3), false);
  // Already above it (cap was lowered under them).
  assert.equal(isTeamSetAllowed(5, 5, cap3), true, "a no-op save must never 400");
  assert.equal(isTeamSetAllowed(4, 5, cap3), true, "leaving one is always allowed");
  assert.equal(isTeamSetAllowed(3, 5, cap3), true, "dropping to the cap is allowed");
  assert.equal(isTeamSetAllowed(6, 5, cap3), false, "but growing is not");
});

test("team size: null = unlimited, otherwise the distinct confirmed headcount", () => {
  const unlimited = teamRulesFrom({ max_team_size: null });
  assert.equal(isTeamFull(0, unlimited), false);
  assert.equal(isTeamFull(9999, unlimited), false);

  const max8 = teamRulesFrom({ max_team_size: 8 });
  assert.equal(isTeamFull(7, max8), false);
  assert.equal(isTeamFull(8, max8), true);
  assert.equal(isTeamFull(9, max8), true, "already over — still full");
});

test("the copy says the season's number and gets singular/plural right", () => {
  assert.equal(teamLimitMessage(3), "This season allows 3 teams — leave one to join another.");
  assert.equal(teamLimitMessage(1), "This season allows 1 team — leave one to join another.");
  assert.match(teamFullMessage(8), /maximum of 8 players/);
  assert.match(teamFullMessage(1), /maximum of 1 player\b/);
  assert.equal(TEAM_LIMIT_CODE, "team_limit_reached", "the wire code is unchanged");
  assert.equal(TEAM_FULL_CODE, "team_full");
});

// ── 3. the read ──────────────────────────────────────────────────────────────

test("teamRulesFor reads v_season_effective_config, scoped to the season", async () => {
  const urls: string[] = [];
  stubFetch((url) => {
    urls.push(url);
    return Response.json([{ max_teams_per_subscriber: 3, max_team_size: null }]);
  });
  const rules = await teamRulesFor(H, "02701ead-a03e-4489-adb9-24d3c6787eec");
  assert.deepEqual(rules, { maxTeamsPerPlayer: 3, maxTeamSize: null });
  assert.equal(urls.length, 1, "one read, not two");
  assert.match(urls[0], /v_season_effective_config/);
  assert.match(urls[0], /season_id=eq\.02701ead-a03e-4489-adb9-24d3c6787eec/);
  assert.ok(
    !/\/season_config\?/.test(urls[0]),
    "never the raw table — that would pick a draft or superseded version"
  );
});

test("teamRulesFor fails SOFT to the default on every failure shape", async () => {
  const fallback = { maxTeamsPerPlayer: 5, maxTeamSize: null };

  assert.deepEqual(await teamRulesFor(null, "s1"), fallback, "no service key");
  assert.deepEqual(await teamRulesFor(H, null), fallback, "no season");

  stubFetch(() => new Response("nope", { status: 500 }));
  assert.deepEqual(await teamRulesFor(H, "s1"), fallback, "transport 500");

  stubFetch(() => Response.json([]));
  assert.deepEqual(await teamRulesFor(H, "s1"), fallback, "draft-only season — no row");

  stubFetch(() => new Response("not json", { status: 200 }));
  assert.deepEqual(await teamRulesFor(H, "s1"), fallback, "unparseable body");

  stubFetch(() => {
    throw new Error("network down");
  });
  assert.deepEqual(await teamRulesFor(H, "s1"), fallback, "thrown");
});

// ── 4. the guard ─────────────────────────────────────────────────────────────

test("/api/teams no longer hardcodes a 5-team cap", () => {
  const src = readFileSync(new URL("../../app/api/teams/route.ts", import.meta.url), "utf8");
  assert.ok(
    src.includes("@/lib/seasons/team-rules"),
    "the route must resolve its cap from this module"
  );
  for (const banned of [">= 5", "> 5", ".slice(0, 5)", "length >= 5"]) {
    assert.ok(
      !src.includes(banned),
      `/api/teams still contains a hardcoded cap: ${banned}`
    );
  }
});
