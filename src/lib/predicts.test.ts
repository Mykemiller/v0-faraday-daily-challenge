// Faraday Predicts — pure-logic tests for the /predicts surface (FDY-147).
// Run: npm run test:predicts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCURACY_CLAIM_RE,
  buildApiQuery,
  buildUrl,
  DEFAULT_URL_STATE,
  emptyHorizonMessage,
  formatDate,
  HORIZON_LABELS,
  NO_MISSES_LINE,
  parseUrlState,
  PREDICTS_HORIZONS,
  TAXONOMY_COUNT_RE,
  trackRecord,
  verdictBadge,
  type PredictsRecord,
} from "./predicts.ts";

// The live record, measured 2026-10-09 16:40 CT.
const LIVE: PredictsRecord = {
  graded: 70,
  confirmed: 20,
  partial: 10,
  refuted: 0,
  not_observed: 0,
  inconclusive: 40,
  brier: 0.080607,
  caveat:
    "no miss has ever been recorded (0 refuted, 0 not_observed): a record with no misses cannot demonstrate calibration, only that nothing was graded against",
};

// ── dates ───────────────────────────────────────────────────────────────────

test("formatDate renders Mon D, YYYY", () => {
  assert.equal(formatDate("2026-11-07"), "Nov 7, 2026");
  assert.equal(formatDate("2026-01-01"), "Jan 1, 2026");
  assert.equal(formatDate("2027-04-30"), "Apr 30, 2027");
  assert.equal(formatDate("2026-12-31"), "Dec 31, 2026");
});

test("formatDate does NOT shift the day in a negative-offset timezone", () => {
  // new Date("2026-11-07") is UTC midnight; in US Central that is Nov 6. The
  // formatter must never construct a Date, so this holds whatever TZ is set.
  const naive = new Date("2026-11-07").getDate(); // 6 or 7 depending on host TZ
  assert.equal(formatDate("2026-11-07"), "Nov 7, 2026");
  assert.ok(naive === 6 || naive === 7, "sanity: the naive parse is TZ-dependent");
});

test("formatDate tolerates a timestamp and rejects junk", () => {
  assert.equal(formatDate("2026-10-08T07:45:00+00:00"), "Oct 8, 2026");
  assert.equal(formatDate(null), null);
  assert.equal(formatDate(""), null);
  assert.equal(formatDate("not a date"), null);
  assert.equal(formatDate("2026-13-01"), null, "month 13 has no name");
});

// ── track record (§2) ───────────────────────────────────────────────────────

test("the strip reads counts then Brier to 3 dp", () => {
  const t = trackRecord(LIVE)!;
  assert.equal(
    t.line,
    "70 forecasts graded · 20 right · 10 partly right · 40 undetermined · Brier 0.081",
  );
});

test("the strip NEVER prints an accuracy percentage", () => {
  const t = trackRecord(LIVE)!;
  assert.ok(!ACCURACY_CLAIM_RE.test(t.line), t.line);
  assert.ok(!/%/.test(t.line), "no percent sign belongs in the strip at all");
  // The guard must actually catch the thing it is guarding against.
  assert.ok(ACCURACY_CLAIM_RE.test("67% accurate"));
  assert.ok(ACCURACY_CLAIM_RE.test("accuracy: 67%"));
  assert.ok(ACCURACY_CLAIM_RE.test("a 67.0 % hit rate"));
});

test("a null Brier drops the segment rather than printing 0.000", () => {
  // Number(null) is 0 — a *finite* value. Printing it would publish a perfect
  // score off a missing figure. The API refuses to coerce; so does the strip.
  const t = trackRecord({ ...LIVE, brier: null })!;
  assert.equal(t.line, "70 forecasts graded · 20 right · 10 partly right · 40 undetermined");
  assert.ok(!t.line.includes("0.000"));
  assert.ok(!t.line.includes("Brier"));
});

test("noMisses is true while refuted + not_observed is 0, and false once either fires", () => {
  assert.equal(trackRecord(LIVE)!.noMisses, true);
  assert.equal(trackRecord({ ...LIVE, refuted: 1 })!.noMisses, false);
  assert.equal(trackRecord({ ...LIVE, not_observed: 3 })!.noMisses, false);
  assert.equal(trackRecord({ ...LIVE, refuted: 2, not_observed: 1 })!.noMisses, false);
});

test("the no-misses line states that grading is still maturing", () => {
  assert.equal(NO_MISSES_LINE, "No misses recorded yet — grading is still maturing.");
});

test("the caveat is passed through verbatim, and blank is null", () => {
  assert.equal(trackRecord(LIVE)!.caveat, LIVE.caveat);
  assert.equal(trackRecord({ ...LIVE, caveat: null })!.caveat, null);
  assert.equal(trackRecord({ ...LIVE, caveat: "   " })!.caveat, null);
});

test("trackRecord(null) is null, not an empty strip", () => {
  assert.equal(trackRecord(null), null);
  assert.equal(trackRecord(undefined), null);
});

// ── IDF governance (§8) ─────────────────────────────────────────────────────

