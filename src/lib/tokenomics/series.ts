// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — read-time series math (pure). Mirrors fn_tokenomics_series
// in SQL so the /api/scoreboard/series route can compute from raw rows and tests can pin the math.
// Deltas + realized volatility are DERIVED here, never stored.

export type Point = { as_of: string; value: number };

// Collapse to one canonical reading per as_of. Input rows may carry vintages (multiple ingests per
// as_of); the freshest vintage wins. If ingested_at is absent, later array position wins (callers
// pass rows ordered ingested_at asc within an as_of, matching the SQL distinct-on).
export function canonicalize(
  rows: { as_of: string | null; value: number | null; ingested_at?: string | null }[],
): Point[] {
  const byDate = new Map<string, { value: number; ingested_at: string }>();
  for (const r of rows) {
    if (!r.as_of || r.value === null || r.value === undefined || !Number.isFinite(r.value)) continue;
    const prev = byDate.get(r.as_of);
    const ing = r.ingested_at ?? "";
    if (!prev || ing >= prev.ingested_at) byDate.set(r.as_of, { value: r.value, ingested_at: ing });
  }
  return [...byDate.entries()]
    .map(([as_of, v]) => ({ as_of, value: v.value }))
    .sort((a, b) => (a.as_of < b.as_of ? -1 : a.as_of > b.as_of ? 1 : 0));
}

function daysBefore(refISO: string, days: number): string {
  const d = new Date(refISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// % change of the latest value vs the closest reading at/just before `refISO - days`.
export function pctChange(points: Point[], days: number, refISO?: string): number | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const horizon = daysBefore(refISO ?? latest.as_of, days);
  let base: Point | null = null;
  for (const p of points) { if (p.as_of <= horizon) base = p; }
  if (!base || base.value === 0) return null;
  return Math.round(((latest.value - base.value) / base.value) * 1000) / 10; // one decimal %
}

// Annualized realized volatility: stddev (sample) of daily log returns, *sqrt(365). null if <3 pts.
export function realizedVol(points: Point[]): number | null {
  if (points.length < 3) return null;
  const rets: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].value, b = points[i].value;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.round(Math.sqrt(varr) * Math.sqrt(365) * 1e4) / 1e4;
}

export type SeriesResult = {
  metric_id: string;
  window_days: number;
  points: Point[];
  latest: Point | null;
  delta_7d: number | null;
  delta_30d: number | null;
  delta_90d: number | null;
  realized_vol: number | null;
  n: number;
};

export function computeSeries(
  metric_id: string,
  rows: { as_of: string | null; value: number | null; ingested_at?: string | null }[],
  window_days = 90,
  refISO?: string,
): SeriesResult {
  const points = canonicalize(rows);
  const latest = points.length ? points[points.length - 1] : null;
  return {
    metric_id, window_days, points, latest,
    delta_7d: pctChange(points, 7, refISO),
    delta_30d: pctChange(points, 30, refISO),
    delta_90d: pctChange(points, 90, refISO),
    realized_vol: realizedVol(points),
    n: points.length,
  };
}
