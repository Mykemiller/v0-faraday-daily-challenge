// EIA Open Data fetcher.
// Pulls electricity generation / capacity data from EIA API v2 for all 50 states.
// Requires env: EIA_API_KEY (free from eia.gov/opendata/register.php)
// Writes / upserts rows to eia_state_electricity.

import { Svc } from '@/lib/pipeline-utils';

const EIA_BASE = 'https://api.eia.gov/v2';

// US state FIPS-2 codes
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

export interface EiaFetchResult {
  states:   number;
  inserted: number;
  errors:   number;
}

export async function fetchAllStateEiaData(svc: Svc): Promise<EiaFetchResult> {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    console.warn('[eia/fetch] EIA_API_KEY not set — skipping');
    return { states: 0, inserted: 0, errors: 0 };
  }

  const result: EiaFetchResult = { states: US_STATES.length, inserted: 0, errors: 0 };
  const currentYear = new Date().getFullYear();

  for (const stateCode of US_STATES) {
    try {
      const data = await fetchStateElectricityData(stateCode, currentYear, apiKey);
      if (!data) { result.errors++; continue; }

      const r = await fetch(`${svc.base}/eia_state_electricity`, {
        method:  'POST',
        headers: { ...svc.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body:    JSON.stringify({
          state_code:           stateCode,
          year:                 currentYear,
          total_capacity_mw:    data.totalCapacityMw,
          renewable_pct:        data.renewablePct,
          avg_industrial_rate:  data.avgIndustrialRate,
          net_generation_gwh:   data.netGenerationGwh,
          available_capacity_mw: data.availableCapacityMw,
          grid_reliability_score: data.gridReliabilityScore,
          fetched_at:           new Date().toISOString(),
        }),
      });
      if (r.ok) result.inserted++;
      else result.errors++;
    } catch (err) {
      console.error(`[eia/fetch] state ${stateCode} error`, err);
      result.errors++;
    }
  }

  return result;
}

interface StateElectricityData {
  totalCapacityMw:       number | null;
  renewablePct:          number | null;
  avgIndustrialRate:     number | null;
  netGenerationGwh:      number | null;
  availableCapacityMw:   number | null;
  gridReliabilityScore:  number | null;
}

async function fetchStateElectricityData(
  stateCode: string,
  year: number,
  apiKey: string
): Promise<StateElectricityData | null> {
  // EIA v2 electricity/electric-power-operational-data endpoint
  const url = `${EIA_BASE}/electricity/electric-power-operational-data/data/` +
    `?api_key=${apiKey}` +
    `&frequency=annual&data[0]=generation&data[1]=capacity` +
    `&facets[location][]=${stateCode}&start=${year - 1}&sort[0][column]=period&sort[0][direction]=desc&length=5`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;

    const body = await r.json().catch(() => null);
    const rows: any[] = body?.response?.data ?? [];

    if (rows.length === 0) return null;

    const totalCap  = rows.find(r => r['type-name'] === 'Total')?.capacity ?? null;
    const renew     = rows.find(r => r['type-name']?.includes('Renewable'));
    const renewCap  = renew?.capacity ?? null;

    return {
      totalCapacityMw:      totalCap ? Number(totalCap) : null,
      renewablePct:         (totalCap && renewCap) ? Math.round((renewCap / totalCap) * 1000) / 10 : null,
      avgIndustrialRate:    null, // requires separate rate endpoint
      netGenerationGwh:     rows.find(r => r['type-name'] === 'Total')?.generation ?? null,
      availableCapacityMw:  totalCap ? Number(totalCap) * 0.85 : null, // ~85% availability factor
      gridReliabilityScore: null, // computed in eia-jw-updater from SAIDI/SAIFI
    };
  } catch {
    return null;
  }
}
