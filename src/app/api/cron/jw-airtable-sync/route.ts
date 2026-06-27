// GET /api/cron/jw-airtable-sync — Airtable → Supabase jurisdiction sync.
//
// Triggered by:
//   • Vercel cron (Monday 03:00 UTC, vercel.json)
//   • pg_cron job jw-airtable-sync via net.http_post
//
// Auth: Authorization: Bearer ${JW_CRON_SECRET}  OR  Vercel-issued CRON_SECRET.
// No-op if neither env is set (so dev environments don't require cron secrets).

import { NextRequest, NextResponse } from 'next/server';
import { syncAirtableToSupabase } from '@/lib/pipelines/airtable-sync';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

function buildSupabase(serviceKey: string) {
  const base    = `${SUPABASE_URL}/rest/v1`;
  const headers = {
    apikey:        serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer:        'return=minimal',
  };
  return {
    from: (table: string) => ({
      upsert: async (row: unknown, opts: unknown) => {
        const res = await fetch(`${base}/${table}`, {
          method:  'POST',
          headers: { ...headers, Prefer: `return=minimal,resolution=merge-duplicates` },
          body:    JSON.stringify(row),
        });
        if (!res.ok) return { error: { message: await res.text() } };
        return { error: null };
        void opts;
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

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' }, { status: 500 });
  }

  try {
    const result = await syncAirtableToSupabase(buildSupabase(serviceKey));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[jw-airtable-sync] failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
