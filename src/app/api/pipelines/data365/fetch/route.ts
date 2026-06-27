// POST /api/pipelines/data365/fetch
// Vercel cron: Saturday 18:00 UTC  (schedule: "0 18 * * 6")
// Fetches recent posts from all monitored Data365 groups.
// Requires env: DATA365_API_KEY

export const maxDuration = 300;

import { isAuthorized, getServiceClient, logRun, completeRun } from '@/lib/pipeline-utils';
import { fetchGroupPostsBatch } from '@/lib/data365/post-fetcher';

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = getServiceClient();
  if (!svc) {
    return Response.json({ error: 'Service client not configured' }, { status: 500 });
  }

  let body: { limit?: number } = {};
  try { body = await req.json(); } catch { /* cron sends no body */ }
  const limit = body.limit ?? 100;

  const runId = await logRun(svc, 'data365-fetch', 'cron');

  (async () => {
    try {
      const result = await fetchGroupPostsBatch(limit, svc);
      if (runId) await completeRun(svc, runId, {
        status:    result.errors > 0 ? 'partial' : 'completed',
        processed: result.inserted,
        failed:    result.errors,
      });
    } catch (err) {
      console.error('[pipeline/data365/fetch]', err);
      if (runId) await completeRun(svc, runId, { status: 'failed', error: String(err) });
    }
  })();

  return Response.json(
    { status: 'started', pipeline: 'data365-fetch', run_id: runId },
    { status: 202 }
  );
}
