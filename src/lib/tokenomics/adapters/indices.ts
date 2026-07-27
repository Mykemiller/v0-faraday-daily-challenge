// Adapter: third-party constructed indices (Groups A/B, INGEST-ONLY).
// Sources: Tokenix/ACPI, TPI, Ornn/OTPI + OCPI, Silicon Data (SDLLMTK + GPU),
// Epoch AI, Artificial Analysis, IEA/Goldman/MS demand forecasts.
//
// We STORE the value for internal tracking but the display gate is enforced by
// display-gate.stampDisplayGate() at the dispatch layer: any source flagged
// is_third_party_index ships display_allowed=false and the snapshot API NULLs its
// value. Epoch AI / Artificial Analysis are NOT third-party-gated (quality-adjust
// + throughput inputs) — they display normally.

import type { MetricInput } from '../types.ts';
import type { AdapterContext } from './aipricing-guru.ts';
import { registryFor } from '../display-gate.ts';

// Normalized captured index reading.
export interface IndexReading {
  source: string;   // registry slug: tokenix_acpi | tpi | ornn_otpi | silicon_data_sdllmtk | ornn_ocpi | silicon_data_gpu | epoch_ai | artificial_analysis | iea | goldman | morgan_stanley
  slug: string;     // short index slug for the metric_id, e.g. "acpi"
  label: string;    // display label, e.g. "Tokenix ACPI"
  value: number;
  unit: string;     // "index-level" | "$/M-tok" | "TWh" …
  as_of: string;
  category?: 'A' | 'B' | 'D';
  source_url?: string;
  confidence?: MetricInput['confidence'];
}

export function parseIndices(readings: IndexReading[], ctx: AdapterContext): MetricInput[] {
  const out: MetricInput[] = [];
  for (const r of readings) {
    if (!r || typeof r.value !== 'number' || !r.source) continue;
    const reg = registryFor(r.source);
    const category = r.category ?? reg?.category ?? 'A';
    out.push({
      metric_id: `index.${slug(r.slug)}`,
      category: category as MetricInput['category'],
      subject: r.label,
      provider: reg?.label ?? r.source,
      region: null,
      sku: null,
      pricing_mode: null,
      value: r.value,
      unit: r.unit || 'index-level',
      as_of: r.as_of || ctx.as_of,
      source: r.source,
      source_tier: reg?.source_tier ?? 2,
      source_url: r.source_url ?? reg?.home_url ?? null,
      confidence: r.confidence ?? 'as-reported',
      // The dispatch layer's stampDisplayGate re-derives this from the registry;
      // we seed it here so a direct call is also correct.
      display_allowed: reg ? reg.display_allowed && !reg.is_third_party_index : true,
      meta: reg?.attribution ? { attribution: reg.attribution } : {},
    });
  }
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
