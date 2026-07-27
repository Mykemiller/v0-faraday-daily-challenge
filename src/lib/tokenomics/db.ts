// Server-only PostgREST access for the Tokenomics Scoreboard. Service-role,
// raw-fetch (no @supabase/supabase-js) — matches the codebase convention. Never
// imported by the pure modules or their tests.

import type { StoredReading, MetricRow } from './types.ts';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export interface Svc {
  base: string;
  headers: Record<string, string>;
}

export function svc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  };
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// Recent vintages across all categories (for the snapshot). Bounded by as_of.
export async function readRecentMetrics(s: Svc, sinceDays = 120, limit = 10000): Promise<StoredReading[]> {
  const qs =
    `?select=metric_id,category,subject,provider,region,sku,pricing_mode,value,unit,as_of,ingested_at,source,source_tier,source_url,confidence,display_allowed,why_note,content_hash,meta` +
    `&as_of=gte.${encodeURIComponent(sinceIso(sinceDays))}` +
    `&order=as_of.asc&limit=${limit}`;
  const r = await fetch(`${s.base}/tokenomics_metrics${qs}`, { headers: s.headers, cache: 'no-store' });
  if (!r.ok) throw new Error(`readRecentMetrics: ${r.status} ${await r.text().catch(() => r.statusText)}`);
  return r.json();
}

// One metric's full vintage history within a window (for the series endpoint).
export async function readSeries(s: Svc, metricId: string, sinceDays: number): Promise<StoredReading[]> {
  const qs =
    `?select=metric_id,value,unit,as_of,ingested_at,source,source_tier,display_allowed,content_hash,category,confidence` +
    `&metric_id=eq.${encodeURIComponent(metricId)}` +
    `&as_of=gte.${encodeURIComponent(sinceIso(sinceDays))}` +
    `&order=as_of.asc&limit=5000`;
  const r = await fetch(`${s.base}/tokenomics_metrics${qs}`, { headers: s.headers, cache: 'no-store' });
  if (!r.ok) throw new Error(`readSeries: ${r.status} ${await r.text().catch(() => r.statusText)}`);
  return r.json();
}

// Append-only insert: identical re-fetch collides on the unique vintage index and
// is ignored; a changed figure is a new content_hash → a new row.
export async function insertMetricRows(s: Svc, rows: MetricRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const r = await fetch(
    `${s.base}/tokenomics_metrics?on_conflict=metric_id,as_of,source,content_hash`,
    {
      method: 'POST',
      headers: { ...s.headers, Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(rows.map(toDbRow)),
    },
  );
  if (!r.ok) throw new Error(`insertMetricRows: ${r.status} ${await r.text().catch(() => r.statusText)}`);
  const inserted = await r.json().catch(() => []);
  return Array.isArray(inserted) ? inserted.length : 0;
}

function toDbRow(m: MetricRow): Record<string, unknown> {
  return {
    metric_id: m.metric_id,
    category: m.category,
    subject: m.subject ?? null,
    provider: m.provider ?? null,
    region: m.region ?? null,
    sku: m.sku ?? null,
    pricing_mode: m.pricing_mode ?? null,
    value: m.value,
    unit: m.unit,
    as_of: m.as_of,
    source: m.source,
    source_tier: m.source_tier,
    source_url: m.source_url ?? null,
    confidence: m.confidence,
    display_allowed: m.display_allowed,
    why_note: m.why_note ?? null,
    content_hash: m.content_hash,
    meta: m.meta ?? {},
  };
}

// Health log — mirrors automation_health_log convention used across the fleet.
export interface HealthRow {
  auto_id: string;
  crawler_id: string;
  run_started_at: string;
  run_completed_at: string;
  artifacts_found: number;
  artifacts_new: number;
  artifacts_duped: number;
  success: boolean;
  errors?: unknown;
  notes?: string;
}

export async function writeHealth(s: Svc, row: HealthRow): Promise<void> {
  const r = await fetch(`${s.base}/automation_health_log`, {
    method: 'POST',
    headers: { ...s.headers, Prefer: 'return=minimal' },
    body: JSON.stringify([row]),
  });
  // Health logging must never crash the run — swallow non-2xx after a console note.
  if (!r.ok) console.error('[tokenomics] health log failed:', r.status, await r.text().catch(() => ''));
}

// Fusion grid signal for a region, from Faraday's own grid plane. Deploy-gated:
// the concrete grid table wiring (DC Hub / live Supabase grid tables) is added at
// promotion; until then this returns null and the fusion block degrades cleanly.
export async function readGridSignal(
  _s: Svc,
  _region: string,
): Promise<import('./fusion.ts').GridSignal | null> {
  // TODO(promotion): join dc_facilities / grid tables → { power_price_kwh,
  // interconnect_queue_depth, time_to_power, as_of }. Returning null keeps the
  // snapshot honest (fusion present, values null) rather than fabricating grid data.
  return null;
}
