// Faraday Signal matcher (FAR-385).
//
// Pure, deterministic matching of the day's published dc_daily_signal rows to
// each of the day's 7 puzzles. Runs ONLY inside the sync-day-content cron —
// never at request time; the serve path stays one Supabase read of
// dc_daily_page_content. No I/O in this module.
//
// Matching is structured-first (per the FAR-385 design decision):
//   1. Pin override — pinned_for_date = serve date (+ optional
//      pinned_puzzle_type) wins outright; latest updated_at breaks collisions.
//   2. Sub-domain exact match  +10
//   3. Domain exact match       +5
//   4. Tag overlap              +2 per overlapping tag
//   5. Recency tiebreak — latest signal_date <= serve date, then updated_at.
//
// Puzzle-side metadata is whatever the Airtable-sourced sync has in hand
// (CC-1 / DC_PUZZLE_SOURCE has NOT landed — there is no staging
// subject_fingerprint yet): the resolved Domain / Sub-Domain public labels
// (null until Myke populates the bank's linked fields, FAR-178) and the
// puzzle's own subject line (`topic` = Puzzle Content `domain`) + name.
// Because domain links are unpopulated today, the domain/sub-domain rules also
// accept an exact label match against `topic` — deterministic, label-level,
// and it decays naturally once the structured fields arrive. Tag tokens draw
// from topic + puzzle name (the closest analog to subject_fingerprint).
//
// Signals carry IDF 4.0 PUBLIC LABELS ONLY (never D#/D#.# codes) — comparisons
// here are label-vs-label.

export type SignalMatchTier = "matched" | "lead" | "none";

export interface SignalCandidate {
  id: string;
  signal_date: string; // YYYY-MM-DD
  headline: string;
  body: string;
  source_url: string | null;
  source_label: string | null;
  domain: string | null; // public label, e.g. "Power Architecture"
  sub_domain: string | null; // public label
  tags: string[];
  pinned_for_date: string | null; // YYYY-MM-DD
  pinned_puzzle_type: string | null;
  published: boolean;
  updated_at: string; // ISO timestamp
}

export interface PuzzleSignalMeta {
  puzzle_type: string;
  /** Resolved IDF domain public label (null until the bank's Domain link is populated). */
  domain_name?: string | null;
  /** Resolved IDF sub-domain public label (null until the bank's Sub-Domain link is populated). */
  sub_domain?: string | null;
  /** The puzzle's own subject line (Puzzle Content `domain`). */
  topic?: string | null;
  puzzle_name?: string | null;
}

export interface SignalAssignment {
  signal_id: string | null;
  tier: SignalMatchTier;
}

/** A signal stays eligible for 3 serve days so a weekend doesn't go dark. */
export const SIGNAL_WINDOW_DAYS = 2;

/** Score at or above which a signal renders as "Related Signal". */
export const MATCHED_SCORE_FLOOR = 10;

const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "in", "on", "to", "for", "by", "at", "vs",
]);

