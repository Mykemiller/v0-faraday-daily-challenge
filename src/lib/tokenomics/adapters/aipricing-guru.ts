// Adapter: aipricing.guru commodity token pricing (Group A, tier 3).
// Source: GET https://aipricing.guru/api/pricing.json
//
// Pure parse — maps the captured JSON payload to MetricInput[]. Tolerant of
// missing fields (a model with no output price yields only the `in` row). Never
// fabricates: absent price → no row for that dimension.

import type { MetricInput } from '../types.ts';

export interface AdapterContext {
  as_of: string; // ISO-8601 — the vendor as-of or fetch time
}

// Representative captured shape (documented for the tests):
//   { "updated": "2026-07-26T00:00:00Z",
//     "models": [
//       { "id": "gpt-5", "name": "GPT-5", "provider": "openai",
//         "input_per_mtok": 1.25, "output_per_mtok": 10.0, "throughput_tps": 180 },
//       ... ] }
export interface AipricingModel {
  id: string;
  name?: string;
  provider?: string;
  input_per_mtok?: number | null;
  output_per_mtok?: number | null;
  throughput_tps?: number | null;
}
export interface AipricingPayload {
  updated?: string;
  models?: AipricingModel[];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function parseAipricingGuru(payload: AipricingPayload, ctx: AdapterContext): MetricInput[] {
  const asOf = payload.updated || ctx.as_of;
  const source = 'aipricing_guru';
  const out: MetricInput[] = [];
  for (const m of payload.models ?? []) {
    if (!m || !m.id) continue;
    const modelSlug = slug(m.id);
    const model = m.name || m.id;
    const base = {
      category: 'A' as const,
      subject: model,
      provider: m.provider ?? null,
      as_of: asOf,
      source,
      source_tier: 3 as const,
      source_url: 'https://aipricing.guru/api/pricing.json',
      confidence: 'as-reported' as const,
      display_allowed: true,
    };
    if (typeof m.input_per_mtok === 'number') {
      out.push({ ...base, metric_id: `token.${modelSlug}.in`, value: m.input_per_mtok, unit: '$/M-in', meta: { dimension: 'in' } });
    }
    if (typeof m.output_per_mtok === 'number') {
      out.push({ ...base, metric_id: `token.${modelSlug}.out`, value: m.output_per_mtok, unit: '$/M-out', meta: { dimension: 'out' } });
    }
    if (typeof m.throughput_tps === 'number') {
      out.push({ ...base, metric_id: `token.${modelSlug}.tps`, value: m.throughput_tps, unit: 'tokens/sec', meta: { dimension: 'tps' } });
    }
  }
  return out;
}
