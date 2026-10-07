// CC-DC-GEN-SCHEDULE-FIELDS-1.0 — the season calendar, pinned.
//   npm run test:schedule
//
// The four columns this module exists to make load-bearing were, before it,
// read by nothing: play_days_of_week, appears_on_days, season_games.starts_on /
// .ends_on. The tests below are therefore written as the four configurations a
// commissioner can actually set, plus the two that must NOT change anything
// (an unconfigured season, and the live Football slate).

import test from "node:test";
import assert from "node:assert/strict";

import {
  isoDate,
  isoWeekday,
  playDays,
  seasonWindow,
  windowDates,
  isScheduled,
  scheduledDates,
  scheduledDayCount,
  scheduledSlots,
  scheduledTypesOn,
  dailyCounts,
  overScheduledDates,
  type ScheduleGame,
} from "./schedule.ts";

// 2026-10-05 is a Monday; the week below runs Mon → Sun.
const WEEK = {
  mon: "2026-10-05", tue: "2026-10-06", wed: "2026-10-07", thu: "2026-10-08",
  fri: "2026-10-09", sat: "2026-10-10", sun: "2026-10-11",
};

/** A two-week season, Mon 2026-10-05 → Sun 2026-10-18. */
const FORTNIGHT = { starts_on: "2026-10-05", ends_on: "2026-10-18" };

const game = (over: Partial<ScheduleGame> = {}): ScheduleGame => ({ type: "Rackl", ...over });

// ── date primitives ─────────────────────────────────────────────────────────

test("isoDate accepts calendar dates and rejects impossible ones", () => {
  assert.equal(isoDate("2026-10-05"), "2026-10-05");
  assert.equal(isoDate("2026-10-05T00:00:00Z"), "2026-10-05", "a timestamp is truncated to its date");
  assert.equal(isoDate("2026-02-30"), null, "February 30 is not a day");
  assert.equal(isoDate("2026-13-01"), null);
  assert.equal(isoDate("10/05/2026"), null);
  assert.equal(isoDate(null), null);
  assert.equal(isoDate(20261005), null);
});

test("isoWeekday is 1=Mon … 7=Sun, computed from the string", () => {
  assert.equal(isoWeekday(WEEK.mon), 1);
  assert.equal(isoWeekday(WEEK.sat), 6);
  assert.equal(isoWeekday(WEEK.sun), 7, "Sunday is 7, never JavaScript's 0");
  assert.equal(isoWeekday("nope"), null);
});

test("a DST boundary does not move a serve day", () => {
  // US DST ends 2026-11-01 (a Sunday). Parsed at UTC noon, the day before and
  // the day after keep their weekdays.
  assert.equal(isoWeekday("2026-10-31"), 6);
  assert.equal(isoWeekday("2026-11-01"), 7);
  assert.equal(isoWeekday("2026-11-02"), 1);
});

