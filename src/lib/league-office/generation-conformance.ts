// CC-LO-GEN-CONFORMANCE-1.0 — "configured vs generated", as one pure function.
//
// A season is configured twice over: a theme mix (which theaters/sectors the
// days belong to) and a difficulty mix (which bands the puzzles are), plus a
// slate that bounds each game to its own difficulty window. After a run, the
// only question that matters is whether the bank that came out resembles the
// configuration that went in — and until now the answer lived in whoever
// happened to run the SQL.
//
// This module answers it. It is deliberately a PURE function over plain
// objects: no React, no Next, no Supabase client, no I/O, no top-level side
// effects. The League Office panel calls it with rows it already loaded, and a
// plain node script can call it with rows from anywhere:
//
//   const { conformance } = await import("./src/lib/league-office/generation-conformance.ts");
//   const report = conformance({ themeMix, difficultyMix, slate, themeRows, bankRows, seasonDates });
//
// The two modules it imports (theme-allocation.js, difficulty.js) are
// themselves import-free and pure — they are imported rather than mirrored so
// that "what the mix MEANS" has exactly one definition: the one the generator
// allocated against.

// Relative, with the extension: the tests run under plain `node --test` (type
// stripping), which does not read tsconfig `paths`.
import {
  isTheaterTotalRow, normalizeTo100, themeExclusions,
} from "../generation/theme-allocation.js";
import {
  CANONICAL_BANDS, canonicalDifficulty, difficultyWindow,
} from "../generation/difficulty.js";

export type ConformanceDimension =
  | "theater" | "sector" | "difficulty" | "difficulty_window" | "coverage" | "exclusion";

export type ConformanceStatus = "ok" | "warn" | "fail";

export type ConformanceRow = {
  dimension: ConformanceDimension;
  /** The thing being compared: a theater id, `T-002/D11`, a band name, or the
   *  dimension's own single key for the three count rows. */
  key: string;
  /** Percentage points for the share dimensions; a COUNT for the others. */
  target: number;
  actual: number;
  /** actual − target, in the same unit. */
  delta: number;
  status: ConformanceStatus;
  note: string;
};

export type ConformanceReport = { rows: ConformanceRow[]; worst: ConformanceStatus };

export type ConformanceThemeMixRow = {
  theater_id: string;
  sector_code?: string | null;
  thread_code?: string | null;
  target_pct?: number | string | null;
  is_excluded?: boolean | null;
};

export type ConformanceDifficultyMixRow = {
  difficulty_band: string;
  target_pct?: number | string | null;
  applies_to_game_id?: string | null;
};

export type ConformanceSlateGame = {
  /** The bank's `puzzle_type` — the key a generated row is joined back on. */
  runtime_key: string | null;
  floor?: string | null;
  ceiling?: string | null;
  enabled?: boolean | null;
};

export type ConformanceThemeRow = {
  date: string;
  theater_id: string | null;
  sector_code?: string | null;
  /** Optional: supplied, the exclusion check covers the thread axis too. */
  thread_codes?: string[] | null;
};

export type ConformanceBankRow = {
  puzzle_type: string | null;
  go_live_date: string | null;
  difficulty: string | null;
};

export type ConformanceInput = {
  themeMix?: ConformanceThemeMixRow[] | null;
  difficultyMix?: ConformanceDifficultyMixRow[] | null;
  slate?: ConformanceSlateGame[] | null;
  themeRows?: ConformanceThemeRow[] | null;
  bankRows?: ConformanceBankRow[] | null;
  seasonDates?: string[] | null;
};

/** D2 — how far a share may drift, in percentage POINTS, before it is said out
 *  loud. Five points is the same bar CC-DC-GEN-DIFFICULTY-PERGAME-1.0 set for
 *  the per-game shift warning; ten is where "drifted" becomes "is not this". */
export const SHARE_WARN_PTS = 5;
export const SHARE_FAIL_PTS = 10;

const RANK: Record<ConformanceStatus, number> = { ok: 0, warn: 1, fail: 2 };

/** One decimal, and the SAME number the status is judged on — a row that reads
 *  "5.0" must never be flagged, and one that reads "10.1" always must. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** D2 — |Δ| ≤ 5 pts ok, ≤ 10 warn, > 10 fail. */