test("no copy on this surface prints a taxonomy count", () => {
  const copy = [
    trackRecord(LIVE)!.line,
    trackRecord(LIVE)!.caveat!,
    NO_MISSES_LINE,
    ...HORIZON_LABELS.map((h) => h.label),
    ...PREDICTS_HORIZONS.map(emptyHorizonMessage),
  ];
  for (const s of copy) assert.ok(!TAXONOMY_COUNT_RE.test(s), `taxonomy count in: ${s}`);
  // The guard must actually catch the thing it is guarding against.
  assert.ok(TAXONOMY_COUNT_RE.test("across 13 sectors"));
  assert.ok(TAXONOMY_COUNT_RE.test("4 Theaters"));
  assert.ok(TAXONOMY_COUNT_RE.test("27 threads"));
  // A forecast count per horizon is NOT a taxonomy count.
  assert.ok(!TAXONOMY_COUNT_RE.test("42 forecasts"));
  assert.ok(!TAXONOMY_COUNT_RE.test("90 days"));
});

// ── empty state (§4) ────────────────────────────────────────────────────────

test("every horizon has an empty-state message", () => {
  assert.equal(emptyHorizonMessage("30d"), "No 30 days forecasts are open right now.");
  // 24m is empty today and that is expected — this is the message it shows.
  assert.equal(emptyHorizonMessage("24m"), "No 24 months forecasts are open right now.");
  for (const h of PREDICTS_HORIZONS) assert.match(emptyHorizonMessage(h), /^No .+ forecasts are open right now\.$/);
});

test("the ladder is in reading order and complete", () => {
  assert.deepEqual(HORIZON_LABELS.map((h) => h.bucket), ["30d", "60d", "90d", "6m", "12m", "24m"]);
  assert.deepEqual([...PREDICTS_HORIZONS], HORIZON_LABELS.map((h) => h.bucket));
});

// ── URL state (§6) ──────────────────────────────────────────────────────────

const u = (s: string) => parseUrlState(new URLSearchParams(s));

test("the default state is open / 30d", () => {
  assert.deepEqual(u(""), DEFAULT_URL_STATE);
  assert.deepEqual(u(""), { view: "open", horizon: "30d", includePartial: false });
  assert.deepEqual(parseUrlState(null), DEFAULT_URL_STATE);
});

test("the documented deep links round-trip", () => {
  assert.deepEqual(u("view=open&h=30d"), { view: "open", horizon: "30d", includePartial: false });
  assert.deepEqual(u("view=right"), { view: "right", horizon: "30d", includePartial: false });
  assert.equal(buildUrl({ view: "open", horizon: "30d", includePartial: false }), "/predicts?view=open&h=30d");
  assert.equal(buildUrl({ view: "right", horizon: "30d", includePartial: false }), "/predicts?view=right");
  assert.equal(buildUrl({ view: "right", horizon: "30d", includePartial: true }), "/predicts?view=right&partial=1");
});

test("buildUrl → parseUrlState is a round trip for every reachable state", () => {
  for (const h of PREDICTS_HORIZONS) {
    const s = { view: "open" as const, horizon: h, includePartial: false };
    assert.deepEqual(parseUrlState(new URL(buildUrl(s), "https://x").searchParams), s);
  }
  for (const partial of [true, false]) {
    const s = { view: "right" as const, horizon: "30d" as const, includePartial: partial };
    assert.deepEqual(parseUrlState(new URL(buildUrl(s), "https://x").searchParams), s);
  }
});

test("buildUrl leaves no stale param from the other view", () => {
  assert.ok(!buildUrl({ view: "right", horizon: "12m", includePartial: false }).includes("h="));
  assert.ok(!buildUrl({ view: "open", horizon: "12m", includePartial: true }).includes("partial"));
});

test("a junk or stale link lands on the page instead of erroring", () => {
  // The API is strict (a bad param from our own code is a bug worth a 400);
  // the URL is forgiving (a bad param from a pasted link is just a visitor).
  assert.deepEqual(u("view=sideways&h=45d"), DEFAULT_URL_STATE);
  assert.deepEqual(u("h=99y"), DEFAULT_URL_STATE);
  assert.deepEqual(u("view=OPEN"), DEFAULT_URL_STATE, "case-sensitive, falls back");
});

test("buildApiQuery never sends a param the strict API would 400 on", () => {
  const open = buildApiQuery({ view: "open", horizon: "90d", includePartial: true });
  assert.equal(open, "view=open&horizon=90d");
  assert.ok(!open.includes("include_partial"), "include_partial with view=open is a 400");

  const right = buildApiQuery({ view: "right", horizon: "90d", includePartial: true });
  assert.equal(right, "view=right&include_partial=true");
  assert.ok(!right.includes("horizon"), "horizon with view=right is a 400");

  assert.equal(
    buildApiQuery({ view: "right", horizon: "30d", includePartial: false }),
    "view=right&include_partial=false",
  );
});

// ── card presentation ───────────────────────────────────────────────────────

test("partial is never rounded up to a win", () => {
  assert.deepEqual(verdictBadge("confirmed"), { label: "Right", tone: "right" });
  assert.deepEqual(verdictBadge("partial"), { label: "Partly right", tone: "partly" });
  assert.equal(verdictBadge("active"), null);
  assert.equal(verdictBadge("inconclusive"), null);
  assert.equal(verdictBadge("refuted"), null, "a miss is not badged on the got-it-right view");
});
