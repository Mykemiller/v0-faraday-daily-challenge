// Data365 Facebook Intelligence — batch job trigger.
//   POST /api/data365 { action, stateFips?, batchSize?, lookbackDays? }
//
// Actions:
//   discover    — search for Facebook groups for each county (long-running)
//   fetch-posts — pull recent posts from registered groups (weekly)
//   aggregate   — roll up posts → opposition signals + update dim_opposition
//   ingest-idf  — write opposition signals into idf_signals table
//   run-all     — fetch-posts → aggregate → ingest-idf (excludes discover)
//
// Auth: CRON_SECRET bearer token (same pattern as /api/cron/rotate).
// Requires env: DATA365_API_KEY, SUPABASE_SERVICE_ROLE_KEY.
//
// Note: 'discover' can take hours for the full US county set.
// Run with stateFips to limit to one state for testing.

import { discoverAllCountyGroups }    from '@/lib/data365/group-discovery';
import { fetchGroupPostsBatch }        from '@/lib/data365/post-fetcher';
import { aggregateOppositionSignals }  from '@/lib/data365/opposition-aggregator';
import { ingestData365ToIdf }          from '@/lib/data365/idf';

const VALID_ACTIONS = ['discover', 'fetch-posts', 'aggregate', 'ingest-idf', 'run-all'] as const;
type Action = typeof VALID_ACTIONS[number];

function checkAuth(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;  // no secret configured — allow (dev convenience)
  const auth = request.headers.get('Authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!checkAuth(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.DATA365_API_KEY) {
    return Response.json(
      { error: 'DATA365_API_KEY not configured' },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body.action as string;
  if (!VALID_ACTIONS.includes(action as Action)) {
    return Response.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }

  const stateFips    = typeof body.stateFips   === 'string' ? body.stateFips   : undefined;
  const batchSize    = typeof body.batchSize    === 'number' ? body.batchSize    : undefined;
  const lookbackDays = typeof body.lookbackDays === 'number' ? body.lookbackDays : undefined;

  try {
    switch (action as Action) {
      case 'discover':
        await discoverAllCountyGroups(stateFips);
        return Response.json({ ok: true, action });

      case 'fetch-posts':
        await fetchGroupPostsBatch(batchSize);
        return Response.json({ ok: true, action });

      case 'aggregate':
        await aggregateOppositionSignals(lookbackDays);
        return Response.json({ ok: true, action });

      case 'ingest-idf':
        await ingestData365ToIdf(batchSize);
        return Response.json({ ok: true, action });

      case 'run-all':
        await fetchGroupPostsBatch(batchSize);
        await aggregateOppositionSignals(lookbackDays);
        await ingestData365ToIdf(batchSize);
        return Response.json({ ok: true, action });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`data365 ${action} error:`, message);
    return Response.json({ error: message }, { status: 500 });
  }
}
