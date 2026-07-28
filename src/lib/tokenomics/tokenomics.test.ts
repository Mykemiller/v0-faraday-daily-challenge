// Pure-logic tests for the Tokenomics Scoreboard core. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contentHash, figureKey, dedupeByFigure, buildMetricRows } from './metric.ts';
import { latestByAsOf, pctChange, realizedVol, sparkline, parseWindowDays, windowPoints } from './series.ts';
import { NEOCLOUD_ROSTER, DEFAULT_PICK5, isValidPick5, resolvePick5, allIngestedNeoclouds } from './roster.ts';
import { stampDisplayGate, isThirdPartyIndex, SOURCE_REGISTRY } from './display-gate.ts';
import { buildSnapshot, DISPLAY_PENDING_NOTE } from './snapshot.ts';
import { buildFusion } from './fusion.ts';
import type { MetricInput, StoredReading, SeriesPoint } from './types.ts';

function mi(over: Partial<MetricInput> = {}): MetricInput {
  return {
    metric_id: 'gpu.h100.ondemand.coreweave',
    category: 'B',
    subject: 'H100',
    provider: 'CoreWeave',
    region: null,
    sku: null,
    pricing_mode: 'ondemand',
    value: 2.39,
    unit: '$/GPU-hr',
    as_of: '2026-07-26T00:00:00Z',
    source: 'neocloud',
    source_tier: 2,
    confidence: 'as-reported',
    display_allowed: true,
    ...over,
  };
}

// ─── metric: content_hash + dedup ────────────────────────────────────────────
test('contentHash is stable for identical figures and changes when value changes', async () => {
  const a = await contentHash(mi());
  const b = await contentHash(mi());
  assert.equal(a, b, 'same figure → same hash (idempotent re-fetch is a no-op)');
  const c = await contentHash(mi({ value: 2.5 }));
  assert.notEqual(a, c, 'changed value → new hash → new vintage');
});

test('contentHash ignores why_note (derived narrative never churns a vintage)', async () => {
  const a = await contentHash(mi());
  const b = await contentHash(mi({ why_note: 'grid tightened' }));
  assert.equal(a, b);
});

test('figureKey is source-independent', () => {
  const k1 = figureKey(mi({ source: 'neocloud' }));
  const k2 = figureKey(mi({ source: 'silicon_data_gpu' }));
  assert.equal(k1, k2, 'same underlying figure, different citing source → same figure key');
});

test('dedupeByFigure collapses same figure to one canonical reading + citations', () => {
  const t1 = mi({ source: 'aws', source_tier: 1, confidence: 'verified', source_url: 'https://aws' });
  const t3 = mi({ source: 'neocloud', source_tier: 2, source_url: 'https://neo' });
  const out = dedupeByFigure([t3, t1]);
  assert.equal(out.length, 1, 'one canonical reading');
  assert.equal(out[0].source, 'aws', 'highest tier wins as canonical');
  const citations = (out[0].meta?.citations ?? []) as { source: string }[];
  assert.equal(citations.length, 1);
  assert.equal(citations[0].source, 'neocloud');
});

test('buildMetricRows dedupes then attaches content_hash', async () => {
  const rows = await buildMetricRows([mi(), mi({ source: 'aws', source_tier: 1 })]);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].content_hash && rows[0].content_hash.length === 64);
});

// ─── series: read-time derivations ───────────────────────────────────────────
function pt(as_of: string, value: number | null): SeriesPoint {
  return { as_of, value };
}
function reading(as_of: string, value: number, ingested_at?: string): StoredReading {
  return { ...mi({ as_of, value }), content_hash: 'x', ingested_at } as StoredReading;
}

test('latestByAsOf keeps the latest ingested vintage per as_of, sorted ascending', () => {
  const rows = [
    reading('2026-07-20T00:00:00Z', 2.0, '2026-07-20T01:00:00Z'),
    reading('2026-07-20T00:00:00Z', 2.2, '2026-07-20T05:00:00Z'), // restated, later ingest wins
    reading('2026-07-19T00:00:00Z', 1.9, '2026-07-19T01:00:00Z'),
  ];
  const pts = latestByAsOf(rows);
  assert.deepEqual(
    pts.map((p) => [p.as_of, p.value]),
    [['2026-07-19T00:00:00Z', 1.9], ['2026-07-20T00:00:00Z', 2.2]],
  );
});