export function shareStatus(delta: number): ConformanceStatus {
  const d = Math.abs(delta);
  if (d <= SHARE_WARN_PTS) return "ok";
  if (d <= SHARE_FAIL_PTS) return "warn";
  return "fail";
}

function shareRow(
  dimension: ConformanceDimension, key: string, target: number, actual: number, note: string
): ConformanceRow {
  const t = round1(target);
  const a = round1(actual);
  const delta = round1(a - t);
  return { dimension, key, target: t, actual: a, delta, status: shareStatus(delta), note };
}

function countRow(
  dimension: ConformanceDimension, key: string, target: number, actual: number, note: string
): ConformanceRow {
  return {
    dimension, key, target, actual, delta: actual - target,
    status: actual === target ? "ok" : "fail", note,
  };
}

const arr = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => Number(v) || 0;

/**
 * The theme mix as theme-allocation.js's functions require it: every axis
 * present, every percentage a number.
 *
 * Both coercions are load-bearing. PostgREST hands back a `numeric` column as
 * a STRING ("35.31"), and a mix row that reached this function from a plain
 * node script may legitimately omit the axes it does not use. Normalizing once
 * here is why nothing downstream has to ask twice.
 */
type MixRow = {
  theater_id: string;
  sector_code: string | null;
  thread_code: string | null;
  target_pct: number;
  is_excluded: boolean;
};

function mixRows(rows: ConformanceThemeMixRow[]): MixRow[] {
  return rows.map((r) => ({
    theater_id: r.theater_id,
    sector_code: r.sector_code ?? null,
    thread_code: r.thread_code ?? null,
    target_pct: num(r.target_pct),
    is_excluded: !!r.is_excluded,
  }));
}

/** Count by key, preserving first-seen order. */
function tally<T>(rows: T[], keyOf: (r: T) => string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r);
    if (k === null) continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/**
 * Configured vs generated, as a list of comparable rows plus the worst status
 * among them.
 *
 * Every dimension is independent and every one of them is optional: a caller
 * that supplies no theme rows simply gets no theater/sector/exclusion rows
 * back, rather than a fabricated zero.
 */
export function conformance(input: ConformanceInput): ConformanceReport {
  const i = input && typeof input === "object" ? input : {};
  const themeMix = mixRows(arr(i.themeMix));
  const difficultyMix = arr(i.difficultyMix);
  const slate = arr(i.slate);
  const themeRows = arr(i.themeRows);
  const bankRows = arr(i.bankRows);
  const dates = arr(i.seasonDates);

  const rows: ConformanceRow[] = [
    ...theaterRows(themeMix, themeRows),
    ...sectorRows(themeMix, themeRows),
    ...difficultyRows(difficultyMix, bankRows),
    ...windowRows(slate, bankRows),
    ...coverageRows(slate, bankRows, dates),
    ...exclusionRows(themeMix, themeRows),
  ];

  let worst: ConformanceStatus = "ok";
  for (const r of rows) if (RANK[r.status] > RANK[worst]) worst = r.status;
  return { rows, worst };
}

/** The failing rows, as `dimension:key` — what the approval audit records. */
export function failingKeys(report: ConformanceReport | null | undefined): string[] {
  return arr(report?.rows).filter((r) => r.status === "fail").map((r) => `${r.dimension}:${r.key}`);
}

// ── theater ──────────────────────────────────────────────────────────────────

/**
 * Theater share of the season's days. The targets are themeQuotas()'s: the
 * non-excluded Theater-total rows, normalized to 100 — the same numbers the
 * allocator laid the calendar out against, so a config whose rows sum to 97 is
 * not reported as 3 points short on every theater.
 */
