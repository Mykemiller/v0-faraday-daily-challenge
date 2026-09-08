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
  canMoveRoster,
  moveWindows,
  rosterMoveState,
  seasonGatesMoves,
  lateJoinDeadline,
  MOVE_WINDOW_CLOSED_CODE,
  type SeasonDates,
  type SeasonRules,
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

// ── roster move windows (CC-LO-FA-WINDOWS-1.0) ───────────────────────────────

/** A gated season: Oct 1 – Dec 31, windows Oct 1–8 and Dec 24–31, FA from
 *  Dec 28 (= ends_on − 3). */
const gated: SeasonDates = {
  starts_on: "2026-10-01",
  ends_on: "2026-12-31",
  playoff_starts_on: null,
  roster_freeze_on: null,
  tz: "America/Chicago",
  trading_open_starts_on: "2026-10-01",
  trading_open_ends_on: "2026-10-08",
  trading_close_starts_on: "2026-12-24",
  trading_close_ends_on: "2026-12-31",
  free_agency_start: "2026-12-28",
};

/** Every season that existed before 2026-09-07 looks like this. */
const ungated: SeasonDates = {
  starts_on: "2026-09-07",
  ends_on: "2026-09-25",
  playoff_starts_on: null,
  roster_freeze_on: null,
  tz: "America/Chicago",
};

test("a season with no stored windows is never gated (fail open)", () => {
  assert.equal(seasonGatesMoves(ungated), false);
  assert.equal(seasonGatesMoves(null), false);
  const st = rosterMoveState(ungated, "2026-09-15");
  assert.equal(st.gated, false);
  assert.equal(st.open, true, "an ungated season is always open");
  // and a mid-season move on the live season is allowed
  assert.equal(canMoveRoster(ungated, "2026-09-15").allowed, true);
});

test("moveWindows returns the three open periods in order", () => {
  const w = moveWindows(gated);
  assert.deepEqual(w, [
    { from: "2026-10-01", to: "2026-10-08" },
    { from: "2026-12-24", to: "2026-12-31" },
    { from: "2026-12-28", to: "2026-12-31" },
  ]);
});

test("a gated season blocks moves between its windows", () => {
  // inside the opening window
  assert.equal(canMoveRoster(gated, "2026-10-05").allowed, true);
  // dead centre of the season — closed
  const mid = canMoveRoster(gated, "2026-11-15");
  assert.equal(mid.allowed, false);
  assert.equal(mid.reason, "window_closed");
  // inside the closing window
  assert.equal(canMoveRoster(gated, "2026-12-26").allowed, true);
  // inside free agency
  assert.equal(canMoveRoster(gated, "2026-12-29").allowed, true);
});

test("window edges are inclusive on both ends", () => {
  assert.equal(canMoveRoster(gated, "2026-10-01").allowed, true, "first day open");
  assert.equal(canMoveRoster(gated, "2026-10-08").allowed, true, "last day open");
  assert.equal(canMoveRoster(gated, "2026-10-09").allowed, false, "day after is closed");
  assert.equal(canMoveRoster(gated, "2026-12-23").allowed, false, "day before close window");
  assert.equal(canMoveRoster(gated, "2026-12-24").allowed, true);
});

test("a FIRST join is allowed even when every window is shut", () => {
  const closed = canMoveRoster(gated, "2026-11-15");
  assert.equal(closed.allowed, false);
  const firstJoin = canMoveRoster(gated, "2026-11-15", { isFirstJoin: true });
  assert.equal(firstJoin.allowed, true, "onboarding is never blocked");
});

test("the playoff freeze overrides everything, free agency included", () => {
  const frozen: SeasonDates = { ...gated, roster_freeze_on: "2026-12-01" };
  // inside the closing window, but frozen
  const inWindow = canMoveRoster(frozen, "2026-12-26");
  assert.equal(inWindow.allowed, false);
  assert.equal(inWindow.reason, "frozen");
  // inside free agency, still frozen
  assert.equal(canMoveRoster(frozen, "2026-12-29").reason, "frozen");
  // and a first join cannot thaw it either
  assert.equal(canMoveRoster(frozen, "2026-12-29", { isFirstJoin: true }).allowed, false);
});

