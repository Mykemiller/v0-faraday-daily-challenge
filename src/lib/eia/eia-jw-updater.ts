// EIA → JW dimension updater.
// Translates EIA state electricity data into JPS dim_power scores
// for all county-level jurisdictions within each state.
// Also updates confidence scores when reliable grid data is available.

import { Svc } from '@/lib/pipeline-utils';

export async function applyEiaToJurisdictions(svc: Svc): Promise<{ updated: number }> {
  // Fetch latest EIA data per state
  const r = await fetch(
    `${svc.base}/eia_state_electricity` +
    `?select=state_code,total_capacity_mw,renewable_pct,available_capacity_mw,grid_reliability_score` +
    `&order=fetched_at.desc`,
    { headers: svc.headers, cache: 'no-store' }
  );
  if (!r.ok) return { updated: 0 };

  const eiaRows: EiaStateRow[] = await r.json().catch(() => []);
  const eiaByState: Record<string, EiaStateRow> = {};
  for (const row of eiaRows) {
    if (!eiaByState[row.state_code]) eiaByState[row.state_code] = row;
  }

  let updated = 0;

  for (const [stateCode, eia] of Object.entries(eiaByState)) {
    const powerScore = computePowerScore(eia);
    if (powerScore === null) continue;

    // Fetch counties in this state (using iso_code prefix or parent relationship)
    const jur = await fetch(
      `${svc.base}/jurisdictions?level=eq.county&iso_code=like.${stateCode}%25&select=id` +
      `&limit=1000`,
      { headers: svc.headers, cache: 'no-store' }
    );
    if (!jur.ok) continue;

    const counties: { id: string }[] = await jur.json().catch(() => []);
    for (const county of counties) {
      const patch = await fetch(`${svc.base}/jurisdictions?id=eq.${county.id}`, {
        method:  'PATCH',
        headers: svc.headers,
        body:    JSON.stringify({
          dim_power:      powerScore,
          last_scored_at: new Date().toISOString(),
        }),
      });
      if (patch.ok) updated++;
    }
  }

  return { updated };
}

function computePowerScore(eia: EiaStateRow): number | null {
  const cap = eia.available_capacity_mw;
  if (!cap) return null;

  // Power score 1–5 based on available capacity and renewable mix
  // 1 = severely constrained, 5 = abundant / renewable-rich
  let score = 2.5; // baseline

  // Capacity bonus: >50GW = excellent, >20GW = good, <5GW = constrained
  if      (cap > 50_000) score += 1.0;
  else if (cap > 20_000) score += 0.5;
  else if (cap < 5_000)  score -= 0.5;
  else if (cap < 2_000)  score -= 1.0;

  // Renewable mix bonus: cleantech data centers prefer renewable-heavy grids
  const renewPct = eia.renewable_pct ?? 0;
  if      (renewPct > 60) score += 0.5;
  else if (renewPct > 40) score += 0.25;

  // Grid reliability bonus (if available)
  if (eia.grid_reliability_score !== null) {
    score += (eia.grid_reliability_score - 3) * 0.2;
  }

  return parseFloat(Math.max(1, Math.min(5, score)).toFixed(2));
}

interface EiaStateRow {
  state_code:            string;
  total_capacity_mw:     number | null;
  renewable_pct:         number | null;
  available_capacity_mw: number | null;
  grid_reliability_score: number | null;
}
