// Faraday Predicts UI 3.0 (FDY-273) — pure-logic tests for the new shell.
// Run: npm run test:predicts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCURACY_CLAIM_RE,
  TAXONOMY_COUNT_RE,
} from "./predicts.ts";
import {
  activeFilterCount,
  bandLabel,
  addDays,
  applyVote,
  DEFAULT_OPEN_STATE,
  DISCLAIMER,
  FIRST_VOTE_LINE,
  groupByThread,
  legacyRedirect,
  matchesOpenState,
  monogram,
  parseMyVotes,
  parseOpenState,
  parseWatchlist,
  recordPillText,
  resolvingSoon,
  rowComparator,
  serializeOpenState,
  shortDate,
  sparkDeltaText,
  toggleWatch,
  voteCountLine,
  type V3Row,
} from "./predicts-v3.ts";

function row(over: Partial<V3Row> = {}): V3Row {
  return {
    prediction_id: "a",
    prediction_text: "LG Electronics will not retract the chiller deal.",
    probability_score: 70,
    probability_band: "Likely",
    horizon_bucket: "30d",
    target_resolution_date: "2026-11-16",
    date_created: "2026-10-17",
    is_bold: false,
    status: "active",
    resolution_date: null,
    resolution_note: null,
    sector_name: "Cooling & Water Technology",
    is_new: false,
    taxonomy: { theater: "The Thermal Reckoning", sector: "Cooling & Water Technology", thread: "Immersion Cooling" },
    companies: [{ name: "LG Electronics", slug: "lg-electronics", domain: null }],
    thread_key: "Immersion Cooling",
    votes: null,
    ...over,
  };
}

// ── URL state ───────────────────────────────────────────────────────────────

test("open state round-trips and omits defaults", () => {
  assert.equal(serializeOpenState(DEFAULT_OPEN_STATE), "/predicts");
  const s = {
    ...DEFAULT_OPEN_STATE,
    h: "60d" as const,
    theater: "The Thermal Reckoning",
    company: "nvidia",
    q: "chiller",
    sort: "bold" as const,
    bold: true,
    watching: true,
  };
  const url = serializeOpenState(s);
  assert.deepEqual(parseOpenState(new URLSearchParams(url.split("?")[1])), s);
});

test("parse is forgiving: junk falls back to defaults", () => {
  const s = parseOpenState(new URLSearchParams("h=45d&sort=odds&company=NVIDIA&bold=yes&q="));
  assert.deepEqual(s, DEFAULT_OPEN_STATE);
  assert.equal(parseOpenState({ theater: ["A", "B"] }).theater, "A");
});

test("active filter badge counts only sheet filters", () => {
  assert.equal(activeFilterCount(DEFAULT_OPEN_STATE), 0);
  assert.equal(activeFilterCount({ ...DEFAULT_OPEN_STATE, theater: "x", q: "y" }), 0);
  assert.equal(activeFilterCount({ ...DEFAULT_OPEN_STATE, h: "30d", bold: true, sort: "newest" }), 3);
});

// ── legacy redirects ───────────────────────────────────────────────────────

test("legacy ?view= map", () => {
  const r = (s: string) => legacyRedirect(new URLSearchParams(s));
  assert.equal(r(""), null);
  assert.equal(r("h=30d"), null);
  assert.equal(r("view=right"), "/predicts/receipts?outcome=right");
  assert.equal(r("view=right&partial=1"), "/predicts/receipts?outcome=right");
  assert.equal(r("view=receipts"), "/predicts/receipts");
  assert.equal(r("view=receipts&outcome=missed"), "/predicts/receipts?outcome=missed");
  assert.equal(r("view=receipts&outcome=all"), "/predicts/receipts");
  assert.equal(r("view=receipts&outcome=bogus"), "/predicts/receipts");
  assert.equal(r("view=open&h=60d"), "/predicts?h=60d");
  assert.equal(r("view=open"), "/predicts");
  assert.equal(r("view=nonsense"), "/predicts");
});

// ── filtering, sort, grouping ──────────────────────────────────────────────

