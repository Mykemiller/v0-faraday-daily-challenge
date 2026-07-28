// Faraday Tokenomics Scoreboard — shared types.
//
// The API contract types (ScoreboardSnapshot and its children) are the shape the
// front end consumes verbatim. The ingest types (MetricInput / MetricRow) are the
// append-only time-series shape. Metric groups A/B/C/D are reused verbatim — do
// NOT invent a new model.

export type Category = 'A' | 'B' | 'C' | 'D'; // A token · B gpu · C futures · D demand-context
export type PricingMode = 'ondemand' | 'reserved' | 'committed' | 'spot' | 'list';
export type SourceTier = 1 | 2 | 3;
export type Confidence = 'verified' | 'as-reported' | 'unverified';
export type FuturesStatus = 'research' | 'announced-pending' | 'trading';

// ─── Ingest side (what adapters produce; content_hash is added by metric.ts) ──
export interface MetricInput {
  metric_id: string;
  category: Category;
  subject?: string | null;
  provider?: string | null;
  region?: string | null;
  sku?: string | null;
  pricing_mode?: PricingMode | null;
  value: number | null; // null = status-only (e.g. non-tradeable futures)
  unit: string;
  as_of: string; // ISO-8601
  source: string;
  source_tier: SourceTier;
  source_url?: string | null;
  confidence: Confidence;
  display_allowed: boolean;
  why_note?: string | null;
  meta?: Record<string, unknown>; // quality_adj, tps, status, volume, attribution, citations…
}

export interface MetricRow extends MetricInput {
  content_hash: string;
}

// A stored reading read back from the DB (superset of MetricRow with ingested_at).
export interface StoredReading extends MetricRow {
  ingested_at?: string;
}

// ─── API contract (front end consumes this shape) ────────────────────────────
export interface IndexCell {
  metric_id: string;
  label: string;
  value: number | null; // NULL when display_allowed=false
  unit: string;
  delta_7d: number | null;
  delta_30d: number | null;
  spark: number[];
  source: string;
  tier: SourceTier;
  as_of: string;
  display_allowed: boolean;
  attribution?: string | null;
  note?: string; // "licensed source — display pending" when gated
}

export interface TokenRow {
  model: string;
  in: number | null;
  out: number | null;
  quality_adj: number | null;
  tps: number | null;
  delta_7d: number | null;
  source: string;
  tier: SourceTier;
  as_of: string;
  confidence: Confidence;
}

export interface GpuCell {
  provider: string;
  ondemand: number | null;
  reserved?: number | null;
  spot?: number | null;
  region: string | null;
  source: string;
  tier: SourceTier;
  as_of: string;
  confidence: Confidence;
}

export interface GpuGroup {
  gpu_class: string;
  cells: GpuCell[];
}

export interface NeocloudRoster {
  fixed: string[];
  candidates: string[];
}

export interface FusionBlock {
  region: string;
  power_price_kwh: number | null;
  interconnect_queue_depth: number | null;
  time_to_power: string | null; // human-readable ("36+ months") or ISO duration
  why_note: string | null;
  as_of: string | null;
}

export interface FuturesRow {
  venue: string;
  instrument: string;
  status: FuturesStatus;
  as_of: string;
  source: string;
  price?: number | null; // only present once status === 'trading'
  volume?: number | null;
}

export interface Footnote {
  ref: string;
  source: string;
  tier: SourceTier;
  cadence: string;
  note: string;
}

export interface ScoreboardSnapshot {
  as_of: string;
  region: string;
  indices: IndexCell[];
  tokens: TokenRow[];
  gpus: GpuGroup[];
  neocloud_roster: NeocloudRoster;
  fusion: FusionBlock | null;
  futures: FuturesRow[];
  footnotes: Footnote[];
}

// ─── Series endpoint ─────────────────────────────────────────────────────────
export interface SeriesPoint {
  as_of: string;
  value: number | null;
}

export interface SeriesResponse {
  metric_id: string;
  window: string;
  unit: string | null;
  display_allowed: boolean;
  source: string | null;
  tier: SourceTier | null;
  points: SeriesPoint[]; // values NULL when display_allowed=false
  delta_7d: number | null;
  delta_30d: number | null;
  delta_90d: number | null;
  realized_vol: number | null;
  note?: string;
}