test("playDays: absent/null ⇒ every day; an empty mask ⇒ none", () => {
  assert.deepEqual(playDays(null), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(playDays({}), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(playDays({ play_days_of_week: null }), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(playDays({ play_days_of_week: [] }), []);
  assert.deepEqual(playDays({ play_days_of_week: [7, 1, 1, 99] }), [1, 7], "normalizeDayMask dedupes, sorts, drops junk");
});

test("seasonWindow / windowDates are inclusive and reject an inverted window", () => {
  assert.deepEqual(seasonWindow(FORTNIGHT), { from: "2026-10-05", to: "2026-10-18" });
  assert.equal(seasonWindow({ starts_on: "2026-10-18", ends_on: "2026-10-05" }), null);
  assert.equal(seasonWindow({ starts_on: "2026-10-05", ends_on: null }), null);
  assert.equal(windowDates(FORTNIGHT).length, 14);
  assert.equal(windowDates(FORTNIGHT)[0], "2026-10-05");
  assert.equal(windowDates(FORTNIGHT)[13], "2026-10-18");
  assert.deepEqual(windowDates({ starts_on: "2026-10-05", ends_on: "2026-10-05" }), ["2026-10-05"]);
  assert.deepEqual(windowDates(null), []);
});

// ── the default: nothing configured changes nothing ─────────────────────────

test("an unconfigured season plays every game every day of its window", () => {
  const games = [game({ type: "Rackl" }), game({ type: "Circuit" })];
  assert.equal(scheduledSlots({ season: FORTNIGHT, config: null, games }).length, 28);
  assert.equal(scheduledDayCount({ season: FORTNIGHT, config: null, game: games[0] }), 14);
});

test("a season with no usable window schedules nothing", () => {
  assert.deepEqual(scheduledSlots({ season: { starts_on: null, ends_on: null }, games: [game()] }), []);
  assert.equal(isScheduled({ date: WEEK.mon, season: null, game: game() }), false);
});

// ── 1. weekdays-only season ─────────────────────────────────────────────────

test("play_days_of_week [1–5]: a weekdays-only season never plays a weekend", () => {
  const config = { play_days_of_week: [1, 2, 3, 4, 5] };
  const g = game();
  for (const d of [WEEK.mon, WEEK.tue, WEEK.wed, WEEK.thu, WEEK.fri])
    assert.equal(isScheduled({ date: d, season: FORTNIGHT, config, game: g }), true, d);
  for (const d of [WEEK.sat, WEEK.sun])
    assert.equal(isScheduled({ date: d, season: FORTNIGHT, config, game: g }), false, d);

  // 14 days, two weekends out → 10 play days, for every game on the slate.
  const games = [game({ type: "Rackl" }), game({ type: "Circuit" })];
  assert.equal(scheduledDayCount({ season: FORTNIGHT, config, game: games[0] }), 10);
  assert.equal(scheduledSlots({ season: FORTNIGHT, config, games }).length, 20);
});

// ── 2. per-game Monday-only ─────────────────────────────────────────────────

test("appears_on_days [1]: a Monday-only game plays twice in a fortnight", () => {
  const monday = game({ type: "The Brief", appears_on_days: [1] });
  const everyday = game({ type: "Rackl" });
  const slots = scheduledSlots({ season: FORTNIGHT, config: null, games: [monday, everyday] });

  assert.deepEqual(
    slots.filter((s) => s.type === "The Brief").map((s) => s.date),
    ["2026-10-05", "2026-10-12"]
  );
  assert.equal(slots.filter((s) => s.type === "Rackl").length, 14, "one game's mask never narrows another's");
});

test("appears_on_days NARROWS the season's play days — it can never widen them", () => {
  // A Saturday-only game in a weekdays-only season plays never. The season's
  // mask is the outer bound; this is the case that would otherwise let a
  // per-game field quietly re-open a day the commissioner closed.
  const config = { play_days_of_week: [1, 2, 3, 4, 5] };
  const saturday = game({ appears_on_days: [6] });
  assert.equal(scheduledDayCount({ season: FORTNIGHT, config, game: saturday }), 0);
  assert.equal(isScheduled({ date: WEEK.sat, season: FORTNIGHT, config, game: saturday }), false);
});

test("appears_on_days null or empty means every play day, not no day", () => {
  const config = { play_days_of_week: [1, 2, 3, 4, 5] };
  assert.equal(scheduledDayCount({ season: FORTNIGHT, config, game: game({ appears_on_days: null }) }), 10);
  assert.equal(scheduledDayCount({ season: FORTNIGHT, config, game: game({ appears_on_days: [] }) }), 10);
});

// ── 3. per-game window inside the season ────────────────────────────────────

test("season_games.starts_on/.ends_on clip a game to part of the season", () => {
  const g = game({ type: "Frequency", starts_on: "2026-10-08", ends_on: "2026-10-11" });
  assert.deepEqual(scheduledDates({ season: FORTNIGHT, config: null, game: g }), [
    "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11",
  ]);
});

test("an absent per-game bound is OPEN on that side", () => {
  assert.equal(scheduledDayCount({ season: FORTNIGHT, game: game({ starts_on: "2026-10-15" }) }), 4);
  assert.equal(scheduledDayCount({ season: FORTNIGHT, game: game({ ends_on: "2026-10-06" }) }), 2);
});

test("a per-game window wider than the season is clipped BY the season", () => {
  const g = game({ starts_on: "2026-01-01", ends_on: "2027-12-31" });
  assert.equal(scheduledDayCount({ season: FORTNIGHT, game: g }), 14);
});

test("a per-game window outside the season schedules nothing", () => {
  const g = game({ starts_on: "2026-11-01", ends_on: "2026-11-30" });
  assert.deepEqual(scheduledDates({ season: FORTNIGHT, game: g }), []);
});

test("the window and the mask compose", () => {
  // Mon–Fri season, a game windowed to one calendar week: 5 play days.
  const config = { play_days_of_week: [1, 2, 3, 4, 5] };
  const g = game({ starts_on: "2026-10-05", ends_on: "2026-10-11" });
  assert.deepEqual(scheduledDates({ season: FORTNIGHT, config, game: g }), [
    "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09",
  ]);
});

// ── 4. an empty mask means NEVER ────────────────────────────────────────────

test("play_days_of_week []: an empty mask schedules nothing, ever", () => {
  // The one place `[]` and null must NOT be conflated. An empty mask is a
  // configured instruction; a null one is an unset field.
  const config = { play_days_of_week: [] };
  assert.deepEqual(scheduledSlots({ season: FORTNIGHT, config, games: [game(), game({ type: "Circuit" })] }), []);
  for (const d of Object.values(WEEK))
    assert.equal(isScheduled({ date: d, season: FORTNIGHT, config, game: game() }), false, d);
});

// ── 5. the live Football season ─────────────────────────────────────────────

test("the live Football config schedules exactly 595 slots", () => {
  // Measured 2026-10-06 against season 02701ead-a03e-4489-adb9-24d3c6787eec /
  // config 3bf84bc8-f202-4a2d-9a89-9dcc38f36711: 2026-10-05 → 2027-01-31 (119
  // days), play_days_of_week = all seven, five enabled games, no
  // appears_on_days and no per-game window anywhere. 119 × 5 = 595 — which is
  // also the exact row count the season already banked, so this module must
  // reproduce the existing calendar, not a new one.
  const season = { starts_on: "2026-10-05", ends_on: "2027-01-31" };
  const config = { play_days_of_week: [1, 2, 3, 4, 5, 6, 7] };
  const games = ["Dark Fiber", "Frequency", "The Brief", "The Stack", "Rackl"].map((type) =>
    game({ type, appears_on_days: null, starts_on: null, ends_on: null })
  );

  assert.equal(windowDates(season).length, 119);
  assert.equal(scheduledSlots({ season, config, games }).length, 595);
  for (const g of games) assert.equal(scheduledDayCount({ season, config, game: g }), 119, g.type);
});

// ── slot ordering, per-date views ───────────────────────────────────────────

test("scheduledSlots is type-major with dates ascending — the old product's order", () => {
  const games = [game({ type: "Rackl" }), game({ type: "Circuit" })];
  const season = { starts_on: "2026-10-05", ends_on: "2026-10-07" };
  assert.deepEqual(scheduledSlots({ season, games }), [
    { type: "Rackl", date: "2026-10-05" },
    { type: "Rackl", date: "2026-10-06" },
    { type: "Rackl", date: "2026-10-07" },
    { type: "Circuit", date: "2026-10-05" },
    { type: "Circuit", date: "2026-10-06" },
    { type: "Circuit", date: "2026-10-07" },
  ]);
});

test("scheduledTypesOn answers the serve path's question: who plays today?", () => {
  const games = [
    game({ type: "Rackl" }),
    game({ type: "The Brief", appears_on_days: [1] }),
    game({ type: "Frequency", starts_on: "2026-10-12" }),
  ];
  assert.deepEqual(scheduledTypesOn({ date: WEEK.mon, season: FORTNIGHT, games }), ["Rackl", "The Brief"]);
  assert.deepEqual(scheduledTypesOn({ date: WEEK.tue, season: FORTNIGHT, games }), ["Rackl"]);
  assert.deepEqual(
    scheduledTypesOn({ date: "2026-10-12", season: FORTNIGHT, games }),
    ["Rackl", "The Brief", "Frequency"],
    "the second Monday, once Frequency's window has opened"
  );
  assert.deepEqual(scheduledTypesOn({ date: "2026-11-01", season: FORTNIGHT, games }), [], "outside the season");
});

test("dailyCounts counts the games landing on each date", () => {
  const games = [game({ type: "Rackl" }), game({ type: "The Brief", appears_on_days: [1] })];
  const counts = dailyCounts({ season: { starts_on: "2026-10-05", ends_on: "2026-10-06" }, games });
  assert.deepEqual(counts, [
    { date: "2026-10-05", count: 2 },
    { date: "2026-10-06", count: 1 },
  ]);
});

// ── games_per_day is a cap to REPORT, never a selector ──────────────────────

test("overScheduledDates names the days that exceed games_per_day", () => {
  const games = ["A", "B", "C"].map((type) => game({ type }));
  const season = { starts_on: "2026-10-05", ends_on: "2026-10-07" };
  const over = overScheduledDates({ season, games, gamesPerDay: 2 });
  assert.deepEqual(over.map((d) => d.date), ["2026-10-05", "2026-10-06", "2026-10-07"]);
  assert.equal(over[0].count, 3);
});

test("a cap at or above the busiest day, or absent, reports nothing", () => {
  const games = ["A", "B", "C"].map((type) => game({ type }));
  const season = { starts_on: "2026-10-05", ends_on: "2026-10-07" };
  assert.deepEqual(overScheduledDates({ season, games, gamesPerDay: 3 }), []);
  assert.deepEqual(overScheduledDates({ season, games, gamesPerDay: 9 }), []);
  assert.deepEqual(overScheduledDates({ season, games, gamesPerDay: null }), []);
  assert.deepEqual(overScheduledDates({ season, games }), []);
  assert.deepEqual(overScheduledDates({ season, games, gamesPerDay: 0 }), [], "0 is not a cap of zero games");
});

test("the cap is judged per DAY, so a staggered slate can sit under it", () => {
  // Three games, each on its own weekday: the busiest day carries one.
  const games = [
    game({ type: "A", appears_on_days: [1] }),
    game({ type: "B", appears_on_days: [2] }),
    game({ type: "C", appears_on_days: [3] }),
  ];
  assert.deepEqual(overScheduledDates({ season: FORTNIGHT, games, gamesPerDay: 1 }), []);
  assert.equal(scheduledSlots({ season: FORTNIGHT, games }).length, 6);
});

// ── purity ──────────────────────────────────────────────────────────────────

test("the module never mutates its inputs and is stable under repetition", () => {
  const games = [game({ type: "Rackl", appears_on_days: [1, 3] })];
  const snapshot = JSON.stringify(games);
  const a = scheduledSlots({ season: FORTNIGHT, config: { play_days_of_week: [1, 2, 3] }, games });
  const b = scheduledSlots({ season: FORTNIGHT, config: { play_days_of_week: [1, 2, 3] }, games });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(games), snapshot);
});

// ── one definition, three consumers ─────────────────────────────────────────

test("validation, generation and serving all read THIS module", async () => {
  // The pack's whole thesis in one assertion. If a fourth place starts
  // deciding which games play on which dates — or one of these three stops
  // asking — this is what fails.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const src = join(dirname(fileURLToPath(import.meta.url)), "..");

  const validation = readFileSync(join(src, "league-office/generation-logic.ts"), "utf8");
  assert.match(validation, /from "\.\.\/seasons\/schedule\.ts"/);
  assert.match(validation, /scheduledDayCount/, "targets are per-game scheduled days");
  assert.match(validation, /overScheduledDates/, "games_per_day is validated against the calendar");

  const generation = readFileSync(join(src, "generation/worker.ts"), "utf8");
  assert.match(generation, /from "@\/lib\/seasons\/schedule"/);
  assert.match(generation, /scheduledSlots\(/, "the slot list is the calendar, not a dates × types product");

  const serving = readFileSync(join(src, "season-slate-server.ts"), "utf8");
  assert.match(serving, /from "@\/lib\/seasons\/schedule"/);
  assert.match(serving, /scheduledTypesOn\(/);
});

test("games_per_day is never used to CHOOSE which games run", async () => {
  // D2. The cap is a validation rule; a generator that silently drops a game
  // to fit under it produces a season nobody configured, from no surface.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const src = join(dirname(fileURLToPath(import.meta.url)), "..");

  for (const f of ["generation/worker.ts", "season-slate-server.ts", "season-slate.ts"])
    assert.doesNotMatch(readFileSync(join(src, f), "utf8"), /games_per_day/,
      `${f} must not read games_per_day — it is a validation rule, not a selector`);
  assert.match(readFileSync(join(src, "league-office/generation-logic.ts"), "utf8"),
    /games_per_day_below_scheduled/, "the only consumer is the blocking finding");
});