test("filters match names case-insensitively; watching needs the watchlist", () => {
  const r = row();
  const none = new Set<string>();
  assert.ok(matchesOpenState(r, { ...DEFAULT_OPEN_STATE, theater: "the thermal reckoning" }, none));
  assert.ok(!matchesOpenState(r, { ...DEFAULT_OPEN_STATE, theater: "Thermal" }, none));
  assert.ok(matchesOpenState(r, { ...DEFAULT_OPEN_STATE, company: "lg-electronics" }, none));
  assert.ok(matchesOpenState(r, { ...DEFAULT_OPEN_STATE, q: "CHILLER" }, none));
  assert.ok(matchesOpenState(r, { ...DEFAULT_OPEN_STATE, q: "immersion" }, none));
  assert.ok(!matchesOpenState(r, { ...DEFAULT_OPEN_STATE, h: "60d" }, none));
  assert.ok(!matchesOpenState(r, { ...DEFAULT_OPEN_STATE, watching: true }, none));
  assert.ok(matchesOpenState(r, { ...DEFAULT_OPEN_STATE, watching: true }, new Set(["a"])));
  assert.ok(!matchesOpenState(r, { ...DEFAULT_OPEN_STATE, bold: true }, none));
});

test("sort comparators", () => {
  const rows = [
    row({ prediction_id: "a", probability_score: 60, target_resolution_date: "2026-12-05", date_created: "2026-10-01" }),
    row({ prediction_id: "b", probability_score: 80, target_resolution_date: "2026-11-20", date_created: "2026-09-01" }),
    row({ prediction_id: "c", probability_score: 30, target_resolution_date: "2027-01-01", date_created: "2026-11-01", is_bold: true }),
  ];
  const ids = (s: Parameters<typeof rowComparator>[0]) => [...rows].sort(rowComparator(s)).map((r) => r.prediction_id);
  assert.deepEqual(ids("probability"), ["b", "a", "c"]);
  assert.deepEqual(ids("resolves"), ["b", "a", "c"]);
  assert.deepEqual(ids("newest"), ["c", "a", "b"]);
  assert.deepEqual(ids("bold"), ["c", "b", "a"]);
});

test("group by thread_key, groups ordered by their top row", () => {
  const rows = [
    row({ prediction_id: "1", thread_key: "Immersion Cooling", probability_score: 60 }),
    row({ prediction_id: "2", thread_key: "GPU Roadmap", probability_score: 90, companies: [] }),
    row({ prediction_id: "3", thread_key: "Immersion Cooling", probability_score: 75 }),
  ];
  const g = groupByThread(rows, "probability");
  assert.deepEqual(g.map((x) => x.key), ["GPU Roadmap", "Immersion Cooling"]);
  assert.deepEqual(g[1].rows.map((r) => r.prediction_id), ["3", "1"]);
  assert.equal(g[1].sharedCompany?.slug, "lg-electronics");
  assert.equal(g[0].sharedCompany, null);
  // a row without thread_key falls back to its Sector
  const g2 = groupByThread([row({ thread_key: undefined, taxonomy: undefined })], "probability");
  assert.equal(g2[0].key, "Cooling & Water Technology");
});

// ── rails ──────────────────────────────────────────────────────────────────

test("next-14-days rail is inclusive, open-only, soonest first", () => {
  assert.equal(addDays("2026-11-08", 14), "2026-11-22");
  const rows = [
    row({ prediction_id: "x", target_resolution_date: "2026-11-22" }),
    row({ prediction_id: "y", target_resolution_date: "2026-11-09" }),
    row({ prediction_id: "z", target_resolution_date: "2026-11-23" }),
    row({ prediction_id: "w", target_resolution_date: "2026-11-07" }),
    row({ prediction_id: "v", target_resolution_date: "2026-11-10", status: "confirmed" }),
  ];
  assert.deepEqual(resolvingSoon(rows, "2026-11-08").map((r) => r.prediction_id), ["y", "x"]);
});

// ── sparkline ──────────────────────────────────────────────────────────────

test("sparkline delta text: arrows, never empty strings", () => {
  assert.equal(sparkDeltaText([70, 72, 76]), "▲ 6 · 3d");
  assert.equal(sparkDeltaText([80, 76]), "▼ 4 · 2d");
  assert.equal(sparkDeltaText([70, 72, 70]), null);
  assert.equal(sparkDeltaText([70]), null);
  assert.equal(sparkDeltaText(undefined), null);
});

// ── watchlist + votes ──────────────────────────────────────────────────────

test("watchlist reducer + tolerant parse", () => {
  assert.deepEqual(toggleWatch([], "a"), ["a"]);
  assert.deepEqual(toggleWatch(["a", "b"], "a"), ["b"]);
  assert.deepEqual(parseWatchlist('["a","a",3,"b"]'), ["a", "b"]);
  assert.deepEqual(parseWatchlist("not json"), []);
  assert.deepEqual(parseWatchlist(null), []);
});

