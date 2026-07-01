// POST /api/pipelines/agenda-watch/extract
// Vercel cron: Sunday 01:00 UTC  (schedule: "0 1 * * 0")
// Processes agenda_watch_documents without extracted text:
//   1. Downloads + extracts text (PDF/HTML)
//   2. Detects data-center signals in the text
//   3. Updates JPS dim_* scores for the jurisdiction

export const maxDuration = 300;

import { isAuthorized, getServiceClient, logRun, completeRun } from '@/lib/pipeline-utils';
import { extractDocumentText } from '@/lib/agenda-watch/text-extractor';
import { extractSignals }      from '@/lib/agenda-watch/signal-extractor';
import { updateJpsDimensionsFromSignals } from '@/lib/agenda-watch/jps-updater';

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = getServiceClient();
  if (!svc) {
    return Response.json({ error: 'Service client not configured' }, { status: 500 });
  }

  const runId = await logRun(svc, 'agenda-watch-extract', 'cron');

  (async () => {
    let processed = 0;
    let failed    = 0;
    try {
      const r = await fetch(
        `${svc.base}/agenda_watch_documents?raw_text=is.null` +
        `&select=id,source_id,jurisdiction_id,document_url,title,document_date,document_type` +
        `&order=crawled_at.desc&limit=200`,
        { headers: svc.headers, cache: 'no-store' }
      );
      const docs: any[] = r.ok ? await r.json().catch(() => []) : [];

      for (const doc of docs) {
        try {
          const text = await extractDocumentText(doc, svc);
          if (!text) { failed++; continue; }

          await fetch(`${svc.base}/agenda_watch_documents?id=eq.${doc.id}`, {
            method:  'PATCH',
            headers: svc.headers,
            body:    JSON.stringify({
              raw_text:   text,
              word_count: text.split(/\s+/).length,
            }),
          });

          const signalCount = await extractSignals(doc, text, svc);
          if (signalCount > 0 && doc.jurisdiction_id) {
            await updateJpsDimensionsFromSignals(doc.jurisdiction_id, svc);
          }

          processed++;
        } catch (err) {
          console.error('[agenda-watch/extract] doc error', doc.id, err);
          failed++;
        }
      }

      if (runId) await completeRun(svc, runId, {
        status:    failed > 0 ? 'partial' : 'completed',
        processed,
        failed,
      });
    } catch (err) {
      console.error('[pipeline/agenda-watch/extract]', err);
      if (runId) await completeRun(svc, runId, { status: 'failed', error: String(err) });
    }
  })();

  return Response.json(
    { status: 'started', pipeline: 'agenda-watch-extract', run_id: runId },
    { status: 202 }
  );
}
