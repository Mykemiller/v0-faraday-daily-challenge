// Read-time series derivations — % change (7/30/90d), realized volatility,
// sparkline. NOTHING here is stored: deltas/volatility are computed fresh per
// request from the append-only vintages, so a stale value can never be served.

import type { StoredReading, SeriesPoint } from './types.ts';

const DAY_MS = 86_400_000;

// Collapse append-only vintages to one point per as_of (latest ingested wins),
// sorted ascending by as_of. Input may contain multiple vintages per as_of.
export function latestByAsOf(readings: StoredReading[]): SeriesPoint[] {
  const byAsOf = new Map<string, StoredReading>();
  for (const r of readings) {
    const prev = byAsOf.get(r.as_of);
    if (!prev) {
      byAsOf.set(r.as_of, r);
      continue;
    }
    const a = r.ingested_at ? Date.parse(r.ingested_at) : 0;
    const b = prev.ingested_at ? Date.parse(prev.ingested_at) : 0;
    if (a >= b) byAsOf.set(r.as_of, r);
  }
  return [...byAsOf.values()]
    .sort((x, y) => Date.parse(x.as_of) - Date.parse(y.as_of))
    .map((r) => ({ as_of: r.as_of, value: r.value }));
}

// The point at or most-recently-before a target time (step interpolation). Only
// considers points carrying a numeric value.
function valueAtOrBefore(points: SeriesPoint[], targetMs: number): number | null {
  let chosen: number | null = null;
  for (const p of points) {
    if (p.value === null) continue;
    if (Date.parse(p.as_of) <= targetMs) chosen = p.value;
    else break;
  }
  return chosen;
}

function latestPoint(points: SeriesPoint[]): SeriesPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].value !== null) return points[i];
  }
  return null;
}

// % change over `days`, relative to the latest reading. null when there is no
// comparison point far enough back, or a zero base.
export function pctChange(points: SeriesPoint[], days: number): number | null {
  const latest = latestPoint(points);
  if (!latest || latest.value === null) return null;
  const targetMs = Date.parse(latest.as_of) - days * DAY_MS;
  const base = valueAtOrBefore(points, targetMs);
  if (base === null || base === 0) return null;
  return round(((latest.value - base) / base) * 100, 2);
}

// Realized volatility = stdev of daily log returns within the trailing window,
// annualized (×√252). Returns a percent. null when fewer than 2 returns exist.
export function realizedVol(points: SeriesPoint[], days: number): number | null {
  const latest = latestPoint(points);
  if (!latest) return null;
  const cutoff = Date.parse(latest.as_of) - days * DAY_MS;
  const vals = points.filter((p) => p.value !== null && p.value > 0 && Date.parse(p.as_of) >= cutoff) as {
    as_of: string;
    value: number;
  }[];
  if (vals.length < 3) return null;
  const returns: number[] = [];
  for (let i = 1; i < vals.length; i++) returns.push(Math.log(vals[i].value / vals[i - 1].value));
  if (returns.length < 2) return null;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return round(Math.sqrt(variance) * Math.sqrt(252) * 100, 2);
}

// Downsample values to at most `maxPoints` for a sparkline (evenly spaced,
// endpoints preserved). Null-valued points are dropped.
export function sparkline(points: SeriesPoint[], maxPoints = 24): number[] {
  const vals = points.filter((p) => p.value !== null).map((p) => p.value as number);
  if (vals.length <= maxPoints) return vals;
  const out: number[] = [];
  const step = (vals.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) out.push(vals[Math.round(i * step)]);
  return out;
}

// Points filtered to a trailing window (keeps null-valued points for shape).
export function windowPoints(points: SeriesPoint[], days: number): SeriesPoint[] {
  if (points.length === 0) return points;
  const last = points[points.length - 1];
  const cutoff = Date.parse(last.as_of) - days * DAY_MS;
  return points.filter((p) => Date.parse(p.as_of) >= cutoff);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Parse a window string ("7d" | "30d" | "90d" | "1y" | "all") to a day count.
export function parseWindowDays(window: string | null | undefined): number {
  if (!window || window === 'all') return 100_000;
  const m = /^(\d+)([dwy])$/.exec(window.trim());
  if (!m) return 90;
  const n = parseInt(m[1], 10);
  return m[2] === 'y' ? n * 365 : m[2] === 'w' ? n * 7 : n;
}
