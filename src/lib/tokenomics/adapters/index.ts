// Adapter dispatch — a `kind`-dispatch over the per-source adapters, matching the
// ingest-state-incentives generalization (socrata|ckan|arcgis|idh_json → here
// aipricing_guru|cloud_gpu|neocloud|index|futures). Each adapter is pure; the
// dispatch stamps the display gate, dedupes by figure, and builds content_hashes.

import type { MetricInput, MetricRow } from '../types.ts';
import { stampDisplayGate } from '../display-gate.ts';
import { buildMetricRows } from '../metric.ts';
import { parseAipricingGuru, type AdapterContext, type AipricingPayload } from './aipricing-guru.ts';
import { parseCloudGpu, type CloudGpuRow } from './cloud-gpu.ts';
import { parseNeocloud, type NeocloudRow } from './neocloud.ts';
import { parseIndices, type IndexReading } from './indices.ts';
import { parseFutures, type FuturesReading } from './futures.ts';

export type AdapterKind = 'aipricing_guru' | 'cloud_gpu' | 'neocloud' | 'index' | 'futures';

export interface RawSource {
  kind: AdapterKind;
  payload: unknown;
}

// Dispatch one raw payload to its adapter → MetricInput[] (display gate NOT yet
// stamped; ingestBatch does that centrally).
export function runAdapter(kind: AdapterKind, payload: unknown, ctx: AdapterContext): MetricInput[] {
  switch (kind) {
    case 'aipricing_guru':
      return parseAipricingGuru(payload as AipricingPayload, ctx);
    case 'cloud_gpu':
      return parseCloudGpu(payload as CloudGpuRow[], ctx);
    case 'neocloud':
      return parseNeocloud(payload as NeocloudRow[], ctx);
    case 'index':
      return parseIndices(payload as IndexReading[], ctx);
    case 'futures':
      return parseFutures(payload as FuturesReading[], ctx);
    default:
      return [];
  }
}

// Run every raw source, stamp the display gate from the registry (third-party
// indices forced display_allowed=false), dedupe by underlying figure, and attach
// content_hashes. Returns rows ready for append-only upsert.
export async function ingestBatch(sources: RawSource[], ctx: AdapterContext): Promise<MetricRow[]> {
  const inputs: MetricInput[] = [];
  for (const s of sources) {
    for (const mi of runAdapter(s.kind, s.payload, ctx)) {
      inputs.push(stampDisplayGate(mi));
    }
  }
  return buildMetricRows(inputs);
}

export * from './aipricing-guru.ts';
export * from './cloud-gpu.ts';
export * from './neocloud.ts';
export * from './indices.ts';
export * from './futures.ts';
