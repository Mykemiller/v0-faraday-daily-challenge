// CC-LO-REGENERATE-FROM-DATE-1.0 — the rules that stand between a commissioner
// and 570 deleted approved puzzles.
//
// Run: npm run test:regenerate
//
// Everything asserted here is PURE. The server action in generation-write.ts
// adds only archive → verify → delete mechanics on top of these answers, so a
// rule that is wrong here is wrong in production and a rule that is right here
// cannot be bypassed by the UI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  // F1 — the archive check is identity, not cardinality. It is a pure function
  // and it lives with the other pure rules, so it is tested like one.
  missingFromArchive,
  MIN_CUTOFF_LEAD_DAYS,
  REMOVABLE_STATES,
  UNTOUCHABLE_STATES,
  addDays,
  ctMidnightMs,
  hoursUntil,
  isoDateOrNull,
  projectedAllocation,
  regenerationPlan,
  restorePlan,
  type RegenBankRow,
} from "./regenerate-logic.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const TODAY = "2026-10-06";
const SEASON = {
  id: "02701ead-a03e-4489-adb9-24d3c6787eec",
  name: "Football Season",
  starts_on: "2026-10-05",
  ends_on: "2027-01-31",
  locked_at: null as string | null,
};

const codes = (p: { blocks: { code: string }[] }) => p.blocks.map((b) => b.code);

/** n Published rows on consecutive dates from `from`, one game. */
function published(from: string, n: number, type = "the_stack"): RegenBankRow[] {
  return Array.from({ length: n }, (_, i) => ({
    puzzle_type: type,
    go_live_date: addDays(from, i),
    published: "Published",
  }));
}

const plan = (over: Partial<Parameters<typeof regenerationPlan>[0]> = {}) =>
  regenerationPlan({
    today: TODAY,
    now: "2026-10-06T21:00:00Z",
    cutoff: "2026-10-10",
    reason: "config changed",
    season: SEASON,
    rows: published("2026-10-10", 5),
    themeRows: [{ theme_date: "2026-10-10" }, { theme_date: "2026-10-11" }],
    runs: [{ id: "r1", status: "complete", completed_at: "2026-10-05T00:00:00Z", superseded_at: null }],
    // F4 — the fixture states that the runs read SUCCEEDED. Every happy-path
    // assertion below therefore proves the gate passes for the right reason.
    runsRead: true,
    ...over,
  });

// ── date helpers ─────────────────────────────────────────────────────────────

test("isoDateOrNull rejects nonsense dates, not just nonsense strings", () => {
  assert.equal(isoDateOrNull("2026-10-10"), "2026-10-10");
  assert.equal(isoDateOrNull("2026-02-30"), null);
  assert.equal(isoDateOrNull("2026-13-01"), null);
  assert.equal(isoDateOrNull("tomorrow"), null);
  assert.equal(isoDateOrNull(null), null);
  assert.equal(isoDateOrNull(20261010), null);
});

test("ctMidnightMs lands on 00:00 America/Chicago on both sides of the DST change", () => {
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(ms));
  // CDT (UTC-5) in October, CST (UTC-6) in January — the offset must come from
  // the answer, not from the UTC guess.
  assert.equal(fmt(ctMidnightMs("2026-10-10") as number), "00:00");
  assert.equal(fmt(ctMidnightMs("2027-01-15") as number), "00:00");
  assert.equal(ctMidnightMs("2026-10-10"), Date.parse("2026-10-10T05:00:00Z"));
  assert.equal(ctMidnightMs("2027-01-15"), Date.parse("2027-01-15T06:00:00Z"));
});

test("hoursUntil measures to CT midnight on the cutoff", () => {
  // 2026-10-06 21:00Z is 16:00 CDT; CT midnight on the 10th is 2026-10-10T05:00Z.
  assert.equal(hoursUntil("2026-10-06T21:00:00Z", "2026-10-10"), 80);
  assert.equal(hoursUntil("2026-10-09T05:00:00Z", "2026-10-10"), 24);
  assert.equal(hoursUntil("2026-10-06T21:00:00Z", "not-a-date"), null);
});

