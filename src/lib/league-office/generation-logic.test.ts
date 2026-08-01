// Unit tests for the Part D generation gating logic.
// Run: npm run test:generation
//
// The GENERATABLE conditions are the server-side gate on the League Office
// Generate buttons — the UI only renders what this module returns, so the
// module is tested directly.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  seasonDayCount,
  seasonDates,
  computeTargets,
  generationFindings,
  generationWarnings,
  isStalled,
  bankMinimumFindings,
  type GenerationInput,
  type GenRun,
} from "./generation-logic.ts";

const LIVE7 = [
  ["rackl", "Rackl"], ["signal_drop", "Signal Drop"], ["the_stack", "The Stack"],
  ["circuit", "Circuit"], ["the_brief", "The Brief"], ["dark_fiber", "Dark Fiber"],
  ["frequency", "Frequency"],
].map(([game_key, name], i) => ({
  id: `g${i}`,
  game_key,
  display_name: name,
  lifecycle_state: "live",
  runtime_key: name,
}));

const ACTIVE_DOMAINS = Array.from({ length: 23 }, (_, i) => `D${i + 1}`);

function okInput(): GenerationInput {
  return {
    season: {
      id: "s1",
      league_id: "l1",
      starts_on: "2026-08-03",
      ends_on: "2026-09-04",
      playoff_starts_on: "2026-08-31",
      roster_freeze_on: "2026-08-28",
      locked_at: null,
      pilot_approved_at: null,
      generated_at: null,
    },
    slate: LIVE7.map((g) => ({ game_id: g.id, is_enabled: true, puzzle_count: null })),
    catalog: [...LIVE7],
    themeMix: [
      { theater_id: "T-001", sector_code: "D2", thread_code: null, target_pct: 60, is_excluded: false },
      { theater_id: "T-003", sector_code: "D14", thread_code: null, target_pct: 40, is_excluded: false },
      { theater_id: "T-002", sector_code: "D18", thread_code: null, target_pct: 100, is_excluded: true },
    ],
    difficultyMix: [
      { difficulty_band: "easy", target_pct: 40, applies_to_game_id: null },
      { difficulty_band: "medium", target_pct: 40, applies_to_game_id: null },
      { difficulty_band: "hard", target_pct: 20, applies_to_game_id: null },
    ],
    activeDomainCodes: ACTIVE_DOMAINS,
    inflightRuns: [],
  };
}

// ── window helpers ───────────────────────────────────────────────────────────

test("seasonDayCount is inclusive; invalid windows are null", () => {
  assert.equal(seasonDayCount("2026-08-03", "2026-09-04"), 33);
  assert.equal(seasonDayCount("2026-08-03", "2026-08-03"), 1);
  assert.equal(seasonDayCount("2026-08-03", null), null);
  assert.equal(seasonDayCount("2026-09-04", "2026-08-03"), null);
});

