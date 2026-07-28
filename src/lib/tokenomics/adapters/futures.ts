// Adapter: compute/token futures market (Group C, tier 2).
// Sources: CME × Silicon Data, ICE × Ornn, ICE × NATIVX/COIL, SHFE.
//
// ZERO-FABRICATION rule: store STATUS always (research | announced-pending |
// trading) with an as-of. Store a PRICE only once an instrument actually trades.
// A non-tradeable instrument NEVER carries a value — value stays null.

import type { MetricInput, FuturesStatus } from '../types.ts';
import type { AdapterContext } from './aipricing-guru.ts';
import { registryFor } from '../display-gate.ts';

export interface FuturesReading {
  source: string;     // registry slug: cme_silicon_data | ice_ornn | ice_nativx_coil | shfe
  venue: string;      // "CME" | "ICE" | "SHFE"
  instrument: string; // human instrument name
  status: FuturesStatus;
  as_of: string;
  price?: number | null;  // ONLY when status === 'trading'
  volume?: number | null;
  unit?: string;
  source_url?: string;
}

export function parseFutures(readings: FuturesReading[], ctx: AdapterContext): MetricInput[] {
  const out: MetricInput[] = [];
  for (const r of readings) {
    if (!r || !r.source || !r.instrument) continue;
    const reg = registryFor(r.source);
    const trading = r.status === 'trading';
    // Enforce the rule: value is null unless genuinely trading with a price.
    const value = trading && typeof r.price === 'number' ? r.price : null;
    out.push({
      metric_id: `futures.${slug(r.venue)}.${slug(r.instrument)}`,
      category: 'C',
      subject: r.instrument,
      provider: r.venue,
      region: null,
      sku: null,
      pricing_mode: null,
      value,
      unit: r.unit || (trading ? 'index-level' : 'status'),
      as_of: r.as_of || ctx.as_of,
      source: r.source,
      source_tier: reg?.source_tier ?? 2,
      source_url: r.source_url ?? null,
      confidence: trading ? 'as-reported' : 'unverified',
      display_allowed: true,
      meta: {
        status: r.status,
        venue: r.venue,
        instrument: r.instrument,
        ...(value !== null && r.volume != null ? { volume: r.volume } : {}),
      },
    });
  }
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
