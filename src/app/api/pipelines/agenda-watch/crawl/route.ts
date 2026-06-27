// POST /api/pipelines/agenda-watch/crawl
// Vercel cron: Saturday 06:00 UTC  (schedule: "0 6 * * 6")
// Kicks off an async crawl of Legistar + CivicPlus agenda documents
// for the priority entity list (or full list when priority_only=false).
//
// Auth: Bearer PIPELINE_SECRET (set in Vercel env). If the secret is unset,
// the route accepts any caller — safe for local dev only.

export const maxDuration = 300;

import { isAuthorized, getServiceClient, logRun, completeRun } from '@/lib/pipeline-utils';
import { crawlAgendaWatchEntities } from '@/lib/agenda-watch/document-crawler';

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = getServiceClient();
  if (!svc) {
    return Response.json({ error: 'Service client not configured' }, { status: 500 });
  }

  let body: { priority_only?: boolean } = {};
  try { body = await req.json(); } catch { /* cron sends no body */ }
  const priorityOnly = body.priority_only !== false; // default: priority entities only

  const runId = await logRun(svc, 'agenda-watch-crawl', 'cron');

  // Fire and forget — Vercel kills the function at maxDuration regardless.
  // The run log records the outcome via completeRun() inside the async fn.
  (async () => {
    try {
      const result = await crawlAgendaWatchEntities(priorityOnly ? 25 : 50, svc);
      if (runId) await completeRun(svc, runId, {
        status:    result.errors > 0 ? 'partial' : 'completed',
        processed: result.inserted,
        failed:    result.errors,
      });
    } catch (err) {
      console.error('[pipeline/agenda-watch/crawl]', err);
      if (runId) await completeRun(svc, runId, {
        status: 'failed',
        error:  String(err),
      });
    }
  })();

  return Response.json(
    { status: 'started', pipeline: 'agenda-watch-crawl', run_id: runId },
    { status: 202 }
  );
}