test('pctChange computes 7d/30d change vs the nearest prior point', () => {
  const pts = [
    pt('2026-06-26T00:00:00Z', 100),
    pt('2026-07-19T00:00:00Z', 110),
    pt('2026-07-26T00:00:00Z', 121),
  ];
  assert.equal(pctChange(pts, 7), 10); // 121 vs 110
  assert.equal(pctChange(pts, 30), 21); // 121 vs 100
});

test('pctChange returns null with no far-enough base or zero base', () => {
  assert.equal(pctChange([pt('2026-07-26T00:00:00Z', 100)], 7), null);
  assert.equal(pctChange([pt('2026-07-19T00:00:00Z', 0), pt('2026-07-26T00:00:00Z', 5)], 7), null);
});

test('realizedVol returns a positive annualized number for varied series, null for flat/short', () => {
  const varied: SeriesPoint[] = [];
  for (let i = 0; i < 10; i++) varied.push(pt(`2026-07-${10 + i}T00:00:00Z`, 100 + (i % 2 === 0 ? 5 : -5)));
  const v = realizedVol(varied, 90);
  assert.ok(v !== null && v > 0);
  assert.equal(realizedVol([pt('2026-07-25T00:00:00Z', 100), pt('2026-07-26T00:00:00Z', 100)], 90), null);
});

test('sparkline downsamples to at most maxPoints preserving endpoints', () => {
  const pts = Array.from({ length: 100 }, (_, i) => pt(`2026-01-01T00:00:00Z`, i));
  const s = sparkline(pts, 10);
  assert.equal(s.length, 10);
  assert.equal(s[0], 0);
  assert.equal(s[s.length - 1], 99);
});

test('parseWindowDays parses d/w/y and all', () => {
  assert.equal(parseWindowDays('7d'), 7);
  assert.equal(parseWindowDays('2w'), 14);
  assert.equal(parseWindowDays('1y'), 365);
  assert.ok(parseWindowDays('all') > 1000);
  assert.equal(parseWindowDays('junk'), 90);
});

test('windowPoints trims to the trailing window', () => {
  const pts = [pt('2026-05-01T00:00:00Z', 1), pt('2026-07-20T00:00:00Z', 2), pt('2026-07-26T00:00:00Z', 3)];
  assert.equal(windowPoints(pts, 7).length, 2);
});

// ─── roster ──────────────────────────────────────────────────────────────────
test('roster: 4 fixed + candidate pool, Together default, all ingested = union', () => {
  assert.deepEqual(NEOCLOUD_ROSTER.fixed, ['coreweave', 'lambda', 'nebius', 'crusoe']);
  assert.equal(DEFAULT_PICK5, 'together');
  assert.ok(NEOCLOUD_ROSTER.candidates.includes('together'));
  assert.equal(allIngestedNeoclouds().length, 4 + NEOCLOUD_ROSTER.candidates.length);
});

test('pick validation + resolution', () => {
  assert.ok(isValidPick5('voltagepark'));
  assert.ok(!isValidPick5('coreweave')); // fixed, not a candidate pick
  assert.equal(resolvePick5({ pick5: 'nscale' }), 'nscale');
  assert.equal(resolvePick5({ pick5: 'bogus' }), DEFAULT_PICK5);
  assert.equal(resolvePick5(null), DEFAULT_PICK5);
});

// ─── display gate ────────────────────────────────────────────────────────────
test('stampDisplayGate forces third-party indices to display_allowed=false + attribution', () => {
  const gated = stampDisplayGate(mi({ source: 'silicon_data_gpu', category: 'B', display_allowed: true }));
  assert.equal(gated.display_allowed, false);
  assert.equal(gated.meta?.attribution, 'Silicon Data');
  assert.ok(isThirdPartyIndex('tokenix_acpi'));
  assert.ok(!isThirdPartyIndex('aws'));
});

test('stampDisplayGate leaves vendor prices open and sets tier from registry', () => {
  const open = stampDisplayGate(mi({ source: 'aws', source_tier: 3 }));
  assert.equal(open.display_allowed, true);
  assert.equal(open.source_tier, SOURCE_REGISTRY.aws.source_tier);
});

