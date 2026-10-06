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
  bankMinimumFindings, bankAlarmApplies, bankCoverageWindow, bankServeDays,
  realizedDifficultyMix,
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

test("condition 1 — missing league/window each surface by name", () => {
  const input = okInput();
  input.season.league_id = null;
  input.season.ends_on = null;
  const codes = generationFindings(input, false).map((f) => f.code);
  for (const c of ["no_league", "no_window"]) assert.ok(codes.includes(c), `missing ${c}`);
});

test("condition 2 — playoffs are optional: no playoff date + no freeze is GENERATABLE and warns once", () => {
  const input = okInput();
  input.season.playoff_starts_on = null;
  input.season.roster_freeze_on = null;
  assert.deepEqual(generationFindings(input, false), []);
  const warnings = generationWarnings(input).filter((w) => w.code === "no_playoffs");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, "warning");
  // A season WITH a playoff date does not get the warning.
  assert.ok(!generationWarnings(okInput()).some((w) => w.code === "no_playoffs"));
});

test("condition 2 — a playoff date without a roster freeze is refused", () => {
  const input = okInput();
  input.season.roster_freeze_on = null;
  const codes = generationFindings(input, false).map((f) => f.code);
  assert.ok(codes.includes("no_freeze_date"));
  assert.ok(!codes.includes("no_playoff_date"), "no_playoff_date is retired");
});

test("condition 2 — playoff ordering rules still apply when a playoff date is set", () => {
  const outside = okInput();
  outside.season.playoff_starts_on = "2026-09-05"; // day after ends_on
  assert.ok(generationFindings(outside, false).some((f) => f.code === "playoff_outside_window"));
  const after = okInput();
  after.season.roster_freeze_on = "2026-09-01"; // after playoff_starts_on
  assert.ok(generationFindings(after, false).some((f) => f.code === "freeze_after_playoff"));
});

