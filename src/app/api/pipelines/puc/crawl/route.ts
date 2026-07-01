// POST /api/pipelines/puc/crawl
// Vercel cron: Saturday 12:00 UTC  (schedule: "0 12 * * 6")
// Crawls state PUC dockets for data-center-relevant filings.
// Priority states: TX, VA, GA, NC, FL, AZ, CO, IL, OH, PA.

export const maxDuration = 300;

import { isAuthorized, getServiceClient, logRun, completeRun } from '@/lib/pipeline-utils';
import { crawlAllPucDockets } from '@/lib/puc/puc-crawler';

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
  const priorityOnly = body.priority_only !== false; // default: priority states only

  const runId = await logRun(svc, 'puc-crawl', 'cron');

  (async () => {
    try {
      const result = await crawlAllPucDockets(priorityOnly, svc);
      if (runId) await completeRun(svc, runId, {
        status:    result.errors > 0 ? 'partial' : 'completed',
        processed: result.inserted,
        failed:    result.errors,
      });
    } catch (err) {
      console.error('[pipeline/puc/crawl]', err);
      if (runId) await completeRun(svc, runId, { status: 'failed', error: String(err) });
    }
  })();

  return Response.json(
    { status: 'started', pipeline: 'puc-crawl', run_id: runId },
    { status: 202 }
  );
}
