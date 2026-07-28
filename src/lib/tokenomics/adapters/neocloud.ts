// Adapter: neocloud GPU rental (Group B, tier 2) — the NEOCLOUD_ROSTER pool.
// Sources: per-provider public pricing pages (primary disclosures). One
// normalized parser over a captured, pre-flattened row shape. On-demand $/GPU-hr
// for H100/H200/B200 (+ reserved/committed where listed).
//
// Neoclouds are region-agnostic in the scoreboard (region NULL) unless a provider
// lists a region. provider slug must be in the roster (fixed or candidate).

import type { MetricInput, PricingMode } from '../types.ts';
import type { AdapterContext } from './aipricing-guru.ts';
import { allIngestedNeoclouds, providerLabel } from '../roster.ts';

export interface NeocloudRow {
  provider: string;        // roster slug: coreweave | lambda | … | together | …
  gpu_class: string;       // "H100" | "H200" | "B200"
  pricing_mode: PricingMode; // ondemand | reserved | committed
  usd_per_gpu_hour: number;
  region?: string | null;
  as_of?: string;
  source_url?: string;
}

const ROSTER = new Set(allIngestedNeoclouds());

export function parseNeocloud(rows: NeocloudRow[], ctx: AdapterContext): MetricInput[] {
  const out: MetricInput[] = [];
  for (const row of rows) {
    if (!row || typeof row.usd_per_gpu_hour !== 'number') continue;
    if (!ROSTER.has(row.provider)) continue; // never ingest an off-roster provider silently
    const region = row.region ?? null;
    const metric_id = `gpu.${slug(row.gpu_class)}.${row.pricing_mode}.${row.provider}${region ? '.' + slug(region) : ''}`;
    out.push({
      metric_id,
      category: 'B',
      subject: row.gpu_class,
      provider: providerLabel(row.provider),
      region,
      sku: null,
      pricing_mode: row.pricing_mode,
      value: round(row.usd_per_gpu_hour, 4),
      unit: '$/GPU-hr',
      as_of: row.as_of || ctx.as_of,
      source: 'neocloud',
      source_tier: 2,
      source_url: row.source_url ?? null,
      confidence: 'as-reported', // vendor list page, not an authoritative catalog API
      display_allowed: true,
      meta: { provider_slug: row.provider },
    });
  }
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
