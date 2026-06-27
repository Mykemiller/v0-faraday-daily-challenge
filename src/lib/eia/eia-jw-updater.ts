// Propagates EIA state electricity data to jurisdictions.dim_power and
// grid_access_score. Counties inherit their state's EIA baseline — utility
// queue data (from the county_power_availability pipeline) further refines
// county-level values when available.
//
// The jurisdictions table uses iso_code as the geographic key:
//   state level  → FIPS-2 (e.g., '06')
//   county level → FIPS-5 (e.g., '06075')
// County rows for a state are matched via iso_code LIKE '06%'.

import type { Svc } from './eia-fetcher';

interface StateEiaSummary {
  state_fips:        string;
  grid_health_score: number;
  data_year:         number;
}

async function getLatestEiaByState(
  svc: Svc
): Promise<Map<string, StateEiaSummary>> {
  const res = await fetch(
    `${svc.base}/eia_state_electricity` +
    `?select=state_fips,grid_health_score,data_year` +
    `&order=data_year.desc`,
    { headers: { ...svc.headers, Accept: 'application/json' } }
  );
  if (!res.ok) return new Map();
  const rows: StateEiaSummary[] = await res.json().catch(() => []);

  const latest = new Map<string, StateEiaSummary>();
  for (const row of rows) {
    if (!latest.has(row.state_fips)) latest.set(row.state_fips, row);
  }
  return latest;
}

// Apply EIA state data to state and county jurisdiction rows.
// dim_power = grid_health_score / 20 (maps 0–100 to 0–5).
// Counties already holding a dim_power value are left untouched.
export async function applyEiaToJurisdictions(
  svc: Svc
): Promise<{ updated: number }> {
  const latestByState = await getLatestEiaByState(svc);
  let updated = 0;

  for (const [fips2, eia] of latestByState.entries()) {
    const dimPower = parseFloat((eia.grid_health_score / 20).toFixed(2));
    const now = new Date().toISOString();

    // Update state-level jurisdiction
    await fetch(
      `${svc.base}/jurisdictions?level=eq.state&iso_code=eq.${fips2}`,
      {
        method:  'PATCH',
        headers: { ...svc.headers, Prefer: 'return=minimal' },
        body:    JSON.stringify({
          dim_power:         dimPower,
          grid_access_score: eia.grid_health_score,
          last_scored_date:  now,
        }),
      }
    );

    // Update county rows in this state that have no dim_power yet
    await fetch(
      `${svc.base}/jurisdictions` +
      `?level=eq.county&iso_code=like.${fips2}*&dim_power=is.null`,
      {
        method:  'PATCH',
        headers: { ...svc.headers, Prefer: 'return=minimal' },
        body:    JSON.stringify({
          dim_power:         dimPower,
          grid_access_score: eia.grid_health_score,
        }),
      }
    );

    console.log(
      `EIA → jurisdictions: state ${fips2}, ` +
      `dim_power=${dimPower}, grid_health=${eia.grid_health_score}`
    );
    updated++;
  }

  return { updated };
}
