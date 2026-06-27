// EIA fetch pipeline — fetches state electricity data from the EIA Open Data API
// and upserts it into eia_state_electricity + eia_capacity_additions.
// Uses the Supabase REST API directly (same Svc pattern as /api/account).

import {
  EIA_ENDPOINTS,
  RENEWABLE_FUEL_IDS,
  STATE_FIPS_TO_ABBR,
} from './eia-client';

const EIA_KEY = (): string => process.env.EIA_API_KEY ?? '';

// Supabase REST handle — same pattern as existing Next.js API routes.
export interface Svc {
  base:    string;
  headers: Record<string, string>;
}

export interface GenerationData {
  total_generation_mwh:  number;
  renewable_mwh:         number;
  solar_mwh:             number;
  wind_mwh:              number;
  hydro_mwh:             number;
  nuclear_mwh:           number;
  natural_gas_mwh:       number;
  coal_mwh:              number;
  total_capacity_mw:     number;
  renewable_capacity_mw: number;
}

export interface StateEiaRow extends GenerationData {
  state_fips:             string;
  state_abbr:             string;
  data_year:              number;
  planned_additions_mw:   number;
  planned_retirements_mw: number;
  renewable_pct:          number;
  capacity_headroom_mw:   number;
  grid_health_score:      number;
}

export async function fetchStateGeneration(
  stateAbbr: string,
  year: number
): Promise<GenerationData> {
  const url = `${EIA_ENDPOINTS.stateGeneration(stateAbbr, year)}&api_key=${EIA_KEY()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EIA generation API ${res.status} for ${stateAbbr}`);
  const data = await res.json();
  const rows: Record<string, string>[] = data?.response?.data ?? [];

  const result: GenerationData = {
    total_generation_mwh: 0, renewable_mwh: 0,   solar_mwh: 0,
    wind_mwh: 0,             hydro_mwh: 0,        nuclear_mwh: 0,
    natural_gas_mwh: 0,      coal_mwh: 0,
    total_capacity_mw: 0,    renewable_capacity_mw: 0,
  };

  for (const row of rows) {
    const gen  = parseFloat(row.generation ?? '0') || 0;
    const cap  = parseFloat(row.capacity   ?? '0') || 0;
    const fuel = (row.fueltypeid ?? '').toLowerCase();

    result.total_generation_mwh += gen;
    result.total_capacity_mw    += cap;

    if (RENEWABLE_FUEL_IDS.has(fuel)) {
      result.renewable_mwh         += gen;
      result.renewable_capacity_mw += cap;
    }
    if (fuel === 'sun' || fuel === 'dpv') result.solar_mwh        += gen;
    if (fuel === 'wnd')                   result.wind_mwh          += gen;
    if (fuel === 'hyc')                   result.hydro_mwh         += gen;
    if (fuel === 'nuc')                   result.nuclear_mwh       += gen;
    if (fuel === 'ng')                    result.natural_gas_mwh   += gen;
    if (fuel === 'col')                   result.coal_mwh          += gen;
  }

  return result;
}

