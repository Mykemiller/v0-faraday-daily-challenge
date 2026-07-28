// Adapter: hyperscaler GPU rental (Group B, tier 1) — AWS / Azure / GCP.
// Sources: AWS Price List API bulk JSON, Azure Retail Prices API, GCP Cloud
// Billing Catalog API. One normalized parser over a captured, pre-flattened row
// shape (the raw catalog JSONs are huge + provider-specific; the fetch layer
// flattens to CloudGpuRow before this pure parser runs).
//
// pricing_mode: ondemand | reserved (Savings Plans / CUD) | spot. Region is the
// fusion join key — always carried for hyperscalers.

import type { MetricInput, PricingMode } from '../types.ts';
import type { AdapterContext } from './aipricing-guru.ts';

// Normalized flattened row (produced by the fetch layer from each catalog API).
export interface CloudGpuRow {
  provider: 'aws' | 'azure' | 'gcp';
  gpu_class: string;        // "H100" | "H200" | "B200" | "GB200"
  gpu_count?: number | null;
  instance: string;         // e.g. "p5.48xlarge" | "ND H100 v5" | "a3-highgpu-8g"
  region: string;           // e.g. "us-east-1"
  pricing_mode: PricingMode;
  usd_per_hour: number;     // total instance $/hr
  as_of?: string;
  source_url?: string;
}

// $/GPU-hr from instance $/hr ÷ gpu_count (falls back to instance-hr when count
// unknown, tagged unit accordingly — never guesses a count).
function perGpuHour(row: CloudGpuRow): { value: number; unit: string } {
  if (row.gpu_count && row.gpu_count > 0) {
    return { value: round(row.usd_per_hour / row.gpu_count, 4), unit: '$/GPU-hr' };
  }
  return { value: round(row.usd_per_hour, 4), unit: '$/instance-hr' };
}

export function parseCloudGpu(rows: CloudGpuRow[], ctx: AdapterContext): MetricInput[] {
  const out: MetricInput[] = [];
  for (const row of rows) {
    if (!row || typeof row.usd_per_hour !== 'number') continue;
    const { value, unit } = perGpuHour(row);
    const metric_id = `gpu.${slug(row.gpu_class)}.${row.pricing_mode}.${row.provider}.${slug(row.region)}`;
    out.push({
      metric_id,
      category: 'B',
      subject: row.gpu_class,
      provider: row.provider.toUpperCase(),
      region: row.region,
      sku: row.instance,
      pricing_mode: row.pricing_mode,
      value,
      unit,
      as_of: row.as_of || ctx.as_of,
      source: row.provider,
      source_tier: 1,
      source_url: row.source_url ?? null,
      confidence: 'verified', // catalog APIs are authoritative list prices
      display_allowed: true,
      meta: { gpu_count: row.gpu_count ?? null, instance: row.instance },
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
