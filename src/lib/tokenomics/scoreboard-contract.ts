// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — FRONT-END DATA CONTRACT (verbatim).
// This is the `ScoreboardSnapshot` type owned by the Tokenomics Scoreboard front end
// (design: claude.ai/design/p/9157d98b — CC-PROMPT-tokenomics-scoreboard.md §5). The backend
// TRANSFORM (snapshot_v1.ts) emits exactly this shape so the FE's httpAdapter is a thin fetch:
// flip USE_MOCK=false, point VITE_API_BASE at this app, done — zero layout change.
//
// Keep this file byte-for-byte aligned with the FE's src/data/types.ts. It is the single seam;
// no component (and no backend consumer) reads anything outside this shape.

// ---------- primitives ----------
export type ISODate = string;              // "2026-07-24T00:00:00Z"
export type RegionId =
  | "us-east-1" | "us-west-2" | "ercot-tx" | "eu-west-1" | "nordics-se" | "me-central-1";
export type SourceTier = "T1" | "T2" | "T3"; // transaction/methodology | constructed/analyst | raw feed
export type Provenance = "sample" | "reported" | "constructed" | "snippet";
export type DisplayState = "value" | "license_pending" | "not_published" | "awaiting_selection";

/** Every number on the screen is a Figure. Nothing renders a bare number. */
export interface Figure {
  state: DisplayState;              // "value" => `value` present; otherwise render the named state
  value?: number;
  unit?: string;                    // "$/M tok", "$/GPU-hr", "$/kWh", "%", "tok/s", "index"
  precision?: number;               // decimal places; default 2
  asOf?: ISODate;                   // REQUIRED whenever state === "value"
  cadenceSec?: number;              // expected refresh interval; drives auto-stale
  provenance?: Provenance;
  sourceId?: string;                // -> Source.id
  footnoteIds?: string[];           // -> Footnote.id
}

export interface Delta { pct: number; direction: "up" | "down" | "flat"; }

export interface Source {
  id: string; name: string; tier: SourceTier;
  cadence: string;                  // human: "daily 00:00 UTC"
  lastIngest?: ISODate;
  coverage?: string;
  licenseStatus: "licensed" | "pending" | "internal" | "public";
  methodologyUrl?: string;
  note?: string;
}

export interface Footnote { id: string; marker: string; text: string; }

// ---------- zone 3: index tiles ----------
export interface IndexTile {
  id: "token_price_index" | "gpu_rental_index" | "quality_adjusted" | "fusion";
  label: string;
  figure: Figure;
  delta7d?: Delta;
  delta30d?: Delta;
  sparkline?: { t: ISODate; v: number }[];
  emphasis?: boolean;               // fusion tile
}

// ---------- zone 6: token pricing ----------
export interface TokenRow {
  id: string; vendor: string; model: string;
  tier: "frontier" | "commodity";
  inputPerM: Figure; outputPerM: Figure;
  qualityAdjusted: Figure;          // $ per unit capability
  throughputTps: Figure;
  delta7d?: Delta; delta30d?: Delta;
}

// ---------- zone 5: GPU rates ----------
export type ProviderId = string;    // "aws" | "azure" | "gcp" | "coreweave" | ... | candidate ids
export interface Provider {
  id: ProviderId; name: string;
  group: "hyperscaler" | "neocloud";
  slot: "fixed" | "candidate";      // "candidate" = eligible for the 5th column
}
export interface RateCell {          // tri-modal
  onDemand: Figure;
  reserved: Figure;
  spot: Figure;
}
export interface GpuRow {
  id: "h100" | "h200" | "b200" | "gb200";
  label: string;
  cells: Record<ProviderId, RateCell>; // missing key OR state "not_published" both render "not published"
}

// ---------- zone 4: fusion ----------
export interface FusionPanel {
  region: RegionId;
  powerPrice: Figure;                    // $/kWh
  impliedPowerSharePct: Figure;          // % of $/GPU-hr attributable to power
  queueDepthGw: Figure;
  timeToPowerMonths: Figure;
  whyItMoved: { headline: string; body: string; author: string; asOf: ISODate; placeholder: boolean };
}

