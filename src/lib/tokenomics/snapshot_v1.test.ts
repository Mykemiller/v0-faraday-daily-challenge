/// <reference lib="deno.ns" />
// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — transform tests (raw rows -> FE ScoreboardSnapshot).
// Run with: deno test --unstable-sloppy-imports src/lib/tokenomics/

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { assembleSnapshotV1, type AssembleV1Input } from "./snapshot_v1.ts";
import type { RawMetricRow, SourceRegistryRow } from "./types.ts";
import type { RegionId } from "./scoreboard-contract.ts";

const GEN = "2026-07-27T00:00:00Z";

const REGISTRY: SourceRegistryRow[] = [
  { source_key: "aipricing_guru", label: "aipricing.guru", tier: 3, cadence: "daily", is_third_party_index: false, display_allowed: true, attribution: "aipricing.guru" },
  { source_key: "cloud_azure", label: "Azure", tier: 1, cadence: "daily", is_third_party_index: false, display_allowed: true, attribution: null },
  { source_key: "neocloud", label: "Neoclouds", tier: 2, cadence: "daily", is_third_party_index: false, display_allowed: true, attribution: null },
  { source_key: "artificial_analysis", label: "Artificial Analysis", tier: 1, cadence: "publisher", is_third_party_index: false, display_allowed: true, attribution: "Artificial Analysis" },
  { source_key: "idx_silicon_gpu", label: "Silicon Data GPU index", tier: 1, cadence: "publisher", is_third_party_index: true, display_allowed: false, attribution: "Silicon Data" },
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

function build(rows: RawMetricRow[], region: RegionId = "us-east-1", fusionByRegion: AssembleV1Input["fusionByRegion"] = {}) {
  return assembleSnapshotV1({ rows, sourceRegistry: REGISTRY, fusionByRegion, selectedRegion: region, generatedAt: GEN });
}

Deno.test("root shape: schemaVersion, all 6 regions, 3 hyperscalers + 4 fixed + 6 candidate providers", () => {
  const s = build([]);
  assertEquals(s.schemaVersion, "1.0");
  assertEquals(s.regions.length, 6);
  assertEquals(s.providers.filter((p) => p.group === "hyperscaler").length, 3);
  assertEquals(s.providers.filter((p) => p.group === "neocloud" && p.slot === "fixed").length, 4);
  assertEquals(s.providers.filter((p) => p.slot === "candidate").length, 6);
  assertEquals(s.gpuRows.map((g) => g.id), ["h100", "h200", "b200", "gb200"]);
});

Deno.test("every number is a Figure; missing GPU cell -> not_published (never a bare dash)", () => {
  const s = build([]);
  const h100 = s.gpuRows.find((g) => g.id === "h100")!;
  const aws = h100.cells["aws"];
  assertEquals(aws.onDemand.state, "not_published");
  assertEquals(aws.onDemand.value, undefined);
  assertEquals(aws.onDemand.unit, "$/GPU-hr"); // unit retained so layout is identical
});

Deno.test("GPU: region bucketing + mode mapping (list->ondemand, committed->reserved); off-region hyperscaler excluded", () => {
  const rows: RawMetricRow[] = [
    // neocloud global (region null) -> included in every region as on-demand
    row({ metric_id: "gpu.h100.ondemand.together_ai.list", category: "B", subject: "h100", provider: "together_ai", pricing_mode: "list", unit: "$/GPU-hr", value: 1.75, region: null, source: "neocloud", source_tier: 2 }),
    // azure eastus -> buckets to us-east-1
    row({ metric_id: "gpu.h100.ondemand.azure.eastus", category: "B", subject: "h100", provider: "azure", pricing_mode: "ondemand", unit: "$/GPU-hr", value: 12.3, region: "eastus", source: "cloud_azure" }),
    row({ metric_id: "gpu.h100.committed.azure.eastus", category: "B", subject: "h100", provider: "azure", pricing_mode: "committed", unit: "$/GPU-hr", value: 7.0, region: "eastus", source: "cloud_azure" }),
    // azure westus2 -> buckets to us-west-2, excluded from us-east-1 view
    row({ metric_id: "gpu.h100.ondemand.azure.westus2", category: "B", subject: "h100", provider: "azure", pricing_mode: "ondemand", unit: "$/GPU-hr", value: 9.9, region: "westus2", source: "cloud_azure" }),
  ];
  const s = build(rows, "us-east-1");
  const h100 = s.gpuRows.find((g) => g.id === "h100")!;
  assertEquals(h100.cells["together_ai"].onDemand.value, 1.75);   // global neocloud shown
  assertEquals(h100.cells["azure"].onDemand.value, 12.3);         // eastus, not westus2's 9.9
  assertEquals(h100.cells["azure"].reserved.value, 7.0);          // committed mapped to reserved
  assertEquals(h100.cells["azure"].spot.state, "not_published");
});

Deno.test("token rows: grouping, frontier vs commodity, Figure units", () => {
  const rows: RawMetricRow[] = [
    row({ metric_id: "token.openai.gpt-4o.in", subject: "gpt-4o", provider: "openai", unit: "$/M-in", value: 2.5, source: "aipricing_guru", source_tier: 3 }),
    row({ metric_id: "token.openai.gpt-4o.out", subject: "gpt-4o", provider: "openai", unit: "$/M-out", value: 10, source: "aipricing_guru", source_tier: 3 }),
    row({ metric_id: "token.meta.llama.in", subject: "llama", provider: "meta", unit: "$/M-in", value: 0.5, source: "aipricing_guru", source_tier: 3 }),
  ];
  const s = build(rows);
  const gpt = s.tokenRows.find((t) => t.model === "gpt-4o")!;
  assertEquals(gpt.tier, "frontier");
  assertEquals(gpt.inputPerM.value, 2.5);
  assertEquals(gpt.inputPerM.unit, "$/M tok");
  assertEquals(gpt.outputPerM.value, 10);
  assertEquals(s.tokenRows.find((t) => t.model === "llama")!.tier, "commodity");
});

Deno.test("DISPLAY GATE: a display_allowed=false token figure -> license_pending, no value", () => {
  const rows: RawMetricRow[] = [
    row({ metric_id: "token.idx.x.in", subject: "x", provider: "idx", unit: "$/M-in", value: null, display_allowed: false, source: "idx_tokenix_acpi" }),
  ];
  const s = build(rows);
  const t = s.tokenRows[0];
  assertEquals(t.inputPerM.state, "license_pending");
  assertEquals(t.inputPerM.value, undefined);
});

Deno.test("fusion (US region): power/queue computed, MW->GW, implied share derived, timeToPower ALWAYS not_published", () => {
  const rows: RawMetricRow[] = [
    row({ metric_id: "gpu.h100.ondemand.azure.eastus", category: "B", subject: "h100", provider: "azure", pricing_mode: "ondemand", unit: "$/GPU-hr", value: 10, region: "eastus", source: "cloud_azure" }),
  ];
  const s = build(rows, "us-east-1", { "us-east-1": { power_price_kwh: 0.10, interconnect_queue_depth_mw: 12000, time_to_power: "Facility Study", as_of: "2026-07-25" } });
  assertEquals(s.fusion.powerPrice.state, "value");
  assertEquals(s.fusion.powerPrice.value, 0.10);
  assertEquals(s.fusion.queueDepthGw.value, 12);              // 12000 MW -> 12 GW
  assertEquals(s.fusion.queueDepthGw.unit, "GW");
  // implied share = 0.7 kW * 0.10 $/kWh / 10 $/GPU-hr = 0.7%
  assertEquals(s.fusion.impliedPowerSharePct.value, 0.7);
  assertEquals(s.fusion.impliedPowerSharePct.provenance, "constructed");
  assertEquals(s.fusion.timeToPowerMonths.state, "not_published"); // never fabricated
});

Deno.test("fusion (non-US region): power + queue not_published (zero fabrication), with f_nonus footnote", () => {
  const s = build([], "nordics-se", { "nordics-se": { power_price_kwh: 0.05 } }); // even if a value is passed, non-US geo => withheld
  assertEquals(s.fusion.powerPrice.state, "not_published");
  assertEquals(s.fusion.queueDepthGw.state, "not_published");
  assert(s.fusion.powerPrice.footnoteIds?.includes("f_nonus"));
  const se = s.regions.find((r) => r.id === "nordics-se")!;
  assertEquals(se.powerPrice.state, "not_published");
  const va = s.regions.find((r) => r.id === "us-east-1")!;
  assertEquals(va.label, "US East (N. Virginia)");
});

Deno.test("index tiles: constructed baskets; fusion tile is license_pending (locked scope)", () => {
  const rows: RawMetricRow[] = [
    row({ metric_id: "token.openai.gpt-4o.in", subject: "gpt-4o", provider: "openai", unit: "$/M-in", value: 2, source: "aipricing_guru", source_tier: 3 }),
    row({ metric_id: "token.openai.gpt-4o.out", subject: "gpt-4o", provider: "openai", unit: "$/M-out", value: 8, source: "aipricing_guru", source_tier: 3 }),
    row({ metric_id: "gpu.h100.ondemand.azure.eastus", category: "B", subject: "h100", provider: "azure", pricing_mode: "ondemand", unit: "$/GPU-hr", value: 10, region: "eastus", source: "cloud_azure" }),
  ];
  const s = build(rows);
  const tpi = s.indexTiles.find((t) => t.id === "token_price_index")!;
  assertEquals(tpi.figure.state, "value");
  assertEquals(tpi.figure.value, 5);          // (2+8)/2
  assertEquals(tpi.figure.provenance, "constructed");
  assertEquals(s.indexTiles.find((t) => t.id === "gpu_rental_index")!.figure.value, 10);
  const fus = s.indexTiles.find((t) => t.id === "fusion")!;
  assertEquals(fus.figure.state, "license_pending");
  assertEquals(fus.emphasis, true);
});

Deno.test("futures: status mapping announced-pending -> pending; partner from source", () => {
  const rows: RawMetricRow[] = [
    row({ metric_id: "futures.cme.compute.status", category: "C", subject: "compute", provider: "CME", unit: "status", value: null, why_note: "status:announced-pending", source: "futures_cme", source_tier: 2 }),
  ];
  const s = build(rows);
  assertEquals(s.futures.length, 1);
  assertEquals(s.futures[0].status, "pending");
  assertEquals(s.futures[0].venue, "CME");
  assertEquals(s.futures[0].partner, "Silicon Data");
});

Deno.test("sources: tier + licenseStatus mapping; footnotes present", () => {
  const rows: RawMetricRow[] = [
    row({ metric_id: "index.idx_silicon_gpu", source: "idx_silicon_gpu", value: null, display_allowed: false }),
    row({ metric_id: "token.openai.x.in", subject: "x", provider: "openai", unit: "$/M-in", value: 1, source: "aipricing_guru", source_tier: 3 }),
  ];
  const s = build(rows);
  const idx = s.sources.find((x) => x.id === "idx_silicon_gpu")!;
  assertEquals(idx.tier, "T1");
  assertEquals(idx.licenseStatus, "pending");        // third-party index, not displayed
  assertEquals(s.sources.find((x) => x.id === "fusion_faraday")!.licenseStatus, "internal");
  assertEquals(s.sources.find((x) => x.id === "aipricing_guru")!.licenseStatus, "public");
  assert(s.footnotes.some((f) => f.id === "f_power_share"));
  assert(s.footnotes.some((f) => f.id === "f_nonus"));
});
