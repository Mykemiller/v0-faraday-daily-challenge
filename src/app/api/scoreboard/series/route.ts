// GET /api/scoreboard/series?metric_id=…&window=7d|30d|90d|1y|all
//
// Sparkline / history / volatility for one metric. Reads the metric's append-only
// vintages and derives % change (7/30/90d) + realized volatility AT READ TIME.
// Honors the display gate: a display_allowed=false metric returns points with
// NULL values (existence + as-of + "display pending" note only).

import { svc, readSeries } from '@/lib/tokenomics/db';
import { latestByAsOf, pctChange, realizedVol, windowPoints, parseWindowDays } from '@/lib/tokenomics/series';
import { DISPLAY_PENDING_NOTE } from '@/lib/tokenomics/snapshot';
import type { SeriesResponse, StoredReading } from '@/lib/tokenomics/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const s = svc();
  if (!s) return Response.json({ error: 'Scoreboard service not configured' }, { status: 500 });

  const params = new URL(request.url).searchParams;
  const metricId = (params.get('metric_id') || '').trim();
  const windowStr = params.get('window') || '90d';
  if (!metricId) return Response.json({ error: 'Missing metric_id' }, { status: 400 });

  const days = parseWindowDays(windowStr);

  try {
    const rows: StoredReading[] = await readSeries(s, metricId, days);
    if (rows.length === 0) {
      return Response.json(
        { metric_id: metricId, window: windowStr, unit: null, display_allowed: true, source: null, tier: null, points: [], delta_7d: null, delta_30d: null, delta_90d: null, realized_vol: null } satisfies SeriesResponse,
      );
    }

    const latest = rows[rows.length - 1];
    const gated = latest.display_allowed === false;
    const allPoints = latestByAsOf(rows);
    const scoped = windowPoints(allPoints, days);

    const resp: SeriesResponse = {
      metric_id: metricId,
      window: windowStr,
      unit: latest.unit,
      display_allowed: !gated,
      source: latest.source,
      tier: latest.source_tier,
      points: gated ? scoped.map((p) => ({ as_of: p.as_of, value: null })) : scoped,
      delta_7d: gated ? null : pctChange(allPoints, 7),
      delta_30d: gated ? null : pctChange(allPoints, 30),
      delta_90d: gated ? null : pctChange(allPoints, 90),
      realized_vol: gated ? null : realizedVol(scoped, days),
    };
    if (gated) resp.note = DISPLAY_PENDING_NOTE;

    return Response.json(resp);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scoreboard/series] failed:', message);
    return Response.json({ error: 'Series failed', detail: message.slice(0, 300) }, { status: 500 });
  }
}