// ---------- zone 2: futures ----------
export interface FuturesChip {
  id: string; venue: string; partner: string;
  status: "trading" | "pending" | "research";
  asOf: ISODate;
}

// ---------- root ----------
export interface ScoreboardSnapshot {
  schemaVersion: "1.0";
  generatedAt: ISODate;
  regions: { id: RegionId; label: string; powerPrice: Figure }[];
  selectedRegion: RegionId;              // server default; client may override
  providers: Provider[];
  indexTiles: IndexTile[];
  tokenRows: TokenRow[];
  gpuRows: GpuRow[];
  fusion: FusionPanel;
  futures: FuturesChip[];
  sources: Source[];
  footnotes: Footnote[];
}

// ---------- subscriber state (separate from the snapshot) ----------
export interface SubscriberPrefs {
  subscriberId: string;
  pickedProviderId: ProviderId | null;   // null => render the awaiting_selection column state
  selectedRegion: RegionId | null;
  theme: "light" | "dark" | "system";
}

// ============================================================================================
// Region model (backend-side): which RegionId maps to which US grid geography. The FE enum has 6
// regions; Faraday's live grid tables (eia_utility_territories, ferc_queue_county_rollup) are
// US-only, so non-US regions carry no fusion/power figures (rendered not_published — never faked).
// ============================================================================================
export type RegionGeo = { label: string; state_abbr: string | null; iso_rto: string | null };

export const REGION_MODEL: Record<RegionId, RegionGeo> = {
  "us-east-1":   { label: "US East (N. Virginia)", state_abbr: "VA", iso_rto: "PJM" },
  "us-west-2":   { label: "US West (Oregon)",      state_abbr: "OR", iso_rto: null },
  "ercot-tx":    { label: "Texas (ERCOT)",         state_abbr: "TX", iso_rto: "ERCOT" },
  "eu-west-1":   { label: "EU West (Ireland)",     state_abbr: null, iso_rto: null }, // no US grid data
  "nordics-se":  { label: "Nordics (Sweden)",      state_abbr: null, iso_rto: null }, // no US grid data
  "me-central-1":{ label: "Middle East (UAE)",     state_abbr: null, iso_rto: null }, // no US grid data
};

export const REGION_IDS = Object.keys(REGION_MODEL) as RegionId[];
export const DEFAULT_REGION_ID: RegionId = "us-east-1";

export function isRegionId(x: string | null | undefined): x is RegionId {
  return !!x && Object.prototype.hasOwnProperty.call(REGION_MODEL, x);
}
export function normalizeRegionId(x: string | null | undefined): RegionId {
  return isRegionId(x) ? x : DEFAULT_REGION_ID;
}

// Map an INGESTED region string (however a provider names it) to the FE RegionId enum, so raw GPU
// rows bucket into the right column set. Unknown ingested regions => null (excluded from a region view).
const INGEST_REGION_TO_ID: Record<string, RegionId> = {
  "us-east-1": "us-east-1", "eastus": "us-east-1", "eastus2": "us-east-1", "us-east4": "us-east-1",
  "us-west-2": "us-west-2", "westus2": "us-west-2", "us-west1": "us-west-2", "us-west-1": "us-west-2",
  "southcentralus": "ercot-tx", "us-south1": "ercot-tx", "ercot-tx": "ercot-tx",
  "eu-west-1": "eu-west-1", "westeurope": "eu-west-1", "europe-west1": "eu-west-1",
  "nordics-se": "nordics-se", "swedencentral": "nordics-se", "europe-north1": "nordics-se",
  "me-central-1": "me-central-1", "uaenorth": "me-central-1",
};
export function ingestRegionToId(region: string | null | undefined): RegionId | null {
  if (!region) return null;
  return INGEST_REGION_TO_ID[region] ?? (isRegionId(region) ? region : null);
}
