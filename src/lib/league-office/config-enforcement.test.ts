// CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 — the classification guard.
//   npm run test:config-enforcement
//
// D3: a column the Season Configurator can write but that nothing has
// classified is exactly the failure this pack exists to end, so the guard runs
// in BOTH directions — every writable column is classified, and no entry
// claims a column the editor cannot write.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CONFIG_ENFORCEMENT,
  SLATE_FIELDS,
  SLATE_PREFIX,
  SYSTEM_DEFAULTS,
  classifiableFields,
  enforcementChip,
  enforcementOf,
  notEnforcedFields,
  notEnforcedSlateFields,
  summarizeNotEnforced,
} from "./config-enforcement.ts";
import { CONFIG_FIELDS } from "./season-config-logic.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The mix tables are their own rows, not columns of the two flat tables, so
 *  they are exempt from the column-for-column guard below. */
const PSEUDO_FIELDS = ["season_theme_mix.target_pct", "season_difficulty_mix.target_pct"];

// ── D3: the whitelist and the classification are the same set ───────────────

test("every column the editor's config whitelist writes is classified", () => {
  const missing = CONFIG_FIELDS.filter((f) => !(f in CONFIG_ENFORCEMENT));
  assert.deepEqual(
    missing,
    [],
    `unclassified config column(s) — add an entry to CONFIG_ENFORCEMENT: ${missing.join(", ")}`
  );
});

test("every column the editor's slate whitelist writes is classified", () => {
  const missing = SLATE_FIELDS.filter((f) => !(SLATE_PREFIX + f in CONFIG_ENFORCEMENT));
  assert.deepEqual(
    missing,
    [],
    `unclassified season_games column(s): ${missing.join(", ")}`
  );
});

test("no entry claims a column the editor cannot write", () => {
  const allowed = new Set([...classifiableFields(), ...PSEUDO_FIELDS]);
  const stray = Object.keys(CONFIG_ENFORCEMENT).filter((k) => !allowed.has(k));
  assert.deepEqual(stray, [], `CONFIG_ENFORCEMENT entries with no matching column: ${stray.join(", ")}`);
});

