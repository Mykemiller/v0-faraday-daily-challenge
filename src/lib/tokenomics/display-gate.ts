// Global display gate for licensed third-party indices (locked scope #2).
//
// Third-party constructed indices are INGEST-ONLY until subscriber launch +
// per-source licensing sign-off. Ingest stamps display_allowed=false for these
// sources; the snapshot API omits their values (existence + as-of + source +
// "display pending" placeholder only). Flip a source's gate ONLY after legal
// sign-off — see docs/tokenomics-scoreboard/README.md. Never ship a third-party
// index value with display_allowed=true without Myke's explicit sign-off.

import type { MetricInput } from './types.ts';

export interface SourceRegistryEntry {
  source: string;
  label: string;
  category: 'A' | 'B' | 'C' | 'D';
  source_tier: 1 | 2 | 3;
  kind: string;
  cadence: string;
  is_third_party_index: boolean;
  display_allowed: boolean; // GLOBAL gate default
  license_note?: string;
  attribution?: string;
  home_url?: string;
  crawlable?: 'api' | 'rendered' | 'semi-manual' | 'press';
  notes?: string;
}

// Canonical source registry (mirrors the tokenomics_source_registry seed). This
// is the ingest-side source of truth for tier + the display gate.
export const SOURCE_REGISTRY: Record<string, SourceRegistryEntry> = {
  // ── A: token / inference pricing ──────────────────────────────────────────
  openai:        { source: 'openai',        label: 'OpenAI',            category: 'A', source_tier: 1, kind: 'vendor_page',    cadence: 'near-daily', is_third_party_index: false, display_allowed: true,  crawlable: 'semi-manual', notes: '403-prone; headless/rendered or semi-manual with as-of' },
  anthropic:     { source: 'anthropic',     label: 'Anthropic',         category: 'A', source_tier: 1, kind: 'vendor_page',    cadence: 'near-daily', is_third_party_index: false, display_allowed: true,  crawlable: 'semi-manual' },
  google:        { source: 'google',        label: 'Google',            category: 'A', source_tier: 1, kind: 'vendor_page',    cadence: 'near-daily', is_third_party_index: false, display_allowed: true,  crawlable: 'semi-manual' },
  xai:           { source: 'xai',           label: 'xAI',               category: 'A', source_tier: 1, kind: 'vendor_page',    cadence: 'near-daily', is_third_party_index: false, display_allowed: true,  crawlable: 'semi-manual' },
  aipricing_guru:{ source: 'aipricing_guru',label: 'aipricing.guru',    category: 'A', source_tier: 3, kind: 'aipricing_guru', cadence: 'near-daily', is_third_party_index: false, display_allowed: true,  crawlable: 'api',         home_url: 'https://aipricing.guru/api/pricing.json' },
  usagepricing:  { source: 'usagepricing',  label: 'UsagePricing',      category: 'A', source_tier: 3, kind: 'aipricing_guru', cadence: 'near-daily', is_third_party_index: false, display_allowed: true,  crawlable: 'rendered' },
  epoch_ai:      { source: 'epoch_ai',      label: 'Epoch AI',          category: 'A', source_tier: 1, kind: 'index',          cadence: 'monthly',    is_third_party_index: false, display_allowed: true,  crawlable: 'api',         notes: 'quality-adjusted price-per-capability' },
  artificial_analysis: { source: 'artificial_analysis', label: 'Artificial Analysis', category: 'A', source_tier: 1, kind: 'index', cadence: 'near-daily', is_third_party_index: false, display_allowed: true, crawlable: 'rendered', notes: 'throughput / tps' },

  // constructed indices — INGEST-ONLY, display gate CLOSED
  tokenix_acpi:  { source: 'tokenix_acpi',  label: 'Tokenix / ACPI',    category: 'A', source_tier: 1, kind: 'index', cadence: 'publisher', is_third_party_index: true, display_allowed: false, license_note: 'licensed — legal sign-off required before any value ships', attribution: 'Tokenix ACPI' },
  tpi:           { source: 'tpi',           label: 'TPI',               category: 'A', source_tier: 2, kind: 'index', cadence: 'publisher', is_third_party_index: true, display_allowed: false, license_note: 'licensed — legal sign-off required', attribution: 'TPI' },
  ornn_otpi:     { source: 'ornn_otpi',     label: 'Ornn / OTPI',       category: 'A', source_tier: 1, kind: 'index', cadence: 'publisher', is_third_party_index: true, display_allowed: false, license_note: 'licensed — legal sign-off required', attribution: 'Ornn OTPI' },
  silicon_data_sdllmtk: { source: 'silicon_data_sdllmtk', label: 'Silicon Data SDLLMTK', category: 'A', source_tier: 1, kind: 'index', cadence: 'publisher', is_third_party_index: true, display_allowed: false, license_note: 'licensed — legal sign-off required', attribution: 'Silicon Data' },

  // ── B: GPU rental ─────────────────────────────────────────────────────────
  aws:   { source: 'aws',   label: 'AWS',   category: 'B', source_tier: 1, kind: 'cloud_gpu', cadence: 'daily', is_third_party_index: false, display_allowed: true, crawlable: 'api', notes: 'Price List API / bulk JSON' },
  azure: { source: 'azure', label: 'Azure', category: 'B', source_tier: 1, kind: 'cloud_gpu', cadence: 'daily', is_third_party_index: false, display_allowed: true, crawlable: 'api', notes: 'Retail Prices API' },
  gcp:   { source: 'gcp',   label: 'GCP',   category: 'B', source_tier: 1, kind: 'cloud_gpu', cadence: 'daily', is_third_party_index: false, display_allowed: true, crawlable: 'api', notes: 'Cloud Billing Catalog API' },
  neocloud: { source: 'neocloud', label: 'Neocloud (roster)', category: 'B', source_tier: 2, kind: 'neocloud', cadence: 'daily', is_third_party_index: false, display_allowed: true, crawlable: 'rendered', notes: 'per-provider on-demand $/GPU-hr; primary vendor pages' },

  // reference GPU indices — INGEST-ONLY, display gate CLOSED
  silicon_data_gpu: { source: 'silicon_data_gpu', label: 'Silicon Data (GPU)', category: 'B', source_tier: 1, kind: 'index', cadence: 'daily', is_third_party_index: true, display_allowed: false, license_note: 'licensed — legal sign-off required', attribution: 'Silicon Data' },
  ornn_ocpi:        { source: 'ornn_ocpi',        label: 'Ornn / OCPI',        category: 'B', source_tier: 1, kind: 'index', cadence: 'daily', is_third_party_index: true, display_allowed: false, license_note: 'licensed — legal sign-off required', attribution: 'Ornn OCPI' },

  // ── C: futures ────────────────────────────────────────────────────────────
  cme_silicon_data: { source: 'cme_silicon_data', label: 'CME × Silicon Data', category: 'C', source_tier: 2, kind: 'futures', cadence: 'event', is_third_party_index: false, display_allowed: true, crawlable: 'press' },
  ice_ornn:         { source: 'ice_ornn',         label: 'ICE × Ornn',         category: 'C', source_tier: 2, kind: 'futures', cadence: 'event', is_third_party_index: false, display_allowed: true, crawlable: 'press' },
  ice_nativx_coil:  { source: 'ice_nativx_coil',  label: 'ICE × NATIVX / COIL', category: 'C', source_tier: 2, kind: 'futures', cadence: 'event', is_third_party_index: false, display_allowed: true, crawlable: 'press' },
  shfe:             { source: 'shfe',             label: 'SHFE',               category: 'C', source_tier: 2, kind: 'futures', cadence: 'monthly', is_third_party_index: false, display_allowed: true, crawlable: 'press' },

  // ── D: demand-side context + fusion ───────────────────────────────────────
  iea:      { source: 'iea',      label: 'IEA',            category: 'D', source_tier: 1, kind: 'index',  cadence: 'quarterly', is_third_party_index: false, display_allowed: true, crawlable: 'rendered' },
  goldman:  { source: 'goldman',  label: 'Goldman Sachs',  category: 'D', source_tier: 1, kind: 'index',  cadence: 'quarterly', is_third_party_index: false, display_allowed: true, crawlable: 'rendered' },
  morgan_stanley: { source: 'morgan_stanley', label: 'Morgan Stanley', category: 'D', source_tier: 1, kind: 'index', cadence: 'quarterly', is_third_party_index: false, display_allowed: true, crawlable: 'rendered' },
  faraday_grid: { source: 'faraday_grid', label: 'Faraday Grid Plane (DC Hub / grid)', category: 'D', source_tier: 1, kind: 'fusion', cadence: 'daily', is_third_party_index: false, display_allowed: true, crawlable: 'api', notes: "Faraday's own jurisdiction/grid data — fusion join" },
};

export function registryFor(source: string): SourceRegistryEntry | undefined {
  return SOURCE_REGISTRY[source];
}

// Stamp display_allowed + source_tier from the registry so a third-party index
// can NEVER slip through with the gate open. If a source is unknown, default to
// closed (fail safe) for anything flagged as an index elsewhere; otherwise leave
// the caller's value but never open the gate for an unknown index source.
export function stampDisplayGate(input: MetricInput): MetricInput {
  const reg = SOURCE_REGISTRY[input.source];
  if (!reg) return input; // unknown source: caller's value stands (adapters set explicitly)
  const display_allowed = reg.display_allowed && !reg.is_third_party_index ? true : reg.display_allowed;
  const meta = { ...(input.meta ?? {}) };
  if (reg.attribution && !meta.attribution) meta.attribution = reg.attribution;
  return {
    ...input,
    source_tier: reg.source_tier,
    display_allowed,
    meta,
  };
}

export function isThirdPartyIndex(source: string): boolean {
  return SOURCE_REGISTRY[source]?.is_third_party_index === true;
}