test("state reports the current and next window for player-facing copy", () => {
  const closed = rosterMoveState(gated, "2026-11-15");
  assert.equal(closed.currentWindow, null);
  assert.deepEqual(closed.nextWindow, { from: "2026-12-24", to: "2026-12-31" });

  const open = rosterMoveState(gated, "2026-10-03");
  assert.deepEqual(open.currentWindow, { from: "2026-10-01", to: "2026-10-08" });

  // past the last window there is no next one to advertise
  const late = rosterMoveState(gated, "2026-12-30");
  assert.equal(late.nextWindow, null);
});

test("only one window configured still gates (the other is simply absent)", () => {
  const openOnly: SeasonDates = {
    ...gated, trading_close_starts_on: null, trading_close_ends_on: null,
  };
  assert.equal(seasonGatesMoves(openOnly), true);
  assert.equal(canMoveRoster(openOnly, "2026-10-05").allowed, true);
  assert.equal(canMoveRoster(openOnly, "2026-11-15").allowed, false);
  // free agency still applies as the third period
  assert.equal(canMoveRoster(openOnly, "2026-12-29").allowed, true);
});

test("the closed code is distinct from the frozen code", () => {
  assert.equal(MOVE_WINDOW_CLOSED_CODE, "trading_window_closed");
  assert.notEqual(MOVE_WINDOW_CLOSED_CODE, "roster_frozen");
});

test("a move before the season opens is closed, not crashed", () => {
  assert.equal(canMoveRoster(gated, "2026-09-01").allowed, false);
  assert.equal(canMoveRoster(gated, "2026-09-01").reason, "window_closed");
});

// ── League Office config flags (CC-LO-FA-CONFIG-1.0) ─────────────────────────

/** What five of the six live seasons resolve to: no effective config at all,
 *  because their only version is a `draft`. Every field null-permissive. */
const noRules: SeasonRules = {};

test("no effective config leaves a season completely ungated", () => {
  // This is the `testing` case — active today with 18 memberships.
  assert.equal(canMoveRoster(ungated, "2026-09-15", { rules: noRules }).allowed, true);
  // and even a gated season falls back to windows only
  assert.equal(canMoveRoster(gated, "2026-10-05", { rules: noRules }).allowed, true);
  assert.equal(canMoveRoster(gated, "2026-11-15", { rules: noRules }).reason, "window_closed");
});

test("null flags are permissive, false flags are not", () => {
  // A null must never be read as "off" — that is what keeps unconfigured
  // seasons working.
  assert.equal(
    canMoveRoster(gated, "2026-10-05", { rules: { allow_mid_season_team_switch: null } }).allowed,
    true
  );
  assert.equal(
    canMoveRoster(gated, "2026-10-05", { rules: { allow_mid_season_team_switch: false } }).reason,
    "switching_disabled"
  );
});

test("allow_mid_season_team_switch=false blocks moves even inside a window", () => {
  const r: SeasonRules = { allow_mid_season_team_switch: false };
  assert.equal(canMoveRoster(gated, "2026-10-05", { rules: r }).reason, "switching_disabled");
  // ...but a FIRST join is onboarding, not trading, and still goes through
  assert.equal(
    canMoveRoster(gated, "2026-10-05", { isFirstJoin: true, rules: r }).allowed,
    true
  );
});

