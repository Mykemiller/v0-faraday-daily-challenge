// Unit tests for CC-LO-GEN-CONFORMANCE-1.0 — "configured vs generated".
// Run: npm run test:gen-conformance
//
// The Football fixture is NOT invented. Every number in it was SELECTed from
// the live season 02701ead-a03e-4489-adb9-24d3c6787eec / config
// 3bf84bc8-f202-4a2d-9a89-9dcc38f36711 on 2026-10-06:
//
//   season window      2026-10-05 → 2027-01-31 (119 days)
//   dc_daily_theme     T-002 49 · T-005 48 · T-007 22  (119 rows, 119 dates)
//   theme mix          T-002 35.31 · T-005 29.41 · T-007 35.28 included;
//                      T-001 · T-003 · T-004 · T-006 excluded
//   difficulty mix     expert 55.77 · practitioner 29.82 · foundational 14.41
//   bank (595 rows)    foundational 120 · practitioner 178 · expert 297
//   per game           Dark Fiber 59/36/24 · Frequency 59/36/24 ·
//                      Rackl 60/35/24 · The Brief 60/35/24 · The Stack 59/36/24
//                      (expert/practitioner/foundational)
//   slate windows      Dark Fiber + Rackl expert..expert ·
//                      The Brief + The Stack practitioner..expert ·
//                      Frequency foundational..expert
//
// So this is a regression test against a REAL bank, and the failures it asserts
// are real failures of that bank — not a synthetic worst case.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  conformance, failingKeys, shareStatus,
  type ConformanceInput, type ConformanceReport, type ConformanceRow,
} from "./generation-conformance.ts";

// ── fixture ──────────────────────────────────────────────────────────────────

const SEASON_START = "2026-10-05";
const SEASON_DAYS = 119;

