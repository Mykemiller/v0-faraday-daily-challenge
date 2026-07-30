/// <reference lib="deno.ns" />
// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — read-layer tests (pure). No network, no DB.
// Run with: deno test --unstable-sloppy-imports src/lib/tokenomics/

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { canonicalize, pctChange, realizedVol, computeSeries, type Point } from "./series.ts";
import { NEOCLOUD_ROSTER, isValidPick5, DEFAULT_PICK5, rosterForSnapshot, snapshotProviderKeys } from "./roster.ts";
import { resolveRegion, normalizeRegion, DEFAULT_REGION } from "./fusion.ts";
import { assembleSnapshot, isKnownRegion } from "./snapshot.ts";
import { type RawMetricRow, type SourceRegistryRow } from "./types.ts";

// ── series ────────────────────────────────────────────────────────────────────
Deno.test("canonicalize keeps freshest vintage per as_of, sorted asc", () => {
  const pts = canonicalize([
    { as_of: "2026-07-10", value: 1, ingested_at: "2026-07-10T00:00Z" },
    { as_of: "2026-07-10", value: 2, ingested_at: "2026-07-11T00:00Z" }, // correction wins
    { as_of: "2026-07-01", value: 5 },
    { as_of: "2026-07-05", value: null },                                // dropped
  ]);
  assertEquals(pts, [{ as_of: "2026-07-01", value: 5 }, { as_of: "2026-07-10", value: 2 }] as Point[]);
});
Deno.test("pctChange uses closest reading at/just before the horizon", () => {
  const pts: Point[] = [
    { as_of: "2026-07-01", value: 100 },
    { as_of: "2026-07-20", value: 110 },
    { as_of: "2026-07-27", value: 121 },
  ];
  // vs 7d before 2026-07-27 => 2026-07-20 (110) -> +10%
  assertEquals(pctChange(pts, 7), 10);
  // vs 30d before => nothing at/just before 2026-06-27 -> null (base is earliest 07-01 which is AFTER horizon? 07-01 <= 06-27 is false)
  assertEquals(pctChange(pts, 30), null);
  assertEquals(pctChange([pts[0]], 7), null);
});
Deno.test("realizedVol is null for <3 points, positive for varied series", () => {
  assertEquals(realizedVol([{ as_of: "a", value: 1 }, { as_of: "b", value: 2 }]), null);
  const v = realizedVol([
    { as_of: "a", value: 100 }, { as_of: "b", value: 105 },
    { as_of: "c", value: 98 }, { as_of: "d", value: 103 },
  ]);
  assert(v !== null && v > 0);
});
Deno.test("computeSeries end-to-end", () => {
  const s = computeSeries("gpu.h100.ondemand.aws.us-east-1", [
    { as_of: "2026-07-20", value: 3.0 }, { as_of: "2026-07-27", value: 3.3 },
  ], 90, "2026-07-27");
  assertEquals(s.n, 2);
  assertEquals(s.latest!.value, 3.3);
  assertEquals(s.delta_7d, 10);
});

// ── roster ──────────────────────────────────────────────────────────────────
Deno.test("roster snapshot output = 4 fixed + full 6-candidate pool", () => {
  const r = rosterForSnapshot();
  assertEquals(r.fixed.length, 4);
  assertEquals(r.candidates.length, 6);
  assertEquals(snapshotProviderKeys().length, 10);
  assert(isValidPick5(DEFAULT_PICK5));
  assert(!isValidPick5("coreweave"));
});

// ── fusion region map ──────────────────────────────────────────────────────────
Deno.test("region resolution + normalization", () => {
  assertEquals(resolveRegion("southcentralus")!.state_abbr, "TX");
  assertEquals(normalizeRegion("bogus"), DEFAULT_REGION);
  assertEquals(normalizeRegion("us-west-2"), "us-west-2");
  assert(isKnownRegion("us-east-1"));
});

// ── snapshot assembler ─────────────────────────────────────────────────────────
const REGISTRY: SourceRegistryRow[] = [
  { source_key: "aipricing_guru", label: "aipricing.guru", tier: 3, cadence: "daily", is_third_party_index: false, display_allowed: true, attribution: "aipricing.guru" },
  { source_key: "cloud_azure", label: "Azure", tier: 1, cadence: "daily", is_third_party_index: false, display_allowed: true, attribution: null },
  { source_key: "neocloud", label: "Neoclouds", tier: 2, cadence: "daily", is_third_party_index: false, display_allowed: true, attribution: null },
  { source_key: "idx_tokenix_acpi", label: "Tokenix / ACPI", tier: 1, cadence: "publisher", is_third_party_index: true, display_allowed: false, attribution: "Tokenix" },
  { source_key: "futures_cme", label: "CME x Silicon Data", tier: 2, cadence: "event", is_third_party_index: false, display_allowed: true, attribution: "CME" },
  { source_key: "fusion_faraday", label: "Faraday grid fusion", tier: 1, cadence: "daily", is_third_party_index: false, display_allowed: true, attribution: "Faraday Intelligence" },
];

function row(over: Partial<RawMetricRow>): RawMetricRow {
  return {
    metric_id: "x", category: "A", subject: null, provider: null, region: null, sku: null,
    pricing_mode: null, value: 1, unit: "index-level", as_of: "2026-07-27", source: "aipricing_guru",
    source_tier: 1, confidence: "as-reported", display_allowed: true, why_note: null,
    delta_7d: null, delta_30d: null, ...over,
  };
}

