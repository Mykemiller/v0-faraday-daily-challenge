// FUSION JOIN (Group D) — Faraday's differentiator. Wired FIRST, not a stretch.
//
// Per region, join power price ($/kWh) + interconnection-queue depth /
// time-to-power from Faraday's own grid data (DC Hub / live Supabase grid tables)
// onto the region-keyed GPU rows, and GENERATE a why_note when a GPU price move
// coincides with a grid signal. This module is the pure join+narrative logic; the
// cron feeds it live grid rows (deploy-gated fetch, like the DC-registry stub).

import type { FusionBlock, SeriesPoint } from './types.ts';
import { pctChange } from './series.ts';

export interface GridSignal {
  region: string;
  power_price_kwh: number | null;
  interconnect_queue_depth: number | null; // # of projects in the interconnection queue
  time_to_power: string | null;            // human-readable ("36+ months") or ISO duration
  as_of: string | null;
}

// One region-keyed GPU metric's recent vintages (for detecting a 7d move).
export interface RegionGpuSeries {
  metric_id: string;
  label: string;      // e.g. "H100 on-demand (CoreWeave)"
  points: SeriesPoint[];
}

// Fire a why_note when a GPU move is at least this large (percent, absolute).
export const PRICE_MOVE_THRESHOLD_PCT = 3;
// …and the grid is meaningfully constrained.
export const QUEUE_DEPTH_THRESHOLD = 20;

function pickStrongestMove(series: RegionGpuSeries[]): { label: string; delta_7d: number } | null {
  let strongest: { label: string; delta_7d: number } | null = null;
  for (const s of series) {
    const d = pctChange(s.points, 7);
    if (d === null) continue;
    if (!strongest || Math.abs(d) > Math.abs(strongest.delta_7d)) strongest = { label: s.label, delta_7d: d };
  }
  return strongest;
}

function gridIsConstrained(g: GridSignal): boolean {
  const deepQueue = (g.interconnect_queue_depth ?? 0) >= QUEUE_DEPTH_THRESHOLD;
  const longWait = !!g.time_to_power && /\d/.test(g.time_to_power);
  return deepQueue || longWait;
}

// Build the fusion block for a region. why_note is generated ONLY when a real
// price move coincides with a real grid constraint — otherwise it stays null
// (no fabricated causation).
export function buildFusion(
  region: string,
  regionGpuSeries: RegionGpuSeries[],
  grid: GridSignal | null,
): FusionBlock {
  if (!grid) {
    return {
      region,
      power_price_kwh: null,
      interconnect_queue_depth: null,
      time_to_power: null,
      why_note: null,
      as_of: null,
    };
  }

  const move = pickStrongestMove(regionGpuSeries);
  let why_note: string | null = null;

  if (move && Math.abs(move.delta_7d) >= PRICE_MOVE_THRESHOLD_PCT && gridIsConstrained(grid)) {
    const dir = move.delta_7d >= 0 ? 'rose' : 'fell';
    const parts: string[] = [];
    parts.push(`${move.label} ${dir} ${Math.abs(move.delta_7d).toFixed(1)}% over 7d in ${region}`);
    const grids: string[] = [];
    if (grid.interconnect_queue_depth != null)
      grids.push(`interconnection queue at ${grid.interconnect_queue_depth} projects`);
    if (grid.time_to_power) grids.push(`time-to-power ${grid.time_to_power}`);
    if (grid.power_price_kwh != null) grids.push(`power at $${grid.power_price_kwh.toFixed(3)}/kWh`);
    if (grids.length) parts.push(`as ${grids.join(', ')}`);
    why_note = `${parts.join(' ')}. Grid supply constraints coincide with the GPU-rental move (correlation, not confirmed causation).`;
  }

  return {
    region,
    power_price_kwh: grid.power_price_kwh,
    interconnect_queue_depth: grid.interconnect_queue_depth,
    time_to_power: grid.time_to_power,
    why_note,
    as_of: grid.as_of,
  };
}