test("condition 2 — a freeze without playoffs is allowed but still obeys the quarter rule", () => {
  const ok = okInput();
  ok.season.playoff_starts_on = null;
  ok.season.roster_freeze_on = "2026-08-28";
  assert.deepEqual(generationFindings(ok, false), []);
  const early = okInput();
  early.season.playoff_starts_on = null;
  early.season.roster_freeze_on = "2026-08-05";
  const codes = generationFindings(early, false).map((f) => f.code);
  assert.ok(codes.includes("freeze_too_early"));
  assert.ok(!codes.includes("no_freeze_date"));
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

// CC-DC-GEN-THEME-ALLOCATION-1.0 D7 — target_pct now DRIVES the calendar, so a
// share the corpus cannot serve has to block before the run is queued rather
// than get quietly handed to a neighbouring Theater.
test("condition 7 — an included theater the corpus cannot serve blocks as theme_quota_unfillable", () => {
  const base = okInput();
  base.themeMix = [
    { theater_id: "T-002", sector_code: null, thread_code: null, target_pct: 60, is_excluded: false },
    { theater_id: "T-007", sector_code: null, thread_code: null, target_pct: 40, is_excluded: false },
    { theater_id: "T-001", sector_code: null, thread_code: null, target_pct: 0, is_excluded: true },
  ];
  base.corpusThemeCounts = [
    { theater_id: "T-001", sector_code: "D2", count: 76 },
    { theater_id: "T-002", sector_code: "D4", count: 40 },
    { theater_id: "T-002", sector_code: "D7", count: 36 },
    { theater_id: "T-007", sector_code: "D11", count: 45 },
  ];
  assert.equal(generationFindings(base, false).filter((f) => f.code === "theme_quota_unfillable").length, 0);

  // T-007 holds only D11 rows, and D11 is excluded ⇒ nothing is left to serve it.
  const starved = structuredClone(base);
  starved.themeMix.push({ theater_id: "T-007", sector_code: "D11", thread_code: null, target_pct: 0, is_excluded: true });
  const found = generationFindings(starved, false).filter((f) => f.code === "theme_quota_unfillable");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "error");
  assert.match(found[0].message, /T-007/);

  // Absent counts ⇒ the pre-flight is skipped; the worker stays the authority.
  const noCounts = structuredClone(starved);
  delete noCounts.corpusThemeCounts;
  assert.equal(generationFindings(noCounts, false).filter((f) => f.code === "theme_quota_unfillable").length, 0);
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

// CC-DC-GEN-DIFFICULTY-ALLOCATION-1.0 D3 — the curve now DECIDES which dates
// carry the deeper bands, so the one curve with no shape behind it has to say
// so out loud rather than drawing a flat sparkline and leaving the
// commissioner to infer it.
test('difficulty_curve "custom" warns that only the shape is unsupported', () => {
  const input = okInput();
  input.difficultyCurve = "custom";
  const warns = generationWarnings(input).filter((f) => f.code === "difficulty_curve_custom_unsupported");
  assert.equal(warns.length, 1);
  assert.match(warns[0].message, /spread the configured mix evenly/);
  // ...and it is a WARNING, never a blocker: the totals are still exactly the mix.
  assert.ok(!generationFindings(input, false).some((f) => f.code === "difficulty_curve_custom_unsupported"));
});

test("the supported curves — and an absent one — raise no curve warning", () => {
  for (const curve of ["flat", "ramp", "wave", " WAVE ", null, undefined]) {
    const input = okInput();
    input.difficultyCurve = curve;
    assert.ok(
      !generationWarnings(input).some((f) => f.code === "difficulty_curve_custom_unsupported"),
      `curve ${String(curve)} must not warn`
    );
  }
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

test("bank minimum: a shorter remaining window lowers the bar; a zero window never alarms", () => {
  const keys = ["Rackl", "Circuit"];
  // 5 serve days left in the season: 5 covered is full coverage
  assert.deepEqual(bankMinimumFindings(keys, { Rackl: 5, Circuit: 5 }, 5), []);
  const f = bankMinimumFindings(keys, { Rackl: 5, Circuit: 2 }, 5);
  assert.equal(f.length, 1);
  assert.match(f[0].message, /Circuit has 2 of the 5 remaining serve days covered/);
  // nothing to cover (season over / >14 days out) → silent regardless of coverage
  assert.deepEqual(bankMinimumFindings(keys, {}, 0), []);
});

test("bank alarm applies only to a season whose puzzles have been generated", () => {
  assert.equal(bankAlarmApplies({ generated_at: null }), false);
  assert.equal(bankAlarmApplies({ generated_at: "2026-09-10T00:00:00Z" }), true);
});

test("bank coverage window is the next 14 serve days clipped to the season", () => {
  // mid-season: the full 14-day horizon fits
  assert.deepEqual(bankCoverageWindow("2026-09-15", "2026-09-10", "2026-10-31"), { from: "2026-09-16", to: "2026-09-29", required: 14 });
  // season ends in 5 days: only those 5
  assert.deepEqual(bankCoverageWindow("2026-09-26", "2026-09-10", "2026-10-01"), { from: "2026-09-27", to: "2026-10-01", required: 5 });
  // season starts in 10 days: the window begins on starts_on
  assert.deepEqual(bankCoverageWindow("2026-09-01", "2026-09-11", "2026-10-01"), { from: "2026-09-11", to: "2026-09-15", required: 5 });
  // season starts >14 days out, or has ended: nothing to cover
  assert.deepEqual(bankCoverageWindow("2026-08-01", "2026-09-10", "2026-10-01"), { from: null, to: null, required: 0 });
  assert.deepEqual(bankCoverageWindow("2026-10-05", "2026-09-10", "2026-10-01"), { from: null, to: null, required: 0 });
  // no window → nothing to cover
  assert.deepEqual(bankCoverageWindow("2026-09-15", null, null), { from: null, to: null, required: 0 });
});

// ── CC-DC-GEN-DIFFICULTY-PERGAME-1.0 ─────────────────────────────────────────
//
// The live Football slate, measured 2026-10-06 against season_config
// 3bf84bc8-f202-4a2d-9a89-9dcc38f36711. Five enabled games, a season mix of
// 14.41 / 29.82 / 55.77, and floors that quietly rewrite it to 2.9 / 19.9 /
// 77.2 — the configuration that banked 167 rows below their own game's floor
// (Dark Fiber 60, Rackl 59, The Brief 24, The Stack 24).
const FOOTBALL_SLATE: [string, string | null, string | null][] = [
  ["Dark Fiber", "expert", "expert"],
  ["Frequency", "foundational", "expert"],
  ["The Brief", "practitioner", "expert"],
  ["The Stack", "practitioner", "expert"],
  ["Rackl", "expert", "expert"],
];

function footballInput(): GenerationInput {
  const input = okInput();
  const byName = new Map(LIVE7.map((g) => [g.display_name, g.id]));
  input.slate = FOOTBALL_SLATE.map(([name, difficulty_floor, difficulty_ceiling]) => ({
    game_id: byName.get(name) as string,
    is_enabled: true,
    puzzle_count: null,
    difficulty_floor,
    difficulty_ceiling,
  }));
  input.difficultyMix = [
    { difficulty_band: "foundational", target_pct: 14.41, applies_to_game_id: null },
    { difficulty_band: "practitioner", target_pct: 29.82, applies_to_game_id: null },
    { difficulty_band: "expert", target_pct: 55.77, applies_to_game_id: null },
  ];
  return input;
}

test("the Football slate's floors shift the season mix, and the commissioner is told", () => {
  const input = footballInput();
  // Still generatable — a shift is a consequence of a valid configuration.
  assert.deepEqual(generationFindings(input, false), []);

  const shift = realizedDifficultyMix(input);
  assert.deepEqual(shift.configured, [14.41, 29.82, 55.77]);
  assert.deepEqual(
    shift.realized.map((v) => Math.round(v * 10) / 10),
    [2.9, 19.9, 77.2]
  );
  // Expert is the worst-hit band: 77.218 − 55.77.
  assert.ok(Math.abs(shift.maxDeviation - 21.448) < 0.001, `maxDeviation was ${shift.maxDeviation}`);

  const warns = generationWarnings(input).filter((w) => w.code === "difficulty_mix_shifted_by_game_rules");
  assert.equal(warns.length, 1);
  assert.equal(warns[0].severity, "warning");
  assert.match(warns[0].message, /from 14\/30\/56 to 3\/20\/77/);
});

test("per-game mix rows shift the season too, not only floors and ceilings", () => {
  const input = okInput();
  // Pin ONE of the seven games to all-expert via an override row set.
  const gid = LIVE7[0].id;
  input.difficultyMix = [
    ...input.difficultyMix,
    { difficulty_band: "foundational", target_pct: 0, applies_to_game_id: gid },
    { difficulty_band: "practitioner", target_pct: 0, applies_to_game_id: gid },
    { difficulty_band: "expert", target_pct: 100, applies_to_game_id: gid },
  ];
  const shift = realizedDifficultyMix(input);
  // Six games at 40/40/20 plus one at 0/0/100, over seven.
  assert.deepEqual(
    shift.realized.map((v) => Math.round(v * 100) / 100),
    [34.29, 34.29, 31.43]
  );
  // 31.43 − 20 = 11.43 points on expert: over the five-point bar.
  assert.ok(generationWarnings(input).some((w) => w.code === "difficulty_mix_shifted_by_game_rules"));
});

test("a slate with no floors, ceilings or overrides never raises the shift warning", () => {
  // okInput() is exactly that: seven open games on one season mix.
  assert.ok(!generationWarnings(okInput()).some((w) => w.code === "difficulty_mix_shifted_by_game_rules"));
  const shift = realizedDifficultyMix(okInput());
  assert.deepEqual(shift.realized, shift.configured);
  assert.equal(shift.maxDeviation, 0);
});

test("a shift inside the five-point bar stays quiet", () => {
  const input = okInput();
  // One of seven games clipped to practitioner–expert: 40/40/20 → 0/66.67/33.33
  // for that game, so the season moves 5.71 / 3.81 / 1.90 points. Over the bar
  // on foundational only...
  input.slate[0] = { ...input.slate[0], difficulty_floor: "practitioner" };
  assert.ok(generationWarnings(input).some((w) => w.code === "difficulty_mix_shifted_by_game_rules"));

  // ...whereas a ceiling that drops nothing moves nothing.
  const quiet = okInput();
  quiet.slate[0] = { ...quiet.slate[0], difficulty_floor: "foundational", difficulty_ceiling: "expert" };
  assert.ok(!generationWarnings(quiet).some((w) => w.code === "difficulty_mix_shifted_by_game_rules"));
});

test("a floor deeper than the ceiling BLOCKS as difficulty_window_empty", () => {
  const input = okInput();
  input.slate[2] = { ...input.slate[2], difficulty_floor: "expert", difficulty_ceiling: "practitioner" };
  const errs = generationFindings(input, false).filter((f) => f.code === "difficulty_window_empty");
  assert.equal(errs.length, 1);
  assert.equal(errs[0].severity, "error");
  assert.match(errs[0].message, /The Stack/);
  assert.match(errs[0].message, /floor of expert above its ceiling of practitioner/);

  // The game it names is the one that is broken, and only that one.
  input.slate[5] = { ...input.slate[5], difficulty_floor: "practitioner", difficulty_ceiling: "foundational" };
  assert.equal(generationFindings(input, false).filter((f) => f.code === "difficulty_window_empty").length, 2);
});

test("an empty window on a DISABLED game is nobody's problem", () => {
  const input = okInput();
  input.slate[2] = {
    ...input.slate[2], is_enabled: false, difficulty_floor: "expert", difficulty_ceiling: "foundational",
  };
  assert.ok(!generationFindings(input, false).some((f) => f.code === "difficulty_window_empty"));
  // ...and it carries no weight in the realized mix either.
  assert.equal(realizedDifficultyMix(input).perGame.length, 6);
});

test("an empty window never also counts as a shift — it is excluded, not zeroed", () => {
  const input = footballInput();
  input.slate[1] = { ...input.slate[1], difficulty_floor: "expert", difficulty_ceiling: "foundational" };
  const shift = realizedDifficultyMix(input);
  assert.equal(shift.perGame.filter((g) => g.mix === null).length, 1);
  // The four survivors are 0/0/100, 0/34.84/65.16, 0/34.84/65.16, 0/0/100.
  assert.deepEqual(
    shift.realized.map((v) => Math.round(v * 100) / 100),
    [0, 17.42, 82.58]
  );
});

test("slate rows with no floor/ceiling fields at all behave as fully open", () => {
  // Older callers (and every test above okInput()) omit the two columns.
  const input = okInput();
  assert.ok(input.slate.every((r) => r.difficulty_floor === undefined));
  assert.deepEqual(generationFindings(input, false), []);
  assert.equal(realizedDifficultyMix(input).maxDeviation, 0);
});

// ── CC-DC-GEN-SCHEDULE-FIELDS-1.0 ────────────────────────────────────────────
//
// play_days_of_week, appears_on_days and the per-game start/end dates were read
// by NOTHING before this pack: targets were `dayCount × enabled games`, so a
// Monday-only game was validated, generated and served seven days a week. The
// tests below are the per-game counts those four columns now produce, plus the
// one rule that is deliberately NOT a selector (games_per_day).
//
// okInput()'s season is 2026-08-03 (a Monday) → 2026-09-04 (a Friday): 33 days,
// of which 25 are weekdays and 5 are Mondays.

test("no schedule fields: every enabled game is scheduled on every season day", () => {
  const input = okInput();
  assert.ok(input.playDaysOfWeek === undefined && input.slate.every((r) => r.appears_on_days === undefined));
  const t = computeTargets(input);
  assert.equal(t.dayCount, 33);
  assert.ok(t.perGame.every((g) => g.effective === 33));
  assert.equal(t.total, 33 * 7);
  assert.deepEqual(generationFindings(input, false), []);
});

test("play_days_of_week narrows every game's target, not just the day label", () => {
  const input = okInput();
  input.playDaysOfWeek = [1, 2, 3, 4, 5];
  const t = computeTargets(input);
  assert.equal(t.dayCount, 33, "the season is still 33 days long");
  assert.ok(t.perGame.every((g) => g.effective === 25), "but only 25 of them are played");
  assert.equal(t.total, 25 * 7);
});

test("appears_on_days narrows ONE game's target", () => {
  const input = okInput();
  input.slate[0] = { ...input.slate[0], appears_on_days: [1] };
  const t = computeTargets(input);
  assert.equal(t.perGame[0].effective, 5, "five Mondays");
  assert.ok(t.perGame.slice(1).every((g) => g.effective === 33));
  assert.equal(t.total, 5 + 33 * 6);
});

test("a per-game window clips that game to part of the season", () => {
  const input = okInput();
  input.slate[0] = { ...input.slate[0], starts_on: "2026-08-10", ends_on: "2026-08-16" };
  assert.equal(computeTargets(input).perGame[0].effective, 7);
});

test("condition 5 measures puzzle_count against SCHEDULED days, not the season", () => {
  // A Monday-only game asking for exactly its five Mondays is correct; the old
  // rule compared 5 against 33 and blocked it.
  const input = okInput();
  input.slate[0] = { ...input.slate[0], appears_on_days: [1], puzzle_count: 5 };
  assert.deepEqual(generationFindings(input, false), []);
  assert.ok(!generationWarnings(input).some((f) => f.code === "surplus_unsupported"));

  input.slate[0] = { ...input.slate[0], puzzle_count: 4 };
  assert.ok(generationFindings(input, false).some((f) => f.code === "puzzle_count_short"));

  input.slate[0] = { ...input.slate[0], puzzle_count: 33 };
  assert.deepEqual(generationFindings(input, false), []);
  assert.ok(generationWarnings(input).some((f) => f.code === "surplus_unsupported"));
});

test("a game the calendar never reaches warns — it never silently disappears", () => {
  const input = okInput();
  input.slate[0] = { ...input.slate[0], starts_on: "2027-01-01", ends_on: "2027-01-31" };
  const w = generationWarnings(input).filter((f) => f.code === "game_never_scheduled");
  assert.equal(w.length, 1);
  assert.match(w[0].message, /Rackl/);
  // A warning, never a blocker: the configuration is legal, just probably wrong.
  assert.deepEqual(generationFindings(input, false), []);
});

test("an empty play-days mask schedules nothing at all", () => {
  const input = okInput();
  input.playDaysOfWeek = [];
  assert.equal(computeTargets(input).total, 0);
  assert.equal(generationWarnings(input).filter((f) => f.code === "game_never_scheduled").length, 7);
});

// ── D2: games_per_day validates, it never selects ───────────────────────────

test("games_per_day below the scheduled count BLOCKS and names the dates", () => {
  const input = okInput();
  input.gamesPerDay = 5; // seven games are scheduled every day
  const f = generationFindings(input, false).filter((c) => c.code === "games_per_day_below_scheduled");
  assert.equal(f.length, 1);
  assert.match(f[0].message, /2026-08-03 \(7\)/);
  assert.match(f[0].message, /33 dates/);
  assert.match(f[0].message, /never drops a game/, "the message must say what will NOT happen");
});

test("games_per_day at or above the busiest day, or unset, is silent", () => {
  const input = okInput();
  input.gamesPerDay = 7;
  assert.deepEqual(generationFindings(input, false), []);
  input.gamesPerDay = null;
  assert.deepEqual(generationFindings(input, false), []);
  delete input.gamesPerDay;
  assert.deepEqual(generationFindings(input, false), []);
});

test("a staggered slate sits under a cap the headcount would bust", () => {
  // Seven games, one weekday each: never more than one game on a day, so
  // games_per_day = 1 is satisfiable even though the slate has seven games.
  const input = okInput();
  input.playDaysOfWeek = [1, 2, 3, 4, 5];
  input.slate = input.slate.map((r, i) => ({ ...r, appears_on_days: [(i % 5) + 1] }));
  input.gamesPerDay = 2;
  assert.deepEqual(generationFindings(input, false), []);
  // Mon and Tue carry two games each, Wed/Thu/Fri one: 5 weeks × (2+2+1+1+1).
  assert.equal(computeTargets(input).total, 35);
});

// ── CC-DC-HINTS-FROM-CONFIG-1.0 D1: the hint budget cannot exceed the bank ──

test("max_hints_per_game above the bank's three tiers BLOCKS the run", () => {
  const input = okInput();
  input.maxHintsPerGame = 4; // Football and HOT SUMMER, SELECTed 2026-10-06
  const f = generationFindings(input, false).filter((c) => c.code === "max_hints_exceeds_bank");
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "error");
  assert.match(f[0].message, /no fourth hint to generate/);
});

test("a servable hint budget, or none supplied, is silent", () => {
  const input = okInput();
  for (const n of [0, 1, 2, 3]) {
    input.maxHintsPerGame = n;
    assert.deepEqual(generationFindings(input, false), [], `${n} is servable`);
  }
  input.maxHintsPerGame = null;
  assert.deepEqual(generationFindings(input, false), []);
  delete input.maxHintsPerGame;
  assert.deepEqual(generationFindings(input, false), []);
});

// ── the difficulty weighting follows the calendar ───────────────────────────

test("a game that plays one day a week pulls the season mix a seventh as hard", () => {
  const input = footballInput();
  const everyDay = realizedDifficultyMix(input);
  // Rackl is pinned expert/expert. Confine it to Mondays and the season's
  // expert share must FALL, because it now carries 5 days of weight, not 33.
  input.slate = input.slate.map((r) =>
    r.difficulty_floor === "expert" && r.difficulty_ceiling === "expert" && r.game_id === input.slate[4].game_id
      ? { ...r, appears_on_days: [1] }
      : r
  );
  const mondayOnly = realizedDifficultyMix(input);
  assert.equal(mondayOnly.perGame[4].days, 5);
  assert.ok(mondayOnly.perGame[0].days === 33, "the other four are untouched");
  assert.ok(
    mondayOnly.realized[2] < everyDay.realized[2],
    `expert should fall from ${everyDay.realized[2]} once Rackl plays five days`
  );
});

// ── the bank-minimum bar follows the calendar too ───────────────────────────

test("bankServeDays counts only the days a game serves inside the window", () => {
  const input = okInput();
  input.playDaysOfWeek = [1, 2, 3, 4, 5];
  input.slate[0] = { ...input.slate[0], appears_on_days: [1] };
  // 2026-08-10 (Mon) → 2026-08-23 (Sun): 14 days, 10 weekdays, 2 Mondays.
  const days = bankServeDays(input, "2026-08-10", "2026-08-23");
  assert.equal(days["Rackl"], 2);
  assert.equal(days["Circuit"], 10);
  assert.deepEqual(bankServeDays(input, null, null), {});
});

test("bank minimum: a per-key bar replaces the window length", () => {
  const keys = ["Rackl", "Circuit"];
  // Rackl serves 2 of these 14 days and has both; Circuit serves 10 and has 9.
  const f = bankMinimumFindings(keys, { Rackl: 2, Circuit: 9 }, 14, { Rackl: 2, Circuit: 10 });
  assert.equal(f.length, 1);
  assert.match(f[0].message, /Circuit has 9 of the 10/);
  // A game that serves no day in the window cannot be short of anything.
  assert.deepEqual(bankMinimumFindings(keys, {}, 14, { Rackl: 0, Circuit: 0 }), []);
  // Unmentioned keys keep the window length.
  assert.equal(bankMinimumFindings(keys, { Rackl: 14 }, 14, { Rackl: 14 }).length, 1);
});