// ── D2: the gates ────────────────────────────────────────────────────────────

test("today+1 is refused and today+2 is accepted", () => {
  const tooSoon = plan({ cutoff: addDays(TODAY, 1), rows: published(addDays(TODAY, 1), 3) });
  assert.equal(tooSoon.ok, false);
  assert.ok(codes(tooSoon).includes("cutoff_too_soon"));
  assert.match(tooSoon.blocks[0].message, /2026-10-08/);

  const justFar = plan({ cutoff: addDays(TODAY, MIN_CUTOFF_LEAD_DAYS), rows: published(addDays(TODAY, 2), 3) });
  assert.equal(justFar.ok, true, JSON.stringify(justFar.blocks));
  assert.equal(justFar.earliestCutoff, "2026-10-08");
});

test("a Live or Retired row anywhere in the range blocks the whole operation", () => {
  for (const state of UNTOUCHABLE_STATES) {
    const p = plan({
      rows: [...published("2026-10-10", 4), { puzzle_type: "rackl", go_live_date: "2026-11-02", published: state }],
    });
    assert.equal(p.ok, false, `${state} must block`);
    assert.ok(codes(p).includes("live_rows_in_range"));
    assert.equal(p.untouchable, 1);
    // ...and the removable set still excludes it, so a caller that ignored the
    // block could not delete it either.
    assert.equal(p.removable, 4);
  }
});

test("Live and Retired are not removable states, Published and Unpublished are", () => {
  assert.deepEqual([...REMOVABLE_STATES], ["Published", "Unpublished"]);
  assert.deepEqual([...UNTOUCHABLE_STATES], ["Live", "Retired"]);
  const p = plan({
    rows: [
      { puzzle_type: "a", go_live_date: "2026-10-10", published: "Published" },
      { puzzle_type: "b", go_live_date: "2026-10-10", published: "Unpublished" },
    ],
  });
  assert.equal(p.ok, true);
  assert.equal(p.removable, 2);
  assert.deepEqual(p.byPublished, { Published: 1, Unpublished: 1 });
});

test("an in-flight run blocks it", () => {
  const p = plan({
    runs: [{ id: "r2", status: "running", completed_at: null, superseded_at: null }],
  });
  assert.equal(p.ok, false);
  assert.ok(codes(p).includes("run_in_flight"));
});

test("a superseded or completed run does not", () => {
  const p = plan({
    runs: [
      { id: "old", status: "running", completed_at: null, superseded_at: "2026-10-05T00:00:00Z" },
      { id: "done", status: "complete", completed_at: "2026-10-05T01:00:00Z", superseded_at: null },
    ],
  });
  assert.equal(p.ok, true, JSON.stringify(p.blocks));
});

test("a locked season blocks it, and says to unlock", () => {
  const p = plan({ season: { ...SEASON, locked_at: "2026-10-05T00:00:00Z" } });
  assert.equal(p.ok, false);
  assert.ok(codes(p).includes("season_locked"));
  assert.match(p.blocks.find((b) => b.code === "season_locked")!.message, /unlock/i);
});

test("a reason is required even when every other gate passes", () => {
  assert.ok(codes(plan({ reason: "   " })).includes("reason_required"));
  assert.ok(codes(plan({ reason: null })).includes("reason_required"));
});

test("the cutoff has to be inside the season window", () => {
  assert.ok(codes(plan({ cutoff: "2027-03-01", rows: [] })).includes("cutoff_after_season"));
  // Before the season start is caught too — but today+2 catches it first here,
  // so use a season that starts later than that.
  const later = { ...SEASON, starts_on: "2026-12-01", ends_on: "2027-03-31" };
  assert.ok(codes(plan({ season: later, cutoff: "2026-11-15", rows: [] })).includes("cutoff_before_season"));
});

test("a cutoff that would remove nothing is refused rather than silently succeeding", () => {
  const p = plan({ rows: [], themeRows: [] });
  assert.equal(p.ok, false);
  assert.deepEqual(codes(p), ["nothing_to_regenerate"]);
});