test("seasonDates enumerates every serve date", () => {
  const dates = seasonDates("2026-08-30", "2026-09-02");
  assert.deepEqual(dates, ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
});

// ── conditions 1–10 ──────────────────────────────────────────────────────────

test("a fully configured season is GENERATABLE for a pilot", () => {
  assert.deepEqual(generationFindings(okInput(), false), []);
});

test("condition 10 — a full run is refused until the pilot is approved", () => {
  const input = okInput();
  assert.ok(generationFindings(input, true).some((f) => f.code === "pilot_not_approved"));
  input.season.pilot_approved_at = "2026-08-02T00:00:00Z";
  assert.deepEqual(generationFindings(input, true), []);
});

test("conditions 1–2 — missing league/window/playoff/freeze each surface by name", () => {
  const input = okInput();
  input.season.league_id = null;
  input.season.ends_on = null;
  input.season.playoff_starts_on = null;
  input.season.roster_freeze_on = null;
  const codes = generationFindings(input, false).map((f) => f.code);
  for (const c of ["no_league", "no_window", "no_playoff_date", "no_freeze_date"])
    assert.ok(codes.includes(c), `missing ${c}`);
});

test("condition 2 — freeze earlier than a quarter of the season is refused", () => {
  const input = okInput();
  input.season.roster_freeze_on = "2026-08-05";
  assert.ok(generationFindings(input, false).some((f) => f.code === "freeze_too_early"));
});

test("condition 3 — an empty slate blocks", () => {
  const input = okInput();
  input.slate = input.slate.map((r) => ({ ...r, is_enabled: false }));
  assert.ok(generationFindings(input, false).some((f) => f.code === "no_games"));
});

test("condition 4 — a non-live game blocks; Logo Match is rejected outright", () => {
  const input = okInput();
  input.catalog = [
    ...LIVE7,
    { id: "gx", game_key: "grid_lock", display_name: "Grid Lock", lifecycle_state: "new_idea", runtime_key: null },
    { id: "gy", game_key: "logo_match", display_name: "Logo Match", lifecycle_state: "live", runtime_key: "Logo Match" },
  ];
  input.slate = [
    ...input.slate,
    { game_id: "gx", is_enabled: true, puzzle_count: null },
    { game_id: "gy", is_enabled: true, puzzle_count: null },
  ];
  const codes = generationFindings(input, false).map((f) => f.code);
  assert.ok(codes.includes("game_not_live"));
  assert.ok(codes.includes("dead_game"), "Logo Match must be rejected even if a row claims it is live");
});

test("condition 5 — puzzle_count below the day count blocks; surplus warns instead", () => {
  const input = okInput();
  input.slate[0] = { ...input.slate[0], puzzle_count: 10 };
  assert.ok(generationFindings(input, false).some((f) => f.code === "puzzle_count_short"));

  input.slate[0] = { ...input.slate[0], puzzle_count: 50 };
  assert.deepEqual(generationFindings(input, false), []);
  assert.ok(generationWarnings(input).some((f) => f.code === "surplus_unsupported"));
});

test("condition 6 — difficulty mix must total exactly 100 (global and per-game)", () => {
  const input = okInput();
  input.difficultyMix[0] = { ...input.difficultyMix[0], target_pct: 50 };
  assert.ok(generationFindings(input, false).some((f) => f.code === "difficulty_mix_not_100"));

  const perGame = okInput();
  perGame.difficultyMix.push({ difficulty_band: "easy", target_pct: 90, applies_to_game_id: "g0" });
  assert.ok(generationFindings(perGame, false).some((f) => f.code === "game_difficulty_mix_not_100"));
});

test("condition 7 — theme mix totals 100 over non-excluded rows; unknown D-codes block", () => {
  const input = okInput();
  input.themeMix[0] = { ...input.themeMix[0], target_pct: 55 };
  assert.ok(generationFindings(input, false).some((f) => f.code === "theme_mix_not_100"));

  const bad = okInput();
  bad.themeMix.push({ theater_id: "T-004", sector_code: "D99", thread_code: null, target_pct: 0, is_excluded: true });
  assert.ok(generationFindings(bad, false).some((f) => f.code === "unknown_domain_code"));
});

test("conditions 8–9 — lock and an in-flight run each block", () => {
  const locked = okInput();
  locked.season.locked_at = "2026-08-02T00:00:00Z";
  assert.ok(generationFindings(locked, false).some((f) => f.code === "season_locked"));

  const busy = okInput();
  busy.inflightRuns = [runFixture({ status: "generating" })];
  assert.ok(generationFindings(busy, false).some((f) => f.code === "run_in_flight"));
});

// ── warnings ─────────────────────────────────────────────────────────────────

test("D16/D18 emphasis above 15% warns; excluded rows never warn", () => {
  const input = okInput();
  input.themeMix = [
    { theater_id: "T-002", sector_code: "D18", thread_code: null, target_pct: 40, is_excluded: false },
    { theater_id: "T-001", sector_code: "D2", thread_code: null, target_pct: 60, is_excluded: false },
    { theater_id: "T-002", sector_code: "D16", thread_code: null, target_pct: 90, is_excluded: true },
  ];
  const warns = generationWarnings(input).filter((f) => f.code === "thin_corpus_emphasis");
  assert.equal(warns.length, 1);
  assert.match(warns[0].message, /Community Opposition/);
});

test("runs above 2,000 puzzles warn", () => {
  const input = okInput();
  input.season.ends_on = "2027-08-03"; // 366 days × 7 games = 2,562
  assert.ok(generationWarnings(input).some((f) => f.code === "large_run"));
});

test("computeTargets: one per game per day; disabled games excluded", () => {
  const input = okInput();
  input.slate[6] = { ...input.slate[6], is_enabled: false };
  const t = computeTargets(input);
  assert.equal(t.dayCount, 33);
  assert.equal(t.perGame.length, 6);
  assert.equal(t.total, 33 * 6);
});

// ── alarms ───────────────────────────────────────────────────────────────────

function runFixture(over: Partial<GenRun>): GenRun {
  return {
    id: "r1",
    season_id: "s1",
    run_kind: "full",
    status: "generating",
    target_count: 231,
    written_count: 10,
    failed_count: 0,
    started_at: "2026-08-02T00:00:00Z",
    completed_at: null,
    superseded_at: null,
    last_heartbeat_at: "2026-08-02T01:00:00Z",
    ...over,
  };
}

test("stall alarm: silent >30 minutes while in flight; never after completion", () => {
  const run = runFixture({});
  assert.equal(isStalled(run, "2026-08-02T01:29:00Z"), false);
  assert.equal(isStalled(run, "2026-08-02T01:31:00Z"), true);
  assert.equal(isStalled(runFixture({ completed_at: "2026-08-02T01:05:00Z" }), "2026-08-02T09:00:00Z"), false);
  // no heartbeat yet → measured from started_at
  assert.equal(isStalled(runFixture({ last_heartbeat_at: null }), "2026-08-02T00:31:00Z"), true);
});

test("bank minimum: every configured game below 14 days ahead raises an alert", () => {
  const keys = ["Rackl", "Signal Drop"];
  const findings = bankMinimumFindings(keys, { Rackl: 14, "Signal Drop": 3 });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /Signal Drop has 3 days/);
  assert.deepEqual(bankMinimumFindings(keys, { Rackl: 20, "Signal Drop": 14 }), []);
});
