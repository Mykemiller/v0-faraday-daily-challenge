// Unit tests for League Office member counting.
// Run: npm run test:member-counts
//
// This is the second bug in one day caused by `team_memberships` being
// season-keyed, so the rule is pinned here rather than left to a code review:
// the fixtures below ARE the live prod rows for the three worst teams
// (2026-08-03), and they are the exact numbers the ticket's acceptance table
// demands. If someone reverts to a row count, these fail with the reason beside
// them.

import { test } from "node:test";
import assert from "node:assert/strict";

import { memberCountsPath, tallyMemberCounts, type MembershipRow } from "./member-counts.ts";

const S1 = "season-1";
const S2 = "season-2";
const HOT = "hot-summer";

// Live prod shape, 2026-08-03. Cloud and Platforms held EIGHT rows for THREE
// people: ipadfun and justcoolyo across all three seasons, myke_testid in two.
const row = (team: string, sub: string, season: string, pending = false): MembershipRow & { season_id: string } =>
  ({ team_id: team, subscriber_id: sub, season_id: season, pending });

const CLOUD_AND_PLATFORMS: MembershipRow[] = [
  row("cloud", "ipadfun", S1), row("cloud", "ipadfun", S2), row("cloud", "ipadfun", HOT),
  row("cloud", "justcoolyo", S1), row("cloud", "justcoolyo", S2), row("cloud", "justcoolyo", HOT),
  row("cloud", "myke_testid", S2), row("cloud", "myke_testid", HOT),
];

test("distinct people, not rows — 8 membership rows are 3 members", () => {
  const counts = tallyMemberCounts(CLOUD_AND_PLATFORMS);
  assert.equal(CLOUD_AND_PLATFORMS.length, 8, "fixture is the real 8-row shape");
  assert.equal(counts.members("cloud"), 3);
});

test("season scoping is the caller's job — the tally counts whatever it is given", () => {
  // "All Seasons" — every row.
  assert.equal(tallyMemberCounts(CLOUD_AND_PLATFORMS).members("cloud"), 3);
  // A specific season — the caller filters via memberCountsPath(seasonId).
  const hotOnly = CLOUD_AND_PLATFORMS.filter((r) => (r as { season_id: string }).season_id === HOT);
  assert.equal(tallyMemberCounts(hotOnly).members("cloud"), 3);
  const s1Only = CLOUD_AND_PLATFORMS.filter((r) => (r as { season_id: string }).season_id === S1);
  assert.equal(tallyMemberCounts(s1Only).members("cloud"), 2);
});

test("Team_Sheba: 6 rows → 5 all-seasons members, 1 in the active season", () => {
  // weaponizedautism is the only member in Hot summer, and holds 2 of the 6 rows.
  const rows: MembershipRow[] = [
    row("sheba", "darkhorse", S1), row("sheba", "ipadfun", S1),
    row("sheba", "justcoolyo", S1), row("sheba", "my_work_fun", S1),
    row("sheba", "weaponizedautism", S2), row("sheba", "weaponizedautism", HOT),
  ];
  assert.equal(tallyMemberCounts(rows).members("sheba"), 5);
  const hot = rows.filter((r) => (r as { season_id: string }).season_id === HOT);
  assert.equal(tallyMemberCounts(hot).members("sheba"), 1);
});

test("darkhorse is opted out (dc_subscribers.active = false) and STILL counts", () => {
  // D5 was dropped deliberately: team_leaderboard — the function the console
  // reconciles against — has no `active` filter. Filtering here would make the
  // two surfaces disagree. Team_Sheba is 5, not 4.
  const rows: MembershipRow[] = [row("sheba", "darkhorse", S1), row("sheba", "ipadfun", S1)];
  assert.equal(tallyMemberCounts(rows).members("sheba"), 2);
});

test("pending is a separate bucket, never folded into members", () => {
  const rows: MembershipRow[] = [
    row("t", "a", S1), row("t", "a", S2), // one person, two seasons
    row("t", "b", S1, true), row("t", "b", S2, true), // one pending person, two seasons
  ];
  const counts = tallyMemberCounts(rows);
  assert.equal(counts.members("t"), 1);
  assert.equal(counts.pending("t"), 1);
});

test("a team with no rows reads 0, never undefined/NaN", () => {
  const counts = tallyMemberCounts([]);
  assert.equal(counts.members("nobody"), 0);
  assert.equal(counts.pending("nobody"), 0);
});

test("the query filters left_at and scopes by season — and nothing else", () => {
  const all = memberCountsPath();
  const scoped = memberCountsPath(HOT);

  // subscriber_id must be selected or a DISTINCT count is impossible.
  assert.match(all, /select=team_id,subscriber_id,pending/);
  // D4 — departed members are not members.
  assert.match(all, /left_at=is\.null/);
  // "All Seasons" must NOT filter by season.
  assert.equal(all.includes("season_id"), false);
  assert.match(scoped, /season_id=eq\.hot-summer/);
  // D5 stays dropped — no active filter, matching team_leaderboard.
  assert.equal(all.includes("active"), false);
  assert.equal(scoped.includes("active"), false);
});
