// Faraday Predicts UI 3.0 (FDY-273, epic FDY-270) — pure rules for the new shell.
//
// No React, no fetch, no env. predicts-v3.test.ts asserts everything here.
// The editorial invariants from predicts.ts still hold and are reused, not
// restated: never an accuracy percentage, never a count of Theaters / Sectors /
// Threads, never an internal code. This module adds the 3.0 rules: URL state for
// the Open board, the legacy ?view= redirect map, Thread-card grouping, sort
// comparators, the next-14-days rail, sparkline delta text, the watchlist and
// vote reducers, and monogram initials.

import { formatDate, type PredictsRecord, type PredictsRow } from "./predicts.ts";

// ── the v3 API shape (predicts-public v3, FDY-271) ─────────────────────────

export type Taxonomy = { theater: string | null; sector: string; thread: string | null };
export type Company = { name: string; slug: string; domain: string | null };
export type Votes = { agree: number; disagree: number };
export type Capabilities = {
  taxonomy: boolean;
  companies: boolean;
  history: boolean;
  movers: boolean;
  velocity: boolean;
  calibration: boolean;
  votes: boolean;
};

export type V3Row = PredictsRow & {
  taxonomy?: Taxonomy;
  companies?: Company[];
  thread_key?: string;
  votes?: Votes | null;
  sparkline?: number[];
  delta_7d?: number | null;
  delta_14d?: number | null;
};

export type CompanyIndexEntry = Company & { open_count: number; graded_count: number };

export const NO_CAPABILITIES: Capabilities = {
  taxonomy: false,
  companies: false,
  history: false,
  movers: false,
  velocity: false,
  calibration: false,
  votes: false,
};

/** Verbatim footer line for every /predicts route (Trust & Compliance). */
export const DISCLAIMER =
  "Faraday Predicts publishes Faraday's own analytical forecasts and grades them in public. Nothing here is a market, a wager, a price or investment advice.";

// ── Open board URL state ──────────────────────────────────────────────────

export const OPEN_HORIZONS = ["all", "30d", "60d", "90d", "6m", "12m", "24m"] as const;
export type OpenHorizon = (typeof OPEN_HORIZONS)[number];

export const HORIZON_CHOICES: { value: OpenHorizon; label: string }[] = [
  { value: "all", label: "All" },
  { value: "30d", label: "30 days" },
  { value: "60d", label: "60 days" },
  { value: "90d", label: "90 days" },
  { value: "6m", label: "6 months" },
  { value: "12m", label: "12 months" },
  { value: "24m", label: "24 months" },
];

export const OPEN_SORTS = ["probability", "resolves", "newest", "bold"] as const;
export type OpenSort = (typeof OPEN_SORTS)[number];

export const SORT_CHOICES: { value: OpenSort; label: string }[] = [
  { value: "probability", label: "Probability" },
  { value: "resolves", label: "Resolves soonest" },
  { value: "newest", label: "Newest" },
  { value: "bold", label: "Bold first" },
];

export type OpenState = {
  h: OpenHorizon;
  theater: string | null;
  sector: string | null;
  thread: string | null;
  company: string | null;
  q: string | null;
  sort: OpenSort;
  bold: boolean;
  watching: boolean;
};

export const DEFAULT_OPEN_STATE: OpenState = {
  h: "all",
  theater: null,
  sector: null,
  thread: null,
  company: null,
  q: null,
  sort: "probability",
  bold: false,
  watching: false,
};

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined> | null | undefined;

