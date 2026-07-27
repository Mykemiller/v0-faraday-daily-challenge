// NEOCLOUD_ROSTER — the neocloud provider config for the Tokenomics Scoreboard.
//
// LOCKED SCOPE (subscriber-pickable 5th column): the scoreboard renders 4 FIXED
// neoclouds plus the subscriber's chosen 5th. To guarantee any pick already has
// data, ingest the 4 fixed PLUS the full candidate pool. The snapshot API returns
// the 4 fixed + the full candidate pool; the front end renders 4 fixed + the pick.
//
// Ranking / selection basis: SemiAnalysis ClusterMAX tiering + Silicon Data
// coverage. The fixed four are the highest-coverage, ClusterMAX-ranked neoclouds;
// the candidate pool is the next band with sufficient public on-demand price
// disclosure. Together AI is the default candidate. Order within each list is the
// display/ranking order.

import type { NeocloudRoster } from './types.ts';

export interface NeocloudProvider {
  slug: string;
  label: string;
  clustermax_tier?: string | null;   // SemiAnalysis ClusterMAX tier, when published
  silicon_data_covered: boolean;     // whether Silicon Data tracks the provider's $/GPU-hr
}

export const NEOCLOUD_PROVIDERS: Record<string, NeocloudProvider> = {
  coreweave:  { slug: 'coreweave',  label: 'CoreWeave',   clustermax_tier: 'Platinum', silicon_data_covered: true },
  lambda:     { slug: 'lambda',     label: 'Lambda',      clustermax_tier: 'Gold',     silicon_data_covered: true },
  nebius:     { slug: 'nebius',     label: 'Nebius',      clustermax_tier: 'Gold',     silicon_data_covered: true },
  crusoe:     { slug: 'crusoe',     label: 'Crusoe',      clustermax_tier: 'Gold',     silicon_data_covered: true },
  // candidate pool — any of these may be the subscriber's picked 5th column
  together:   { slug: 'together',   label: 'Together AI', clustermax_tier: 'Silver',   silicon_data_covered: true },
  voltagepark:{ slug: 'voltagepark',label: 'Voltage Park',clustermax_tier: 'Silver',   silicon_data_covered: true },
  fluidstack: { slug: 'fluidstack', label: 'FluidStack',  clustermax_tier: 'Silver',   silicon_data_covered: false },
  nscale:     { slug: 'nscale',     label: 'Nscale',      clustermax_tier: null,       silicon_data_covered: false },
  vastai:     { slug: 'vastai',     label: 'Vast.ai',     clustermax_tier: 'Bronze',   silicon_data_covered: true },
  datacrunch: { slug: 'datacrunch', label: 'DataCrunch',  clustermax_tier: 'Bronze',   silicon_data_covered: false },
};

// The 4 fixed columns — always rendered.
export const FIXED_NEOCLOUDS: string[] = ['coreweave', 'lambda', 'nebius', 'crusoe'];

// The candidate pool — the subscriber's 5th column is one of these.
// Together AI is first = the default when a subscriber has no saved pick.
export const CANDIDATE_NEOCLOUDS: string[] = [
  'together', 'voltagepark', 'fluidstack', 'nscale', 'vastai', 'datacrunch',
];

export const DEFAULT_PICK5: string = CANDIDATE_NEOCLOUDS[0]; // 'together'

export const NEOCLOUD_ROSTER: NeocloudRoster = {
  fixed: FIXED_NEOCLOUDS,
  candidates: CANDIDATE_NEOCLOUDS,
};

// Every provider we ingest = fixed + candidates (so any pick already has data).
export function allIngestedNeoclouds(): string[] {
  return [...FIXED_NEOCLOUDS, ...CANDIDATE_NEOCLOUDS];
}

export function isValidPick5(slug: string): boolean {
  return CANDIDATE_NEOCLOUDS.includes(slug);
}

// Resolve a subscriber's stored pref to a valid pick5 slug (falls back to default).
export function resolvePick5(pref: unknown): string {
  if (pref && typeof pref === 'object' && 'pick5' in pref) {
    const p = (pref as { pick5?: unknown }).pick5;
    if (typeof p === 'string' && isValidPick5(p)) return p;
  }
  return DEFAULT_PICK5;
}

export function providerLabel(slug: string): string {
  return NEOCLOUD_PROVIDERS[slug]?.label ?? slug;
}
