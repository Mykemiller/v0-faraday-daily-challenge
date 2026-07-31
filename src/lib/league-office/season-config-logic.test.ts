// Tests for the Season Config pure logic. `npm run test:season-config`.

import test from "node:test";
import assert from "node:assert/strict";

import {
  editability, slugify, round2, sumPct, isHundred, normalizeTo100, evenSplit,
  defaultDifficultyMix, defaultThemeMix, normalizeDayMask, dayMaskLabel,
  windowSummary, validateWindow, curvePoints, canonicalJson, fingerprint,
  configFingerprint, sanitizeConfigPatch, localFindings, summarizeFindings,
  diffConfigs, promoteIntent, countOverCap, THEATERS,
  derivedFreeAgency, findOverlappingSeason,
} from "./season-config-logic.ts";

// ── editability ──────────────────────────────────────────────────────────────
test("draft and scheduled are editable; everything else is not", () => {
  assert.equal(editability("draft").editable, true);
  assert.equal(editability("scheduled").editable, true);
  assert.equal(editability("active").editable, false);
  assert.equal(editability("superseded").editable, false);
  assert.equal(editability("cancelled").editable, false);
  assert.equal(editability(undefined).editable, false);
  // The active copy must point at the clone path — it is the only way through.
  assert.match(editability("active").reason ?? "", /Clone/);
});

// ── slugify ──────────────────────────────────────────────────────────────────
test("slugify produces the live slug shape", () => {
  assert.equal(slugify("Season 3 — Post-CES / Pre-GTC"), "season-3-post-ces-pre-gtc");
  assert.equal(slugify("  Hello   World  "), "hello-world");
  assert.equal(slugify("!!!"), "");
  assert.equal(slugify("a".repeat(200)).length, 64);
});

// ── percentages ──────────────────────────────────────────────────────────────
test("round2 and sumPct avoid float drift", () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(sumPct([0.1, 0.2]), 0.3);
  assert.equal(sumPct([33.33, 33.33, 33.34]), 100);
  assert.equal(sumPct([null, undefined, 5]), 5);
});

test("isHundred tolerates 2dp representation", () => {
  assert.equal(isHundred(100), true);
  assert.equal(isHundred(99.999999), true);
  assert.equal(isHundred(99.99), false);
  assert.equal(isHundred(0), false);
});

test("evenSplit always sums to exactly 100", () => {
  for (const n of [1, 2, 3, 6, 7, 9, 11, 13]) {
    const parts = evenSplit(n);
    assert.equal(parts.length, n);
    assert.equal(sumPct(parts), 100, `n=${n} summed to ${sumPct(parts)}`);
  }
  assert.deepEqual(evenSplit(0), []);
});

test("normalizeTo100 rescales proportionally and lands on exactly 100", () => {
  const out = normalizeTo100([10, 20, 20]);
  assert.equal(sumPct(out), 100);
  // proportions preserved: the two 20s stay equal and double the 10.
  assert.equal(out[1], out[2]);
  assert.ok(Math.abs(out[1] - out[0] * 2) < 0.02);

  // already-100 input is left alone
  assert.deepEqual(normalizeTo100([30, 50, 20]), [30, 50, 20]);
  // an awkward set still lands exactly
  assert.equal(sumPct(normalizeTo100([1, 1, 1, 1, 1, 1, 1])), 100);
  // all-zero degrades to an even split rather than dividing by zero
  assert.equal(sumPct(normalizeTo100([0, 0, 0])), 100);
  assert.deepEqual(normalizeTo100([]), []);
});

test("the shipped defaults are valid 100% sets", () => {
  assert.equal(sumPct(defaultDifficultyMix().map((r) => r.target_pct)), 100);
  assert.equal(sumPct(defaultThemeMix().map((r) => r.target_pct)), 100);
  assert.equal(defaultThemeMix().length, THEATERS.length);
});

