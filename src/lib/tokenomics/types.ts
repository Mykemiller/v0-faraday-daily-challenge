// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — the scoreboard_snapshot API contract (front end consumes).
// Every array element carries as_of, source, tier, confidence for stale/unverified badging.

export type Tier = 1 | 2 | 3;
export type Confidence = "verified" | "as-reported" | "unverified";

export type IndexCell = {
  metric_id: string;
  label: string;
  value: number | null;        // null when display_allowed=false (licensed source — display pending)
  unit: string;
  delta_7d: number | null;
  delta_30d: number | null;
  spark: { as_of: string; value: number }[] | null;
  source: string;
  tier: Tier;
  as_of: string | null;
  display_allowed: boolean;
  attribution?: string | null; // required attribution string when a licensed source is displayed
  placeholder?: string;        // "licensed source — display pending" when gated
};

export type TokenRow = {
  model: string;
  in: number | null;
  out: number | null;
  quality_adj: number | null;
  tps: number | null;
  delta_7d: number | null;
  source: string;
  tier: Tier;
  as_of: string | null;
  confidence: Confidence;
};

export type GpuCell = {
  provider: string;
  ondemand: number | null;
  reserved?: number | null;
  spot?: number | null;
  region: string | null;
  source: string;
  tier: Tier;
  as_of: string | null;
  confidence: Confidence;
};
export type GpuClassRow = { gpu_class: string; cells: GpuCell[] };

export type FusionBlock = {
  region: string;
  power_price_kwh: number | null;
  interconnect_queue_depth: number | null;
  time_to_power: string | null;
  why_note: string | null;
  as_of: string | null;
};

export type FuturesRow = {
  venue: string;
  instrument: string;
  status: string;              // research | announced-pending | trading
  price?: number | null;       // present only when trading
  as_of: string | null;
  source: string;
};

export type Footnote = { ref: string; source: string; tier: Tier; cadence: string; note: string };

export type NeocloudRosterOut = {
  fixed: { key: string; label: string }[];
  candidates: { key: string; label: string }[];
};

export type ScoreboardSnapshot = {
  as_of: string;
  region: string;
  indices: IndexCell[];
  tokens: TokenRow[];
  gpus: GpuClassRow[];
  neocloud_roster: NeocloudRosterOut;
  fusion: FusionBlock | null;
  futures: FuturesRow[];
  footnotes: Footnote[];
};

// The raw row shape the API reads from fn_tokenomics_snapshot_rows (+ tokenomics_metrics).
export type RawMetricRow = {
  metric_id: string;
  category: "A" | "B" | "C" | "D";
  subject: string | null;
  provider: string | null;
  region: string | null;
  sku: string | null;
  pricing_mode: string | null;
  value: number | null;        // already display-gated by the RPC (null when display_allowed=false)
  unit: string;
  as_of: string | null;
  source: string;
  source_tier: Tier;
  confidence: Confidence;
  display_allowed: boolean;
  why_note: string | null;
  delta_7d?: number | null;
  delta_30d?: number | null;
};

export type SourceRegistryRow = {
  source_key: string;
  label: string;
  tier: Tier;
  cadence: string;
  is_third_party_index: boolean;
  display_allowed: boolean;
  attribution: string | null;
};

export const DISPLAY_PENDING_PLACEHOLDER = "licensed source — display pending";