// ── F3: an already-emptied range is a DIFFERENT fault with a different cure ──

test("puzzles gone but theme days left reads as range_already_emptied, not nothing_to_regenerate", () => {
  // The state a partial delete leaves behind: the children were removed, the
  // parents were not. Re-running this action cannot fix it — the range holds
  // nothing removable — so the block has to name the step that does.
  const p = plan({ rows: [], themeRows: [{ theme_date: "2026-10-10" }, { theme_date: "2026-10-11" }] });
  assert.equal(p.ok, false);
  assert.deepEqual(codes(p), ["range_already_emptied"]);
  const m = p.blocks[0].message;
  assert.match(m, /already been emptied/i);
  assert.match(m, /Generate puzzles/, "the message must name the recovery that actually works");
  assert.doesNotMatch(m, /[Rr]e-run/, "re-running regenerate_from is exactly what will NOT work");
});

test("an already-emptied range is never reported when something IS removable", () => {
  const p = plan({ rows: published("2026-10-10", 2), themeRows: [{ theme_date: "2026-10-10" }] });
  assert.equal(p.ok, true, JSON.stringify(p.blocks));
  assert.ok(!codes(p).includes("range_already_emptied"));
});

// ── F4: a failed runs read must not read as "nothing in flight" ──────────────

test("an unreadable runs query BLOCKS — a failed read is not a quiet season", () => {
  // q() returns [] on any failure, so [] alone is ambiguous. Only
  // runsRead === true resolves it in the permissive direction.
  const failed = plan({ runs: [], runsRead: false });
  assert.equal(failed.ok, false);
  assert.ok(codes(failed).includes("runs_unreadable"));
  assert.match(failed.blocks.find((b) => b.code === "runs_unreadable")!.message, /Nothing was changed/);
});

test("a caller that omits runsRead gets the blocking answer, not the permissive one", () => {
  const omitted = regenerationPlan({
    today: TODAY, now: "2026-10-06T21:00:00Z", cutoff: "2026-10-10", reason: "x",
    season: SEASON, rows: published("2026-10-10", 3), themeRows: [], runs: [],
  });
  assert.equal(omitted.ok, false);
  assert.ok(codes(omitted).includes("runs_unreadable"));
});

test("a successful read that genuinely found no runs passes", () => {
  const empty = plan({ runs: [], runsRead: true });
  assert.equal(empty.ok, true, JSON.stringify(empty.blocks));
});

test("runs_unreadable never fires when rows came back, whatever the flag says", () => {
  // A non-empty list is self-evidently a successful read.
  const p = plan({ runs: [{ id: "r", status: "complete", completed_at: "2026-10-05T00:00:00Z", superseded_at: null }], runsRead: false });
  assert.ok(!codes(p).includes("runs_unreadable"));
  assert.equal(p.ok, true, JSON.stringify(p.blocks));
});

test("a missing season is a block, not a throw", () => {
  const p = plan({ season: null, rows: [] });
  assert.equal(p.ok, false);
  assert.ok(codes(p).includes("season_missing"));
});

// ── D2: the happy path counts ────────────────────────────────────────────────

test("happy path reports the counts the confirm step has to show", () => {
  const rows: RegenBankRow[] = [
    ...published("2026-10-10", 3, "the_stack"),
    ...published("2026-10-10", 3, "rackl"),
    { puzzle_type: "the_brief", go_live_date: "2026-10-11", published: "Unpublished" },
  ];
  const p = plan({ rows, themeRows: [{ theme_date: "2026-10-10" }, { theme_date: "2026-10-11" }, { theme_date: "2026-10-12" }] });
  assert.equal(p.ok, true, JSON.stringify(p.blocks));
  assert.equal(p.removable, 7);
  assert.equal(p.untouchable, 0);
  assert.deepEqual(p.byPublished, { Published: 6, Unpublished: 1 });
  assert.equal(p.themeRows, 3);
  assert.deepEqual(p.dates, ["2026-10-10", "2026-10-11", "2026-10-12"]);
  assert.deepEqual(p.perType, [
    { puzzle_type: "rackl", count: 3 },
    { puzzle_type: "the_brief", count: 1 },
    { puzzle_type: "the_stack", count: 3 },
  ]);
  assert.equal(p.cutoffDate, "2026-10-10");
  assert.equal(p.hoursUntilCutoff, 80);
});