// ── day masks ────────────────────────────────────────────────────────────────
test("normalizeDayMask filters junk, dedupes and sorts", () => {
  assert.deepEqual(normalizeDayMask([3, 1, 1, 9, 0, "2"]), [1, 2, 3]);
  assert.deepEqual(normalizeDayMask(null), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(normalizeDayMask([]), []);
});

test("dayMaskLabel names the common masks", () => {
  assert.equal(dayMaskLabel([1, 2, 3, 4, 5, 6, 7]), "Every day");
  assert.equal(dayMaskLabel([1, 2, 3, 4, 5]), "Weekdays");
  assert.equal(dayMaskLabel([6, 7]), "Weekends");
  assert.equal(dayMaskLabel([1, 3]), "Mon · Wed");
  assert.equal(dayMaskLabel([]), "Never");
});

// ── window ───────────────────────────────────────────────────────────────────
test("windowSummary counts inclusive days and play days", () => {
  // 2026-07-11 (Sat) → 2026-07-17 (Fri) = 7 days
  const all = windowSummary("2026-07-11", "2026-07-17");
  assert.deepEqual(all, { days: 7, playDays: 7 });

  // weekdays only over that same week = 5
  const weekdays = windowSummary("2026-07-11", "2026-07-17", [1, 2, 3, 4, 5]);
  assert.equal(weekdays?.playDays, 5);

  assert.deepEqual(windowSummary("2026-07-11", "2026-07-11"), { days: 1, playDays: 1 });
  assert.equal(windowSummary("2026-07-17", "2026-07-11"), null); // reversed
  assert.equal(windowSummary("", "2026-07-11"), null);
});

test("validateWindow enforces ordering and containment", () => {
  assert.deepEqual(validateWindow({ starts_on: "2027-01-07", ends_on: "2027-03-14" }), []);

  assert.ok(validateWindow({ starts_on: "2027-03-14", ends_on: "2027-01-07" })
    .some((e) => /end date must be after/i.test(e)));

  assert.ok(validateWindow({
    starts_on: "2027-01-07", ends_on: "2027-03-14", free_agency_start: "2027-06-01",
  }).some((e) => /outside the season window/i.test(e)));

  // notice must not come after free agency opens
  assert.ok(validateWindow({
    starts_on: "2027-01-07", ends_on: "2027-03-14",
    free_agency_start: "2027-02-01", free_agency_notice_start: "2027-02-10",
  }).some((e) => /notice must come on or before/i.test(e)));

  assert.ok(validateWindow({}).length >= 2); // both dates required
});

// ── generated free-agency dates ──────────────────────────────────────────────
test("derivedFreeAgency mirrors the GENERATED ALWAYS columns (ends_on −3 / −7)", () => {
  // matches the live rows: Season 1 ends 2026-07-10 → FA 07-07, notice 07-03
  assert.deepEqual(derivedFreeAgency("2026-07-10"), { start: "2026-07-07", notice: "2026-07-03" });
  // Season 2 ends 2027-01-06 → 2027-01-03 / 2026-12-30 (crosses a year boundary)
  assert.deepEqual(derivedFreeAgency("2027-01-06"), { start: "2027-01-03", notice: "2026-12-30" });
  // crosses a month boundary
  assert.deepEqual(derivedFreeAgency("2026-09-04"), { start: "2026-09-01", notice: "2026-08-28" });

  assert.deepEqual(derivedFreeAgency(null), { start: null, notice: null });
  assert.deepEqual(derivedFreeAgency(""), { start: null, notice: null });
  assert.deepEqual(derivedFreeAgency("nonsense"), { start: null, notice: null });
});

// ── seasons_no_overlap ───────────────────────────────────────────────────────
const LIVE_SEASONS = [
  { id: "s1", name: "Season 1", starts_on: "2026-06-13", ends_on: "2026-07-10" },
  { id: "s2", name: "Season 2", starts_on: "2026-07-11", ends_on: "2027-01-06" },
  { id: "s3", name: "Season 3", starts_on: "2027-01-07", ends_on: "2027-03-14" },
];

test("findOverlappingSeason enforces the inclusive daterange EXCLUDE rule", () => {
  // the exact window from the failing screenshot — sits inside Season 2
  assert.equal(findOverlappingSeason("2026-08-03", "2026-09-04", LIVE_SEASONS)?.name, "Season 2");

  // touching an endpoint counts: the constraint uses '[]' (inclusive both ends)
  assert.equal(findOverlappingSeason("2027-03-14", "2027-04-01", LIVE_SEASONS)?.name, "Season 3");
  assert.equal(findOverlappingSeason("2026-05-01", "2026-06-13", LIVE_SEASONS)?.name, "Season 1");

  // fully containing an existing season also overlaps
  assert.equal(findOverlappingSeason("2026-01-01", "2028-01-01", LIVE_SEASONS)?.name, "Season 1");

  // genuinely free windows
  assert.equal(findOverlappingSeason("2027-03-15", "2027-05-17", LIVE_SEASONS), null);
  assert.equal(findOverlappingSeason("2026-01-01", "2026-06-12", LIVE_SEASONS), null);

  // editing a season must not collide with itself
  assert.equal(findOverlappingSeason("2026-07-11", "2027-01-06", LIVE_SEASONS, "s2"), null);

  // incomplete input is not an overlap claim
  assert.equal(findOverlappingSeason(null, "2026-09-04", LIVE_SEASONS), null);
  assert.equal(findOverlappingSeason("2026-08-03", "2026-09-04", []), null);
});

// ── curve preview ────────────────────────────────────────────────────────────
test("curvePoints stays in range and matches the named shape", () => {
  const ramp = curvePoints("ramp", 5);
  assert.deepEqual(ramp, [0, 0.25, 0.5, 0.75, 1]);
  assert.ok(curvePoints("flat", 5).every((v) => v === 0.5));
  assert.ok(curvePoints("wave", 40).every((v) => v >= 0 && v <= 1));
  assert.equal(curvePoints("anything", 3).length, 3);
});

// ── fingerprint ──────────────────────────────────────────────────────────────
test("canonicalJson is key-order independent", () => {
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
  assert.equal(canonicalJson([1, { z: 1, a: 2 }]), '[1,{"a":2,"z":1}]');
  assert.equal(canonicalJson(null), "null");
});

test("fingerprint is stable, and changes when any child changes", () => {
  const base = {
    config: { label: "v1", max_teams_per_subscriber: 1 },
    games: [{ game_id: "g1", is_enabled: true, weight: 1 }],
    themeMix: [{ theater_id: "T-001", target_pct: 50 }],
    difficultyMix: [{ difficulty_band: "expert", target_pct: 20 }],
  };
  const a = configFingerprint(base);
  assert.equal(a, configFingerprint(base), "same input → same hash");

  // PostgREST row order must not matter
  const reordered = {
    ...base,
    games: [
      { game_id: "g2", is_enabled: true, weight: 1 },
      { game_id: "g1", is_enabled: true, weight: 1 },
    ],
  };
  const flipped = { ...reordered, games: reordered.games.slice().reverse() };
  assert.equal(configFingerprint(reordered), configFingerprint(flipped), "row order must not shift the hash");

  // a real change in each child must move the hash — this is the whole point:
  // a plain updated_at guard on season_config would MISS all three of these.
  assert.notEqual(a, configFingerprint({ ...base, config: { ...base.config, label: "v2" } }));
  assert.notEqual(a, configFingerprint({ ...base, games: [{ game_id: "g1", is_enabled: false, weight: 1 }] }));
  assert.notEqual(a, configFingerprint({ ...base, themeMix: [{ theater_id: "T-001", target_pct: 51 }] }));
  assert.notEqual(a, configFingerprint({ ...base, difficultyMix: [{ difficulty_band: "expert", target_pct: 21 }] }));

  assert.match(fingerprint("x"), /^[0-9a-f]{8}$/);
});

// ── patch sanitation ─────────────────────────────────────────────────────────
test("sanitizeConfigPatch whitelists, coerces, and never lets a client set state", () => {
  const out = sanitizeConfigPatch({
    label: "Spring rules",
    max_teams_per_subscriber: "5",
    hint_penalty_pct: "12.345",
    hints_enabled: "true",
    allow_late_join: false,
    play_days_of_week: [7, 1, 1, 99],
    // none of these may survive — they are DB/RPC-owned or unknown
    state: "active",
    version: 99,
    season_id: "nope",
    id: "nope",
    bogus_column: 1,
  });

  assert.equal(out.label, "Spring rules");
  assert.equal(out.max_teams_per_subscriber, 5, "numeric strings coerce to int");
  assert.equal(out.hint_penalty_pct, 12.35, "numerics round to 2dp");
  assert.equal(out.hints_enabled, true);
  assert.equal(out.allow_late_join, false);
  assert.deepEqual(out.play_days_of_week, [1, 7]);

  for (const forbidden of ["state", "version", "season_id", "id", "bogus_column"])
    assert.equal(forbidden in out, false, `${forbidden} must be dropped`);
});

test("sanitizeConfigPatch guards enums and NOT NULL columns", () => {
  const bad = sanitizeConfigPatch({
    difficulty_curve: "spiral",
    team_score_method: "median",
    leaderboard_visibility: "secret",
  });
  assert.deepEqual(bad, {}, "invalid enum values are dropped, not written");

  const good = sanitizeConfigPatch({ difficulty_curve: "wave", team_score_method: "top_n" });
  assert.equal(good.difficulty_curve, "wave");
  assert.equal(good.team_score_method, "top_n");

  // an emptied form field must not null a NOT NULL column
  const emptied = sanitizeConfigPatch({ max_teams_per_subscriber: "", hint_penalty_pct: "" });
  assert.equal(emptied.max_teams_per_subscriber, 1);
  assert.equal(emptied.hint_penalty_pct, 25);

  // a nullable one may genuinely clear
  assert.equal(sanitizeConfigPatch({ team_score_top_n: "" }).team_score_top_n, null);
});

// ── findings ─────────────────────────────────────────────────────────────────
const okInput = {
  games: [{ is_enabled: true }, { is_enabled: true }],
  themeMix: [{ target_pct: 100 }],
  difficultyMix: [{ target_pct: 100 }],
  gamesPerDay: 2,
  teamScoreMethod: "sum",
  teamScoreTopN: null,
};

test("localFindings mirrors the DB validator's rules", () => {
  assert.deepEqual(localFindings(okInput), []);

  const noGames = localFindings({ ...okInput, games: [{ is_enabled: false }], gamesPerDay: null });
  assert.ok(noGames.some((f) => f.code === "no_games_enabled" && f.severity === "error"));

  const tooMany = localFindings({ ...okInput, gamesPerDay: 5 });
  assert.ok(tooMany.some((f) => f.code === "games_per_day_exceeds_slate" && f.severity === "error"));

  const topN = localFindings({ ...okInput, teamScoreMethod: "top_n", teamScoreTopN: null });
  assert.ok(topN.some((f) => f.code === "top_n_missing" && f.severity === "error"));

  // mixes off 100 are WARNINGS — they must never block promotion
  const offMix = localFindings({ ...okInput, themeMix: [{ target_pct: 90 }], difficultyMix: [{ target_pct: 80 }] });
  assert.equal(offMix.filter((f) => f.severity === "error").length, 0);
  assert.ok(offMix.some((f) => f.code === "theme_mix_not_100"));
  assert.ok(offMix.some((f) => f.code === "difficulty_mix_not_100"));
});

test("excluded theme rows and per-game difficulty rows are outside the 100% total", () => {
  const f = localFindings({
    ...okInput,
    themeMix: [{ target_pct: 100 }, { target_pct: 40, is_excluded: true }],
    difficultyMix: [{ target_pct: 100 }, { target_pct: 40, applies_to_game_id: "g1" }],
  });
  assert.deepEqual(f, [], "excluded/per-game rows must not break the base total");
});

test("summarizeFindings reads like the footer bar", () => {
  assert.equal(summarizeFindings([]), "0 warnings · 0 errors");
  assert.equal(
    summarizeFindings([
      { severity: "warning", code: "a", message: "" },
      { severity: "error", code: "b", message: "" },
    ]),
    "1 warning · 1 error"
  );
});

// ── diff ─────────────────────────────────────────────────────────────────────
test("diffConfigs returns changed fields only", () => {
  const before = { label: "v1", max_teams_per_subscriber: 1, hints_enabled: true };
  const after = { label: "v2", max_teams_per_subscriber: 1, hints_enabled: false };
  const rows = diffConfigs(before, after);

  assert.deepEqual(rows.map((r) => r.field).sort(), ["hints_enabled", "label"]);
  assert.deepEqual(rows.find((r) => r.field === "label"), { field: "label", before: "v1", after: "v2" });
  assert.deepEqual(diffConfigs(before, before), []);

  // no incumbent (the first version) → everything set is a change
  assert.ok(diffConfigs(null, after).length > 0);
  assert.deepEqual(diffConfigs(before, null), []);
});

// ── promote intent ───────────────────────────────────────────────────────────
test("promoteIntent mirrors the RPC's now() comparison", () => {
  const now = new Date("2026-07-30T12:00:00Z");
  const future = promoteIntent("2027-01-07T00:00:00Z", now);
  assert.deepEqual(future, { action: "schedule", label: "Schedule", resultingState: "scheduled" });

  const past = promoteIntent("2026-01-01T00:00:00Z", now);
  assert.equal(past.resultingState, "active");
  assert.equal(past.label, "Promote now");

  assert.equal(promoteIntent(null, now).resultingState, "active");
});

// ── max_teams guardrail ──────────────────────────────────────────────────────
test("countOverCap counts subscribers over a proposed cap without touching rows", () => {
  const memberships = [
    { subscriber_id: "a" }, { subscriber_id: "a" }, { subscriber_id: "a" },
    { subscriber_id: "b" }, { subscriber_id: "b" },
    { subscriber_id: "c" },
  ];
  assert.deepEqual(countOverCap(memberships, 1), { over: 2, worst: 3 });
  assert.deepEqual(countOverCap(memberships, 2), { over: 1, worst: 3 });
  assert.deepEqual(countOverCap(memberships, 3), { over: 0, worst: 3 });
  assert.deepEqual(countOverCap([], 1), { over: 0, worst: 0 });
});
