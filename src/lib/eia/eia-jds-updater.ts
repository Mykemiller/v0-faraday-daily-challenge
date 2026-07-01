// Enriches JDS source_breakdown with EIA renewable capacity signals.
// States with >1,000 MW renewable capacity are flagged — renewable capacity
// signals hyperscaler data center developer interest (sustainability commitments).

import type { Svc } from './eia-fetcher';

interface EiaRenewableRow {
  state_fips:            string;
  renewable_capacity_mw: number;
  renewable_pct:         number;
  data_year:             number;
}

export async function enrichJdsWithEia(
  svc: Svc
): Promise<{ enriched: number }> {
  const res = await fetch(
    `${svc.base}/eia_state_electricity` +
    `?select=state_fips,renewable_capacity_mw,renewable_pct,data_year` +
    `&order=data_year.desc`,
    { headers: { ...svc.headers, Accept: 'application/json' } }
  );
  if (!res.ok) return { enriched: 0 };
  const rows: EiaRenewableRow[] = await res.json().catch(() => []);

  const latest = new Map<string, EiaRenewableRow>();
  for (const row of rows) {
    if (!latest.has(row.state_fips)) latest.set(row.state_fips, row);
  }

  let enriched = 0;

  for (const [fips2, eia] of latest.entries()) {
    if ((eia.renewable_capacity_mw ?? 0) <= 1000) continue;

    // Resolve state jurisdiction id
    const jRes = await fetch(
      `${svc.base}/jurisdictions` +
      `?level=eq.state&iso_code=eq.${fips2}&select=id`,
      { headers: { ...svc.headers, Accept: 'application/json' } }
    );
    if (!jRes.ok) continue;
    const jRows: { id: string }[] = await jRes.json().catch(() => []);
    if (!jRows.length) continue;
    const jurisdictionId = jRows[0].id;

    // Fetch the most recent jds_scores record for this jurisdiction
    const jdsRes = await fetch(
      `${svc.base}/jds_scores` +
      `?jurisdiction_id=eq.${jurisdictionId}` +
      `&select=id,source_breakdown` +
      `&order=scored_at.desc` +
      `&limit=1`,
      { headers: { ...svc.headers, Accept: 'application/json' } }
    );
    if (!jdsRes.ok) continue;
    const jdsRows: { id: string; source_breakdown: Record<string, unknown> | null }[] =
      await jdsRes.json().catch(() => []);
    if (!jdsRows.length) continue;

    const existing = jdsRows[0];
    const updatedSources = {
      ...(existing.source_breakdown ?? {}),
      eia_renewable_mw:  eia.renewable_capacity_mw,
      eia_renewable_pct: eia.renewable_pct,
    };

    await fetch(`${svc.base}/jds_scores?id=eq.${existing.id}`, {
      method:  'PATCH',
      headers: { ...svc.headers, Prefer: 'return=minimal' },
      body:    JSON.stringify({ source_breakdown: updatedSources }),
    });

    enriched++;
  }

  return { enriched };
}
