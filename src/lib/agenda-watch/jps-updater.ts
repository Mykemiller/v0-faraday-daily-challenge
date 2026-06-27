// JPS dimension updater — recomputes JPS dimension scores for a jurisdiction
// after new AgendaWatch signals have been extracted.
// Writes updated dim_* columns to the jurisdictions table and fires
// a confidence-tier recalculation.

import { Svc } from '@/lib/pipeline-utils';

export async function updateJpsDimensionsFromSignals(
  jurisdictionId: string,
  svc: Svc
): Promise<void> {
  // Aggregate recent signals for this jurisdiction
  const r = await fetch(
    `${svc.base}/agenda_watch_signals?jurisdiction_id=eq.${jurisdictionId}` +
    `&extracted_at=gte.${new Date(Date.now() - 90 * 86_400_000).toISOString()}` +
    `&select=signal_type,document_date`,
    { headers: svc.headers, cache: 'no-store' }
  );
  if (!r.ok) return;
  const signals: { signal_type: string; document_date: string | null }[] =
    await r.json().catch(() => []);

  if (signals.length === 0) return;

  const updates: Record<string, number | string> = {
    last_scored_at: new Date().toISOString(),
  };

  // Count signal types to derive dimension adjustments
  const counts = countByType(signals.map(s => s.signal_type));

  // dim_regulatory: boosted by zoning_approval, penalised by opposition_motion
  if (counts.zoning_approval || counts.opposition_motion) {
    const base   = 3.0;
    const boost  = Math.min((counts.zoning_approval ?? 0) * 0.2, 0.8);
    const drag   = Math.min((counts.opposition_motion ?? 0) * 0.3, 0.9);
    updates.dim_regulatory = parseFloat(Math.max(1, Math.min(5, base + boost - drag)).toFixed(2));
  }

  if (counts.permitting_update) {
    const base  = 3.0;
    const boost = Math.min(counts.permitting_update * 0.15, 0.6);
    updates.dim_permitting = parseFloat(Math.min(5, base + boost).toFixed(2));
  }

  if (counts.utility_capacity) {
    const base  = 2.5;
    const boost = Math.min(counts.utility_capacity * 0.25, 1.0);
    updates.dim_power = parseFloat(Math.min(5, base + boost).toFixed(2));
  }

  if (counts.opposition_motion) {
    const base = 3.5;
    const drag = Math.min(counts.opposition_motion * 0.3, 1.5);
    updates.dim_opposition = parseFloat(Math.max(1, base - drag).toFixed(2));
  }

  if (counts.incentive_approval) {
    const base  = 3.0;
    const boost = Math.min(counts.incentive_approval * 0.2, 0.8);
    updates.dim_incentives = parseFloat(Math.min(5, base + boost).toFixed(2));
  }

  if (Object.keys(updates).length <= 1) return; // only last_scored_at — nothing to write

  await fetch(`${svc.base}/jurisdictions?id=eq.${jurisdictionId}`, {
    method:  'PATCH',
    headers: svc.headers,
    body:    JSON.stringify(updates),
  });
}

function countByType(types: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of types) counts[t] = (counts[t] ?? 0) + 1;
  return counts;
}