Deno.test("GATED third-party index returns existence + placeholder, NEVER a value", () => {
  const rows: RawMetricRow[] = [
    // RPC already nulled the value for the gated row:
    row({ metric_id: "index.idx_tokenix_acpi", subject: "ACPI", source: "idx_tokenix_acpi",
          value: null, display_allowed: false, source_tier: 1 }),
  ];
  const snap = assembleSnapshot(rows, { region: "us-east-1", as_of: "2026-07-27", sourceRegistry: REGISTRY });
  assertEquals(snap.indices.length, 1);
  const idx = snap.indices[0];
  assertEquals(idx.value, null);
  assertEquals(idx.placeholder, "licensed source — display pending");
  assertEquals(idx.display_allowed, false);
  assertEquals(idx.as_of, "2026-07-27");        // existence + as-of still returned
  assertEquals(idx.attribution, "Tokenix");
});

Deno.test("tokens group by model; gpus group by class+provider; region filter applied", () => {
  const rows: RawMetricRow[] = [
    row({ metric_id: "token.openai.gpt-4o.in", subject: "gpt-4o", unit: "$/M-in", value: 2.5, source: "aipricing_guru", source_tier: 3, delta_7d: 5 }),
    row({ metric_id: "token.openai.gpt-4o.out", subject: "gpt-4o", unit: "$/M-out", value: 10, source: "aipricing_guru", source_tier: 3 }),
    row({ metric_id: "gpu.h100.ondemand.together_ai.list", category: "B", subject: "h100", provider: "together_ai", pricing_mode: "list", unit: "$/GPU-hr", value: 1.75, region: null, source: "neocloud", source_tier: 2 }),
    row({ metric_id: "gpu.h100.ondemand.azure.us-east-1", category: "B", subject: "h100", provider: "azure", pricing_mode: "ondemand", unit: "$/GPU-hr", value: 12.3, region: "us-east-1", source: "cloud_azure" }),
    row({ metric_id: "gpu.h100.ondemand.azure.us-west-2", category: "B", subject: "h100", provider: "azure", pricing_mode: "ondemand", unit: "$/GPU-hr", value: 9.9, region: "us-west-2", source: "cloud_azure" }),
  ];
  const snap = assembleSnapshot(rows, { region: "us-east-1", as_of: "2026-07-27", sourceRegistry: REGISTRY });
  assertEquals(snap.tokens.length, 1);
  assertEquals(snap.tokens[0].in, 2.5);
  assertEquals(snap.tokens[0].out, 10);
  assertEquals(snap.tokens[0].delta_7d, 5);
  assertEquals(snap.gpus.length, 1);            // one gpu_class (h100)
  const providers = snap.gpus[0].cells.map((c) => c.provider).sort();
  assertEquals(providers, ["azure", "together_ai"]); // us-west-2 azure row filtered out
  assertEquals(snap.gpus[0].cells.find((c) => c.provider === "together_ai")!.ondemand, 1.75);
});

Deno.test("futures: status without price; price only when a trading price row exists", () => {
  const rows: RawMetricRow[] = [
    row({ metric_id: "futures.cme.compute.status", category: "C", subject: "compute", provider: "CME", unit: "status", value: null, why_note: "status:announced-pending", source: "futures_cme", source_tier: 2 }),
    row({ metric_id: "futures.ice.compute.status", category: "C", subject: "compute", provider: "ICE", unit: "status", value: null, why_note: "status:trading", source: "futures_cme", source_tier: 2 }),
    row({ metric_id: "futures.ice.compute.price", category: "C", subject: "compute", provider: "ICE", unit: "index-level", value: 45.6, source: "futures_cme", source_tier: 2 }),
  ];
  const snap = assembleSnapshot(rows, { region: "us-east-1", as_of: "2026-07-27", sourceRegistry: REGISTRY });
  const cme = snap.futures.find((f) => f.venue === "CME")!;
  assertEquals(cme.status, "announced-pending");
  assertEquals(cme.price, undefined);
  const ice = snap.futures.find((f) => f.venue === "ICE")!;
  assertEquals(ice.status, "trading");
  assertEquals(ice.price, 45.6);
});

Deno.test("fusion block built from demand.fusion.<region>.* + timeToPower", () => {
  const rows: RawMetricRow[] = [
    row({ metric_id: "demand.fusion.us-east-1.power_price_kwh", category: "D", subject: "grid-fusion", provider: "Faraday Intelligence", region: "us-east-1", unit: "$/kWh", value: 0.086, source: "fusion_faraday", why_note: "GPU on-demand in N. Virginia moved +10% · grid $0.086/kWh (PJM)", confidence: "verified" }),
    row({ metric_id: "demand.fusion.us-east-1.queue_depth_mw", category: "D", subject: "grid-fusion", provider: "Faraday Intelligence", region: "us-east-1", unit: "MW", value: 12000, source: "fusion_faraday", confidence: "verified" }),
  ];
  const snap = assembleSnapshot(rows, { region: "us-east-1", as_of: "2026-07-27", sourceRegistry: REGISTRY, timeToPower: "Facility Study" });
  assert(snap.fusion !== null);
  assertEquals(snap.fusion!.power_price_kwh, 0.086);
  assertEquals(snap.fusion!.interconnect_queue_depth, 12000);
  assertEquals(snap.fusion!.time_to_power, "Facility Study");
  assert(snap.fusion!.why_note!.includes("PJM"));
});

Deno.test("footnotes flag gated indices as display-pending", () => {
  const rows: RawMetricRow[] = [ row({ metric_id: "index.idx_tokenix_acpi", source: "idx_tokenix_acpi", value: null, display_allowed: false }) ];
  const snap = assembleSnapshot(rows, { region: "us-east-1", as_of: "2026-07-27", sourceRegistry: REGISTRY });
  const fn = snap.footnotes.find((f) => f.source === "Tokenix / ACPI")!;
  assertEquals(fn.note, "licensed source — display pending");
});
