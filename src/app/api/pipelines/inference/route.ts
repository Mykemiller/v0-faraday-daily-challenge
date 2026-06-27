// POST /api/pipelines/inference
// Triggers the JW Inference Engine (Methods A + utility queue + B).
// Method C is a DB trigger — always active, no API call needed.
//
// Auth: Bearer token from PIPELINE_SECRET env var.
// Runs async — returns 202 immediately so Vercel function timeout isn't hit.
// Cron target: pg_cron calls this Sunday at 04:00 UTC after JPS refresh.

import { NextRequest, NextResponse } from 'next/server';
import { runFullInferenceEngine }    from '@/lib/pipelines/inference-orchestrator';

export async function POST(req: NextRequest) {
  const secret = process.env.PIPELINE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Pipeline not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fire-and-forget — Vercel function timeout is 60s; full inference may exceed that.
  // Logs are available in Vercel runtime logs.
  runFullInferenceEngine().catch(err => {
    console.error('Inference engine error:', err);
  });

  return NextResponse.json(
    { status: 'started', triggered_at: new Date().toISOString() },
    { status: 202 },
  );
}
