// Generates IDF-format signals from EIA state electricity data.
// Produces "power posture" narratives tagged dim_power for classifier training.
// Three narrative types per state: renewable mix, capacity headroom, grid health.

import type { Svc } from './eia-fetcher';

interface EiaStateRow {
  state_fips:            string;
  state_abbr:            string;
  data_year:             number;
  renewable_pct:         number | null;
  renewable_capacity_mw: number | null;
  capacity_headroom_mw:  number | null;
  planned_additions_mw:  number | null;
  grid_health_score:     number | null;
}

type Significance = 'high' | 'medium' | 'low';

interface IdfSignalRow {
  state_fips:    string;
  signal_type:   string;
  signal_text:   string;
  jps_dimension: string;
  data_year:     number;
  metric_name:   string;
  metric_value:  number;
  significance:  Significance;
}

export async function generateEiaIdfSignals(
  svc: Svc
): Promise<{ inserted: number }> {
  const res = await fetch(
    `${svc.base}/eia_state_electricity` +
    `?select=state_fips,state_abbr,data_year,renewable_pct,renewable_capacity_mw,` +
    `capacity_headroom_mw,planned_additions_mw,grid_health_score` +
    `&order=data_year.desc`,
    { headers: { ...svc.headers, Accept: 'application/json' } }
  );
  if (!res.ok) return { inserted: 0 };
  const rows: EiaStateRow[] = await res.json().catch(() => []);

  const latest = new Map<string, EiaStateRow>();
  for (const row of rows) {
    if (!latest.has(row.state_fips)) latest.set(row.state_fips, row);
  }

  const signals: IdfSignalRow[] = [];

  for (const [fips2, eia] of latest.entries()) {
    const renewPct = eia.renewable_pct         ?? 0;
    const renewMw  = eia.renewable_capacity_mw ?? 0;
    const headroom = eia.capacity_headroom_mw  ?? 0;
    const addMw    = eia.planned_additions_mw  ?? 0;
    const ghScore  = eia.grid_health_score     ?? 0;

    signals.push(
      {
        state_fips:    fips2,
        signal_type:   'eia_power_profile',
        signal_text:
          `${eia.state_abbr} generated ${renewPct.toFixed(1)}% of its electricity` +
          ` from renewable sources in ${eia.data_year},` +
          ` with ${renewMw.toFixed(0)} MW of renewable capacity.`,
        jps_dimension: 'dim_power',
        data_year:     eia.data_year,
        metric_name:   'renewable_pct',
        metric_value:  renewPct,
        significance:  renewPct > 40 ? 'high' : renewPct > 20 ? 'medium' : 'low',
      },
      {
        state_fips:    fips2,
        signal_type:   'eia_power_profile',
        signal_text:
          `${eia.state_abbr} has ${headroom.toFixed(0)} MW of estimated spare capacity` +
          ` above peak demand, with ${addMw.toFixed(0)} MW of planned additions.`,
        jps_dimension: 'dim_power',
        data_year:     eia.data_year,
        metric_name:   'capacity_headroom_mw',
        metric_value:  headroom,
        significance:  headroom > 5000 ? 'high' : headroom > 1000 ? 'medium' : 'low',
      },
      {
        state_fips:    fips2,
        signal_type:   'eia_power_profile',
        signal_text:
          `${eia.state_abbr} grid health score: ${ghScore.toFixed(0)}/100,` +
          ` reflecting generation mix, spare capacity, and planned build-out.`,
        jps_dimension: 'dim_power',
        data_year:     eia.data_year,
        metric_name:   'grid_health_score',
        metric_value:  ghScore,
        significance:  ghScore > 70 ? 'high' : ghScore > 40 ? 'medium' : 'low',
      }
    );
  }

  if (!signals.length) return { inserted: 0 };

  const insRes = await fetch(`${svc.base}/eia_idf_signals`, {
    method:  'POST',
    headers: svc.headers,
    body:    JSON.stringify(signals),
  });

  return { inserted: insRes.ok ? signals.length : 0 };
}