async function fetchPlannedAdditions(
  stateAbbr: string
): Promise<Record<string, string>[]> {
  const url = `${EIA_ENDPOINTS.plannedAdditions(stateAbbr)}&api_key=${EIA_KEY()}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return data?.response?.data ?? [];
}

// Compute a 0–100 grid health score from EIA state metrics.
// Components: renewable mix (30 pts), capacity headroom (40 pts),
// planned additions (30 pts).
export function computeGridHealthScore(state: {
  renewable_pct:        number;
  capacity_headroom_mw: number;
  total_capacity_mw:    number;
  planned_additions_mw: number;
}): number {
  const renewScore =
    state.renewable_pct >= 60 ? 30 :
    state.renewable_pct >= 40 ? 24 :
    state.renewable_pct >= 20 ? 16 :
    state.renewable_pct >= 10 ? 10 : 5;

  const headroomPct = state.total_capacity_mw > 0
    ? (state.capacity_headroom_mw / state.total_capacity_mw) * 100
    : 0;
  const headroomScore =
    headroomPct >= 30 ? 40 :
    headroomPct >= 20 ? 32 :
    headroomPct >= 10 ? 20 :
    headroomPct >= 5  ? 12 : 4;

  const additionsPct = state.total_capacity_mw > 0
    ? (state.planned_additions_mw / state.total_capacity_mw) * 100
    : 0;
  const futureScore =
    additionsPct >= 20 ? 30 :
    additionsPct >= 10 ? 22 :
    additionsPct >= 5  ? 14 :
    additionsPct >= 2  ? 8  : 3;

  return Math.min(100, renewScore + headroomScore + futureScore);
}

// Fetch EIA data for all 50 states and upsert into Supabase.
// Returns counts of successful and failed states.
export async function fetchAllStateEiaData(
  svc: Svc
): Promise<{ ok: number; fail: number }> {
  const year = new Date().getFullYear() - 1; // EIA data lags ~1 year
  let ok = 0, fail = 0;

  for (const [fips2, abbr] of Object.entries(STATE_FIPS_TO_ABBR)) {
    try {
      const [genData, additions] = await Promise.all([
        fetchStateGeneration(abbr, year),
        fetchPlannedAdditions(abbr),
      ]);

      const totalAddMw = additions.reduce(
        (sum, a) => sum + (parseFloat(a['nameplate-capacity-mw'] ?? '0') || 0),
        0
      );

      const renewablePct = genData.total_generation_mwh > 0
        ? parseFloat(
            (genData.renewable_mwh / genData.total_generation_mwh * 100).toFixed(2)
          )
        : 0;

      // Headroom = capacity minus estimated peak demand (generation / 8760h × 1.2)
      const estimatedPeakDemand = (genData.total_generation_mwh / 8760) * 1.2;
      const headroom = genData.total_capacity_mw - estimatedPeakDemand;

      const gridHealthScore = computeGridHealthScore({
        renewable_pct:        renewablePct,
        capacity_headroom_mw: headroom,
        total_capacity_mw:    genData.total_capacity_mw,
        planned_additions_mw: totalAddMw,
      });

      const row: StateEiaRow = {
        state_fips:             fips2,
        state_abbr:             abbr,
        data_year:              year,
        ...genData,
        planned_additions_mw:   totalAddMw,
        planned_retirements_mw: 0,
        renewable_pct:          renewablePct,
        capacity_headroom_mw:   headroom,
        grid_health_score:      gridHealthScore,
      };

      await fetch(`${svc.base}/eia_state_electricity`, {
        method:  'POST',
        headers: { ...svc.headers, Prefer: 'resolution=merge-duplicates' },
        body:    JSON.stringify(row),
      });

      if (additions.length > 0) {
        const additionRows = additions.map(a => ({
          state_fips:            fips2,
          plant_name:            a.entityName ?? a['plant-name'] ?? null,
          fuel_type:             a.fueltypeid ?? a['energy-source-code'] ?? null,
          nameplate_capacity_mw: parseFloat(a['nameplate-capacity-mw'] ?? '0') || 0,
          planned_year:          parseInt(a.period ?? String(year + 1)),
          status:                'planned',
        }));
        await fetch(`${svc.base}/eia_capacity_additions`, {
          method:  'POST',
          headers: svc.headers,
          body:    JSON.stringify(additionRows),
        });
      }

      // EIA allows 5,000 requests/hour with a key; 300 ms keeps well within budget
      await new Promise(r => setTimeout(r, 300));
      console.log(
        `EIA: ${abbr} — renewable ${renewablePct.toFixed(1)}%, ` +
        `grid health ${gridHealthScore}`
      );
      ok++;
    } catch (e) {
      console.error(`EIA fetch failed for ${abbr}:`, e);
      fail++;
    }
  }

  return { ok, fail };
}
