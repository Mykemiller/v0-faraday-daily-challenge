// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — FUSION (edge copy). Region -> geography crosswalk + the
// pure metric/why_note generator. The DB join itself lives in fn_scoreboard_fusion (SQL); this file
// resolves a cloud region to (state_abbr, iso_rto) and turns the RPC result into D-category rows.
// Canonical crosswalk mirrored in src/lib/tokenomics/fusion.ts (kept in sync).

import { type Metric, buildMetricId, num } from "./metrics.ts";

export type Geo = { state_abbr: string; iso_rto: string | null; label: string };

// Cloud region -> geography. Keyed by canonical region + common per-provider aliases so a GPU row's
// region (however the provider names it) resolves. Extend as regions are added.
export const REGION_GRID_MAP: Record<string, Geo> = {
  // Northern Virginia (AWS us-east-1, Azure eastus/eastus2, GCP us-east4) — the DC capital, default.
  "us-east-1":  { state_abbr: "VA", iso_rto: "PJM", label: "N. Virginia" },
  "eastus":     { state_abbr: "VA", iso_rto: "PJM", label: "N. Virginia" },
  "eastus2":    { state_abbr: "VA", iso_rto: "PJM", label: "N. Virginia" },
  "us-east4":   { state_abbr: "VA", iso_rto: "PJM", label: "N. Virginia" },
  // Ohio (AWS us-east-2, GCP us-east5)
  "us-east-2":  { state_abbr: "OH", iso_rto: "PJM", label: "Ohio" },
  "us-east5":   { state_abbr: "OH", iso_rto: "PJM", label: "Ohio" },
  // Oregon (AWS us-west-2, Azure westus2, GCP us-west1) — BPA/WECC, no ISO market.
  "us-west-2":  { state_abbr: "OR", iso_rto: null, label: "Oregon" },
  "westus2":    { state_abbr: "OR", iso_rto: null, label: "Oregon" },
  "us-west1":   { state_abbr: "OR", iso_rto: null, label: "Oregon" },
  // N. California (AWS us-west-1) — CAISO
  "us-west-1":  { state_abbr: "CA", iso_rto: "CAISO", label: "N. California" },
  "westus":     { state_abbr: "CA", iso_rto: "CAISO", label: "N. California" },
  // Texas (Azure southcentralus, GCP us-south1) — ERCOT
  "southcentralus": { state_abbr: "TX", iso_rto: "ERCOT", label: "Texas" },
  "us-south1":  { state_abbr: "TX", iso_rto: "ERCOT", label: "Texas" },
  // Iowa (GCP us-central1) — MISO
  "us-central1":{ state_abbr: "IA", iso_rto: "MISO", label: "Iowa" },
};

// Regions the cron computes fusion for by default (the AI-cloud core).
export const DEFAULT_REGIONS = ["us-east-1", "us-east-2", "us-west-2", "us-west-1", "southcentralus", "us-central1"];

export function resolveRegion(region: string | null | undefined): Geo | null {
  if (!region) return null;
  return REGION_GRID_MAP[region] ?? null;
}

// % move of the most recent distinct on-demand GPU reading vs the prior distinct value in a region.
// Rows come newest-first. Returns null if fewer than two distinct values.
export function recentGpuMovePct(gpuRows: { value: number | null; as_of: string }[]): number | null {
  const vals = gpuRows.map((r) => num(r.value)).filter((v): v is number => v !== null);
  if (vals.length < 2) return null;
  const latest = vals[0];
  const prior = vals.find((v) => v !== latest);
  if (prior === undefined || prior === 0) return null;
  return Math.round(((latest - prior) / prior) * 1000) / 10; // one decimal %
}

// Turn the fn_scoreboard_fusion RPC result into D-category rows. Emits:
//   - demand.fusion.<region>.power_price_kwh  ($/kWh, why_note when a coincident GPU move is seen)
//   - demand.fusion.<region>.queue_depth_mw   (MW)
//   - demand.fusion.<region>.queue_entries    (count)
// Nulls are preserved (zero fabrication) — a missing grid figure yields a null-value row so the gap
// is explicit, not invented.
export function fusionMetrics(
  region: string, geo: Geo, fusion: Record<string, unknown>, asOf: string,
  gpuRows: { value: number | null; as_of: string }[],
): Metric[] {
  const price = num(fusion.power_price_kwh);
  const queueMw = num(fusion.interconnect_queue_depth_mw);
  const queueN = num(fusion.interconnect_queue_entries);
  const phase = fusion.time_to_power ? String(fusion.time_to_power) : null;

  const movePct = recentGpuMovePct(gpuRows);
  let whyNote: string | null = null;
  if (movePct !== null && Math.abs(movePct) >= 2 && (price !== null || queueMw !== null)) {
    const bits: string[] = [`GPU on-demand in ${geo.label} moved ${movePct > 0 ? "+" : ""}${movePct}%`];
    if (price !== null) bits.push(`grid $${price}/kWh`);
    if (queueMw !== null) bits.push(`${Math.round(queueMw).toLocaleString()} MW queued`);
    if (phase) bits.push(`deepest study phase: ${phase}`);
    whyNote = bits.join(" · ") + ` (${geo.iso_rto ?? "non-ISO"})`;
  }

  const base = {
    category: "D" as const, subject: "grid-fusion", provider: "Faraday Intelligence",
    region, sku: null, pricing_mode: null, as_of: asOf, source: "fusion_faraday",
    source_tier: 1 as const, source_url: null, confidence: "verified" as const, display_allowed: true,
  };
  return [
    { ...base, metric_id: buildMetricId("demand", "fusion", region, "power_price_kwh"),
      value: price, unit: "$/kWh", why_note: whyNote },
    { ...base, metric_id: buildMetricId("demand", "fusion", region, "queue_depth_mw"),
      value: queueMw, unit: "MW", why_note: null },
    { ...base, metric_id: buildMetricId("demand", "fusion", region, "queue_entries"),
      value: queueN, unit: "count", why_note: null,
      confidence: phase ? "verified" : "as-reported" },
  ];
}
