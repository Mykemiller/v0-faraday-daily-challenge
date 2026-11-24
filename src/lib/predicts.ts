// Faraday Predicts — the public /predicts surface (26-41-v01 P9, FDY-147).
//
// Pure logic only: types, formatters, the track-record line and URL state.
// No React, no fetch, no `process.env` — so `predicts.test.ts` can assert the
// copy rules directly, which is the point. Three of the rules here are
// editorial invariants rather than formatting preferences:
//
//   1. NEVER print an accuracy percentage. The graded set is 20 confirmed + 10
//      partial + 40 inconclusive and **0 misses** (measured 2026-10-09 16:40
//      CT). A Brier over a loss-free set rewards over-confidence — 99%-on-
//      everything would score better — so "67% accurate" would be a number
//      with no defensible meaning. The engine's own calibration snapshot says
//      `sufficient` but its first reason is that no miss has ever been
//      recorded. Report counts and the Brier; never a hit rate.
//   2. ALWAYS carry the no-misses line while refuted + not_observed = 0, so the
//      record is never read as a clean sheet.
//   3. NEVER print a count of Sectors, Theaters or Threads (IDF governance).
//      Counting FORECASTS per horizon is fine; counting taxonomy is not.

export const PREDICTS_VIEWS = ["open", "right", "receipts"] as const;
export type PredictsView = (typeof PREDICTS_VIEWS)[number];

export const PREDICTS_HORIZONS = ["30d", "60d", "90d", "6m", "12m", "24m"] as const;
export type PredictsHorizon = (typeof PREDICTS_HORIZONS)[number];

/** The ladder in reading order, with the selector labels. Mirrors
 *  HORIZON_LADDER in the predicts-public edge function and HORIZON_GROUPS in
 *  faraday-predicts-digest, so the page, the API and the email agree. */
export const HORIZON_LABELS: { bucket: PredictsHorizon; label: string }[] = [
  { bucket: "30d", label: "30 days" },
  { bucket: "60d", label: "60 days" },
  { bucket: "90d", label: "90 days" },
  { bucket: "6m", label: "6 months" },
  { bucket: "12m", label: "12 months" },
  { bucket: "24m", label: "24 months" },
];

export const DEFAULT_HORIZON: PredictsHorizon = "30d";

// ── Receipts (26-45-v01, FDY-114) ──────────────────────────────────────────
//
// Every graded forecast, hits and misses on the same card at the same size.
// `missed` is wrong + didn't happen together: the filter never splits the two
// kinds of miss, so neither can be quietly left out of the "Missed" view.

export const OUTCOME_FILTERS = ["all", "right", "partly", "missed"] as const;
export type OutcomeFilter = (typeof OUTCOME_FILTERS)[number];

export const OUTCOME_CHIPS: { outcome: OutcomeFilter; label: string }[] = [
  { outcome: "all", label: "All" },
  { outcome: "right", label: "Right" },
  { outcome: "partly", label: "Partly right" },
  { outcome: "missed", label: "Missed" },
];

export type ReceiptOutcome = "right" | "partly" | "wrong" | "didnt_happen" | "undetermined";

/** Badge for a receipt. Always a text label, never colour alone. Both kinds of
 *  miss are red. */
export function receiptBadge(
  outcome: string | null | undefined,
): { label: string; tone: "right" | "partly" | "miss" | "undetermined" } | null {
  switch (outcome) {
    case "right":
      return { label: "Right", tone: "right" };
    case "partly":
      return { label: "Partly right", tone: "partly" };
    case "wrong":
      return { label: "Wrong", tone: "miss" };
    case "didnt_happen":
      return { label: "Didn't happen", tone: "miss" };
    case "undetermined":
      return { label: "Undetermined", tone: "undetermined" };
    default:
      return null;
  }
}

export const RECEIPTS_EMPTY = "No receipts in this filter yet.";

/** Shown in place of the Evidence link on a "Didn't happen" card with no link:
 *  the absence IS the evidence, so say what was absent and by when. */
export function noEvidenceLine(due: string | null | undefined): string | null {
  const d = formatDate(due);
  return d ? `No evidence it happened by ${d}` : null;
}

// ── the API contract (predicts-public) ──────────────────────────────────────

export type PredictsRow = {
  prediction_id: string;
  prediction_text: string;
  probability_score: number;
  probability_band: string | null;
  horizon_bucket: string | null;
  target_resolution_date: string | null;
  date_created: string;
  is_bold: boolean;
  status: string;
  resolution_date: string | null;
  resolution_note: string | null;
  sector_name: string | null;
  is_new: boolean;
  /** view=receipts only. */
  outcome?: ReceiptOutcome;
  thin_evidence?: boolean;
  evidence_url?: string | null;
  /** FDY-262 (Velocity 3.0). Each is present only when the forecast carries it;
   *  predicts-public omits the key otherwise (legacy forecasts). */
  velocity_tag?: string;
  evidence_posture?: { observed?: unknown; projected?: unknown };
  /** Plain source NAMES, already translated server-side. Never codes. */
  source_layers?: unknown;
};

