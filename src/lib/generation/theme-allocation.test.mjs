// CC-DC-GEN-THEME-ALLOCATION-1.0 — the season theme calendar must be a function
// of the commissioner's MIX, not of the dates the corpus rows happen to carry.
// Run: npm run test:theme-allocation
//
// The Football fixture below is the live configuration that exposed the bug
// (season_config 3bf84bc8-f202-4a2d-9a89-9dcc38f36711, read 2026-10-06):
// T-002 35.31 / T-005 29.41 / T-007 35.28 included, T-001/003/004/006 excluded,
// and a corpus in which EVERY T-007 row is dated after the season window — the
// exact shape the old date-matching Phase A could not serve.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  allocateThemeCalendar,
  ThemeAllocationError,
  themeUnfillableKey,
  themeQuotas,
  themeExclusions,
  isEligible,
  largestRemainder,
  normalizeTo100,
  seededOrder,
} from "./theme-allocation.js";
import { normalizeTo100 as canonNormalizeTo100 } from "../league-office/season-config-logic.ts";

// ── fixture ──────────────────────────────────────────────────────────────────

const SEASON_SEED = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";

/** 119 consecutive dates — the live Football window length. */
function datesFrom(start, n) {
  const out = [];
  const t = new Date(`${start}T12:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

const DATES = datesFrom("2027-09-01", 119);

const FOOTBALL_MIX = [
  { theater_id: "T-001", sector_code: null, thread_code: null, target_pct: 26.05, is_excluded: true },
  { theater_id: "T-002", sector_code: null, thread_code: null, target_pct: 35.31, is_excluded: false },
  { theater_id: "T-003", sector_code: null, thread_code: null, target_pct: 20.69, is_excluded: true },
  { theater_id: "T-004", sector_code: null, thread_code: null, target_pct: 14.29, is_excluded: true },
  { theater_id: "T-005", sector_code: null, thread_code: null, target_pct: 29.41, is_excluded: false },
  { theater_id: "T-006", sector_code: null, thread_code: null, target_pct: 17.14, is_excluded: true },
  { theater_id: "T-007", sector_code: null, thread_code: null, target_pct: 35.28, is_excluded: false },
];

/** Sectors each theater carries in the live corpus (counts collapsed to 3/row). */
const CORPUS_SHAPE = {
  "T-001": ["D1", "D3", "D9", "D10", "D13", "D20"],
  "T-002": ["D1", "D4", "D7", "D11", "D20", "D22"],
  "T-003": ["D7", "D13", "D17", "D18", "D21"],
  "T-004": ["D4", "D5", "D8", "D10", "D17", "D19"],
  "T-005": ["D1", "D5", "D6", "D9", "D12", "D15", "D23"],
  "T-006": ["D14", "D16", "D19", "D21", "D23"],
  "T-007": ["D2", "D3", "D8", "D11", "D22"],
};

/**
 * A synthetic corpus in the live shape. T-007's rows are deliberately dated
 * 2029 — far past the season window — so a date-matching allocator could never
 * reach them; every other theater's rows sit inside or near the window.
 */
function buildCorpus({ perSector = 9, t007PerSector = 9 } = {}) {
  const rows = [];
  for (const [theater, sectors] of Object.entries(CORPUS_SHAPE)) {
    const n = theater === "T-007" ? t007PerSector : perSector;
    const base = theater === "T-007" ? "2029-01-01" : "2027-06-01";
    for (const sector of sectors) {
      for (let i = 0; i < n; i++) {
        rows.push({
          id: `${theater}-${sector}-${i}`,
          theme_date: datesFrom(base, 400)[(rows.length * 7) % 400],
          theater_id: theater,
          sector_code: sector,
          thread_codes: [`${sector}.${i % 3}`],
        });
      }
    }
  }
  return rows;
}

const CORPUS = buildCorpus();

const countBy = (plan, key) => {
  const out = {};
  for (const p of plan) out[p[key]] = (out[p[key]] ?? 0) + 1;
  return out;
};

/** Longest run of identical consecutive values. */
function longestRun(values) {
  let best = 0;
  let run = 0;
  let prev = Symbol("none");
  for (const v of values) {
    run = v === prev ? run + 1 : 1;
    prev = v;
    if (run > best) best = run;
  }
  return best;
}

// ── arithmetic ───────────────────────────────────────────────────────────────

test("normalizeTo100 is byte-identical to the season-config implementation it mirrors", () => {
  const cases = [
    [10, 20, 20],
    [35.31, 29.41, 35.28],
    [30, 50, 20],
    [1, 1, 1, 1, 1, 1, 1],
    [0, 0, 0],
    [140.2, 0.1],
    [],
  ];
  for (const c of cases) assert.deepEqual(normalizeTo100(c), canonNormalizeTo100(c), JSON.stringify(c));
});

test("largestRemainder always sums to the total and never goes negative", () => {
  assert.deepEqual(largestRemainder([35.31, 29.41, 35.28], 119), [42, 35, 42]);
  assert.deepEqual(largestRemainder([50, 50], 7), [4, 3]);
  assert.deepEqual(largestRemainder([1, 1, 1], 0), [0, 0, 0]);
  assert.deepEqual(largestRemainder([0, 0], 5), [3, 2]); // no signal reads as even
  for (const total of [1, 5, 13, 119, 365]) {
    const out = largestRemainder([35.31, 29.41, 35.28], total);
    assert.equal(out.reduce((a, b) => a + b, 0), total);
    assert.ok(out.every((n) => n >= 0));
  }
});

test("seededOrder is a permutation, is stable for one seed and differs across seeds", () => {
  const keys = ["T-001", "T-002", "T-005", "T-007", "T-003"];
  const a = seededOrder(keys, "seed-a");
  assert.deepEqual([...a].sort(), [...keys].sort());
  assert.deepEqual(a, seededOrder(keys, "seed-a"));
  const seeds = ["s1", "s2", "s3", "s4", "s5", "s6"];
  assert.ok(new Set(seeds.map((s) => seededOrder(keys, s).join(","))).size > 1);
});

// ── exclusions ───────────────────────────────────────────────────────────────

test("exclusions read all three axes exactly as the worker's old `passes` did", () => {
  const ex = themeExclusions([
    ...FOOTBALL_MIX,
    { theater_id: "T-002", sector_code: "D22", thread_code: null, target_pct: 0, is_excluded: true },
    { theater_id: "T-005", sector_code: "D1", thread_code: "D1.2", target_pct: 0, is_excluded: true },
  ]);
  assert.deepEqual([...ex.theaters].sort(), ["T-001", "T-003", "T-004", "T-006"]);
  assert.deepEqual([...ex.sectors], ["D22"]);
  assert.deepEqual([...ex.threads], ["D1.2"]);

  assert.equal(isEligible({ theater_id: "T-001", sector_code: "D1", thread_codes: [] }, ex), false);
  assert.equal(isEligible({ theater_id: "T-002", sector_code: "D22", thread_codes: [] }, ex), false);
  assert.equal(isEligible({ theater_id: "T-005", sector_code: "D1", thread_codes: ["D1.2"] }, ex), false);
  assert.equal(isEligible({ theater_id: "T-005", sector_code: "D1", thread_codes: ["D1.0"] }, ex), true);
});

// ── the Football fixture ─────────────────────────────────────────────────────

test("Football fixture: 119 days land on the configured 35.31 / 29.41 / 35.28 mix", () => {
  const plan = allocateThemeCalendar({ dates: DATES, corpusRows: CORPUS, mixRows: FOOTBALL_MIX, seed: SEASON_SEED });

  assert.equal(plan.length, 119);
  assert.deepEqual(plan.map((p) => p.date), DATES, "one row per season date, in date order");

  const byTheater = countBy(plan, "theater_id");
  assert.equal(byTheater["T-002"], 42);
  assert.equal(byTheater["T-005"], 35);
  assert.equal(byTheater["T-007"], 42);
  // ±1 of the arithmetic share, which largest remainder guarantees exactly.
  for (const [tid, pct] of [["T-002", 35.31], ["T-005", 29.41], ["T-007", 35.28]])
    assert.ok(Math.abs(byTheater[tid] - (pct / 100) * 119) <= 1, `${tid} within a day of its share`);
});

test("Football fixture: no excluded theater appears on any day", () => {
  const plan = allocateThemeCalendar({ dates: DATES, corpusRows: CORPUS, mixRows: FOOTBALL_MIX, seed: SEASON_SEED });
  for (const tid of ["T-001", "T-003", "T-004", "T-006"])
    assert.equal(plan.filter((p) => p.theater_id === tid).length, 0, `${tid} is excluded`);
  const sources = new Map(CORPUS.map((r) => [r.id, r]));
  for (const p of plan) assert.equal(sources.get(p.sourceId).theater_id, p.theater_id);
});

test("Football fixture: T-007 is served in full even though every T-007 corpus row is dated after the window", () => {
  const t007 = new Set(CORPUS.filter((r) => r.theater_id === "T-007").map((r) => r.theme_date));
  const lastSeasonDate = DATES[DATES.length - 1];
  assert.ok([...t007].every((d) => d > lastSeasonDate), "fixture premise: T-007 rows are all out of window");

  const plan = allocateThemeCalendar({ dates: DATES, corpusRows: CORPUS, mixRows: FOOTBALL_MIX, seed: SEASON_SEED });
  assert.equal(plan.filter((p) => p.theater_id === "T-007").length, 42);
});

test("Football fixture: no theater runs more than 2 consecutive days, no sector repeats back to back", () => {
  const plan = allocateThemeCalendar({ dates: DATES, corpusRows: CORPUS, mixRows: FOOTBALL_MIX, seed: SEASON_SEED });
  assert.ok(longestRun(plan.map((p) => p.theater_id)) <= 2, "theater run length");
  assert.equal(longestRun(plan.map((p) => p.sector_code)), 1, "sector never repeats on consecutive days");
});

test("Football fixture: rows are spread across the pool before any is reused", () => {
  const plan = allocateThemeCalendar({ dates: DATES, corpusRows: CORPUS, mixRows: FOOTBALL_MIX, seed: SEASON_SEED });
  const counts = Object.values(countBy(plan, "sourceId"));
  assert.equal(Math.max(...counts), 1, "the pool is big enough, so no row is reused at all");
  // 45 eligible T-007 rows cover 42 days with none repeated.
  const t007 = plan.filter((p) => p.theater_id === "T-007").map((p) => p.sourceId);
  assert.equal(new Set(t007).size, t007.length);
});

// ── determinism ──────────────────────────────────────────────────────────────

test("same inputs and seed produce an identical calendar; a different seed does not", () => {
  const a = allocateThemeCalendar({ dates: DATES, corpusRows: CORPUS, mixRows: FOOTBALL_MIX, seed: SEASON_SEED });
  const b = allocateThemeCalendar({ dates: DATES, corpusRows: CORPUS, mixRows: FOOTBALL_MIX, seed: SEASON_SEED });
  assert.deepEqual(a, b);

  // row ORDER in the corpus must not change the answer either (D6)
  const shuffled = [...CORPUS].reverse();
  const c = allocateThemeCalendar({ dates: DATES, corpusRows: shuffled, mixRows: FOOTBALL_MIX, seed: SEASON_SEED });
  assert.deepEqual(a, c, "corpus row order is not an input to the plan");

  const other = allocateThemeCalendar({ dates: DATES, corpusRows: CORPUS, mixRows: FOOTBALL_MIX, seed: "another-season" });
  assert.notDeepEqual(a.map((p) => p.sourceId), other.map((p) => p.sourceId));
  // ...but the quotas are the quotas, whatever the seed.
  assert.deepEqual(countBy(other, "theater_id"), { "T-002": 42, "T-005": 35, "T-007": 42 });
});

// ── sector-level quotas ──────────────────────────────────────────────────────

test("sector rows inside a theater split that theater's day quota", () => {
  const mix = [
    { theater_id: "T-002", sector_code: null, thread_code: null, target_pct: 50, is_excluded: false },
    { theater_id: "T-007", sector_code: null, thread_code: null, target_pct: 50, is_excluded: false },
    { theater_id: "T-007", sector_code: "D11", thread_code: null, target_pct: 75, is_excluded: false },
    { theater_id: "T-007", sector_code: "D22", thread_code: null, target_pct: 25, is_excluded: false },
  ];
  const dates = datesFrom("2027-09-01", 100);

  const quotas = themeQuotas(mix, 100);
  assert.deepEqual(quotas.theaters.map((t) => [t.theater_id, t.days]), [["T-002", 50], ["T-007", 50]]);
  assert.deepEqual(quotas.sectors.get("T-007").map((s) => [s.sector_code, s.days]), [["D11", 38], ["D22", 12]]);

  const plan = allocateThemeCalendar({ dates, corpusRows: CORPUS, mixRows: mix, seed: SEASON_SEED });
  assert.deepEqual(countBy(plan, "theater_id"), { "T-002": 50, "T-007": 50 });
  const t007 = countBy(plan.filter((p) => p.theater_id === "T-007"), "sector_code");
  assert.deepEqual(t007, { D11: 38, D22: 12 }, "configured sector split is honored exactly");

  // T-002 configures no sectors, so its own sectors rotate least-used-first.
  const t002 = countBy(plan.filter((p) => p.theater_id === "T-002"), "sector_code");
  assert.equal(Object.keys(t002).length, CORPUS_SHAPE["T-002"].length);
  assert.ok(Math.max(...Object.values(t002)) - Math.min(...Object.values(t002)) <= 1, "free sectors rotate evenly");
});

// ── D7: unfillable is an error, never a silent redistribution ────────────────

test("an included theater with no eligible corpus row is an error, not a redistribution", () => {
  const mix = [
    { theater_id: "T-002", sector_code: null, thread_code: null, target_pct: 60, is_excluded: false },
    { theater_id: "T-009", sector_code: null, thread_code: null, target_pct: 40, is_excluded: false },
  ];
  assert.throws(
    () => allocateThemeCalendar({ dates: DATES, corpusRows: CORPUS, mixRows: mix, seed: SEASON_SEED }),
    (e) => {
      assert.ok(e instanceof ThemeAllocationError);
      assert.equal(e.code, "unfillable");
      assert.deepEqual(e.unfillable, [{ theater_id: "T-009", sector_code: null }]);
      assert.deepEqual(e.failureKeys, ["theme:unfillable:T-009"]);
      assert.equal(e.failureKey, "theme:unfillable:T-009");
      return true;
    }
  );
});

test("an included SECTOR with no eligible corpus row is an error too", () => {
  const mix = [
    { theater_id: "T-007", sector_code: null, thread_code: null, target_pct: 100, is_excluded: false },
    { theater_id: "T-007", sector_code: "D11", thread_code: null, target_pct: 50, is_excluded: false },
    { theater_id: "T-007", sector_code: "D19", thread_code: null, target_pct: 50, is_excluded: false },
  ];
  assert.throws(
    () => allocateThemeCalendar({ dates: DATES, corpusRows: CORPUS, mixRows: mix, seed: SEASON_SEED }),
    (e) => {
      assert.deepEqual(e.unfillable, [{ theater_id: "T-007", sector_code: "D19" }]);
      assert.equal(e.failureKey, themeUnfillableKey("T-007"));
      return true;
    }
  );
});

test("a theater emptied by THREAD exclusions alone is still caught", () => {
  const mix = [
    { theater_id: "T-002", sector_code: null, thread_code: null, target_pct: 50, is_excluded: false },
    { theater_id: "T-007", sector_code: null, thread_code: null, target_pct: 50, is_excluded: false },
    ...["D2", "D3", "D8", "D11", "D22"].flatMap((sector) =>
      [0, 1, 2].map((i) => ({
        theater_id: "T-007", sector_code: sector, thread_code: `${sector}.${i}`,
        target_pct: 0, is_excluded: true,
      }))
    ),
  ];
  assert.throws(
    () => allocateThemeCalendar({ dates: DATES, corpusRows: CORPUS, mixRows: mix, seed: SEASON_SEED }),
    (e) => e instanceof ThemeAllocationError && e.failureKey === "theme:unfillable:T-007"
  );
});

test("no included theme mix at all is its own error", () => {
  assert.throws(
    () => allocateThemeCalendar({ dates: DATES, corpusRows: CORPUS, mixRows: [FOOTBALL_MIX[0]], seed: SEASON_SEED }),
    (e) => e instanceof ThemeAllocationError && e.code === "no_theme_mix"
  );
});

// ── small / awkward corpora ──────────────────────────────────────────────────

test("a corpus far shorter than the season still fills every day, reusing least-recently-used rows", () => {
  const tiny = CORPUS.filter((r) => Number(r.id.split("-").pop()) === 0); // 1 row per (theater, sector)
  const plan = allocateThemeCalendar({ dates: DATES, corpusRows: tiny, mixRows: FOOTBALL_MIX, seed: SEASON_SEED });

  assert.equal(plan.length, 119);
  assert.deepEqual(countBy(plan, "theater_id"), { "T-002": 42, "T-005": 35, "T-007": 42 });
  assert.ok(longestRun(plan.map((p) => p.theater_id)) <= 2);
  assert.ok(plan.every((p) => p.sourceId));

  // Reuse is least-recently-used, never "the same row until it goes stale":
  // inside a (theater, sector) pool every row is used within one of every
  // other. Across a whole theater the spread can be wider by design — the
  // consecutive-sector rule (D5) outranks perfect row balance when a sector is
  // shared with another theater and keeps getting skipped.
  const buckets = {};
  for (const p of plan) {
    const bucket = (buckets[`${p.theater_id}|${p.sector_code}`] ??= {});
    bucket[p.sourceId] = (bucket[p.sourceId] ?? 0) + 1;
  }
  for (const [bucket, uses] of Object.entries(buckets)) {
    const counts = Object.values(uses);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${bucket} reuses evenly`);
  }
  // every eligible sector of an included theater is still visited
  for (const tid of ["T-002", "T-005", "T-007"])
    assert.equal(
      new Set(plan.filter((p) => p.theater_id === tid).map((p) => p.sector_code)).size,
      CORPUS_SHAPE[tid].length,
      `${tid} visits all of its sectors`
    );
});

test("a one-day season and a zero-day season are both well defined", () => {
  assert.deepEqual(allocateThemeCalendar({ dates: [], corpusRows: CORPUS, mixRows: FOOTBALL_MIX, seed: "s" }), []);
  const one = allocateThemeCalendar({ dates: ["2027-09-01"], corpusRows: CORPUS, mixRows: FOOTBALL_MIX, seed: "s" });
  assert.equal(one.length, 1);
  assert.ok(["T-002", "T-005", "T-007"].includes(one[0].theater_id));
});

test("a theater holding more than two thirds of the season takes its unavoidable run", () => {
  const mix = [
    { theater_id: "T-002", sector_code: null, thread_code: null, target_pct: 90, is_excluded: false },
    { theater_id: "T-007", sector_code: null, thread_code: null, target_pct: 10, is_excluded: false },
  ];
  const plan = allocateThemeCalendar({ dates: datesFrom("2027-09-01", 30), corpusRows: CORPUS, mixRows: mix, seed: "s" });
  assert.deepEqual(countBy(plan, "theater_id"), { "T-002": 27, "T-007": 3 });
  assert.equal(plan.length, 30); // the quota is still met exactly
});