// ─── snapshot assembly + display gate ────────────────────────────────────────
test('buildSnapshot suppresses gated index values but keeps existence + placeholder', () => {
  const readings: StoredReading[] = [
    { ...mi({ metric_id: 'index.acpi', category: 'A', subject: 'Tokenix ACPI', source: 'tokenix_acpi', source_tier: 1, unit: 'index-level', value: 128.4, display_allowed: false, meta: { attribution: 'Tokenix ACPI' } }), content_hash: 'h1' } as StoredReading,
    { ...mi({ metric_id: 'index.aa', category: 'A', subject: 'Artificial Analysis', source: 'artificial_analysis', source_tier: 1, unit: 'index-level', value: 42, display_allowed: true }), content_hash: 'h2' } as StoredReading,
  ];
  const snap = buildSnapshot(readings, { region: 'us-east-1', roster: NEOCLOUD_ROSTER, fusion: null });
  const acpi = snap.indices.find((i) => i.metric_id === 'index.acpi')!;
  assert.equal(acpi.value, null, 'gated value suppressed');
  assert.equal(acpi.note, DISPLAY_PENDING_NOTE);
  assert.deepEqual(acpi.spark, []);
  assert.equal(acpi.display_allowed, false);
  const aa = snap.indices.find((i) => i.metric_id === 'index.aa')!;
  assert.equal(aa.value, 42, 'ungated index displays its value');
});

test('buildSnapshot groups gpu cells by class and merges pricing modes', () => {
  const base = { category: 'B' as const, subject: 'H100', provider: 'CoreWeave', region: null, content_hash: 'h' };
  const readings: StoredReading[] = [
    { ...mi({ ...base, metric_id: 'gpu.h100.ondemand.coreweave', pricing_mode: 'ondemand', value: 2.39 }) } as StoredReading,
    { ...mi({ ...base, metric_id: 'gpu.h100.reserved.coreweave', pricing_mode: 'reserved', value: 1.99 }) } as StoredReading,
  ];
  const snap = buildSnapshot(readings, { region: 'us-east-1', roster: NEOCLOUD_ROSTER, fusion: null });
  const h100 = snap.gpus.find((g) => g.gpu_class === 'H100')!;
  const cw = h100.cells.find((c) => c.provider === 'CoreWeave')!;
  assert.equal(cw.ondemand, 2.39);
  assert.equal(cw.reserved, 1.99);
});

test('buildSnapshot never renders a price for a non-tradeable future', () => {
  const readings: StoredReading[] = [
    { ...mi({ metric_id: 'futures.cme.ai-compute', category: 'C', subject: 'AI Compute', provider: 'CME', pricing_mode: null, value: null, unit: 'status', source: 'cme_silicon_data', meta: { status: 'announced-pending', venue: 'CME', instrument: 'AI Compute Futures' } }), content_hash: 'h' } as StoredReading,
  ];
  const snap = buildSnapshot(readings, { region: 'us-east-1', roster: NEOCLOUD_ROSTER, fusion: null });
  assert.equal(snap.futures[0].status, 'announced-pending');
  assert.equal(snap.futures[0].price, undefined, 'no price for a non-trading instrument');
});

// ─── fusion ──────────────────────────────────────────────────────────────────
test('buildFusion generates why_note only when a real move meets a real grid constraint', () => {
  const series = [
    { metric_id: 'gpu.h100.ondemand.aws.us-east-1', label: 'H100 on-demand (AWS)', points: [pt('2026-07-19T00:00:00Z', 3.0), pt('2026-07-26T00:00:00Z', 3.3)] },
  ];
  const grid = { region: 'us-east-1', power_price_kwh: 0.062, interconnect_queue_depth: 44, time_to_power: '36+ months', as_of: '2026-07-26T00:00:00Z' };
  const f = buildFusion('us-east-1', series, grid);
  assert.ok(f.why_note && f.why_note.includes('us-east-1'));
  assert.equal(f.power_price_kwh, 0.062);
});

test('buildFusion emits no why_note when grid is unconstrained or move is small', () => {
  const smallMove = [{ metric_id: 'm', label: 'H100', points: [pt('2026-07-19T00:00:00Z', 3.0), pt('2026-07-26T00:00:00Z', 3.01)] }];
  const grid = { region: 'us-east-1', power_price_kwh: 0.05, interconnect_queue_depth: 2, time_to_power: null, as_of: '2026-07-26T00:00:00Z' };
  assert.equal(buildFusion('us-east-1', smallMove, grid).why_note, null);
  assert.equal(buildFusion('us-east-1', smallMove, null).power_price_kwh, null);
});
