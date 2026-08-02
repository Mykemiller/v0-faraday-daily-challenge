// Pure-logic tests for the playoff phase + roster freeze module.
//   npm run test:playoffs

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TZ,
  addDays,
  daysBetween,
  isRosterFrozen,
  parseScoringPhase,
  phaseWindow,
  playoffStatus,
  rosterFreezeState,
  seasonPhase,
  seasonToday,
  windowContains,
  type SeasonDates,
} from "./phase.ts";

// The real Hot summer Final Beta row (the only season carrying playoff dates).
const HOT_SUMMER: SeasonDates = {
  starts_on: "2026-08-03",
  ends_on: "2026-09-04",
  playoff_starts_on: "2026-08-28",
  roster_freeze_on: "2026-08-17",
  tz: "America/Chicago",
};

// A season with no playoff configuration — every other season in prod today.
const PLAIN: SeasonDates = {
  starts_on: "2026-07-11",
  ends_on: "2026-08-02",
  playoff_starts_on: null,
  roster_freeze_on: null,
  tz: null,
};

// ── date helpers ─────────────────────────────────────────────────────────────

test("addDays crosses month and DST boundaries without slipping a day", () => {
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-09-01", -1), "2026-08-31");
  // US DST ends 2026-11-01; noon-UTC anchoring keeps this exact.
  assert.equal(addDays("2026-10-31", 2), "2026-11-02");
  assert.equal(addDays("2026-03-08", 0), "2026-03-08");
});

test("daysBetween is signed and null-safe", () => {
  assert.equal(daysBetween("2026-08-03", "2026-08-17"), 14);
  assert.equal(daysBetween("2026-08-17", "2026-08-03"), -14);
  assert.equal(daysBetween("2026-08-17", "2026-08-17"), 0);
  assert.equal(daysBetween(null, "2026-08-17"), null);
  assert.equal(daysBetween("2026-08-17", "not-a-date"), null);
});

test("seasonToday formats in the season zone and survives a bad tz", () => {
  // 2026-08-03T02:00Z is still 2026-08-02 in Chicago (UTC-5).
  const at = new Date("2026-08-03T02:00:00Z");
  assert.equal(seasonToday("America/Chicago", at), "2026-08-02");
  assert.equal(seasonToday("UTC", at), "2026-08-03");
  // Unset and junk both fall back to the default zone rather than throwing.
  assert.equal(seasonToday(null, at), seasonToday(DEFAULT_TZ, at));
  assert.equal(seasonToday("Not/AZone", at), seasonToday(DEFAULT_TZ, at));
});

// ── seasonPhase ──────────────────────────────────────────────────────────────

test("seasonPhase walks pre → regular → playoff → post", () => {
  assert.equal(seasonPhase(HOT_SUMMER, "2026-08-02"), "pre");
  assert.equal(seasonPhase(HOT_SUMMER, "2026-08-03"), "regular"); // first day
  assert.equal(seasonPhase(HOT_SUMMER, "2026-08-27"), "regular"); // day before
  assert.equal(seasonPhase(HOT_SUMMER, "2026-08-28"), "playoff"); // playoffs open
  assert.equal(seasonPhase(HOT_SUMMER, "2026-09-04"), "playoff"); // last day
  assert.equal(seasonPhase(HOT_SUMMER, "2026-09-05"), "post");
});

test("a season with no playoff date is regular for its whole run", () => {
  assert.equal(seasonPhase(PLAIN, "2026-07-11"), "regular");
  assert.equal(seasonPhase(PLAIN, "2026-08-02"), "regular");
  assert.equal(seasonPhase(PLAIN, "2026-08-03"), "post");
});

test("seasonPhase treats a season with no dates as pre, never as live", () => {
  const empty: SeasonDates = {
    starts_on: null, ends_on: null, playoff_starts_on: null, roster_freeze_on: null,
  };
  assert.equal(seasonPhase(empty, "2026-08-20"), "pre");
});

