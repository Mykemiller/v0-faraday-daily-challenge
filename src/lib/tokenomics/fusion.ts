// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — region -> geography crosswalk (CANONICAL copy for the Next
// API). Mirrors supabase/functions/ingest-tokenomics/fusion.ts REGION_GRID_MAP. The API uses this
// to validate the ?region= param and to label the fusion block; the fusion VALUES come from the
// fn_scoreboard_fusion RPC / the persisted demand.fusion.* rows.

export type Geo = { state_abbr: string; iso_rto: string | null; label: string };

export const REGION_GRID_MAP: Record<string, Geo> = {
  "us-east-1":  { state_abbr: "VA", iso_rto: "PJM", label: "N. Virginia" },
  "eastus":     { state_abbr: "VA", iso_rto: "PJM", label: "N. Virginia" },
  "eastus2":    { state_abbr: "VA", iso_rto: "PJM", label: "N. Virginia" },
  "us-east4":   { state_abbr: "VA", iso_rto: "PJM", label: "N. Virginia" },
  "us-east-2":  { state_abbr: "OH", iso_rto: "PJM", label: "Ohio" },
  "us-east5":   { state_abbr: "OH", iso_rto: "PJM", label: "Ohio" },
  "us-west-2":  { state_abbr: "OR", iso_rto: null, label: "Oregon" },
  "westus2":    { state_abbr: "OR", iso_rto: null, label: "Oregon" },
  "us-west1":   { state_abbr: "OR", iso_rto: null, label: "Oregon" },
  "us-west-1":  { state_abbr: "CA", iso_rto: "CAISO", label: "N. California" },
  "westus":     { state_abbr: "CA", iso_rto: "CAISO", label: "N. California" },
  "southcentralus": { state_abbr: "TX", iso_rto: "ERCOT", label: "Texas" },
  "us-south1":  { state_abbr: "TX", iso_rto: "ERCOT", label: "Texas" },
  "us-central1":{ state_abbr: "IA", iso_rto: "MISO", label: "Iowa" },
};

export const DEFAULT_REGION = "us-east-1"; // the DC capital

export function resolveRegion(region: string | null | undefined): Geo | null {
  if (!region) return null;
  return REGION_GRID_MAP[region] ?? null;
}

// Normalize a caller's ?region= to a known key, falling back to the default.
export function normalizeRegion(region: string | null | undefined): string {
  return region && REGION_GRID_MAP[region] ? region : DEFAULT_REGION;
}
