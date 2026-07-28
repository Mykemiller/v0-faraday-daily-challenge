// GET /api/scoreboard/snapshot?region=…&pick5=<provider>
//
// Returns the typed scoreboard_snapshot the front end consumes. Reads recent
// append-only vintages via the service role, assembles the snapshot (pure), wires
// the FUSION block, and enforces the display gate (third-party index VALUES are
// omitted — existence + as-of + source + "display pending" only).
//
// The snapshot returns the 4 fixed neoclouds + the FULL candidate pool so any
// subscriber pick already has data; the front end renders 4 fixed + the pick.

import { svc, readRecentMetrics, readGridSignal } from '@/lib/tokenomics/db';
import { buildSnapshot } from '@/lib/tokenomics/snapshot';
import { buildFusion, type RegionGpuSeries } from '@/lib/tokenomics/fusion';
import { latestByAsOf } from '@/lib/tokenomics/series';
import { NEOCLOUD_ROSTER, resolvePick5 } from '@/lib/tokenomics/roster';
import { SOURCE_REGISTRY } from '@/lib/tokenomics/display-gate';
import type { StoredReading, Footnote } from '@/lib/tokenomics/types';

export const dynamic = 'force-dynamic';

function buildFootnotes(readings: StoredReading[]): Footnote[] {
  const seen = new Set<string>();
  const out: Footnote[] = [];
  let n = 1;
  for (const r of readings) {
    if (seen.has(r.source)) continue;
    seen.add(r.source);
    const reg = SOURCE_REGISTRY[r.source];
    out.push({
      ref: `${n++}`,
      source: reg?.label ?? r.source,
      tier: r.source_tier,
      cadence: reg?.cadence ?? 'unknown',
      note: reg?.is_third_party_index
        ? 'licensed source — value display pending sign-off'
        : reg?.notes ?? '',
    });
  }
  return out;
}

// Region-keyed GPU series for the fusion narrative (strongest 7d move).
function regionGpuSeries(readings: StoredReading[], region: string): RegionGpuSeries[] {
  const byMetric = new Map<string, StoredReading[]>();
  for (const r of readings) {
    if (r.category !== 'B' || r.region !== region || r.pricing_mode !== 'ondemand') continue;
    if (!byMetric.has(r.metric_id)) byMetric.set(r.metric_id, []);
    byMetric.get(r.metric_id)!.push(r);
  }
  return [...byMetric.entries()].map(([metric_id, rows]) => ({
    metric_id,
    label: `${rows[0].subject ?? metric_id} on-demand (${rows[0].provider ?? ''})`.trim(),
    points: latestByAsOf(rows),
  }));
}

export async function GET(request: Request) {
  const s = svc();
  if (!s) return Response.json({ error: 'Scoreboard service not configured' }, { status: 500 });

  const params = new URL(request.url).searchParams;
  const region = (params.get('region') || 'us-east-1').trim();
  const pick5 = resolvePick5({ pick5: params.get('pick5') });

  try {
    const readings = await readRecentMetrics(s);
    const grid = await readGridSignal(s, region);
    const fusion = buildFusion(region, regionGpuSeries(readings, region), grid);

    const snapshot = buildSnapshot(readings, {
      region,
      roster: NEOCLOUD_ROSTER,
      fusion,
      footnotes: buildFootnotes(readings),
      // API returns 4 fixed + full candidate pool (no provider trim server-side).
    });

    return Response.json({ ...snapshot, pick5 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scoreboard/snapshot] failed:', message);
    return Response.json({ error: 'Snapshot failed', detail: message.slice(0, 300) }, { status: 500 });
  }
}