test("vote reducer: insert, switch, idempotent repeat; counts gated at 5", () => {
  const z = { agree: 0, disagree: 0 };
  assert.deepEqual(applyVote(z, undefined, "agree"), { agree: 1, disagree: 0 });
  assert.deepEqual(applyVote({ agree: 1, disagree: 0 }, "agree", "disagree"), { agree: 0, disagree: 1 });
  assert.deepEqual(applyVote({ agree: 1, disagree: 0 }, "agree", "agree"), { agree: 1, disagree: 0 });
  assert.deepEqual(parseMyVotes('{"a":"agree","b":"yes","c":"disagree"}'), { a: "agree", c: "disagree" });
  assert.deepEqual(parseMyVotes("[1]"), {});
  assert.equal(voteCountLine({ agree: 3, disagree: 1 }), FIRST_VOTE_LINE);
  assert.equal(voteCountLine({ agree: 61, disagree: 14 }), "61 · 14");
  assert.equal(voteCountLine(null), FIRST_VOTE_LINE);
});

// ── marks + copy ───────────────────────────────────────────────────────────

test("monogram initials", () => {
  assert.equal(monogram("LG Electronics"), "LE");
  assert.equal(monogram("NVIDIA"), "NV");
  assert.equal(monogram("Cooling & Water Technology"), "CW");
  assert.equal(monogram(""), "F");
});

test("short date has no timezone drift", () => {
  assert.equal(shortDate("2026-11-16"), "Nov 16");
  assert.equal(shortDate("2026-12-01T00:00:00Z"), "Dec 1");
  assert.equal(shortDate(null), null);
});

test("record pill: counts + Brier, never a rate or a taxonomy count", () => {
  const t = recordPillText({ graded: 84, confirmed: 37, partial: 18, refuted: 1, not_observed: 28, inconclusive: 0, brier: 0.189831, caveat: null });
  assert.equal(t, "84 graded · 37 right · 29 missed · Brier 0.190");
  assert.ok(!ACCURACY_CLAIM_RE.test(t!));
  assert.ok(!TAXONOMY_COUNT_RE.test(t!));
  assert.equal(recordPillText(null), null);
});

test("disclaimer is verbatim", () => {
  assert.equal(
    DISCLAIMER,
    "Faraday Predicts publishes Faraday's own analytical forecasts and grades them in public. Nothing here is a market, a wager, a price or investment advice.",
  );
});

test("band label never prints a market word", () => {
  assert.equal(bandLabel("Roughly Even Odds"), "Roughly even");
  assert.equal(bandLabel("Highly Likely"), "Highly likely");
  assert.equal(bandLabel("Likely"), "Likely");
  assert.equal(bandLabel(null), null);
});

// ── FDY-274 ────────────────────────────────────────────────────────────────
import {
  clampTitle,
  companyCountLine,
  contiguousRuns,
  historyChanges,
  moverBadge,
  sinceCalledText,
  sortMovers,
  statusStrip,
  publicNote,
} from "./predicts-v3.ts";

test("history → dated changes, flat history has none", () => {
  const h = [
    { date: "2026-10-01", probability: 60 },
    { date: "2026-10-02", probability: 60 },
    { date: "2026-10-03", probability: 66 },
    { date: "2026-10-05", probability: 62 },
  ];
  assert.deepEqual(historyChanges(h), [
    { date: "2026-10-03", from: 60, to: 66, delta: 6 },
    { date: "2026-10-05", from: 66, to: 62, delta: -4 },
  ]);
  assert.deepEqual(historyChanges([{ date: "2026-10-01", probability: 70 }, { date: "2026-10-02", probability: 70 }]), []);
  assert.equal(sinceCalledText(h, 62), "▲ 2 since called");
  assert.equal(sinceCalledText(h, 60), null);
  assert.deepEqual(contiguousRuns(h).map((r) => r.length), [3, 1]);
});

test("title clamp ≤ 80 chars on a word boundary", () => {
  const long = "By November 16, 2026, LG Electronics will not have issued any public announcement retracting the deal.";
  const t = clampTitle(long);
  assert.ok(t.length <= 80, t);
  assert.ok(t.endsWith("…"));
  assert.equal(clampTitle("Short claim."), "Short claim.");
});

test("movers sort by |delta| in the chosen window; badges are glyphs", () => {
  const rows = [
    { prediction_id: "a", delta_7d: 3, delta_14d: 9 },
    { prediction_id: "b", delta_7d: -6, delta_14d: null },
    { prediction_id: "c", delta_7d: 0, delta_14d: -2 },
  ];
  assert.deepEqual(sortMovers(rows, 7).map((r) => r.prediction_id), ["b", "a"]);
  assert.deepEqual(sortMovers(rows, 14).map((r) => r.prediction_id), ["a", "c"]);
  assert.equal(moverBadge(6, 7), "▲ 6 in 7d");
  assert.equal(moverBadge(-4, 14), "▼ 4 in 14d");
  assert.equal(moverBadge(0, 7), null);
});