test("every gate is reported at once — the commissioner fixes one round trip, not four", () => {
  const p = plan({
    reason: "",
    cutoff: addDays(TODAY, 1),
    season: { ...SEASON, locked_at: "2026-10-01T00:00:00Z" },
    runs: [{ id: "r", status: "running", completed_at: null, superseded_at: null }],
  });
  const got = codes(p);
  for (const c of ["reason_required", "cutoff_too_soon", "season_locked", "run_in_flight"])
    assert.ok(got.includes(c), `missing ${c} in ${got.join(",")}`);
});

// ── the projection ───────────────────────────────────────────────────────────

test("projectedAllocation splits the range by theater share and the bands by game window", () => {
  const p = projectedAllocation({
    cutoff: "2026-10-10",
    season: { starts_on: "2026-10-05", ends_on: "2026-10-19" }, // 10 days in range
    config: { play_days_of_week: null },
    themeMix: [
      { theater_id: "T1", sector_code: null, thread_code: null, target_pct: 60, is_excluded: false },
      { theater_id: "T2", sector_code: null, thread_code: null, target_pct: 40, is_excluded: false },
    ],
    seasonMix: [
      { difficulty_band: "foundational", target_pct: 20 },
      { difficulty_band: "practitioner", target_pct: 30 },
      { difficulty_band: "expert", target_pct: 50 },
    ],
    games: [
      { runtime_key: "the_stack", display_name: "The Stack", is_enabled: true },
      // expert-only window: CC-DC-GEN-DIFFICULTY-PERGAME-1.0 P3.
      { runtime_key: "rackl", display_name: "Rackl", is_enabled: true, difficulty_floor: "expert", difficulty_ceiling: "expert" },
      // a floor deeper than its ceiling admits no band at all (P4).
      { runtime_key: "broken", display_name: "Broken", is_enabled: true, difficulty_floor: "expert", difficulty_ceiling: "foundational" },
      { runtime_key: "off", display_name: "Off", is_enabled: false },
    ],
  });
  assert.equal(p.dayCount, 10);
  assert.deepEqual(p.theaters, [
    { theater_id: "T1", target_pct: 60, days: 6 },
    { theater_id: "T2", target_pct: 40, days: 4 },
  ]);
  assert.deepEqual(p.perGame.map((g) => g.runtime_key), ["the_stack", "rackl", "broken"]);
  assert.deepEqual(p.perGame[0].bands, { foundational: 2, practitioner: 3, expert: 5 });
  assert.deepEqual(p.perGame[1].bands, { foundational: 0, practitioner: 0, expert: 10 });
  assert.equal(p.perGame[2].bands, null);
});

test("projectedAllocation counts only the days a game actually plays in the range", () => {
  const p = projectedAllocation({
    cutoff: "2026-10-10", // a Saturday
    season: { starts_on: "2026-10-05", ends_on: "2026-10-23" },
    config: { play_days_of_week: [1, 2, 3, 4, 5] }, // Mon–Fri
    seasonMix: [{ difficulty_band: "expert", target_pct: 100 }],
    games: [{ runtime_key: "the_stack", display_name: "The Stack", is_enabled: true }],
  });
  assert.equal(p.dayCount, 14);      // calendar days 10–23
  assert.equal(p.perGame[0].days, 10); // weekdays only
  assert.deepEqual(p.perGame[0].bands, { foundational: 0, practitioner: 0, expert: 10 });
});

// ── D6: restore ──────────────────────────────────────────────────────────────

const arch = (type: string, date: string, over: Record<string, unknown> = {}) => ({
  id: `${type}-${date}`,
  puzzle_type: type,
  go_live_date: date,
  theme_date: date,
  superseded_at: "2026-10-06T12:00:00Z",
  ...over,
});
const archTheme = (date: string, over: Record<string, unknown> = {}) => ({
  id: `t-${date}`, theme_date: date, superseded_at: "2026-10-06T12:00:00Z", ...over,
});