function theaterRows(
  themeMix: MixRow[], themeRows: ConformanceThemeRow[]
): ConformanceRow[] {
  const ex = themeExclusions(themeMix);
  const totals = themeMix.filter(isTheaterTotalRow).filter((r) => !ex.theaters.has(r.theater_id));
  const pcts = normalizeTo100(totals.map((r) => r.target_pct));
  const target = new Map<string, number>();
  totals.forEach((r, k) => target.set(r.theater_id, pcts[k]));

  const seen = tally(themeRows, (r) => r.theater_id ?? null);
  const total = themeRows.length;

  // Configured theaters first, then any INCLUDED theater the calendar used but
  // the mix never named (target 0). An EXCLUDED theater showing up is not a
  // share problem — it is the exclusion dimension's to report.
  const keys = [...target.keys()];
  for (const k of seen.keys()) if (!target.has(k) && !ex.theaters.has(k)) keys.push(k);

  return keys.map((k) => {
    const n = seen.get(k) ?? 0;
    return shareRow("theater", k, target.get(k) ?? 0, pct(n, total),
      `${n} of ${total} day${total === 1 ? "" : "s"}`);
  });
}

// ── sector ───────────────────────────────────────────────────────────────────

/**
 * Sector share WITHIN its theater — themeQuotas() normalizes sector targets to
 * 100 inside the theater that configures them, so the actual has to be measured
 * the same way or a 50% sector in a 30%-of-season theater reads as 20 short.
 *
 * Only sectors that carry a target produce a row (D2). Most seasons configure
 * none at all, and inventing a row per observed sector would bury the theaters.
 */
function sectorRows(
  themeMix: MixRow[], themeRows: ConformanceThemeRow[]
): ConformanceRow[] {
  const ex = themeExclusions(themeMix);
  const out: ConformanceRow[] = [];

  const theaters = [...new Set(
    themeMix.filter((r) => r.sector_code && !r.thread_code && !r.is_excluded).map((r) => r.theater_id)
  )].filter((t) => !ex.theaters.has(t));

  for (const t of theaters) {
    const secRows = themeMix.filter(
      (r) => r.theater_id === t && r.sector_code && !r.thread_code && !r.is_excluded
        && !ex.sectors.has(r.sector_code)
    );
    if (!secRows.length) continue;
    const pcts = normalizeTo100(secRows.map((r) => r.target_pct));

    const inTheater = themeRows.filter((r) => r.theater_id === t);
    const seen = tally(inTheater, (r) => r.sector_code ?? null);

    secRows.forEach((r, k) => {
      const n = seen.get(r.sector_code as string) ?? 0;
      out.push(shareRow("sector", `${t}/${r.sector_code}`, pcts[k], pct(n, inTheater.length),
        `${n} of ${inTheater.length} day${inTheater.length === 1 ? "" : "s"} in ${t}`));
    });
  }
  return out;
}

// ── difficulty ───────────────────────────────────────────────────────────────

/**
 * The SEASON difficulty mix against the bank's realized bands.
 *
 * Note what this row does NOT know: a slate whose per-game floors forbid a band
 * cannot reach a season target that demands it, and the gap is the config's,
 * not the generator's (CC-DC-GEN-DIFFICULTY-PERGAME-1.0 already warns about
 * exactly that shift). This dimension reports the gap; it does not excuse it,
 * and it must not be widened to hide one.
 */
function difficultyRows(
  difficultyMix: ConformanceDifficultyMixRow[], bankRows: ConformanceBankRow[]
): ConformanceRow[] {
  const season = difficultyMix.filter((r) => !r.applies_to_game_id);
  if (!season.length) return [];

  const bands = season
    .map((r) => ({ band: canonicalDifficulty(r.difficulty_band), pct: num(r.target_pct) }))
    .filter((r): r is { band: string; pct: number } => r.band !== null);
  if (!bands.length) return [];

  const pcts = normalizeTo100(bands.map((b) => b.pct));
  const seen = tally(bankRows, (r) => canonicalDifficulty(r.difficulty));
  const total = bankRows.length;

  const ordered = CANONICAL_BANDS
    .map((b: string) => ({ band: b, k: bands.findIndex((x) => x.band === b) }))
    .filter((x: { band: string; k: number }) => x.k >= 0);

  return ordered.map(({ band, k }: { band: string; k: number }) => {
    const n = seen.get(band) ?? 0;
    return shareRow("difficulty", band, pcts[k], pct(n, total),
      `${n} of ${total} puzzle${total === 1 ? "" : "s"}`);
  });
}

// ── difficulty_window ────────────────────────────────────────────────────────