export type PredictsRecord = {
  graded: number;
  confirmed: number;
  partial: number;
  refuted: number;
  not_observed: number;
  inconclusive: number;
  brier: number | null;
  caveat: string | null;
};

export type PredictsResponse = {
  ok: boolean;
  view: PredictsView;
  horizon?: PredictsHorizon;
  include_partial?: boolean;
  release_tag: string | null;
  record: PredictsRecord;
  record_as_of: string | null;
  horizon_counts: Partial<Record<PredictsHorizon, number>>;
  /** view=receipts only: forecasts per outcome chip, under the same filters. */
  outcome_counts?: Partial<Record<OutcomeFilter, number>>;
  /** view=receipts only: pass back as `cursor` for the next 50; null on the last page. */
  next_cursor?: string | null;
  count: number;
  predictions: PredictsRow[];
};

// ── dates ───────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format a `YYYY-MM-DD` date as `Mon D, YYYY`.
 *
 *  ⚠️ Built from the string parts, never through `new Date(s)`. `new Date(
 *  "2026-11-07")` parses as UTC midnight, and a reader in US Central then sees
 *  **Nov 6** — every resolves-by date on the page a day early, which on a page
 *  whose whole claim is "dated calls, graded on the date" is a correctness bug,
 *  not a cosmetic one. No Date object is constructed here at all. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return null;
  return `${month} ${Number(d)}, ${y}`;
}

// ── the track-record strip (§2) ─────────────────────────────────────────────

/** The no-misses line. Shown whenever refuted + not_observed = 0 — which is
 *  the live state (0 and 0, measured 2026-10-09 16:40 CT) and the reason the
 *  calibration snapshot's own first caveat exists. */
export const NO_MISSES_LINE = "No misses recorded yet — grading is still maturing.";

export type TrackRecordView = {
  /** The strip, already assembled. Counts and Brier only — never a hit rate. */
  line: string;
  /** `payload.reasons[0]` from the latest overall calibration snapshot, verbatim. */
  caveat: string | null;
  /** True while nothing has ever been refuted or gone unobserved. */
  noMisses: boolean;
};

export function trackRecord(record: PredictsRecord | null | undefined): TrackRecordView | null {
  if (!record) return null;
  // Misses sit in the strip beside the hits (FDY-114): wrong and didn't happen
  // are counted out loud, never folded away.
  const parts = [
    `${record.graded} forecasts graded`,
    `${record.confirmed} right`,
    `${record.partial} partly right`,
    `${record.refuted ?? 0} wrong`,
    `${record.not_observed ?? 0} didn't happen`,
    `${record.inconclusive} undetermined`,
  ];
  // A null Brier is a missing figure, not a 0.000 — the API already refuses to
  // coerce it, and the strip drops the segment rather than printing "Brier —".
  if (typeof record.brier === "number" && Number.isFinite(record.brier)) {
    parts.push(`Brier ${record.brier.toFixed(3)}`);
  }
  return {
    line: parts.join(" · "),
    caveat: record.caveat?.trim() ? record.caveat.trim() : null,
    noMisses: (record.refuted ?? 0) + (record.not_observed ?? 0) === 0,
  };
}

/** IDF governance (§8) + the no-accuracy-percentage rule (§2), as one check the
 *  page tests and the quality gate can both run.
 *  - `\d+ sectors|theaters|threads` is the locked taxonomy-count pattern.
 *  - a bare `NN%` is fine (every card shows a probability); the ban is on
 *    framing one as accuracy. */
export const TAXONOMY_COUNT_RE = /\b\d+\s+(sectors?|theaters?|threads?|domains?)\b/i;
export const ACCURACY_CLAIM_RE = /\b\d+(\.\d+)?\s*%\s*(accurate|accuracy|correct|right|hit rate)\b|\b(accuracy|hit rate)\b[^.]{0,20}\b\d+(\.\d+)?\s*%/i;

// ── empty state (§4) ────────────────────────────────────────────────────────

export function emptyHorizonMessage(bucket: PredictsHorizon): string {
  const label = HORIZON_LABELS.find((h) => h.bucket === bucket)?.label ?? bucket;
  return `No ${label} forecasts are open right now.`;
}

// ── URL state (§6) ──────────────────────────────────────────────────────────
//
// /predicts?view=open&h=30d and /predicts?view=right — deep-linkable, and the
// back button works. Note the URL says `h` while the API says `horizon`:
// `buildApiQuery` is the only place that translation happens.

export type PredictsUrlState = {
  view: PredictsView;
  horizon: PredictsHorizon;
  includePartial: boolean;
  /** view=receipts only. */
  outcome: OutcomeFilter;
};

export const DEFAULT_URL_STATE: PredictsUrlState = {
  view: "open",
  horizon: DEFAULT_HORIZON,
  includePartial: false,
  outcome: "all",
};

/** Read state from the URL. Unknown or missing values fall back to the default
 *  rather than erroring — a hand-edited or stale link should land on the page,
 *  not on an error. (The API is strict; the URL is forgiving. Those are
 *  different jobs: a bad param from our own code is a bug worth a 400, a bad
 *  param from a pasted link is just a visitor.) */
