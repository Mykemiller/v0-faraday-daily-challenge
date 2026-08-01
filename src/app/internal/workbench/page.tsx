// Faraday Workbench — internal engine/data-plane status panels.
// Route: /internal/workbench
// Auth posture: same as /internal/clerk-program — server-rendered only, noindex,
// requires SUPABASE_SERVICE_ROLE_KEY on the server. Every read here is
// service-role because the underlying objects are RLS/deny-all and revoked from
// anon+authenticated; none of these queries may ever move client-side.
//
// Panels are read-only status surfaces. Data revalidates hourly (segment +
// per-fetch revalidate 3600), not per render — the sources move on weekly crons
// and a draining backfill queue, so per-request fetches would be pure waste.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Faraday Workbench — Faraday Internal',
  robots: 'noindex',
};

export const revalidate = 3600;

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

type Svc = { base: string; headers: Record<string, string> };

function svc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base:    `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey:         key,
      Authorization:  `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  };
}

interface MetricsSnapshot {
  captured_at:           string;
  total_backlog_years:   number | null;
  vintages_total:        number | null;
  observations_total:    number | null;
  active_but_empty:      number | null;
  health_fail_rate_7d:   number | null;
  briefs_generated_7d:   number | null;
  edgar_artifacts_total: number | null;
  cited_depth_pct:       number | null;
  multi_vintage_sources: number | null;
}

interface LegacySpanCount {
  span:        string;
  legacy_rows: number;
  span_start:  number;
}

// Which direction a week-over-week move is healthy in. 'zero' = must be 0:
// down is good, and any non-zero current value renders red.
type GoodDirection = 'up' | 'down' | 'zero';

const MODEL_METRICS: {
  key:   keyof MetricsSnapshot;
  label: string;
  good:  GoodDirection;
  pct?:  boolean;
}[] = [
  { key: 'total_backlog_years',   label: 'Backlog (source-years)',            good: 'down' },
  { key: 'vintages_total',        label: 'Forecast vintages held',            good: 'up' },
  { key: 'observations_total',    label: 'Forecast observations extracted',   good: 'up' },
  { key: 'active_but_empty',      label: 'Active-but-empty sources',          good: 'zero' },
  { key: 'health_fail_rate_7d',   label: 'Ingest failure rate, 7d (%)',       good: 'down', pct: true },
  { key: 'briefs_generated_7d',   label: 'JW briefs generated, 7d',           good: 'up' },
  { key: 'edgar_artifacts_total', label: 'SEC EDGAR artifacts',               good: 'up' },
  { key: 'cited_depth_pct',       label: 'Cited source depth (%)',            good: 'up',   pct: true },
];

function fmtValue(v: number | null | undefined, pct = false): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const s = Number.isInteger(n)
    ? n.toLocaleString('en-US')
    : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return pct ? `${s}%` : s;
}

function deltaCell(
  last: number | null | undefined,
  curr: number | null | undefined,
  good: GoodDirection,
): { glyph: string; className: string } {
  const l = last === null || last === undefined ? null : Number(last);
  const c = curr === null || curr === undefined ? null : Number(curr);
  if (l === null || c === null || !Number.isFinite(l) || !Number.isFinite(c)) {
    return { glyph: '—', className: 'text-stone-300' };
  }
  const delta = c - l;
  if (delta === 0) return { glyph: '—', className: 'text-stone-300' };
  const up      = delta > 0;
  const healthy = good === 'up' ? up : !up;
  return {
    glyph:     up ? '▲' : '▼',
    className: healthy ? 'text-green-700' : 'text-red-700',
  };
}

function fmtCapturedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default async function FaradayWorkbench() {
  const s = svc();
  if (!s) {
    return (
      <div className="p-8 text-red-700 text-sm">
        SUPABASE_SERVICE_ROLE_KEY not set. This dashboard requires server-side access.
      </div>
    );
  }

  const [snapshotsR, spansR] = await Promise.allSettled([
    // Newest row = "this week", the one before it = "last week". A pg_cron job
    // writes one row every Monday 12:00 UTC, but ad-hoc rows may exist — always
    // take the two most recent rather than assuming a weekly grid.
    fetch(
      `${s.base}/forecast_model_metrics_snapshots?select=*&order=captured_at.desc&limit=2`,
      { headers: s.headers, next: { revalidate: 3600 } }
    ).then(r => r.ok ? r.json() as Promise<MetricsSnapshot[]> : []),

    fetch(
      `${s.base}/v_legacy_span_counts?select=span,legacy_rows,span_start&order=span_start.asc`,
      { headers: s.headers, next: { revalidate: 3600 } }
    ).then(r => r.ok ? r.json() as Promise<LegacySpanCount[]> : []),
  ]);

  const snapshots = snapshotsR.status === 'fulfilled' ? snapshotsR.value : [];
  const spans     = spansR.status     === 'fulfilled' ? spansR.value     : [];

  const thisWeek = snapshots[0] ?? null;
  const lastWeek = snapshots[1] ?? null;

  return (
    <div className="min-h-screen bg-stone-50 p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <p className="text-xs font-mono uppercase tracking-widest text-stone-400 mb-1">
            Faraday Intelligence · Internal
          </p>
          <h1 className="text-2xl font-bold text-stone-800">
            Faraday Workbench
          </h1>
          <p className="text-stone-500 text-sm mt-1">
            Engine & data-plane status — read-only, refreshed hourly
          </p>
        </div>

        {/* Faraday Forecast Model */}
        <div className="bg-white border border-stone-200 rounded-lg p-5 mb-6">
          <h2 className="font-semibold text-stone-700 mb-4">Faraday Forecast Model</h2>

          {/* Section A — model metrics, last week vs this week */}
          {!thisWeek ? (
            <p className="text-stone-400 text-sm">No metrics snapshots yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-stone-400 uppercase tracking-widest border-b border-stone-100">
                    <th className="pb-2 pr-4">Metric</th>
                    <th className="pb-2 pr-4 text-right">Last week</th>
                    <th className="pb-2 pr-4 text-right">This week</th>
                    <th className="pb-2 text-center">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {MODEL_METRICS.map(m => {
                    const curr  = thisWeek[m.key] as number | null;
                    const last  = lastWeek ? (lastWeek[m.key] as number | null) : null;
                    const delta = deltaCell(last, curr, m.good);
                    const currRed =
                      m.good === 'zero' && Number.isFinite(Number(curr)) && Number(curr) > 0;
                    return (
                      <tr key={m.key} className="border-b border-stone-50">
                        <td className="py-2 pr-4 text-stone-600">{m.label}</td>
                        <td className="py-2 pr-4 text-right font-mono text-xs text-stone-500">
                          {fmtValue(last, m.pct)}
                        </td>
                        <td className={`py-2 pr-4 text-right font-mono text-xs ${currRed ? 'text-red-700 font-semibold' : 'text-stone-700'}`}>
                          {fmtValue(curr, m.pct)}
                          {m.key === 'cited_depth_pct' && (
                            <span className="text-stone-400 font-sans">
                              {' '}· {fmtValue(thisWeek.multi_vintage_sources)} multi-vintage sources
                            </span>
                          )}
                        </td>
                        <td className={`py-2 text-center ${delta.className}`}>{delta.glyph}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-stone-400 mt-3">
                as of {fmtCapturedAt(thisWeek.captured_at)}
              </p>
            </div>
          )}

          {/* Section B — legacy artifact coverage by 20-year span */}
          <h3 className="text-xs text-stone-400 uppercase tracking-widest mt-6 mb-3">
            Legacy artifact coverage by span
          </h3>
          {spans.length === 0 ? (
            <p className="text-stone-400 text-sm">No span counts returned.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-stone-400 uppercase tracking-widest border-b border-stone-100">
                    {spans.map(sp => (
                      <th key={sp.span} className="pb-2 pr-4 whitespace-nowrap">{sp.span}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {spans.map(sp => (
                      <td key={sp.span} className="py-2 pr-4 font-mono text-xs text-stone-700 whitespace-nowrap">
                        {Number(sp.legacy_rows).toLocaleString('en-US')}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <p className="text-xs text-stone-400 mt-3">
                Content-dated rows across all legacy data sources; counts grow as the backfill queue drains.
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-stone-300 mt-6 text-center">
          Internal only · not indexed
        </p>
      </div>
    </div>
  );
}