// ── phaseWindow ──────────────────────────────────────────────────────────────

test("full window is the whole season — the existing RPC behavior", () => {
  assert.deepEqual(phaseWindow(HOT_SUMMER, "full"), { from: "2026-08-03", to: "2026-09-04" });
  assert.deepEqual(phaseWindow(PLAIN, "full"), { from: "2026-07-11", to: "2026-08-02" });
});

test("regular and playoff windows partition the season exactly, no gap or overlap", () => {
  const reg = phaseWindow(HOT_SUMMER, "regular")!;
  const post = phaseWindow(HOT_SUMMER, "playoff")!;
  assert.deepEqual(reg, { from: "2026-08-03", to: "2026-08-27" });
  assert.deepEqual(post, { from: "2026-08-28", to: "2026-09-04" });
  // Adjacent: the day after regular ends is the day playoffs open.
  assert.equal(addDays(reg.to, 1), post.from);
  // Together they cover the full window exactly.
  const full = phaseWindow(HOT_SUMMER, "full")!;
  assert.equal(reg.from, full.from);
  assert.equal(post.to, full.to);
});

test("no playoff date → regular is the whole season, playoff is null", () => {
  assert.deepEqual(phaseWindow(PLAIN, "regular"), { from: "2026-07-11", to: "2026-08-02" });
  // null means "no rows" — never "fall back to the full season", which would
  // report regular-season points as playoff points.
  assert.equal(phaseWindow(PLAIN, "playoff"), null);
});

test("phaseWindow returns null on unusable dates rather than an inverted range", () => {
  const noDates: SeasonDates = {
    starts_on: null, ends_on: "2026-09-04", playoff_starts_on: null, roster_freeze_on: null,
  };
  assert.equal(phaseWindow(noDates, "full"), null);

  const inverted: SeasonDates = {
    starts_on: "2026-09-04", ends_on: "2026-08-03", playoff_starts_on: null, roster_freeze_on: null,
  };
  assert.equal(phaseWindow(inverted, "full"), null);
});

test("a playoff start on day one leaves no regular season", () => {
  // The seasons_playoff_window CHECK forbids this in the DB (playoff > starts_on),
  // but app callers can pass unsaved wizard input.
  const s: SeasonDates = {
    starts_on: "2026-08-03", ends_on: "2026-09-04",
    playoff_starts_on: "2026-08-03", roster_freeze_on: null,
  };
  assert.equal(phaseWindow(s, "regular"), null);
  assert.deepEqual(phaseWindow(s, "playoff"), { from: "2026-08-03", to: "2026-09-04" });
});

test("a playoff date past the season end yields no playoff window", () => {
  const s: SeasonDates = {
    starts_on: "2026-08-03", ends_on: "2026-09-04",
    playoff_starts_on: "2026-09-20", roster_freeze_on: null,
  };
  assert.equal(phaseWindow(s, "playoff"), null);
  // Regular is clamped to the season end, not extended to the stray date.
  assert.deepEqual(phaseWindow(s, "regular"), { from: "2026-08-03", to: "2026-09-04" });
});

test("windowContains is inclusive at both ends and false for a null window", () => {
  const w = phaseWindow(HOT_SUMMER, "playoff");
  assert.equal(windowContains(w, "2026-08-28"), true);
  assert.equal(windowContains(w, "2026-09-04"), true);
  assert.equal(windowContains(w, "2026-08-27"), false);
  assert.equal(windowContains(w, "2026-09-05"), false);
  assert.equal(windowContains(null, "2026-08-28"), false);
});

// ── roster freeze ────────────────────────────────────────────────────────────

test("the freeze turns on ON the freeze date and stays on", () => {
  assert.equal(isRosterFrozen(HOT_SUMMER, "2026-08-16"), false);
  assert.equal(isRosterFrozen(HOT_SUMMER, "2026-08-17"), true); // the day itself
  assert.equal(isRosterFrozen(HOT_SUMMER, "2026-08-28"), true); // into the playoffs
  assert.equal(isRosterFrozen(HOT_SUMMER, "2026-09-04"), true); // last day
});

