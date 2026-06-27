// POST /api/clerk-program/apply
// Applies approved County Clerk Program submissions to the JW dimension scores.
// For each approved submission not yet applied, it writes dim_* values to
// the jurisdictions table and bumps confidence_tier to at least 'estimated'.
//
// Auth: Bearer PIPELINE_SECRET (coordinator-internal).

import { isAuthorized, getServiceClient } from '@/lib/pipeline-utils';

interface ClerkSubmission {
  id:              string;
  jurisdiction_id: string;
  dim_regulatory:  number | null;
  dim_permitting:  number | null;
  dim_power:       number | null;
  dim_opposition:  number | null;
  dim_incentives:  number | null;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = getServiceClient();
  if (!svc) {
    return Response.json({ error: 'Service client not configured' }, { status: 500 });
  }

  const r = await fetch(
    `${svc.base}/clerk_program_submissions?review_status=eq.approved&applied_to_jw=eq.false` +
    `&select=id,jurisdiction_id,dim_regulatory,dim_permitting,dim_power,dim_opposition,dim_incentives`,
    { headers: svc.headers, cache: 'no-store' }
  );
  if (!r.ok) {
    return Response.json({ error: 'Failed to fetch submissions' }, { status: 500 });
  }

  const submissions: ClerkSubmission[] = await r.json().catch(() => []);
  let applied = 0;
  const errors: string[] = [];

  for (const sub of submissions) {
    const updates: Record<string, unknown> = {};

    if (sub.dim_regulatory  !== null) updates.dim_regulatory  = sub.dim_regulatory;
    if (sub.dim_permitting  !== null) updates.dim_permitting  = sub.dim_permitting;
    if (sub.dim_power       !== null) updates.dim_power       = sub.dim_power;
    if (sub.dim_opposition  !== null) updates.dim_opposition  = sub.dim_opposition;
    if (sub.dim_incentives  !== null) updates.dim_incentives  = sub.dim_incentives;

    if (Object.keys(updates).length === 0) continue;

    // Clerk data = direct human source = minimum 'estimated' confidence tier.
    // Fetch existing confidence_score to ensure we only ever increase it.
    const existing = await fetch(
      `${svc.base}/jurisdictions?id=eq.${sub.jurisdiction_id}&select=confidence_score,confidence_tier`,
      { headers: svc.headers, cache: 'no-store' }
    );
    const existRows: { confidence_score: number | null; confidence_tier: string | null }[] =
      existing.ok ? await existing.json().catch(() => []) : [];
    const existingScore = existRows[0]?.confidence_score ?? 0;

    updates.last_scored_at   = new Date().toISOString();
    updates.confidence_tier  = 'estimated';
    updates.confidence_score = Math.max(60, existingScore);

    const patch = await fetch(`${svc.base}/jurisdictions?id=eq.${sub.jurisdiction_id}`, {
      method:  'PATCH',
      headers: svc.headers,
      body:    JSON.stringify(updates),
    });

    if (patch.ok) {
      await fetch(`${svc.base}/clerk_program_submissions?id=eq.${sub.id}`, {
        method:  'PATCH',
        headers: svc.headers,
        body:    JSON.stringify({
          applied_to_jw: true,
          applied_at:    new Date().toISOString(),
        }),
      });
      applied++;
    } else {
      errors.push(sub.id);
    }
  }

  return Response.json({ applied, total: submissions.length, errors });
}