test("allow_free_agency=false removes free agency as an open period", () => {
  const on = canMoveRoster(gated, "2026-12-29", { rules: { allow_free_agency: true } });
  assert.equal(on.allowed, true);
  // Dec 29 is inside FA but also inside the closing window (Dec 24–31), so use
  // a season whose FA does NOT overlap the closing window to isolate the flag.
  const faOnly: SeasonDates = {
    ...gated, trading_close_starts_on: null, trading_close_ends_on: null,
  };
  assert.equal(canMoveRoster(faOnly, "2026-12-29", {}).allowed, true, "FA opens it by default");
  assert.equal(
    canMoveRoster(faOnly, "2026-12-29", { rules: { allow_free_agency: false } }).reason,
    "window_closed",
    "with FA off there is no open period left"
  );
});

test("config roster_lock_on is absolute, like the playoff freeze", () => {
  const r: SeasonRules = { roster_lock_on: "2026-10-04" };
  // inside the opening window, but past the config lock
  assert.equal(canMoveRoster(gated, "2026-10-05", { rules: r }).reason, "locked");
  // a first join cannot get past it either
  assert.equal(
    canMoveRoster(gated, "2026-10-05", { isFirstJoin: true, rules: r }).allowed,
    false
  );
  // and the day before the lock is still fine
  assert.equal(canMoveRoster(gated, "2026-10-03", { rules: r }).allowed, true);
});

test("the playoff freeze outranks the config lock", () => {
  const frozen: SeasonDates = { ...gated, roster_freeze_on: "2026-10-02" };
  const verdict = canMoveRoster(frozen, "2026-10-05", {
    rules: { roster_lock_on: "2026-10-04" },
  });
  assert.equal(verdict.reason, "frozen", "freeze is reported, not the config lock");
});

test("allow_late_join=false closes first joins after the deadline", () => {
  const r: SeasonRules = { allow_late_join: false };
  // deadline falls back to starts_on when no registration date is set
  assert.equal(lateJoinDeadline(gated, r), "2026-10-01");
  assert.equal(canMoveRoster(gated, "2026-10-01", { isFirstJoin: true, rules: r }).allowed, true);
  assert.equal(
    canMoveRoster(gated, "2026-10-02", { isFirstJoin: true, rules: r }).reason,
    "late_join_closed"
  );
});

test("registration_closes_on anchors 'late' when the config sets one", () => {
  const r: SeasonRules = { allow_late_join: false, registration_closes_on: "2026-10-20" };
  assert.equal(lateJoinDeadline(gated, r), "2026-10-20");
  // a newcomer on Oct 15 is inside registration even though the season started
  assert.equal(canMoveRoster(gated, "2026-10-15", { isFirstJoin: true, rules: r }).allowed, true);
  assert.equal(
    canMoveRoster(gated, "2026-10-21", { isFirstJoin: true, rules: r }).reason,
    "late_join_closed"
  );
});

test("allow_late_join governs first joins ONLY — it never blocks a move", () => {
  const r: SeasonRules = { allow_late_join: false };
  // an existing player moving inside a window is unaffected by the late-join flag
  assert.equal(canMoveRoster(gated, "2026-10-05", { rules: r }).allowed, true);
});

test("full precedence order holds when every rule fires at once", () => {
  const season: SeasonDates = { ...gated, roster_freeze_on: "2026-10-02" };
  const rules: SeasonRules = {
    roster_lock_on: "2026-10-03",
    allow_mid_season_team_switch: false,
    allow_late_join: false,
    allow_free_agency: false,
  };
  // strictest wins, and it is the playoff freeze
  assert.equal(canMoveRoster(season, "2026-10-05", { rules }).reason, "frozen");
  // drop the freeze → the config lock is next
  assert.equal(
    canMoveRoster({ ...season, roster_freeze_on: null }, "2026-10-05", { rules }).reason,
    "locked"
  );
  // drop the lock → switching flag
  assert.equal(
    canMoveRoster({ ...season, roster_freeze_on: null }, "2026-10-05", {
      rules: { ...rules, roster_lock_on: null },
    }).reason,
    "switching_disabled"
  );
});
