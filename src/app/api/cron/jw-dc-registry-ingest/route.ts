// GET /api/cron/jw-dc-registry-ingest — DC facility registry → JDS scores ingest.
//
// Triggered by:
//   • Vercel cron (Saturday 00:00 UTC, vercel.json)
//   • pg_cron job jw-dc-registry-ingest via net.http_post
//
// This route is the orchestration stub.  The real data fetch from licensed
// vendors (DC Byte, Datacenter Hawk) or free sources (Data Center Map) must be
// added as concrete DcFacility[] before this route does real work.  The pipeline
// itself (ingestDcRegistry) is fully implemented and ready to receive data.
//
// Auth: Authorization: Bearer ${JW_CRON_SECRET}  OR  Vercel-issued CRON_SECRET.
// Uses raw Supabase REST API (no supabase-js dependency).

import { NextRequest, NextResponse } from 'next/server';
import { ingestDcRegistry, DcFacility } from '@/lib/pipelines/dc-registry-pipeline';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

function buildSupabase(serviceKey: string) {
  const base    = `${SUPABASE_URL}/rest/v1`;
  const headers = {
    apikey:         serviceKey,
    Authorization:  `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  return {
    from: (table: string) => ({
      select: async (...cols: unknown[]) => {
        const selectParam = typeof cols[0] === 'string' ? cols[0] : '*';
        const res = await fetch(`${base}/${table}?select=${encodeURIComponent(selectParam)}`, { headers });
        if (!res.ok) return { data: null, error: { message: await res.text() } };
        return { data: await res.json(), error: null };
      },
      upsert: async (rows: unknown, _opts: unknown) => {
        const res = await fetch(`${base}/${table}`, {
          method:  'POST',
          headers: { ...headers, Prefer: 'return=minimal,resolution=merge-duplicates' },
          body:    JSON.stringify(rows),
        });
        if (!res.ok) return { error: { message: await res.text() } };
        return { error: null };
      },
    }),
  };
}

function authorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const jwSecret   = process.env.JW_CRON_SECRET;
  const bearer     = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!cronSecret && !jwSecret) return true;
  return (!!cronSecret && bearer === cronSecret) || (!!jwSecret && bearer === jwSecret);
}

// Fetch the latest DC facility snapshot from public sources.
// Replace this stub with real vendor API calls once data licenses are in place.
async function fetchFacilitySnapshot(): Promise<DcFacility[]> {
  // TODO: integrate DC Byte / Datacenter Hawk API + Data Center Map RSS
  return [];
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, { status: 500 });
  }

  try {
    const facilities = await fetchFacilitySnapshot();

    if (facilities.length === 0) {
      console.log('[jw-dc-registry-ingest] no facilities from data sources — skipping upsert');
      return NextResponse.json({ ok: true, ingested: 0, skipped: 0, note: 'no_data_sources_configured' });
    }

    const supabase = buildSupabase(serviceKey);
    const result   = await ingestDcRegistry(
      facilities,
      supabase as Parameters<typeof ingestDcRegistry>[1]
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[jw-dc-registry-ingest] failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
