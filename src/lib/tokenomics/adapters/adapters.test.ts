// Adapter tests with real captured-style payloads. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAipricingGuru } from './aipricing-guru.ts';
import { parseCloudGpu, type CloudGpuRow } from './cloud-gpu.ts';
import { parseNeocloud, type NeocloudRow } from './neocloud.ts';
import { parseIndices, type IndexReading } from './indices.ts';
import { parseFutures, type FuturesReading } from './futures.ts';
import { ingestBatch, runAdapter } from './index.ts';

const CTX = { as_of: '2026-07-26T00:00:00Z' };

// ─── aipricing.guru ──────────────────────────────────────────────────────────
test('parseAipricingGuru emits in/out/tps rows and skips absent prices', () => {
  const payload = {
    updated: '2026-07-26T00:00:00Z',
    models: [
      { id: 'gpt-5', name: 'GPT-5', provider: 'openai', input_per_mtok: 1.25, output_per_mtok: 10.0, throughput_tps: 180 },
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'anthropic', input_per_mtok: 5.0 }, // no output/tps
    ],
  };
  const out = parseAipricingGuru(payload, CTX);
  const ids = out.map((m) => m.metric_id).sort();
  assert.deepEqual(ids, ['token.claude-opus-4-8.in', 'token.gpt-5.in', 'token.gpt-5.out', 'token.gpt-5.tps']);
  const inRow = out.find((m) => m.metric_id === 'token.gpt-5.in')!;
  assert.equal(inRow.value, 1.25);
  assert.equal(inRow.unit, '$/M-in');
  assert.equal(inRow.meta?.dimension, 'in');
  assert.equal(inRow.confidence, 'as-reported');
});

// ─── cloud GPU ───────────────────────────────────────────────────────────────
test('parseCloudGpu divides instance $/hr by gpu_count → $/GPU-hr and keeps region', () => {
  const rows: CloudGpuRow[] = [
    { provider: 'aws', gpu_class: 'H100', gpu_count: 8, instance: 'p5.48xlarge', region: 'us-east-1', pricing_mode: 'ondemand', usd_per_hour: 98.32 },
  ];
  const out = parseCloudGpu(rows, CTX);
  assert.equal(out[0].metric_id, 'gpu.h100.ondemand.aws.us-east-1');
  assert.equal(out[0].unit, '$/GPU-hr');
  assert.equal(out[0].value, 12.29); // 98.32 / 8
  assert.equal(out[0].region, 'us-east-1');
  assert.equal(out[0].confidence, 'verified');
  assert.equal(out[0].source_tier, 1);
});

test('parseCloudGpu falls back to $/instance-hr when gpu_count unknown (no guess)', () => {
  const rows: CloudGpuRow[] = [
    { provider: 'gcp', gpu_class: 'B200', instance: 'a4-highgpu-8g', region: 'us-central1', pricing_mode: 'spot', usd_per_hour: 40 },
  ];
  const out = parseCloudGpu(rows, CTX);
  assert.equal(out[0].unit, '$/instance-hr');
  assert.equal(out[0].value, 40);
});

// ─── neocloud ────────────────────────────────────────────────────────────────
test('parseNeocloud maps roster providers and skips off-roster ones', () => {
  const rows: NeocloudRow[] = [
    { provider: 'coreweave', gpu_class: 'H100', pricing_mode: 'ondemand', usd_per_gpu_hour: 2.39 },
    { provider: 'together', gpu_class: 'H200', pricing_mode: 'ondemand', usd_per_gpu_hour: 3.15 },
    { provider: 'randocloud', gpu_class: 'H100', pricing_mode: 'ondemand', usd_per_gpu_hour: 1.0 }, // off-roster → skipped
  ];
  const out = parseNeocloud(rows, CTX);
  assert.equal(out.length, 2);
  const cw = out.find((m) => m.provider === 'CoreWeave')!;
  assert.equal(cw.metric_id, 'gpu.h100.ondemand.coreweave');
  assert.equal(cw.unit, '$/GPU-hr');
  assert.equal(cw.source, 'neocloud');
  assert.equal(cw.source_tier, 2);
});

// ─── indices (display gate) ──────────────────────────────────────────────────
test('parseIndices seeds display_allowed=false for third-party indices, true for AA', () => {
  const readings: IndexReading[] = [
    { source: 'silicon_data_gpu', slug: 'ocpi-h100', label: 'Silicon Data OCPI H100', value: 2.55, unit: 'index-level', as_of: CTX.as_of, category: 'B' },
    { source: 'artificial_analysis', slug: 'aa-throughput', label: 'AA Throughput', value: 180, unit: 'tokens/sec', as_of: CTX.as_of, category: 'A' },
  ];
  const out = parseIndices(readings, CTX);
  const sd = out.find((m) => m.metric_id === 'index.ocpi-h100')!;
  assert.equal(sd.display_allowed, false);
  assert.equal(sd.meta?.attribution, 'Silicon Data');
  const aa = out.find((m) => m.metric_id === 'index.aa-throughput')!;
  assert.equal(aa.display_allowed, true);
});

// ─── futures (zero-fabrication) ──────────────────────────────────────────────
test('parseFutures stores status always, price ONLY when trading', () => {
  const readings: FuturesReading[] = [
    { source: 'cme_silicon_data', venue: 'CME', instrument: 'AI Compute Futures', status: 'announced-pending', as_of: CTX.as_of, price: 123 }, // price ignored — not trading
    { source: 'ice_ornn', venue: 'ICE', instrument: 'OCPI Futures', status: 'trading', as_of: CTX.as_of, price: 2.61, volume: 400 },
  ];
  const out = parseFutures(readings, CTX);
  const pending = out.find((m) => m.subject === 'AI Compute Futures')!;
  assert.equal(pending.value, null, 'no price for a non-trading instrument');
  assert.equal(pending.meta?.status, 'announced-pending');
  const trading = out.find((m) => m.subject === 'OCPI Futures')!;
  assert.equal(trading.value, 2.61);
  assert.equal(trading.meta?.volume, 400);
});

// ─── dispatch + end-to-end ───────────────────────────────────────────────────
test('runAdapter dispatches by kind', () => {
  const out = runAdapter('neocloud', [{ provider: 'lambda', gpu_class: 'H100', pricing_mode: 'ondemand', usd_per_gpu_hour: 2.49 }], CTX);
  assert.equal(out[0].provider, 'Lambda');
});

test('ingestBatch stamps the gate, dedupes by figure, and attaches content_hash', async () => {
  const rows = await ingestBatch(
    [
      { kind: 'index', payload: [{ source: 'tokenix_acpi', slug: 'acpi', label: 'Tokenix ACPI', value: 128.4, unit: 'index-level', as_of: CTX.as_of, category: 'A' }] as IndexReading[] },
      { kind: 'neocloud', payload: [{ provider: 'crusoe', gpu_class: 'H100', pricing_mode: 'ondemand', usd_per_gpu_hour: 2.29 }] as NeocloudRow[] },
    ],
    CTX,
  );
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.content_hash.length, 64);
  const acpi = rows.find((r) => r.metric_id === 'index.acpi')!;
  assert.equal(acpi.display_allowed, false, 'third-party index gated closed end-to-end');
});
