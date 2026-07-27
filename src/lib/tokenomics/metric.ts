// Canonical metric row builder — content_hash + figure-level dedup.
//
// Idempotency contract (matches the migration's unique key):
//   content_hash = sha256(canonical semantic figure). The unique key is
//   (metric_id, as_of, source, content_hash), so an unchanged re-fetch collides
//   on the hash → no-op; any changed figure field → a new content_hash → a new
//   dated vintage.
//
// Dedup contract ("dedup on the underlying figure, not the row"): several sources
// can report the SAME figure — that is ONE canonical reading with MULTIPLE
// citations, not multiple rows. dedupeByFigure() collapses same-figure inputs,
// keeps the highest-tier source as canonical, and stashes the rest as
// meta.citations. Zero-fabrication: unverifiable inputs keep confidence as-is
// (never laundered to 'verified').

import type { MetricInput, MetricRow, SourceTier } from './types.ts';

// Web Crypto — available in node 22, edge, and deno alike (isomorphic).
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Stable JSON: object keys sorted recursively so hashing is order-independent.
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

// The semantic figure that content_hash covers. Excludes derived/narrative fields
// (why_note) and bookkeeping (ingested_at) so those never churn a vintage.
function figurePayload(m: MetricInput): Record<string, unknown> {
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
    confidence: m.confidence,
    display_allowed: m.display_allowed,
    meta: m.meta ?? {},
  };
}

export function contentHash(m: MetricInput): Promise<string> {
  return sha256Hex(canonical(figurePayload(m)));
}

// The underlying-figure identity, source-independent — used to collapse the same
// reading reported by more than one source into one canonical row + citations.
export function figureKey(m: MetricInput): string {
  return [m.metric_id, m.as_of, m.value ?? 'null', m.unit, m.pricing_mode ?? ''].join('|');
}

const TIER_RANK: Record<SourceTier, number> = { 1: 3, 2: 2, 3: 1 };

// Collapse same-figure inputs. Highest-tier source wins as canonical; other
// sources become meta.citations = [{ source, source_url, tier }]. Verified beats
// as-reported beats unverified on ties.
export function dedupeByFigure(inputs: MetricInput[]): MetricInput[] {
  const groups = new Map<string, MetricInput[]>();
  for (const m of inputs) {
    const k = figureKey(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(m);
  }

  const confRank = (c: string) => (c === 'verified' ? 2 : c === 'as-reported' ? 1 : 0);
  const out: MetricInput[] = [];
  for (const grp of groups.values()) {
    if (grp.length === 1) {
      out.push(grp[0]);
      continue;
    }
    const sorted = [...grp].sort(
      (a, b) => TIER_RANK[b.source_tier] - TIER_RANK[a.source_tier] || confRank(b.confidence) - confRank(a.confidence),
    );
    const canonicalReading = sorted[0];
    const citations = sorted.slice(1).map((c) => ({
      source: c.source,
      source_url: c.source_url ?? null,
      tier: c.source_tier,
    }));
    out.push({
      ...canonicalReading,
      meta: { ...(canonicalReading.meta ?? {}), citations },
    });
  }
  return out;
}

export async function buildMetricRow(m: MetricInput): Promise<MetricRow> {
  return { ...m, content_hash: await contentHash(m) };
}

// Dedupe by figure, then attach content_hash to each canonical reading.
export async function buildMetricRows(inputs: MetricInput[]): Promise<MetricRow[]> {
  const canonicalReadings = dedupeByFigure(inputs);
  return Promise.all(canonicalReadings.map(buildMetricRow));
}
