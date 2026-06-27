// EIA → IDF signal generator.
// Creates structured IDF signals from EIA state electricity data.
// Signals capture notable grid facts (high capacity, high renewables, constraints)
// that the Live Agent can surface in answers about power infrastructure.

import { Svc } from '@/lib/pipeline-utils';

export async function generateEiaIdfSignals(svc: Svc): Promise<{ generated: number; errors: number }> {
  const since = new Date(Date.now() - 32 * 86_400_000).toISOString();

  const r = await fetch(
    `${svc.base}/eia_state_electricity?fetched_at=gte.${since}` +
    `&select=state_code,year,total_capacity_mw,renewable_pct,net_generation_gwh,fetched_at` +
    `&order=fetched_at.desc`,
    { headers: svc.headers, cache: 'no-store' }
  );
  if (!r.ok) return { generated: 0, errors: 1 };

  const rows: EiaRow[] = await r.json().catch(() => []);
  const seen  = new Set<string>(); // deduplicate by state+year
  const idfRows = [];

  for (const row of rows) {
    const key = `${row.state_code}-${row.year}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const summary = buildSignalSummary(row);
    if (!summary) continue;

    idfRows.push({
      source_type:  'eia' as const,
      signal_key:   `eia:${row.state_code}:${row.year}`,
      signal_type:  'grid_infrastructure',
      title:        `EIA ${row.year} electricity data — ${row.state_code}`,
      content:      summary,
      metadata:     {
        state_code:         row.state_code,
        year:               row.year,
        total_capacity_mw:  row.total_capacity_mw,
        renewable_pct:      row.renewable_pct,
        net_generation_gwh: row.net_generation_gwh,
      },
      ingested_at: new Date().toISOString(),
    });
  }

  if (idfRows.length === 0) return { generated: 0, errors: 0 };

  const ins = await fetch(`${svc.base}/idf_signals`, {
    method:  'POST',
    headers: { ...svc.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body:    JSON.stringify(idfRows),
  });

  return ins.ok
    ? { generated: idfRows.length, errors: 0 }
    : { generated: 0, errors: idfRows.length };
}

function buildSignalSummary(row: EiaRow): string | null {
  if (!row.total_capacity_mw && !row.renewable_pct) return null;
  const parts: string[] = [];
  if (row.total_capacity_mw)
    parts.push(`Total generating capacity: ${Math.round(row.total_capacity_mw).toLocaleString()} MW`);
  if (row.renewable_pct !== null)
    parts.push(`Renewable mix: ${row.renewable_pct}%`);
  if (row.net_generation_gwh)
    parts.push(`Net generation: ${Math.round(row.net_generation_gwh).toLocaleString()} GWh`);
  return parts.length ? `${row.state_code} ${row.year}: ${parts.join('; ')}.` : null;
}

interface EiaRow {
  state_code:         string;
  year:               number;
  total_capacity_mw:  number | null;
  renewable_pct:      number | null;
  net_generation_gwh: number | null;
  fetched_at:         string;
}