function norm(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function tokens(v: unknown): string[] {
  return norm(v)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** dateISO minus n days, in plain YYYY-MM-DD arithmetic (UTC, no TZ drift). */
export function minusDays(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

function isValidISODate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Published + inside the 3-day serve window (pins are handled separately). */
function inWindow(s: SignalCandidate, dateISO: string): boolean {
  if (!s.published || !isValidISODate(s.signal_date)) return false;
  return s.signal_date <= dateISO && s.signal_date >= minusDays(dateISO, SIGNAL_WINDOW_DAYS);
}

/**
 * Deterministic per-(puzzle, signal) score. Exported for tests.
 */
export function scoreSignal(puzzle: PuzzleSignalMeta, signal: SignalCandidate): number {
  let score = 0;

  const puzzleSub = norm(puzzle.sub_domain);
  const puzzleDom = norm(puzzle.domain_name);
  const puzzleTopic = norm(puzzle.topic);

  const sigSub = norm(signal.sub_domain);
  const sigDom = norm(signal.domain);

  // Sub-domain exact match (+10) — against the resolved sub-domain label, or an
  // exact label match on the puzzle's own subject line while links are unpopulated.
  if (sigSub && (sigSub === puzzleSub || sigSub === puzzleTopic)) score += 10;

  // Domain exact match (+5), same acceptance rule.
  if (sigDom && (sigDom === puzzleDom || sigDom === puzzleTopic)) score += 5;

  // Tag overlap: +2 per distinct overlapping tag. A tag matches a whole puzzle
  // label exactly, or (single-word tags) a token drawn from topic/name/labels.
  const labelSet = new Set([puzzleSub, puzzleDom, puzzleTopic].filter(Boolean));
  const tokenSet = new Set([
    ...tokens(puzzle.sub_domain),
    ...tokens(puzzle.domain_name),
    ...tokens(puzzle.topic),
    ...tokens(puzzle.puzzle_name),
  ]);

  const seen = new Set<string>();
  for (const raw of Array.isArray(signal.tags) ? signal.tags : []) {
    const tag = norm(raw);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    const hit = labelSet.has(tag) || (!tag.includes(" ") && tokenSet.has(tag));
    if (hit) score += 2;
  }

  return score;
}

// Recency order: latest signal_date first, then latest updated_at. Stable for
// equal keys (callers pass arrays in a deterministic fetch order).
function moreRecent(a: SignalCandidate, b: SignalCandidate): number {
  if (a.signal_date !== b.signal_date) return a.signal_date > b.signal_date ? -1 : 1;
  const au = a.updated_at || "";
  const bu = b.updated_at || "";
  if (au !== bu) return au > bu ? -1 : 1;
  return 0;
}

/**
 * Match the day's signals to every puzzle. Duplicates across games are allowed
 * (no uniqueness constraint). Returns one assignment per puzzle_type:
 *   matched — pin override, or score >= MATCHED_SCORE_FLOOR
 *   lead    — no strong match, but >= 1 published signal in the window
 *             (highest-scoring one, recency tiebreak)
 *   none    — no published signal in the window (signal_id null)
 */
export function matchSignalsForDay(
  puzzles: PuzzleSignalMeta[],
  signals: SignalCandidate[],
  dateISO: string,
  warn: (msg: string) => void = (msg) => console.warn(msg)
): Map<string, SignalAssignment> {
  const out = new Map<string, SignalAssignment>();
  const list = Array.isArray(signals) ? signals : [];

  const pool = list.filter((s) => inWindow(s, dateISO));
  const pins = list.filter((s) => s.published && s.pinned_for_date === dateISO);

  for (const puzzle of puzzles) {
    const type = typeof puzzle?.puzzle_type === "string" ? puzzle.puzzle_type : "";
    if (!type) continue;

    // 1. Pin override — wins outright, regardless of the 3-day window.
    const applicablePins = pins.filter(
      (s) => !s.pinned_puzzle_type || norm(s.pinned_puzzle_type) === norm(type)
    );
    if (applicablePins.length) {
      const winner = [...applicablePins].sort(
        (a, b) => (a.updated_at || "") > (b.updated_at || "") ? -1 : (a.updated_at || "") < (b.updated_at || "") ? 1 : 0
      )[0];
      if (applicablePins.length > 1) {
        warn(
          `[signal-matcher] ${applicablePins.length} pinned signals collide for ${dateISO} / ${type}; most recently updated wins (${winner.id})`
        );
      }
      out.set(type, { signal_id: winner.id, tier: "matched" });
      continue;
    }

    // 2. Scored pool.
    if (!pool.length) {
      out.set(type, { signal_id: null, tier: "none" });
      continue;
    }
    const ranked = pool
      .map((s) => ({ s, score: scoreSignal(puzzle, s) }))
      .sort((a, b) => (b.score - a.score) || moreRecent(a.s, b.s));
    const best = ranked[0];
    out.set(type, {
      signal_id: best.s.id,
      tier: best.score >= MATCHED_SCORE_FLOOR ? "matched" : "lead",
    });
  }

  return out;
}