function datesFrom(start: string, n: number): string[] {
  const out: string[] = [];
  const t = new Date(start + "T12:00:00Z");
  for (let k = 0; k < n; k++) {
    out.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

const FOOTBALL_DATES = datesFrom(SEASON_START, SEASON_DAYS);

const FOOTBALL_THEME_MIX = [
  { theater_id: "T-001", sector_code: null, thread_code: null, target_pct: "26.05", is_excluded: true },
  { theater_id: "T-002", sector_code: null, thread_code: null, target_pct: "35.31", is_excluded: false },
  { theater_id: "T-003", sector_code: null, thread_code: null, target_pct: "20.69", is_excluded: true },
  { theater_id: "T-004", sector_code: null, thread_code: null, target_pct: "14.29", is_excluded: true },
  { theater_id: "T-005", sector_code: null, thread_code: null, target_pct: "29.41", is_excluded: false },
  { theater_id: "T-006", sector_code: null, thread_code: null, target_pct: "17.14", is_excluded: true },
  { theater_id: "T-007", sector_code: null, thread_code: null, target_pct: "35.28", is_excluded: false },
];

const FOOTBALL_DIFFICULTY_MIX = [
  { difficulty_band: "expert", target_pct: "55.77", applies_to_game_id: null },
  { difficulty_band: "foundational", target_pct: "14.41", applies_to_game_id: null },
  { difficulty_band: "practitioner", target_pct: "29.82", applies_to_game_id: null },
];

const FOOTBALL_SLATE = [
  { runtime_key: "Circuit", floor: null, ceiling: null, enabled: false },
  { runtime_key: "Signal Drop", floor: null, ceiling: null, enabled: false },
  { runtime_key: "Dark Fiber", floor: "expert", ceiling: "expert", enabled: true },
  { runtime_key: "Frequency", floor: "foundational", ceiling: "expert", enabled: true },
  { runtime_key: "Rackl", floor: "expert", ceiling: "expert", enabled: true },
  { runtime_key: "The Brief", floor: "practitioner", ceiling: "expert", enabled: true },
  { runtime_key: "The Stack", floor: "practitioner", ceiling: "expert", enabled: true },
];

/** (theater, sector, days) exactly as dc_daily_theme has them. */
const FOOTBALL_THEME_SHAPE: [string, string, number][] = [
  ["T-002", "D11", 7], ["T-002", "D1", 7], ["T-002", "D20", 6], ["T-002", "D22", 6],
  ["T-002", "D4", 5], ["T-002", "D12", 5], ["T-002", "D7", 4], ["T-002", "D10", 4],
  ["T-002", "D8", 3], ["T-002", "D2", 2],
  ["T-005", "D1", 7], ["T-005", "D9", 7], ["T-005", "D5", 6], ["T-005", "D15", 5],
  ["T-005", "D23", 5], ["T-005", "D6", 5], ["T-005", "D4", 4], ["T-005", "D22", 4],
  ["T-005", "D12", 3], ["T-005", "D8", 2],
  ["T-007", "D2", 6], ["T-007", "D11", 5], ["T-007", "D3", 4], ["T-007", "D22", 4],
  ["T-007", "D8", 3],
];

function footballThemeRows() {
  const out: { date: string; theater_id: string; sector_code: string }[] = [];
  for (const [theater_id, sector_code, n] of FOOTBALL_THEME_SHAPE)
    for (let k = 0; k < n; k++) out.push({ date: FOOTBALL_DATES[out.length], theater_id, sector_code });
  return out;
}

/** expert / practitioner / foundational counts per game, summing to 119 each. */
const FOOTBALL_BANK_SHAPE: [string, number, number, number][] = [
  ["Dark Fiber", 59, 36, 24],
  ["Frequency", 59, 36, 24],
  ["Rackl", 60, 35, 24],
  ["The Brief", 60, 35, 24],
  ["The Stack", 59, 36, 24],
];

function footballBankRows() {
  const out: { puzzle_type: string; go_live_date: string; difficulty: string }[] = [];
  for (const [puzzle_type, e, p, f] of FOOTBALL_BANK_SHAPE) {
    const bands = [
      ...Array(e).fill("expert"), ...Array(p).fill("practitioner"), ...Array(f).fill("foundational"),
    ];
    bands.forEach((difficulty, k) => out.push({ puzzle_type, go_live_date: FOOTBALL_DATES[k], difficulty }));
  }
  return out;
}

function football(): ConformanceInput {
  return {
    themeMix: FOOTBALL_THEME_MIX,
    difficultyMix: FOOTBALL_DIFFICULTY_MIX,
    slate: FOOTBALL_SLATE,
    themeRows: footballThemeRows(),
    bankRows: footballBankRows(),
    seasonDates: FOOTBALL_DATES,
  };
}

function row(r: ConformanceReport, dimension: string, key: string): ConformanceRow {
  const hit = r.rows.find((x) => x.dimension === dimension && x.key === key);
  assert.ok(hit, `expected a ${dimension} row for ${key}`);
  return hit;
}

// ── the fixture itself ───────────────────────────────────────────────────────

test("the Football fixture is the shape the live season actually has", () => {
  const f = football();
  assert.equal(f.seasonDates?.length, 119);
  assert.equal(FOOTBALL_DATES[118], "2027-01-31");
  assert.equal(f.themeRows?.length, 119);
  assert.equal(f.bankRows?.length, 595);
  const byBand = new Map<string, number>();
  for (const b of f.bankRows ?? []) byBand.set(b.difficulty!, (byBand.get(b.difficulty!) ?? 0) + 1);
  assert.deepEqual(
    [byBand.get("foundational"), byBand.get("practitioner"), byBand.get("expert")],
    [120, 178, 297]
  );
});

// ── theater ──────────────────────────────────────────────────────────────────

test("Football theaters: T-007 is 16.8 points short, T-005 10.9 over, T-002 5.9 over", () => {
  const r = conformance(football());

  const t7 = row(r, "theater", "T-007");
  assert.equal(t7.target, 35.3);
  assert.equal(t7.actual, 18.5);
  assert.equal(t7.delta, -16.8);
  assert.equal(t7.status, "fail");
  assert.match(t7.note, /22 of 119 days/);

  const t5 = row(r, "theater", "T-005");
  assert.equal(t5.target, 29.4);
  assert.equal(t5.actual, 40.3);
  assert.equal(t5.delta, 10.9);
  assert.equal(t5.status, "fail");

  const t2 = row(r, "theater", "T-002");
  assert.equal(t2.target, 35.3);
  assert.equal(t2.actual, 41.2);
  assert.equal(t2.delta, 5.9);
  assert.equal(t2.status, "warn");
});

test("an excluded theater never gets a share row — that is the exclusion dimension's job", () => {
  const r = conformance(football());
  const theaters = r.rows.filter((x) => x.dimension === "theater").map((x) => x.key);
  assert.deepEqual(theaters.sort(), ["T-002", "T-005", "T-007"]);
});

// ── sector ───────────────────────────────────────────────────────────────────

test("Football configures no sector targets, so no sector row is invented", () => {
  const r = conformance(football());
  assert.equal(r.rows.filter((x) => x.dimension === "sector").length, 0);
});

test("a sector target is measured INSIDE its theater, not across the season", () => {
  // T-009 is 50% of the season; inside it, D5 is configured at 50% and gets 5
  // of the theater's 10 days — exactly on target, even though that is only 25%
  // of the season.
  const themeMix = [
    { theater_id: "T-009", sector_code: null, thread_code: null, target_pct: 50, is_excluded: false },
    { theater_id: "T-010", sector_code: null, thread_code: null, target_pct: 50, is_excluded: false },
    { theater_id: "T-009", sector_code: "D5", thread_code: null, target_pct: 50, is_excluded: false },
    { theater_id: "T-009", sector_code: "D6", thread_code: null, target_pct: 50, is_excluded: false },
  ];
  const themeRows = [
    ...Array.from({ length: 5 }, (_, k) => ({ date: `d${k}`, theater_id: "T-009", sector_code: "D5" })),
    ...Array.from({ length: 5 }, (_, k) => ({ date: `e${k}`, theater_id: "T-009", sector_code: "D6" })),
    ...Array.from({ length: 10 }, (_, k) => ({ date: `f${k}`, theater_id: "T-010", sector_code: "D7" })),
  ];
  const r = conformance({ themeMix, themeRows });
  const d5 = row(r, "sector", "T-009/D5");
  assert.equal(d5.target, 50);
  assert.equal(d5.actual, 50);
  assert.equal(d5.delta, 0);
  assert.equal(d5.status, "ok");
  assert.match(d5.note, /5 of 10 days in T-009/);
});

// ── difficulty ───────────────────────────────────────────────────────────────

test("Football difficulty: foundational 5.8 over, expert 5.9 short, practitioner on target", () => {
  const r = conformance(football());

  const f = row(r, "difficulty", "foundational");
  assert.equal(f.target, 14.4);
  assert.equal(f.actual, 20.2);
  assert.equal(f.delta, 5.8);
  assert.equal(f.status, "warn");
  assert.match(f.note, /120 of 595 puzzles/);

  const e = row(r, "difficulty", "expert");
  assert.equal(e.target, 55.8);
  assert.equal(e.actual, 49.9);
  assert.equal(e.delta, -5.9);
  assert.equal(e.status, "warn");

  const p = row(r, "difficulty", "practitioner");
  assert.equal(p.delta, 0.1);
  assert.equal(p.status, "ok");
});

test("difficulty rows come back in canonical band order", () => {
  const r = conformance(football());
  assert.deepEqual(
    r.rows.filter((x) => x.dimension === "difficulty").map((x) => x.key),
    ["foundational", "practitioner", "expert"]
  );
});

// ── difficulty_window ────────────────────────────────────────────────────────

test("Football: 167 bank rows sit outside their own game's band window", () => {
  const w = row(conformance(football()), "difficulty_window", "window");
  assert.equal(w.target, 0);
  assert.equal(w.actual, 167);
  assert.equal(w.delta, 167);
  assert.equal(w.status, "fail");
  // Dark Fiber 60 + Rackl 59 (expert-only, so every non-expert row breaches)
  // + The Brief 24 + The Stack 24 (foundational is below their floor).
  // Frequency's window is open, so it contributes nothing.
  assert.match(w.note, /Dark Fiber 60/);
  assert.match(w.note, /Rackl 59/);
  assert.match(w.note, /The Brief 24/);
  assert.match(w.note, /The Stack 24/);
  assert.doesNotMatch(w.note, /Frequency/);
});

test("a floor above its ceiling leaves no legal band, so every row breaches", () => {
  const r = conformance({
    slate: [{ runtime_key: "Rackl", floor: "expert", ceiling: "foundational", enabled: true }],
    bankRows: [
      { puzzle_type: "Rackl", go_live_date: "2026-10-05", difficulty: "expert" },
      { puzzle_type: "Rackl", go_live_date: "2026-10-06", difficulty: "foundational" },
    ],
  });
  assert.equal(row(r, "difficulty_window", "window").actual, 2);
});

test("a disabled game's rows are not judged against a window it does not have", () => {
  const r = conformance({
    slate: [{ runtime_key: "Circuit", floor: "expert", ceiling: "expert", enabled: false }],
    bankRows: [{ puzzle_type: "Circuit", go_live_date: "2026-10-05", difficulty: "foundational" }],
  });
  assert.equal(r.rows.filter((x) => x.dimension === "difficulty_window").length, 0);
});

// ── coverage ─────────────────────────────────────────────────────────────────

test("Football covers every enabled game on every season day", () => {
  const c = row(conformance(football()), "coverage", "cells");
  assert.equal(c.target, 595);
  assert.equal(c.actual, 595);
  assert.equal(c.delta, 0);
  assert.equal(c.status, "ok");
  assert.match(c.note, /all 595/);
});

test("a missing (game × day) cell is a coverage fail with the count", () => {
  const f = football();
  const r = conformance({ ...f, bankRows: (f.bankRows ?? []).slice(0, 592) });
  const c = row(r, "coverage", "cells");
  assert.equal(c.actual, 592);
  assert.equal(c.delta, -3);
  assert.equal(c.status, "fail");
  assert.match(c.note, /3 of 595/);
});

// ── exclusion ────────────────────────────────────────────────────────────────

test("Football uses no excluded theater, sector or thread", () => {
  const x = row(conformance(football()), "exclusion", "excluded");
  assert.equal(x.actual, 0);
  assert.equal(x.status, "ok");
  assert.match(x.note, /no day uses any of the 4 excluded keys/);
});

test("a day in an excluded theater, sector or thread is a fail that names the key", () => {
  const themeMix = [
    { theater_id: "T-002", sector_code: null, thread_code: null, target_pct: 100, is_excluded: false },
    { theater_id: "T-004", sector_code: null, thread_code: null, target_pct: 0, is_excluded: true },
    { theater_id: "T-002", sector_code: "D16", thread_code: null, target_pct: 0, is_excluded: true },
    { theater_id: "T-002", sector_code: null, thread_code: "TH-9", target_pct: 0, is_excluded: true },
  ];
  const r = conformance({
    themeMix,
    themeRows: [
      { date: "a", theater_id: "T-004", sector_code: "D1" },
      { date: "b", theater_id: "T-002", sector_code: "D16" },
      { date: "c", theater_id: "T-002", sector_code: "D1", thread_codes: ["TH-9"] },
      { date: "d", theater_id: "T-002", sector_code: "D1", thread_codes: ["TH-1"] },
    ],
  });
  const x = row(r, "exclusion", "excluded");
  assert.equal(x.actual, 3);
  assert.equal(x.status, "fail");
  assert.match(x.note, /T-004 1/);
  assert.match(x.note, /D16 1/);
  assert.match(x.note, /TH-9 1/);
});

// ── the report as a whole ────────────────────────────────────────────────────

test("Football's worst status is fail, and the failing keys are the three real ones", () => {
  const r = conformance(football());
  assert.equal(r.worst, "fail");
  assert.deepEqual(
    failingKeys(r).sort(),
    ["difficulty_window:window", "theater:T-005", "theater:T-007"]
  );
});

test("a bank that matches its configuration reports worst = ok", () => {
  const dates = datesFrom("2026-10-05", 10);
  const games = ["Rackl", "The Stack"];
  const bands = ["foundational", "practitioner", "expert", "practitioner", "expert"];
  const r = conformance({
    themeMix: [
      { theater_id: "T-002", sector_code: null, thread_code: null, target_pct: 50, is_excluded: false },
      { theater_id: "T-005", sector_code: null, thread_code: null, target_pct: 50, is_excluded: false },
      { theater_id: "T-004", sector_code: null, thread_code: null, target_pct: 0, is_excluded: true },
    ],
    difficultyMix: [
      { difficulty_band: "foundational", target_pct: 20, applies_to_game_id: null },
      { difficulty_band: "practitioner", target_pct: 40, applies_to_game_id: null },
      { difficulty_band: "expert", target_pct: 40, applies_to_game_id: null },
    ],
    slate: games.map((runtime_key) => ({
      runtime_key, floor: "foundational", ceiling: "expert", enabled: true,
    })),
    themeRows: dates.map((date, k) => ({
      date, theater_id: k < 5 ? "T-002" : "T-005", sector_code: "D1",
    })),
    bankRows: games.flatMap((puzzle_type) =>
      dates.map((go_live_date, k) => ({ puzzle_type, go_live_date, difficulty: bands[k % 5] }))
    ),
    seasonDates: dates,
  });
  assert.equal(r.worst, "ok", JSON.stringify(r.rows.filter((x) => x.status !== "ok"), null, 1));
  assert.deepEqual(failingKeys(r), []);
  assert.ok(r.rows.length >= 7);
});

test("an empty input is an empty report, not a wall of zeroes", () => {
  const r = conformance({});
  assert.deepEqual(r.rows, []);
  assert.equal(r.worst, "ok");
});

// ── the threshold itself ─────────────────────────────────────────────────────

test("D2 thresholds: 5 is ok, 10 is warn, above 10 is fail — on both signs", () => {
  for (const d of [0, 4.9, 5, -5]) assert.equal(shareStatus(d), "ok", `${d}`);
  for (const d of [5.1, 9.9, 10, -10, -5.1]) assert.equal(shareStatus(d), "warn", `${d}`);
  for (const d of [10.1, 40, -10.1, -100]) assert.equal(shareStatus(d), "fail", `${d}`);
});

// ── the contract the orchestrator depends on ─────────────────────────────────

test("the module is callable from plain node: no React, Next, Supabase or env", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./generation-conformance.ts", import.meta.url), "utf8");
  // Only the two pure, import-free generation modules may be imported.
  const imports = [...src.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["../generation/difficulty.js", "../generation/theme-allocation.js"]);
  assert.doesNotMatch(src, /process\.env/);
  assert.doesNotMatch(src, /\bfetch\(/);
  assert.doesNotMatch(src, /createClient|next\/|react/);
});
