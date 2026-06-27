// POST /api/pipelines/eia/refresh
// Vercel cron: Monday 06:00 UTC  (schedule: "0 6 * * 1")
// Refreshes EIA annual electricity data for all 50 states, propagates
// dim_power scores to county jurisdictions, and emits IDF signals.
// Requires env: EIA_API_KEY

export const maxDuration = 300;

import { isAuthorized, getServiceClient, logRun, completeRun } from '@/lib/pipeline-utils';
import { fetchAllStateEiaData }    from '@/lib/eia/eia-fetcher';
import { applyEiaToJurisdictions } from '@/lib/eia/eia-jw-updater';
import { generateEiaIdfSignals }   from '@/lib/eia/eia-idf';

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = getServiceClient();
  if (!svc) {
    return Response.json({ error: 'Service client not configured' }, { status: 500 });
  }

  const runId = await logRun(svc, 'eia-refresh', 'cron');

  (async () => {
    try {
      const fetchResult = await fetchAllStateEiaData(svc);
      const [jwResult, idfResult] = await Promise.allSettled([
        applyEiaToJurisdictions(svc),
        generateEiaIdfSignals(svc),
      ]);

      const processed = fetchResult.inserted +
        (jwResult.status  === 'fulfilled' ? jwResult.value.updated    : 0) +
        (idfResult.status === 'fulfilled' ? idfResult.value.generated : 0);
      const failed = fetchResult.errors +
        (jwResult.status  === 'rejected' ? 1 : 0) +
        (idfResult.status === 'fulfilled' ? idfResult.value.errors    : 1);

      if (runId) await completeRun(svc, runId, {
        status:    failed > 0 ? 'partial' : 'completed',
        processed,
        failed,
        metadata:  { fetchResult } as any,
      });
    } catch (err) {
      console.error('[pipeline/eia/refresh]', err);
      if (runId) await completeRun(svc, runId, { status: 'failed', error: String(err) });
    }
  })();

  return Response.json(
    { status: 'started', pipeline: 'eia-refresh', run_id: runId },
    { status: 202 }
  );
}