function getParam(src: ParamSource, key: string): string | null {
  if (!src) return null;
  if (src instanceof URLSearchParams) return src.get(key);
  const v = src[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function cleanText(v: string | null, max: number): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
}

/** Forgiving: a pasted or stale link lands on the board, never on an error. */
export function parseOpenState(src: ParamSource): OpenState {
  const h = getParam(src, "h");
  const sort = getParam(src, "sort");
  const company = getParam(src, "company");
  return {
    h: (OPEN_HORIZONS as readonly string[]).includes(h ?? "") ? (h as OpenHorizon) : "all",
    theater: cleanText(getParam(src, "theater"), 120),
    sector: cleanText(getParam(src, "sector"), 120),
    thread: cleanText(getParam(src, "thread"), 120),
    company: company && /^[a-z0-9][a-z0-9-]{0,79}$/.test(company) ? company : null,
    q: cleanText(getParam(src, "q"), 80),
    sort: (OPEN_SORTS as readonly string[]).includes(sort ?? "") ? (sort as OpenSort) : "probability",
    bold: getParam(src, "bold") === "1",
    watching: getParam(src, "watching") === "1",
  };
}

/** Canonical URL: defaults are omitted, so the bare board is just /predicts. */
export function serializeOpenState(s: OpenState): string {
  const p = new URLSearchParams();
  if (s.h !== "all") p.set("h", s.h);
  if (s.theater) p.set("theater", s.theater);
  if (s.sector) p.set("sector", s.sector);
  if (s.thread) p.set("thread", s.thread);
  if (s.company) p.set("company", s.company);
  if (s.q) p.set("q", s.q);
  if (s.sort !== "probability") p.set("sort", s.sort);
  if (s.bold) p.set("bold", "1");
  if (s.watching) p.set("watching", "1");
  const qs = p.toString();
  return qs ? `/predicts?${qs}` : "/predicts";
}

/** Filters that live behind the Filter button (Theater chips and search are
 *  visible on the page, so they do not count toward the badge). */
export function activeFilterCount(s: OpenState): number {
  return [s.h !== "all", !!s.sector, !!s.company, !!s.thread, s.bold, s.watching, s.sort !== "probability"].filter(
    Boolean,
  ).length;
}

// ── legacy ?view= redirects (pre-3.0 links) ──────────────────────────────────

const LEGACY_OUTCOMES = new Set(["all", "right", "partly", "missed"]);

/** Old /predicts?view=… links → the 3.0 route. null = not a legacy link. */
export function legacyRedirect(src: ParamSource): string | null {
  const view = getParam(src, "view");
  if (view === null) return null;
  if (view === "right") return "/predicts/receipts?outcome=right";
  if (view === "receipts") {
    const o = getParam(src, "outcome");
    return o && LEGACY_OUTCOMES.has(o) && o !== "all" ? `/predicts/receipts?outcome=${o}` : "/predicts/receipts";
  }
  if (view === "open") {
    const h = getParam(src, "h");
    return h && (OPEN_HORIZONS as readonly string[]).includes(h) && h !== "all" ? `/predicts?h=${h}` : "/predicts";
  }
  return "/predicts";
}

// ── filtering + sorting ────────────────────────────────────────────────────

const ieq = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

export function matchesOpenState(r: V3Row, s: OpenState, watched: ReadonlySet<string>): boolean {
  if (s.h !== "all" && r.horizon_bucket !== s.h) return false;
  if (s.theater && !ieq(r.taxonomy?.theater, s.theater)) return false;
  if (s.sector && !ieq(r.taxonomy?.sector ?? r.sector_name, s.sector)) return false;
  if (s.thread && !ieq(r.taxonomy?.thread, s.thread) && !ieq(r.thread_key, s.thread)) return false;
  if (s.company && !(r.companies ?? []).some((c) => c.slug === s.company)) return false;
  if (s.bold && !r.is_bold) return false;
  if (s.watching && !watched.has(r.prediction_id)) return false;
  if (s.q) {
    const hay = [
      r.prediction_text,
      r.taxonomy?.thread ?? "",
      r.taxonomy?.sector ?? r.sector_name ?? "",
      ...(r.companies ?? []).map((c) => c.name),
    ]
      .join("\n")
      .toLowerCase();
    if (!hay.includes(s.q.toLowerCase())) return false;
  }
  return true;
}

export function rowComparator(sort: OpenSort): (a: V3Row, b: V3Row) => number {
  const byProb = (a: V3Row, b: V3Row) =>
    b.probability_score - a.probability_score || a.prediction_id.localeCompare(b.prediction_id);
  switch (sort) {
    case "resolves":
      return (a, b) =>
        (a.target_resolution_date ?? "9999").localeCompare(b.target_resolution_date ?? "9999") || byProb(a, b);
    case "newest":
      return (a, b) => b.date_created.localeCompare(a.date_created) || byProb(a, b);
    case "bold":
      return (a, b) => Number(b.is_bold) - Number(a.is_bold) || byProb(a, b);
    default:
      return byProb;
  }
}

// ── Thread cards ─────────────────────────────────────────────────────────

export type ThreadGroup = {
  key: string;
  /** Headline for the card. */
  title: string;
  theater: string | null;
  sector: string;
  rows: V3Row[];
  /** Set when every row in the group names the same company. */
  sharedCompany: Company | null;
};

export function threadKeyOf(r: V3Row): string {
  return r.thread_key ?? r.taxonomy?.thread ?? r.taxonomy?.sector ?? r.sector_name ?? "Faraday";
}

/** Group rows by thread_key. Rows inside a group follow `sort`; groups are
 *  ordered by applying the same comparator to each group's top row. */
export function groupByThread(rows: V3Row[], sort: OpenSort): ThreadGroup[] {
  const cmp = rowComparator(sort);
  const map = new Map<string, V3Row[]>();
  for (const r of rows) {
    const k = threadKeyOf(r);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  const groups: ThreadGroup[] = [];
  for (const [key, list] of map) {
    list.sort(cmp);
    const top = list[0];
    const first = top.companies?.[0] ?? null;
    const shared = first && list.every((r) => (r.companies ?? []).some((c) => c.slug === first.slug)) ? first : null;
    groups.push({
      key,
      title: key,
      theater: top.taxonomy?.theater ?? null,
      sector: top.taxonomy?.sector ?? top.sector_name ?? "Faraday",
      rows: list,
      sharedCompany: shared,
    });
  }
  groups.sort((a, b) => cmp(a.rows[0], b.rows[0]) || a.key.localeCompare(b.key));
  return groups;
}

export const THREAD_CARD_MAX_ROWS = 4;

// ── rails ──────────────────────────────────────────────────────────────────

/** YYYY-MM-DD `days` after `today` (YYYY-MM-DD), computed on UTC parts. */
export function addDays(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Open calls resolving within the next 14 days (inclusive), soonest first. */
export function resolvingSoon(rows: V3Row[], today: string, days = 14): V3Row[] {
  const end = addDays(today, days);
  return rows
    .filter((r) => r.status === "active" && r.target_resolution_date && r.target_resolution_date >= today &&
      r.target_resolution_date <= end)
    .sort(rowComparator("resolves"));
}

// ── sparkline ──────────────────────────────────────────────────────────────

/** "▲ 6 · 30d" when the line moved, null when flat or absent. Arrows are
 *  glyphs, never colour. */
export function sparkDeltaText(spark: number[] | null | undefined): string | null {
  if (!spark || spark.length < 2) return null;
  const delta = spark[spark.length - 1] - spark[0];
  if (delta === 0) return null;
  return `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)} · ${spark.length}d`;
}

// ── watchlist + votes (device-local) ───────────────────────────────────────

export const WATCH_KEY = "faraday_predicts_watch";
export const VOTES_KEY = "faraday_predicts_votes";

export function toggleWatch(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function parseWatchlist(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : [];
  } catch {
    return [];
  }
}

export type VoteChoice = "agree" | "disagree";
export type MyVotes = Record<string, VoteChoice>;

export function parseMyVotes(raw: string | null): MyVotes {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: MyVotes = {};
    for (const [k, val] of Object.entries(v)) if (val === "agree" || val === "disagree") out[k] = val;
    return out;
  } catch {
    return {};
  }
}

/** Optimistic count update for a tap. Same vote again changes nothing. */
export function applyVote(counts: Votes, prev: VoteChoice | undefined, next: VoteChoice): Votes {
  if (prev === next) return counts;
  const out = { ...counts };
  if (prev) out[prev] = Math.max(0, out[prev] - 1);
  out[next] = out[next] + 1;
  return out;
}

export const VOTE_COUNT_FLOOR = 5;
export const FIRST_VOTE_LINE = "Be the first to weigh in";

/** "61 · 14" once at least 5 people have weighed in, else the invitation. */
export function voteCountLine(v: Votes | null | undefined): string {
  if (!v || v.agree + v.disagree < VOTE_COUNT_FLOOR) return FIRST_VOTE_LINE;
  return `${v.agree} · ${v.disagree}`;
}

// ── marks ───────────────────────────────────────────────────────────────────

const STOP = new Set(["and", "of", "the", "&", "for", "in", "on"]);

/** Up to two initials from the significant words of a name. */
export function monogram(name: string | null | undefined): string {
  const words = String(name ?? "")
    .replace(/[^A-Za-z0-9& ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()));
  if (!words.length) return "F";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// ── small formatters ───────────────────────────────────────────────────────

/** Display label for the engine's probability band. The stored band
 *  "Roughly Even Odds" carries a market word ("odds") that Predicts copy must
 *  never print (Trust & Compliance), so it is shown as "Roughly even". The
 *  stored value is untouched. */
export function bandLabel(band: string | null | undefined): string | null {
  if (!band) return null;
  const cleaned = band.replace(/\s*\bodds\b/gi, "").trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase() : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 16" from YYYY-MM-DD, string parts only (no Date — no timezone drift). */
export function shortDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : null;
}

export { formatDate };

/** The app-bar record pill. Counts and the Brier only — never a rate. */
export function recordPillText(r: PredictsRecord | null | undefined): string | null {
  if (!r) return null;
  const missed = (r.refuted ?? 0) + (r.not_observed ?? 0);
  const parts = [`${r.graded} graded`, `${r.confirmed} right`, `${missed} missed`];
  if (typeof r.brier === "number" && Number.isFinite(r.brier)) parts.push(`Brier ${r.brier.toFixed(3)}`);
  return parts.join(" · ");
}

/** Today in US Central as YYYY-MM-DD (the serve day for "next 14 days"). */
export function todayCentral(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now);
}

// ── forecast page, company page, Movers (FDY-274) ─────────────────────────

export type HistoryPoint = { date: string; probability: number };
export type HistoryChange = { date: string; from: number; to: number; delta: number };

/** Dated changes in the published probability, oldest first. A flat history
 *  yields []. Built only from the points that exist — never interpolated. */
export function historyChanges(history: HistoryPoint[] | null | undefined): HistoryChange[] {
  const out: HistoryChange[] = [];
  const h = history ?? [];
  for (let i = 1; i < h.length; i++) {
    if (h[i].probability !== h[i - 1].probability) {
      out.push({ date: h[i].date, from: h[i - 1].probability, to: h[i].probability, delta: h[i].probability - h[i - 1].probability });
    }
  }
  return out;
}

/** "▲ 6" / "▼ 4" for change since the first recorded point; null when unchanged. */
export function sinceCalledText(history: HistoryPoint[] | null | undefined, current: number): string | null {
  const first = history?.[0]?.probability;
  if (typeof first !== "number" || first === current) return null;
  const d = current - first;
  return `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} since called`;
}

/** Split a daily series into runs of consecutive days, so a chart never draws
 *  a line across a day with no record (gaps stay gaps). */
export function contiguousRuns(history: HistoryPoint[]): HistoryPoint[][] {
  const runs: HistoryPoint[][] = [];
  let cur: HistoryPoint[] = [];
  for (const p of history) {
    const prev = cur[cur.length - 1];
    if (prev && addDays(prev.date, 1) !== p.date) {
      runs.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** Clamp a claim for a <title>: ≤ max chars on a word boundary, with an ellipsis. */
export function clampTitle(text: string, max = 80): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  const sp = head.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? head.slice(0, sp) : head).replace(/[\s,;:.-]+$/, "")}…`;
}

export type MoverWindow = 7 | 14;

/** Rows that moved in the window, by |delta| desc (ties: id). */
export function sortMovers<T extends { prediction_id: string; delta_7d?: number | null; delta_14d?: number | null }>(
  rows: T[],
  window: MoverWindow,
): T[] {
  const d = (r: T) => (window === 7 ? r.delta_7d : r.delta_14d);
  return rows
    .filter((r) => typeof d(r) === "number" && d(r) !== 0)
    .sort((a, b) => Math.abs(d(b) as number) - Math.abs(d(a) as number) || a.prediction_id.localeCompare(b.prediction_id));
}

export function moverBadge(delta: number | null | undefined, window: MoverWindow): string | null {
  if (typeof delta !== "number" || delta === 0) return null;
  return `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta)} in ${window}d`;
}

/** "3 open · 2 graded" — counts only, never a rate. */
export function companyCountLine(open: number, graded: number): string {
  return `${open} open · ${graded} graded`;
}

export type StatusStrip = { label: string; date: string | null; tone: "open" | "right" | "partly" | "miss" | "undetermined" };

/** Status strip for the forecast page. Text label always present. */
export function statusStrip(row: { status: string; outcome?: string | null; target_resolution_date: string | null; resolution_date: string | null }): StatusStrip {
  const resolveBy = formatDate(row.target_resolution_date);
  const graded = formatDate(row.resolution_date);
  switch (row.outcome ?? (row.status === "active" ? "open" : row.status)) {
    case "open":
    case "active":
      return { label: `Open · resolves ${resolveBy ?? "—"}`, date: resolveBy, tone: "open" };
    case "right":
    case "confirmed":
      return { label: `Right · graded ${graded ?? "—"}`, date: graded, tone: "right" };
    case "partly":
    case "partial":
      return { label: `Partly right · graded ${graded ?? "—"}`, date: graded, tone: "partly" };
    case "wrong":
    case "refuted":
      return { label: `Wrong · graded ${graded ?? "—"}`, date: graded, tone: "miss" };
    case "didnt_happen":
    case "not_observed":
      return { label: `Didn't happen · graded ${graded ?? "—"}`, date: graded, tone: "miss" };
    default:
      return { label: `Undetermined · graded ${graded ?? "—"}`, date: graded, tone: "undetermined" };
  }
}

export const RESOLVES_COPY =
  "When the resolve-by date arrives, Faraday grades the call against public evidence. A call whose event has not happened by its date is a miss.";

/** Grader notes open with an internal verdict word ("CONFIRMED.",
 *  "NOT_OBSERVED."); the page already shows the outcome in plain words, so the
 *  code is dropped rather than shown. */
const VERDICT_WORDS: Record<string, string> = {
  CONFIRMED: "confirmed",
  PARTIAL: "partly right",
  REFUTED: "refuted",
  NOT_OBSERVED: "not observed",
  INCONCLUSIVE: "inconclusive",
  EXPIRED: "expired",
};

export function publicNote(note: string | null | undefined): string | null {
  const t = (note ?? "")
    .replace(/^\s*[A-Z][A-Z_]{2,}[.:]\s*/, "")
    .replace(/\b(CONFIRMED|PARTIAL|REFUTED|NOT_OBSERVED|INCONCLUSIVE|EXPIRED)\b/g, (w) => VERDICT_WORDS[w])
    .trim();
  return t || null;
}
