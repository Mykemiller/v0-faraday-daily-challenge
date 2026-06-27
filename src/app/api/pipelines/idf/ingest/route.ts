// POST /api/pipelines/idf/ingest
// Vercel cron: Sunday 05:00 UTC  (schedule: "0 5 * * 0")
// Batch-ingests all pending signals from all four JW data feeds into idf_signals.
// Each source runs concurrently; failures in one source don't block others.

export const maxDuration = 300;

import { isAuthorized, getServiceClient, logRun, completeRun } from '@/lib/pipeline-utils';
import { ingestSignalsToIdf as ingestAgendaWatchIdf } from '@/lib/agenda-watch/idf-ingestor';
import { ingestPucSignalsToIdf }                      from '@/lib/puc/puc-signal-extractor';
import { ingestData365ToIdf }                         from '@/lib/data365/data365-idf';

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = getServiceClient();
  if (!svc) {
    return Response.json({ error: 'Service client not configured' }, { status: 500 });
  }

  const runId = await logRun(svc, 'idf-batch-ingest', 'cron');

  (async () => {
    try {
      const results = await Promise.allSettled([
        ingestAgendaWatchIdf(svc),
        ingestPucSignalsToIdf(svc),
        ingestData365ToIdf(svc),
      ]);

      let processed = 0;
      let failed    = 0;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          processed += r.value.ingested;
          failed    += r.value.errors;
        } else {
          failed++;
        }
      }

      if (runId) await completeRun(svc, runId, {
        status:    failed > 0 ? 'partial' : 'completed',
        processed,
        failed,
      });
    } catch (err) {
      console.error('[pipeline/idf/ingest]', err);
      if (runId) await completeRun(svc, runId, { status: 'failed', error: String(err) });
    }
  })();

  return Response.json(
    { status: 'started', pipeline: 'idf-batch-ingest', run_id: runId },
    { status: 202 }
  );
}
