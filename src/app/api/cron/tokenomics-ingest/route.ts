// GET /api/cron/tokenomics-ingest — the Tokenomics Scoreboard source poller.
//
// Triggered by Vercel cron / pg_cron net.http_post. Runs the per-source adapters
// (kind-dispatch), dedupes by underlying figure, appends new vintages
// (content-hash idempotent), and writes ONE automation_health_log row per run.
//
// AUTO id: PROPOSED **AUTO-183** ("Tokenomics Scoreboard Ingest") — registered in
// docs/tokenomics-scoreboard/README.md, NOT yet assigned in the Airtable
// Automation Registry (governance: no AUTO- assignment without Myke's sign-off).
//
// Auth: Authorization: Bearer ${CRON_SECRET}. Cadence per group (README): tokens
// near-daily; GPU on-demand daily / reserved weekly; indices at publisher cadence;
// futures on event/monthly; demand-context quarterly.
//
// ⚠️ The real vendor FETCH is deploy-gated (like jw-dc-registry-ingest). Frontier
// vendor pages are 403-prone (headless/semi-manual); catalog APIs need keys;
// third-party indices need licensing. Until wired, gatherRawSources() returns []
// and the run is an honest no-op (never fabricates data).

import { NextRequest, NextResponse } from 'next/server';
import { ingestBatch, type RawSource } from '@/lib/tokenomics/adapters';
import { svc, insertMetricRows, writeHealth } from '@/lib/tokenomics/db';

export const dynamic = 'force-dynamic';

const AUTO_ID = 'AUTO-183'; // PROPOSED — pending Myke's registry sign-off
const CRAWLER_ID = 'tokenomics-ingest_v1.0';

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unset in dev → open
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return bearer === secret;
}

// Fetch each source's raw payload. DEPLOY-GATED: real vendor calls (aipricing.guru
// JSON, AWS/Azure/GCP catalog APIs, rendered vendor pages, neocloud pages, index
// publishers, futures press/IR) are added at promotion. Returning [] keeps the run
// honest until then.
async function gatherRawSources(): Promise<RawSource[]> {
  // TODO(promotion): populate from live fetchers, e.g.
  //   { kind: 'aipricing_guru', payload: await fetchAipricingGuru() },
  //   { kind: 'cloud_gpu',      payload: await fetchAwsPriceList() },
  //   { kind: 'neocloud',       payload: await scrapeNeocloudPages() },
  //   { kind: 'index',          payload: await fetchLicensedIndices() },
  //   { kind: 'futures',        payload: await fetchFuturesStatus() },
  return [];
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const s = svc();
  if (!s) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, { status: 500 });

  const runStarted = new Date().toISOString();
  try {
    const sources = await gatherRawSources();
    const rows = await ingestBatch(sources, { as_of: runStarted });
    const inserted = sources.length === 0 ? 0 : await insertMetricRows(s, rows);

    await writeHealth(s, {
      auto_id: AUTO_ID,
      crawler_id: CRAWLER_ID,
      run_started_at: runStarted,
      run_completed_at: new Date().toISOString(),
      artifacts_found: rows.length,
      artifacts_new: inserted,
      artifacts_duped: rows.length - inserted,
      success: true,
      notes:
        sources.length === 0
          ? 'no_data_sources_configured (real vendor fetch is deploy-gated)'
          : `ingested ${inserted} new vintages from ${sources.length} sources`,
    });

    return NextResponse.json({
      ok: true,
      sources: sources.length,
      readings: rows.length,
      inserted,
      duped: rows.length - inserted,
      note: sources.length === 0 ? 'no_data_sources_configured' : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[tokenomics-ingest] failed:', message);
    await writeHealth(s, {
      auto_id: AUTO_ID,
      crawler_id: CRAWLER_ID,
      run_started_at: runStarted,
      run_completed_at: new Date().toISOString(),
      artifacts_found: 0,
      artifacts_new: 0,
      artifacts_duped: 0,
      success: false,
      errors: [{ kind: 'ingest_error', reason: message.slice(0, 500) }],
      notes: `ingest_error: ${message.slice(0, 200)}`,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
