// Shared utilities for all pipeline API routes.
// Provides the raw Supabase HTTP client (matching the project's fetch-based pattern)
// and a pipeline auth check.

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export type Svc = { base: string; headers: Record<string, string> };

export function getServiceClient(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base:    `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey:          key,
      Authorization:   `Bearer ${key}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
  };
}

export function isAuthorized(req: Request): boolean {
  const auth   = req.headers.get('Authorization');
  const secret = process.env.PIPELINE_SECRET;
  // Cron invocations arrive from Vercel's own IP with the secret; no secret set → dev mode.
  if (!secret) return true;
  return auth === `Bearer ${secret}`;
}

export async function logRun(
  svc: Svc,
  pipelineName: string,
  trigger: 'cron' | 'manual' | 'webhook'
): Promise<string | null> {
  const r = await fetch(`${svc.base}/pipeline_run_log`, {
    method:  'POST',
    headers: svc.headers,
    body:    JSON.stringify({ pipeline_name: pipelineName, trigger_type: trigger, status: 'running' }),
  });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? rows[0]?.id ?? null : null;
}

export async function completeRun(
  svc: Svc,
  runId: string,
  result: { status: 'completed' | 'failed' | 'partial'; processed?: number; failed?: number; error?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  await fetch(`${svc.base}/pipeline_run_log?id=eq.${runId}`, {
    method:  'PATCH',
    headers: svc.headers,
    body:    JSON.stringify({
      status:            result.status,
      completed_at:      new Date().toISOString(),
      records_processed: result.processed ?? 0,
      records_failed:    result.failed    ?? 0,
      error_message:     result.error     ?? null,
      metadata:          result.metadata  ?? null,
    }),
  });
}