test("company count line is counts only", () => {
  assert.equal(companyCountLine(3, 2), "3 open · 2 graded");
  assert.ok(!/%/.test(companyCountLine(3, 2)));
});

test("status strip labels", () => {
  assert.equal(statusStrip({ status: "active", target_resolution_date: "2026-11-16", resolution_date: null }).label, "Open · resolves Nov 16, 2026");
  assert.equal(statusStrip({ status: "not_observed", outcome: "didnt_happen", target_resolution_date: null, resolution_date: "2026-11-07" }).label, "Didn't happen · graded Nov 7, 2026");
  assert.equal(statusStrip({ status: "confirmed", target_resolution_date: null, resolution_date: "2026-11-05" }).tone, "right");
});

test("publicNote drops the leading internal verdict word", () => {
  assert.equal(publicNote("NOT_OBSERVED. No evidence was retrieved."), "No evidence was retrieved.");
  assert.equal(publicNote("CONFIRMED. Multiple analyses agree."), "Multiple analyses agree.");
  assert.equal(publicNote("TSMC said so."), "TSMC said so.");
  assert.equal(publicNote("NOT_OBSERVED."), null);
  assert.equal(publicNote(null), null);
  assert.equal(publicNote("NOT_OBSERVED. No update, which is required for CONFIRMED."), "No update, which is required for confirmed.");
});

import {
  CAL_TICKS,
  dotRadius,
  missedCount,
  parseReceiptsState,
  receiptsQuery,
  recordTiles,
  serializeReceiptsState,
  showCalibration,
} from "./predicts-v3.ts";

const REC = { graded: 84, confirmed: 37, partial: 18, refuted: 1, not_observed: 28, inconclusive: 0, brier: 0.189831, caveat: null };

test("missed = wrong + didn't happen", () => {
  assert.equal(missedCount(REC), 29);
});

test("record tiles: four count labels, never a rate", () => {
  const t = recordTiles(REC);
  assert.deepEqual(t.map((x) => x.label), ["Graded", "Right", "Partly right", "Missed"]);
  assert.deepEqual(t.map((x) => x.value), [84, 37, 18, 29]);
  assert.equal(t[3].sub, "1 wrong · 28 didn't happen");
  for (const x of t) assert.doesNotMatch(`${x.label} ${x.sub ?? ""}`, /%|rate|accura/i);
});

test("√n radius is clamped to 4–14", () => {
  assert.equal(dotRadius(0, 40), 4);
  assert.equal(dotRadius(40, 40), 14);
  assert.equal(dotRadius(400, 40), 14);
  assert.equal(dotRadius(10, 40), 9);
  assert.ok(dotRadius(1, 40) >= 4);
});

test("calibration axis labels carry no % sign", () => {
  for (const t of CAL_TICKS) assert.doesNotMatch(t, /%/);
});

test("calibration only when the API marks it and ≥3 bands exist", () => {
  const caps = { taxonomy: true, companies: true, history: true, movers: true, velocity: false, calibration: true, votes: true };
  const b = { band: "x", predicted_mid: 50, observed_rate: 50, n: 3 };
  assert.equal(showCalibration(caps, [b, b, b]), true);
  assert.equal(showCalibration(caps, [b, b]), false);
  assert.equal(showCalibration({ ...caps, calibration: false }, [b, b, b]), false);
  assert.equal(showCalibration(caps, undefined), false);
});

test("receipts URL state round-trips and maps h → horizon upstream", () => {
  const s = parseReceiptsState(new URLSearchParams("outcome=missed&theater=The+Power+Reckoning&company=nvidia&h=30d&junk=1"));
  assert.equal(serializeReceiptsState(s), "/predicts/receipts?outcome=missed&theater=The+Power+Reckoning&company=nvidia&h=30d");
  assert.equal(receiptsQuery(s, "abc"), "view=receipts&outcome=missed&theater=The+Power+Reckoning&company=nvidia&horizon=30d&cursor=abc");
  assert.deepEqual(parseReceiptsState(new URLSearchParams("outcome=wrong&h=7y&company=Bad Co")), {
    outcome: "all", theater: null, sector: null, company: null, h: null,
  });
});

import { publicCaveat } from "./predicts-v3.ts";

test("caveat keeps its words but never shows a status code", () => {
  assert.equal(
    publicCaveat("every miss on record rests on absence rather than contrary evidence (22 not_observed, 0 refuted): the score is only as good as the corpus"),
    "every miss on record rests on absence rather than contrary evidence (22 didn't happen, 0 wrong): the score is only as good as the corpus",
  );
  assert.equal(publicCaveat(null), null);
});