test("a season with no freeze date is never frozen", () => {
  assert.equal(isRosterFrozen(PLAIN, "2026-07-30"), false);
  assert.equal(isRosterFrozen(PLAIN, "2026-08-02"), false);
});

test("rosterFreezeState reports the countdown, and 0 on the day", () => {
  assert.deepEqual(rosterFreezeState(HOT_SUMMER, "2026-08-03"), {
    frozen: false, freezeOn: "2026-08-17", daysUntilFreeze: 14,
  });
  assert.deepEqual(rosterFreezeState(HOT_SUMMER, "2026-08-17"), {
    frozen: true, freezeOn: "2026-08-17", daysUntilFreeze: 0,
  });
  assert.deepEqual(rosterFreezeState(HOT_SUMMER, "2026-08-20"), {
    frozen: true, freezeOn: "2026-08-17", daysUntilFreeze: -3,
  });
  assert.deepEqual(rosterFreezeState(PLAIN, "2026-07-30"), {
    frozen: false, freezeOn: null, daysUntilFreeze: null,
  });
});

test("the freeze is independent of the playoff window", () => {
  // Freeze lands 11 days before playoffs open — the gap is real and both states
  // must be readable during it.
  const mid = playoffStatus(HOT_SUMMER, "2026-08-20");
  assert.equal(mid.roster.frozen, true);
  assert.equal(mid.playoffsLive, false);
  assert.equal(mid.phase, "regular");
});

// ── playoffStatus ────────────────────────────────────────────────────────────

test("playoffStatus counts down to the playoff opening", () => {
  const pre = playoffStatus(HOT_SUMMER, "2026-08-21");
  assert.equal(pre.phase, "regular");
  assert.equal(pre.playoffsLive, false);
  assert.equal(pre.daysUntilPlayoffs, 7);
  assert.equal(pre.playoffStartsOn, "2026-08-28");

  const open = playoffStatus(HOT_SUMMER, "2026-08-28");
  assert.equal(open.playoffsLive, true);
  assert.equal(open.daysUntilPlayoffs, 0);

  const during = playoffStatus(HOT_SUMMER, "2026-09-01");
  assert.equal(during.playoffsLive, true);
  assert.equal(during.daysUntilPlayoffs, -4);
});

test("playoffStatus on a season without playoffs is inert", () => {
  const st = playoffStatus(PLAIN, "2026-07-30");
  assert.equal(st.playoffsLive, false);
  assert.equal(st.playoffStartsOn, null);
  assert.equal(st.daysUntilPlayoffs, null);
  assert.equal(st.playoffWindow, null);
  assert.equal(st.roster.frozen, false);
  // Regular-season scoring is untouched — the whole season, as before.
  assert.deepEqual(st.regularWindow, { from: "2026-07-11", to: "2026-08-02" });
});

test("playoffStatus stays coherent after the season ends", () => {
  const st = playoffStatus(HOT_SUMMER, "2026-09-10");
  assert.equal(st.phase, "post");
  assert.equal(st.playoffsLive, false);
  // The windows are still reportable so a closed season's boards still resolve.
  assert.deepEqual(st.playoffWindow, { from: "2026-08-28", to: "2026-09-04" });
});

// ── query parsing ────────────────────────────────────────────────────────────

test("parseScoringPhase defaults to full for anything unrecognised", () => {
  assert.equal(parseScoringPhase("playoff"), "playoff");
  assert.equal(parseScoringPhase("regular"), "regular");
  assert.equal(parseScoringPhase("full"), "full");
  assert.equal(parseScoringPhase(null), "full");
  assert.equal(parseScoringPhase(undefined), "full");
  assert.equal(parseScoringPhase(""), "full");
  assert.equal(parseScoringPhase("Playoff"), "full"); // case-sensitive by design
  assert.equal(parseScoringPhase("'; drop table seasons; --"), "full");
});