test("restore fills only EMPTY future slots and never overwrites an existing row", () => {
  const r = restorePlan({
    today: TODAY,
    fromDate: "2026-10-01",
    reason: "the regeneration was worse",
    archived: [
      arch("the_stack", "2026-10-02"), // past — already served
      arch("the_stack", "2026-10-06"), // today is allowed
      arch("the_stack", "2026-10-11"), // slot refilled by the regeneration
      arch("rackl", "2026-10-11"),     // slot still empty
    ],
    archivedThemes: [archTheme("2026-10-02"), archTheme("2026-10-06"), archTheme("2026-10-11")],
    existing: [{ puzzle_type: "the_stack", go_live_date: "2026-10-11" }],
    existingThemes: [{ theme_date: "2026-10-11" }],
  });
  assert.equal(r.ok, true, JSON.stringify(r.blocks));
  assert.equal(r.floorDate, TODAY);
  assert.deepEqual(r.slots, [
    { puzzle_type: "the_stack", go_live_date: "2026-10-06" },
    { puzzle_type: "rackl", go_live_date: "2026-10-11" },
  ]);
  // The occupied slot is NOT in the plan — R2.
  assert.ok(!r.rows.some((x) => x.puzzle_type === "the_stack" && x.go_live_date === "2026-10-11"));
  assert.equal(r.skipped.occupied, 2); // the puzzle slot and the live theme day
  assert.equal(r.skipped.past, 2);     // the 10-02 puzzle and its theme day
  // The theme day for 10-11 already exists, so only 10-06's is restored.
  assert.deepEqual(r.themes.map((t) => t.theme_date), ["2026-10-06"]);
});

test("fromDate never reaches behind today, however far back it is set", () => {
  const r = restorePlan({
    today: TODAY,
    fromDate: "2020-01-01",
    reason: "x",
    archived: [arch("the_stack", "2026-10-05"), arch("the_stack", "2026-10-07")],
    archivedThemes: [archTheme("2026-10-05"), archTheme("2026-10-07")],
    existing: [],
    existingThemes: [],
  });
  assert.equal(r.floorDate, TODAY);
  assert.deepEqual(r.slots, [{ puzzle_type: "the_stack", go_live_date: "2026-10-07" }]);
});

test("a fromDate in the future narrows the restore rather than widening it", () => {
  const r = restorePlan({
    today: TODAY,
    fromDate: "2026-11-01",
    reason: "x",
    archived: [arch("the_stack", "2026-10-20"), arch("the_stack", "2026-11-02")],
    archivedThemes: [archTheme("2026-10-20"), archTheme("2026-11-02")],
    existing: [],
    existingThemes: [],
  });
  assert.equal(r.floorDate, "2026-11-01");
  assert.deepEqual(r.slots, [{ puzzle_type: "the_stack", go_live_date: "2026-11-02" }]);
});

test("a slot archived twice restores the most recent copy, once", () => {
  const r = restorePlan({
    today: TODAY,
    fromDate: TODAY,
    reason: "x",
    archived: [
      arch("the_stack", "2026-10-20", { id: "older", superseded_at: "2026-10-01T00:00:00Z" }),
      arch("the_stack", "2026-10-20", { id: "newer", superseded_at: "2026-10-06T00:00:00Z" }),
    ],
    archivedThemes: [archTheme("2026-10-20")],
    existing: [],
    existingThemes: [],
  });
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].id, "newer");
  assert.equal(r.skipped.superseded, 1);
});

test("a puzzle whose theme day is neither live nor restorable is skipped, not attempted", () => {
  // dc_staging_theme_fk (season_id, theme_date) → dc_daily_theme would reject it.
  const r = restorePlan({
    today: TODAY,
    fromDate: TODAY,
    reason: "x",
    archived: [arch("the_stack", "2026-10-20", { theme_date: "2026-10-20" })],
    archivedThemes: [],
    existing: [],
    existingThemes: [],
  });
  assert.equal(r.skipped.noTheme, 1);
  assert.deepEqual(r.rows, []);
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ["nothing_to_restore"]);
});