export function parseUrlState(params: URLSearchParams | null | undefined): PredictsUrlState {
  const get = (k: string) => params?.get(k) ?? null;
  const rawView = get("view");
  const view: PredictsView = (PREDICTS_VIEWS as readonly string[]).includes(rawView ?? "")
    ? (rawView as PredictsView)
    : "open";
  const rawH = get("h");
  const horizon: PredictsHorizon = (PREDICTS_HORIZONS as readonly string[]).includes(rawH ?? "")
    ? (rawH as PredictsHorizon)
    : DEFAULT_HORIZON;
  const rawOutcome = get("outcome");
  const outcome: OutcomeFilter = (OUTCOME_FILTERS as readonly string[]).includes(rawOutcome ?? "")
    ? (rawOutcome as OutcomeFilter)
    : "all";
  return { view, horizon, includePartial: get("partial") === "1", outcome };
}

/** The canonical URL for a state. Only the params that matter to the current
 *  view are written, so /predicts?view=right has no stale `h=` hanging off it. */
export function buildUrl(state: PredictsUrlState): string {
  const p = new URLSearchParams();
  p.set("view", state.view);
  if (state.view === "open") p.set("h", state.horizon);
  else if (state.view === "receipts") {
    if (state.outcome !== "all") p.set("outcome", state.outcome);
  } else if (state.includePartial) p.set("partial", "1");
  return `/predicts?${p.toString()}`;
}

/** The API query for a state. The edge function is STRICT — it 400s on a param
 *  belonging to the other view — so this sends `horizon` only for open and
 *  `include_partial` only for right. */
export function buildApiQuery(state: PredictsUrlState): string {
  const p = new URLSearchParams();
  p.set("view", state.view);
  if (state.view === "open") p.set("horizon", state.horizon);
  else if (state.view === "receipts") p.set("outcome", state.outcome);
  else p.set("include_partial", state.includePartial ? "true" : "false");
  return p.toString();
}

// ── card presentation ───────────────────────────────────────────────────────

/** Verdict badge for a graded forecast. `partial` is amber and says "Partly
 *  right" — never rounded up to a win. */
export function verdictBadge(status: string): { label: string; tone: "right" | "partly" } | null {
  if (status === "confirmed") return { label: "Right", tone: "right" };
  if (status === "partial") return { label: "Partly right", tone: "partly" };
  return null;
}

export const BOLD_CALL_TOOLTIP = "A contrarian call, scored separately — labeled, not inflated.";

// ── Velocity 3.0 on the card (FDY-262) ──────────────────────────────────────
//
// Three copy elements, and only three (pending Growth, Trust & Compliance and
// Editor review): the velocity chip label, the evidence line, and the "What we
// looked at" heading over a list of source names. Rules:
//   - D4: a forecast without the field renders NOTHING for it. Never a default
//     tag, never "Evidence: 0 observed", never an empty list.
//   - FD-2: never an L-code and never a count of source layers. The list is
//     shown, its length is not printed anywhere.
//   - D3: the chip is text plus an arrow glyph, never colour alone; brand
//     palette only (Gold = Accelerating, Sage = Stable, Near-black = Decelerating).

export type VelocityTone = "accelerating" | "stable" | "decelerating";

export const VELOCITY_CHIPS: Readonly<Record<VelocityTone, { label: string; glyph: string }>> = {
  accelerating: { label: "Accelerating", glyph: "↑" },
  stable: { label: "Stable", glyph: "→" },
  decelerating: { label: "Decelerating", glyph: "↓" },
};

/** The chip for a forecast, or null (unknown or absent tag → no chip). */
export function velocityChip(tag: unknown): { label: string; glyph: string; tone: VelocityTone } | null {
  if (typeof tag !== "string") return null;
  const t = tag.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(VELOCITY_CHIPS, t)) return null;
  const tone = t as VelocityTone;
  return { ...VELOCITY_CHIPS[tone], tone };
}

function evidenceCount(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** "Evidence: 3 observed · 4 projected", or null when the posture is absent,
 *  malformed, or both counts are zero (no fabricated line). */
export function evidenceLine(posture: unknown): string | null {
  if (!posture || typeof posture !== "object" || Array.isArray(posture)) return null;
  const p = posture as { observed?: unknown; projected?: unknown };
  const observed = evidenceCount(p.observed);
  const projected = evidenceCount(p.projected);
  if (observed === null || projected === null || observed + projected === 0) return null;
  return `Evidence: ${observed} observed · ${projected} projected`;
}

export const WHAT_WE_LOOKED_AT = "What we looked at";

/** Internal source-layer codes (L1–L10). The API never sends one; this is the
 *  card's second line of defence. */
export const LAYER_CODE_RE = /\bL\d+\b/i;

/** The source names to list: strings only, trimmed, de-duplicated, in the
 *  API's order. Anything code-like or numeric is dropped, never shown. */
export function sourceNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const name = v.trim();
    if (!name || name.length > 60 || LAYER_CODE_RE.test(name) || /\d/.test(name) || /layer/i.test(name)) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
