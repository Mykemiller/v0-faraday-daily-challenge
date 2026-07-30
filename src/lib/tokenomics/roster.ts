// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — NEOCLOUD_ROSTER (CANONICAL copy for the Next API).
// The edge ingest fn keeps an identical copy at supabase/functions/ingest-tokenomics/roster.ts
// (separate runtime — deno vs node — so it cannot be imported across). Keep the two in sync when
// the roster changes; roster.test.ts pins the shape on this side.
//
// LOCKED SCOPE DECISION #1: the snapshot returns the 4 fixed + the FULL candidate pool so any
// subscriber pick already has data; the front end renders 4 fixed + the chosen 5th.

export type NeocloudProvider = {
  key: string;
  label: string;
  gpu_classes: ("h100" | "h200" | "b200")[];
  clustermax_rank?: number | null;
};
export type NeocloudRoster = { fixed: NeocloudProvider[]; candidates: NeocloudProvider[] };

export const NEOCLOUD_ROSTER: NeocloudRoster = {
  fixed: [
    { key: "coreweave", label: "CoreWeave", gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 1 },
    { key: "lambda",    label: "Lambda",    gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 2 },
    { key: "nebius",    label: "Nebius",    gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 3 },
    { key: "crusoe",    label: "Crusoe",    gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 4 },
  ],
  candidates: [
    { key: "together_ai",  label: "Together AI",  gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 5 },
    { key: "voltage_park", label: "Voltage Park", gpu_classes: ["h100", "h200"],         clustermax_rank: 6 },
    { key: "fluidstack",   label: "Fluidstack",   gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 7 },
    { key: "nscale",       label: "Nscale",       gpu_classes: ["h100", "h200"],         clustermax_rank: 8 },
    { key: "vast_ai",      label: "Vast.ai",      gpu_classes: ["h100", "h200"],         clustermax_rank: 9 },
    { key: "datacrunch",   label: "DataCrunch",   gpu_classes: ["h100", "h200", "b200"], clustermax_rank: 10 },
  ],
};

export const DEFAULT_PICK5 = NEOCLOUD_ROSTER.candidates[0].key; // "together_ai"

export function isValidPick5(key: string): boolean {
  return NEOCLOUD_ROSTER.candidates.some((c) => c.key === key);
}

// Public roster shape returned in the snapshot (keys + labels only).
export function rosterForSnapshot() {
  return {
    fixed: NEOCLOUD_ROSTER.fixed.map((p) => ({ key: p.key, label: p.label })),
    candidates: NEOCLOUD_ROSTER.candidates.map((p) => ({ key: p.key, label: p.label })),
  };
}

// Providers to include in a snapshot's GPU grid: the 4 fixed always, plus the whole candidate pool
// (so the pick is instant client-side). The front end filters to fixed + chosen 5th.
export function snapshotProviderKeys(): string[] {
  return [...NEOCLOUD_ROSTER.fixed, ...NEOCLOUD_ROSTER.candidates].map((p) => p.key);
}