test("a puzzle with no theme_date at all needs no theme row", () => {
  const r = restorePlan({
    today: TODAY,
    fromDate: TODAY,
    reason: "x",
    archived: [arch("the_stack", "2026-10-20", { theme_date: null })],
    archivedThemes: [],
    existing: [],
    existingThemes: [],
  });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped.noTheme, 0);
});

test("restore demands a reason and a real date", () => {
  const noReason = restorePlan({ today: TODAY, fromDate: TODAY, reason: " ", archived: [], existing: [] });
  assert.ok(codes(noReason).includes("reason_required"));
  const noDate = restorePlan({ today: TODAY, fromDate: "nope", reason: "x", archived: [], existing: [] });
  assert.ok(codes(noDate).includes("from_invalid"));
  assert.deepEqual(noDate.rows, []);
});

// ── source guards: what review must not be allowed to undo ───────────────────

test("the server action archives BEFORE it deletes, and both actions default to a dry run", () => {
  const src = readFileSync(join(HERE, "generation-write.ts"), "utf8");
  // The only DELETE in the feature goes through deleteByIds, which issues it by
  // PRIMARY KEY against the ids that are already in the archive.
  assert.match(src, /async function deleteByIds[\s\S]*?method: "DELETE"/);

  const body = src.slice(
    src.indexOf("export async function regenerateFrom"),
    src.indexOf("export async function restoreSuperseded")
  );
  const archiveAt = body.indexOf("dc_puzzle_bank_superseded");
  const verifyAt = body.indexOf("archivedIds(");
  const deleteAt = body.indexOf("deleteByIds(");
  assert.ok(archiveAt > -1, "regenerateFrom must write to dc_puzzle_bank_superseded");
  assert.ok(verifyAt > -1, "regenerateFrom must read the archive back to verify it");
  assert.ok(deleteAt > -1, "regenerateFrom must delete");
  assert.ok(archiveAt < verifyAt, "the archive insert must come before the verification");
  assert.ok(verifyAt < deleteAt, "the verification must come before the delete");

  // dryRun defaults to TRUE in both actions: the guard is written
  // `if (input.dryRun !== false) return <report>`, so an omitted flag, a
  // missing key or a string all report instead of deleting. A `!input.dryRun`
  // or `input.dryRun == false` here would be a truthiness bug with a 570-row
  // blast radius, which is why this is asserted on the source and not inferred.
  assert.match(body, /if \(input\.dryRun !== false\)/);
  assert.doesNotMatch(body, /if \(!input\.dryRun\)/);
  const restore = src.slice(src.indexOf("export async function restoreSuperseded"));
  assert.match(restore, /if \(input\.dryRun !== false\)/);
  assert.doesNotMatch(restore, /if \(!input\.dryRun\)/);

  // ...and the dispatcher converts the wire value the same way.
  const dispatch = readFileSync(join(HERE, "write.ts"), "utf8");
  assert.match(dispatch, /dryRun: input\.dryRun !== false/);
});

