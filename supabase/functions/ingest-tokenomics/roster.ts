// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — NEOCLOUD_ROSTER config.
// LOCKED SCOPE DECISION #1: ingest a candidate POOL so any subscriber-picked 5th column already has
// data. The snapshot API returns the 4 fixed + the full candidate pool; the front end renders the
// 4 fixed + the subscriber's chosen 5th. Ranking/selection basis: SemiAnalysis ClusterMAX +
// Silicon Data coverage.
//
// NOTE: this file is the deno (edge) copy. The canonical source consumed by the Next API is
// src/lib/tokenomics/roster.ts — the two are kept identical by roster.test.ts on the src side and a
// shape assertion here. Keep them in sync when the roster changes.

export type NeocloudProvider = {
  key: string;            // stable slug used in metric_id + subscriber pick5
  label: string;
  // GPU classes this provider lists on-demand $/GPU-hr (drives which SKUs the adapter fetches).
  gpu_classes: ("h100" | "h200" | "b200")[];
  clustermax_rank?: number | null;   // SemiAnalysis ClusterMAX standing (lower = better), if known
};

export type NeocloudRoster = {
  fixed: NeocloudProvider[];       // always rendered (columns 1-4)
  candidates: NeocloudProvider[];  // pool for the pickable 5th column; [0] is the default pick
};

export const NEOCLOUD_ROSTER: NeocloudRoster = {
  fixed: [
    { key: "coreweave", label: "CoreWeave", gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 1 },
    { key: "lambda",    label: "Lambda",    gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 2 },
    { key: "nebius",    label: "Nebius",    gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 3 },
    { key: "crusoe",    label: "Crusoe",    gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 4 },
  ],
  candidates: [
    { key: "together_ai",  label: "Together AI",  gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 5 }, // default 5th
    { key: "voltage_park", label: "Voltage Park", gpu_classes: ["h100", "h200"],         clustermax_rank: 6 },
    { key: "fluidstack",   label: "Fluidstack",   gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 7 },
    { key: "nscale",       label: "Nscale",       gpu_classes: ["h100", "h200"],         clustermax_rank: 8 },
    { key: "vast_ai",      label: "Vast.ai",      gpu_classes: ["h100", "h200"],         clustermax_rank: 9 },
    { key: "datacrunch",   label: "DataCrunch",   gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 10 },
  ],
};

export const DEFAULT_PICK5 = NEOCLOUD_ROSTER.candidates[0].key; // "together_ai"

// Every provider whose data we ingest (fixed + candidates).
export function allNeoclouds(): NeocloudProvider[] {
  return [...NEOCLOUD_ROSTER.fixed, ...NEOCLOUD_ROSTER.candidates];
}

// Validate a subscriber pick — must be a candidate key (the fixed four are not pickable).
export function isValidPick5(key: string): boolean {
  return NEOCLOUD_ROSTER.candidates.some((c) => c.key === key);
}