/**
 * Bank rows outside their own game's [floor, ceiling]. Unlike the share rows
 * this is not a drift: the window is what the game WAS generated inside, so a
 * row below the floor is a row that should not exist. One row, the total count,
 * and the per-game breakdown in the note.
 */
function windowRows(
  slate: ConformanceSlateGame[], bankRows: ConformanceBankRow[]
): ConformanceRow[] {
  const games = slate.filter((g) => g.enabled !== false && g.runtime_key);
  if (!games.length || !bankRows.length) return [];

  const windows = new Map<string, { lo: number; hi: number } | null>();
  for (const g of games) windows.set(g.runtime_key as string, difficultyWindow(g.floor, g.ceiling));

  const perGame = new Map<string, number>();
  let offside = 0;
  for (const r of bankRows) {
    const key = r.puzzle_type ?? "";
    if (!windows.has(key)) continue; // not a slate game — coverage's business
    const band = canonicalDifficulty(r.difficulty);
    if (band === null) continue; // an unreadable band is not a window breach
    const w = windows.get(key) ?? null;
    const idx = CANONICAL_BANDS.indexOf(band);
    // A null window means floor > ceiling: the game has no legal band at all,
    // so every row it produced is outside it.
    if (w && idx >= w.lo && idx <= w.hi) continue;
    offside += 1;
    perGame.set(key, (perGame.get(key) ?? 0) + 1);
  }

  const note = offside
    ? [...perGame.entries()].map(([k, n]) => `${k} ${n}`).join(" · ")
    : "every puzzle inside its game's band window";
  return [countRow("difficulty_window", "window", 0, offside, note)];
}

// ── coverage ─────────────────────────────────────────────────────────────────

/** Every enabled game needs a puzzle on every season date (D2). */
function coverageRows(
  slate: ConformanceSlateGame[], bankRows: ConformanceBankRow[], dates: string[]
): ConformanceRow[] {
  const games = slate.filter((g) => g.enabled !== false && g.runtime_key)
    .map((g) => g.runtime_key as string);
  if (!games.length || !dates.length) return [];

  const want = new Set<string>();
  for (const d of dates) for (const g of games) want.add(`${g}|${d}`);
  const have = new Set<string>();
  for (const r of bankRows) {
    const k = `${r.puzzle_type ?? ""}|${r.go_live_date ?? ""}`;
    if (want.has(k)) have.add(k);
  }

  const missing = want.size - have.size;
  return [countRow("coverage", "cells", want.size, have.size,
    missing
      ? `${missing} of ${want.size} (game × day) cell${want.size === 1 ? "" : "s"} empty`
      : `all ${want.size} (game × day) cells filled`)];
}

// ── exclusion ────────────────────────────────────────────────────────────────

/**
 * A theme the configuration excluded, used anyway. Three axes, read exactly as
 * the worker reads them (themeExclusions/isEligible): an excluded Theater, an
 * excluded SECTOR CODE wherever it appears, an excluded thread.
 *
 * Inlined rather than calling isEligible() so the note can name WHICH axis was
 * breached — "3 days in excluded T-004" is actionable; "3 ineligible" is not.
 */
function exclusionRows(
  themeMix: MixRow[], themeRows: ConformanceThemeRow[]
): ConformanceRow[] {
  const ex = themeExclusions(themeMix);
  const configured = ex.theaters.size + ex.sectors.size + ex.threads.size;
  if (!configured || !themeRows.length) return [];

  const hits = new Map<string, number>();
  for (const r of themeRows) {
    const breached: string[] = [];
    if (r.theater_id && ex.theaters.has(r.theater_id)) breached.push(r.theater_id);
    if (r.sector_code && ex.sectors.has(r.sector_code)) breached.push(r.sector_code);
    for (const c of arr(r.thread_codes)) if (ex.threads.has(c)) breached.push(c);
    for (const b of breached) hits.set(b, (hits.get(b) ?? 0) + 1);
  }

  let used = 0;
  for (const n of hits.values()) used += n;
  const note = used
    ? [...hits.entries()].map(([k, n]) => `${k} ${n}`).join(" · ")
    : `no day uses any of the ${configured} excluded key${configured === 1 ? "" : "s"}`;
  return [countRow("exclusion", "excluded", 0, used, note)];
}