test("the delete is filtered to this season's removable rows and never names Live or Retired", () => {
  const src = readFileSync(join(HERE, "generation-write.ts"), "utf8");
  const body = src.slice(
    src.indexOf("export async function regenerateFrom"),
    src.indexOf("export async function restoreSuperseded")
  );
  assert.doesNotMatch(body, /published=in\.\([^)]*Live/, "a delete filter must never admit Live");
  assert.doesNotMatch(body, /published=in\.\([^)]*Retired/, "a delete filter must never admit Retired");
  // The theme delete is season-scoped: dc_daily_theme also holds the shared
  // platform corpus (season_id IS NULL), and deleting that would break every
  // other season's generation.
  assert.doesNotMatch(body, /dc_daily_theme\?[^`"']*season_id=is\.null/);
  assert.match(body, /dc_daily_theme\?season_id=eq\./);
});

test("restore inserts with ignore-duplicates — PostgREST can never upsert over a live row", () => {
  const src = readFileSync(join(HERE, "generation-write.ts"), "utf8");
  const restore = src.slice(src.indexOf("export async function restoreSuperseded"));
  assert.match(restore, /resolution=ignore-duplicates/);
  assert.doesNotMatch(restore, /resolution=merge-duplicates/, "merge-duplicates is an overwrite");
  assert.doesNotMatch(restore, /method: "(PATCH|PUT)"/, "restore never updates an existing row");
});

// ── F1: the archive check compares SETS, not lengths ─────────────────────────

test("missingFromArchive passes only when the archive holds exactly the selected ids", () => {
  assert.deepEqual(missingFromArchive(["a", "b", "c"], ["c", "a", "b"]), { ok: true, missing: [], extra: 0 });
  assert.deepEqual(missingFromArchive([], []), { ok: true, missing: [], extra: 0 });
});

test("missingFromArchive catches the duplicated-page failure a length check lets through", () => {
  // THE bug F1 exists for: an unordered OFFSET-paged read returns "a" twice and
  // drops "c". Same length, different set — and the next statement is an
  // irreversible delete.
  const r = missingFromArchive(["a", "b", "c"], ["a", "b", "a"]);
  assert.equal(r.ok, false, "three ids and three rows is NOT proof the archive is complete");
  assert.deepEqual(r.missing, ["c"]);
});

test("missingFromArchive names what is missing, and nothing else", () => {
  const r = missingFromArchive(["a", "b", "c", "d"], ["a"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ["b", "c", "d"]);
  assert.equal(r.extra, 0);
});

test("missingFromArchive refuses an archive holding rows this operation never selected", () => {
  // Non-zero `extra` means the superseded_at batch key is not unique to this
  // operation, which invalidates the whole verification — so it aborts too.
  const r = missingFromArchive(["a"], ["a", "stranger"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, []);
  assert.equal(r.extra, 1);
});

test("the archive read-back is ORDERED — OFFSET paging over an unordered result is undefined", () => {
  const src = readFileSync(join(HERE, "generation-write.ts"), "utf8");
  const fn = src.slice(src.indexOf("async function archivedIds"), src.indexOf("export function missingFromArchive"));
  assert.match(fn, /order=id\.asc/, "qAll pages with limit/offset; without a total order the pages are not disjoint");
});

test("both archive verifications go through missingFromArchive, never a length comparison", () => {
  const src = readFileSync(join(HERE, "generation-write.ts"), "utf8");
  const body = src.slice(
    src.indexOf("export async function regenerateFrom"),
    src.indexOf("export async function restoreSuperseded")
  );
  assert.equal((body.match(/missingFromArchive\(/g) ?? []).length, 2, "puzzles and themes both");
  assert.doesNotMatch(body, /archivedPuzzleIds\.length !== /);
  assert.doesNotMatch(body, /archivedThemeIds\.length !== /);
});

// ── F4 + F5: the call site honours what the planner now demands ──────────────

test("the runs read reports whether it succeeded, and q() is left alone", () => {
  const src = readFileSync(join(HERE, "generation-write.ts"), "utf8");
  assert.match(src, /async function readRuns\([\s\S]*?ok: false, rows: \[\]/);
  assert.match(src, /runsRead: runs\.ok/, "the planner must be told whether the read worked");
  // The fail-soft q() is right for every other reader in the console; this fix
  // is scoped to the one gate that degrades open.
  const svc = readFileSync(join(HERE, "service.ts"), "utf8");
  assert.match(svc, /if \(!r\.ok\) return \[\];/, "service.q() must keep its fail-soft contract");
});

test("every season_id that reaches a PostgREST filter is encoded", () => {
  const src = readFileSync(join(HERE, "generation-write.ts"), "utf8");
  const feature = src.slice(src.indexOf("CC-LO-REGENERATE-FROM-DATE-1.0 — replace an approved season"));
  assert.doesNotMatch(feature, /season_id=eq\.\$\{seasonId\}/, "use the encoded `sid`/`esid`, not the raw id");
  assert.doesNotMatch(src, /seasons\?id=eq\.\$\{seasonId\}/);
});
