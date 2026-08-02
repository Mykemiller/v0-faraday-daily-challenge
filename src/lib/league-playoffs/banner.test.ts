// Pure-logic tests for the player-facing playoff banner copy.
//   npm run test:playoffs
//
// The banner is the one playoff surface every player sees whether or not they
// care about the bracket, so its precedence rules are worth pinning: a live
// playoff outranks a freeze notice, and the freeze only speaks when it is
// imminent or already in force.

import test from "node:test";
import assert from "node:assert/strict";

import { bannerLine } from "./banner.ts";

type S = Parameters<typeof bannerLine>[0];

const base: S = {
  phase: "regular",
  playoffs_live: false,
  playoff_starts_on: "2026-08-28",
  days_until_playoffs: 20,
  roster_frozen: false,
  roster_freeze_on: "2026-08-17",
  days_until_roster_freeze: 9,
};

test("live playoffs outrank everything else", () => {
  const line = bannerLine({ ...base, playoffs_live: true, phase: "playoff", roster_frozen: true })!;
  assert.equal(line.headline, "Playoffs are live");
  assert.match(line.detail, /count toward the bracket/);
  assert.equal(line.cta, "See the bracket");
});

test("a distant freeze is not mentioned in the countdown", () => {
  // 9 days out is beyond the 7-day notice window — mentioning it every visit
  // for weeks would be noise.
  const line = bannerLine(base)!;
  assert.equal(line.headline, "Playoffs start in 20 days");
  assert.equal(line.detail, "");
});

test("an imminent freeze rides along with the playoff countdown", () => {
  const line = bannerLine({ ...base, days_until_roster_freeze: 3 })!;
  assert.equal(line.headline, "Playoffs start in 20 days");
  assert.equal(line.detail, "Rosters freeze in 3 days.");
});

test("the freeze notice singularises at one day", () => {
  const line = bannerLine({ ...base, days_until_roster_freeze: 1 })!;
  assert.equal(line.detail, "Rosters freeze in 1 day.");
  const one = bannerLine({ ...base, days_until_playoffs: 1, days_until_roster_freeze: null })!;
  assert.equal(one.headline, "Playoffs start in 1 day");
});

test("freeze day itself (0 days out) still counts as imminent", () => {
  const line = bannerLine({ ...base, days_until_roster_freeze: 0 })!;
  assert.equal(line.detail, "Rosters freeze in 0 days.");
});

test("once frozen, the countdown says so instead of counting down to the freeze", () => {
  const line = bannerLine({ ...base, roster_frozen: true, days_until_roster_freeze: -2 })!;
  assert.equal(line.headline, "Playoffs start in 20 days");
  assert.equal(line.detail, "Rosters are frozen — your teams are locked in.");
});

test("in the gap after the freeze but before playoffs open, the freeze leads", () => {
  // days_until_playoffs is 0 here only in the sense that the countdown has run
  // out but playoffs_live is still false — the freeze is the live fact.
  const line = bannerLine({
    ...base, roster_frozen: true, days_until_playoffs: 0, days_until_roster_freeze: -11,
  })!;
  assert.equal(line.headline, "Rosters are frozen for the playoffs");
  assert.equal(line.cta, "Standings");
});

test("nothing to say → no banner at all", () => {
  // Not frozen, playoffs not live, countdown elapsed: render nothing rather
  // than an empty frame.
  assert.equal(
    bannerLine({ ...base, days_until_playoffs: 0, roster_frozen: false, days_until_roster_freeze: null }),
    null
  );
  assert.equal(
    bannerLine({ ...base, days_until_playoffs: null, roster_frozen: false, days_until_roster_freeze: null }),
    null
  );
});

test("a negative playoff countdown never renders as a countdown", () => {
  // Past the start date but not flagged live (e.g. a closed season) — the
  // countdown branch must not fire with a negative number.
  const line = bannerLine({
    ...base, days_until_playoffs: -3, roster_frozen: false, days_until_roster_freeze: null,
  });
  assert.equal(line, null);
});
