// POST /api/pipelines/data365/aggregate
// Vercel cron: daily 08:00 UTC  (schedule: "0 8 * * *")
// Aggregates Data365 community posts into:
//   1. dim_opposition scores on jurisdictions
//   2. IDF signals for the Live Agent corpus

export const maxDuration = 300;

import { isAuthorized, getServiceClient, logRun, completeRun } from '@/lib/pipeline-utils';
import { aggregateOppositionSignals } from '@/lib/data365/opposition-aggregator';
import { ingestData365ToIdf }         from '@/lib/data365/data365-idf';

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = getServiceClient();
  if (!svc) {
    return Response.json({ error: 'Service client not configured' }, { status: 500 });
  }

  const runId = await logRun(svc, 'data365-aggregate', 'cron');

  (async () => {
    try {
      const [opp, idf] = await Promise.allSettled([
        aggregateOppositionSignals(svc),
        ingestData365ToIdf(svc),
      ]);

      const processed = (opp.status === 'fulfilled' ? opp.value.updated : 0) +
                        (idf.status === 'fulfilled' ? idf.value.ingested : 0);
      const failed    = (opp.status === 'rejected' ? 1 : 0) +
                        (idf.status === 'fulfilled' ? idf.value.errors  : 1);

      if (runId) await completeRun(svc, runId, {
        status:    failed > 0 ? 'partial' : 'completed',
        processed,
        failed,
      });
    } catch (err) {
      console.error('[pipeline/data365/aggregate]', err);
      if (runId) await completeRun(svc, runId, { status: 'failed', error: String(err) });
    }
  })();

  return Response.json(
    { status: 'started', pipeline: 'data365-aggregate', run_id: runId },
    { status: 202 }
  );
}
