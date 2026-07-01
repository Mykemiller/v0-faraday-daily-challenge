// POST /api/eia/sync[?step=fetch|jw|jds|idf]
// Orchestrates the full EIA Open Data sync: fetch → JW dim_power → JDS enrichment
// → IDF signal generation. Accepts ?step= to run a single stage (default: all).
// Protected by CRON_SECRET bearer token (same pattern as /api/cron/rotate).
//
// Required env: EIA_API_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Optional env: CRON_SECRET (if unset, open access — dev only).

import { fetchAllStateEiaData, type Svc } from '@/lib/eia/eia-fetcher';
import { applyEiaToJurisdictions }        from '@/lib/eia/eia-jw-updater';
import { enrichJdsWithEia }               from '@/lib/eia/eia-jds-updater';
import { generateEiaIdfSignals }          from '@/lib/eia/eia-idf';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

function buildSvc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base:    `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey:           key,
      Authorization:    `Bearer ${key}`,
      'Content-Type':   'application/json',
    },
  };
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get('Authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const s = buildSvc();
  if (!s) {
    return Response.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' },
      { status: 500 }
    );
  }
  if (!process.env.EIA_API_KEY) {
    return Response.json({ error: 'EIA_API_KEY not configured' }, { status: 500 });
  }

  const step = new URL(request.url).searchParams.get('step') ?? 'all';
  const result: Record<string, unknown> = {};

  try {
    if (step === 'all' || step === 'fetch') {
      result.fetch = await fetchAllStateEiaData(s);
    }
    if (step === 'all' || step === 'jw') {
      result.jw = await applyEiaToJurisdictions(s);
    }
    if (step === 'all' || step === 'jds') {
      result.jds = await enrichJdsWithEia(s);
    }
    if (step === 'all' || step === 'idf') {
      result.idf = await generateEiaIdfSignals(s);
    }
    return Response.json({ ok: true, step, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