test("SLATE_FIELDS still matches normalizeGameRow in season-write.ts", () => {
  // Read the writer rather than trusting a hand-kept copy: a new season_games
  // column added there must land here, which is the whole point of D3.
  const src = readFileSync(join(HERE, "season-write.ts"), "utf8");
  const start = src.indexOf("function normalizeGameRow");
  assert.ok(start > -1, "normalizeGameRow not found — the slate writer moved; update this guard");
  const body = src.slice(start, src.indexOf("\n}", start));
  const keys = [...body.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
  assert.ok(keys.length > 0, "could not parse the slate write shape");
  const written = keys.filter((k) => k !== "season_config_id" && k !== "game_id");
  assert.deepEqual(
    [...written].sort(),
    [...SLATE_FIELDS].sort(),
    "season_games write shape and SLATE_FIELDS have diverged"
  );
});

test("every entry names a reader, or says plainly that there is none", () => {
  for (const [field, e] of Object.entries(CONFIG_ENFORCEMENT)) {
    assert.ok(["enforced", "partial", "not_enforced"].includes(e.status), `${field}: bad status`);
    assert.ok(e.note.trim().length > 20, `${field}: note is too thin to help anyone`);
    if (e.status === "enforced" || e.status === "partial")
      assert.notEqual(e.by, "—", `${field} claims ${e.status} but names no reader`);
    else assert.equal(e.by, "—", `${field} is not enforced but names a reader`);
  }
});

test("every classifiable column has a system default to compare against", () => {
  const missing = classifiableFields().filter(
    (f) => !(f in SYSTEM_DEFAULTS) && f !== "effective_from"
  );
  assert.deepEqual(missing, [], `no SYSTEM_DEFAULTS entry for: ${missing.join(", ")}`);
});

// ── the chip ────────────────────────────────────────────────────────────────

test("the chip appears only where there is something to warn about", () => {
  assert.equal(enforcementChip("roster_lock_on"), null); // enforced → no chip
  assert.equal(enforcementChip("max_teams_per_subscriber"), "Partly enforced");
  assert.equal(enforcementChip("drop_lowest_n_days"), "Not enforced yet");
  assert.equal(enforcementChip("season_games.points_override"), null);
  assert.equal(enforcementChip("not_a_column"), null);
  assert.equal(enforcementOf("not_a_column"), null);
});

// ── D7: the four fields this pack wired up ──────────────────────────────────

test("the scoring fields wired in this PR read as enforced and name their reader", () => {
  for (const f of ["hint_penalty_pct", "streak_bonus_enabled", "season_games.points_override"]) {
    assert.equal(CONFIG_ENFORCEMENT[f].status, "enforced", f);
    assert.match(CONFIG_ENFORCEMENT[f].by, /season-scoring|DailyChallenge/, f);
  }
  // …and the ones D7 deliberately left alone did NOT drift.
  for (const f of [
    "drop_lowest_n_days", "team_score_method", "team_score_top_n", "signals_per_correct",
    "scoring_profile", "publish_leaderboard", "leaderboard_visibility", "publish_standings_at",
  ])
    assert.equal(CONFIG_ENFORCEMENT[f].status, "not_enforced", f);
});

// ── notEnforcedFields on the real Football config ───────────────────────────

/** season_config 3bf84bc8-f202-4a2d-9a89-9dcc38f36711, state=active,
 *  SELECTed from ycadmmngkdhvpcsrcuaq at 2026-10-06 17:4x CT. */
const FOOTBALL = {
  label: "Initial configuration",
  notes: null,
  extras: {},
  effective_from: "2026-10-05T12:43:26.742+00:00",
  effective_to: null,
  games_per_day: null,
  hints_enabled: true,
  max_team_size: null,
  min_team_size: 1,
  roster_lock_on: "2026-12-01",
  allow_late_join: true,
  scoring_profile: "standard",
  difficulty_curve: "ramp",
  hint_penalty_pct: 10,
  team_score_top_n: null,
  allow_free_agency: true,
  play_days_of_week: [1, 2, 3, 4, 5, 6, 7],
  team_score_method: "sum",
  drop_lowest_n_days: 0,
  max_hints_per_game: 4,
  publish_leaderboard: true,
  signals_per_correct: 1,
  publish_standings_at: null,
  streak_bonus_enabled: true,
  registration_opens_on: "2026-10-05",
  target_solve_rate_pct: 80,
  leaderboard_visibility: "public",
  registration_closes_on: "2026-11-30",
  max_teams_per_subscriber: 3,
  late_submission_grace_hours: 0,
  allow_mid_season_team_switch: true,
};

test("Football: exactly the three settings it set that do nothing", () => {
  const found = notEnforcedFields(FOOTBALL).map((f) => f.field).sort();
  assert.deepEqual(found, ["max_hints_per_game", "registration_opens_on", "target_solve_rate_pct"]);
  assert.equal(
    summarizeNotEnforced(notEnforcedFields(FOOTBALL)),
    "3 settings in this config are saved but not yet enforced"
  );
});

test("Football: the fields it set that ARE rules stay off the list", () => {
  const found = new Set(notEnforcedFields(FOOTBALL).map((f) => f.field));
  for (const f of ["difficulty_curve", "hint_penalty_pct", "roster_lock_on", "registration_closes_on"])
    assert.ok(!found.has(f), `${f} is enforced and must not be listed`);
  // partial is not "not enforced" — the cap gets a chip, not a line in the count.
  assert.ok(!found.has("max_teams_per_subscriber"));
});

test("a config sitting entirely on its defaults nags about nothing", () => {
  const defaults: Record<string, unknown> = {};
  for (const f of CONFIG_FIELDS) if (f in SYSTEM_DEFAULTS) defaults[f] = SYSTEM_DEFAULTS[f];
  assert.deepEqual(notEnforcedFields(defaults), []);
  assert.equal(summarizeNotEnforced([]), "");
  // Numerics come back from PostgREST as strings; "25.00" is still the default.
  assert.deepEqual(notEnforcedFields({ ...defaults, max_hints_per_game: "3" }), []);
  // …and a re-ordered day mask is a different mask, so it is NOT the default.
  assert.equal(notEnforcedFields({ ...defaults, drop_lowest_n_days: 2 }).length, 1);
});

test("label and notes never count, however filled in", () => {
  assert.deepEqual(notEnforcedFields({ label: "Week 3 rules", notes: "ask Myke" }), []);
});

test("a slate row answers the same question under its own namespace", () => {
  // Football's Rackl row: a 500 ceiling (now enforced) and nothing else set.
  assert.deepEqual(notEnforcedSlateFields({ is_enabled: true, points_override: 500, weight: 1, sort_order: 100 }), []);
  const weighted = notEnforcedSlateFields({ weight: 2.5, sort_order: 10 }).map((f) => f.field);
  assert.deepEqual(weighted.sort(), ["season_games.sort_order", "season_games.weight"]);
  // The label drops the namespace so the UI can print it.
  assert.equal(notEnforcedSlateFields({ weight: 2.5 })[0].label, "Weight");
});

test("notEnforcedFields is total — null, empty and unknown keys are all fine", () => {
  assert.deepEqual(notEnforcedFields(null), []);
  assert.deepEqual(notEnforcedFields(undefined), []);
  assert.deepEqual(notEnforcedFields({}), []);
  assert.deepEqual(notEnforcedFields({ some_future_column: 7 }), []);
  assert.deepEqual(notEnforcedSlateFields(null), []);
});
