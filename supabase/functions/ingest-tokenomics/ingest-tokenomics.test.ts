// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — pure-module tests. No network, no DB.
// Run with:  deno test supabase/functions/ingest-tokenomics/
//
// Fixtures are captured-SHAPE payloads (the real API/render shapes), used to pin parser behavior.
// They are explicitly test inputs, NOT asserted market data.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildMetricId, num, toDate, contentHash, dedupeByHash, asStatus, type Metric } from "./metrics.ts";
import {
  parseAipricingGuru, parseVendorCapture, parseCapabilityCapture, parseAzureRetail,
  parseAwsOffers, parseNeocloudListing, buildFutures, defaultFutures, parseDemandCapture,
  parseIndexCapture,
} from "./adapters.ts";
import { NEOCLOUD_ROSTER, isValidPick5, DEFAULT_PICK5, allNeoclouds } from "./roster.ts";
import { REGION_GRID_MAP, resolveRegion, recentGpuMovePct, fusionMetrics } from "./fusion.ts";

const AS_OF = "2026-07-27";

// ── metrics helpers ─────────────────────────────────────────────────────────
Deno.test("buildMetricId slugifies and preserves in-segment hyphens", () => {
  assertEquals(buildMetricId("gpu", "H100", "ondemand", "AWS", "us-east-1"), "gpu.h100.ondemand.aws.us-east-1");
  assertEquals(buildMetricId("token", null, "GPT 4o", undefined, "in"), "token.gpt-4o.in");
});
Deno.test("num strips $ and commas; toDate validates", () => {
  assertEquals(num("$1,234.50"), 1234.5);
  assertEquals(num(""), null);
  assertEquals(num("n/a"), null);
  assertEquals(toDate("2026-07-27T10:00:00Z"), "2026-07-27");
  assertEquals(toDate("nope"), null);
});
Deno.test("contentHash changes with value, stable otherwise", async () => {
  const m: Metric = { metric_id: "x", category: "A", subject: null, provider: null, region: null,
    sku: null, pricing_mode: "list", value: 1, unit: "$/M-in", as_of: AS_OF, source: "s",
    source_tier: 1, source_url: null, confidence: "as-reported", display_allowed: true, why_note: null };
  const h1 = await contentHash(m);
  const h2 = await contentHash({ ...m, source_url: "https://changed", why_note: "x" }); // excluded from basis
  const h3 = await contentHash({ ...m, value: 2 });                                     // included
  assertEquals(h1, h2);
  assert(h1 !== h3);
});
Deno.test("dedupeByHash collapses identical readings (one figure, many citations)", async () => {
  const m: Metric = { metric_id: "x", category: "A", subject: null, provider: null, region: null,
    sku: null, pricing_mode: "list", value: 1, unit: "$/M-in", as_of: AS_OF, source: "s",
    source_tier: 1, source_url: "a", confidence: "as-reported", display_allowed: true, why_note: null };
  const { rows, duped } = await dedupeByHash([m, { ...m, source_url: "b" }, { ...m, value: 9 }]);
  assertEquals(rows.length, 2);
  assertEquals(duped, 1);
});

// ── roster ──────────────────────────────────────────────────────────────────
Deno.test("roster: 4 fixed + 6 candidates; default pick is a candidate", () => {
  assertEquals(NEOCLOUD_ROSTER.fixed.map((f) => f.key), ["coreweave", "lambda", "nebius", "crusoe"]);
  assertEquals(NEOCLOUD_ROSTER.candidates.length, 6);
  assert(isValidPick5(DEFAULT_PICK5));
  assert(!isValidPick5("coreweave"));   // fixed columns are not pickable
  assert(!isValidPick5("nope"));
  assertEquals(allNeoclouds().length, 10);
});

// ── A) token pricing ─────────────────────────────────────────────────────────
Deno.test("parseAipricingGuru emits in/out rows and honors row updated_at", () => {
  const payload = [
    { provider: "OpenAI", model: "gpt-4o", input_per_million: "2.50", output_per_million: "10.00", updated_at: "2026-07-20" },
    { vendor: "Anthropic", name: "claude-sonnet", input: 3, output: 15 },
  ];
  const rows = parseAipricingGuru(payload, AS_OF);
  assertEquals(rows.length, 4);
  const inRow = rows.find((r) => r.metric_id === "token.openai.gpt-4o.in")!;
  assertEquals(inRow.value, 2.5);
  assertEquals(inRow.unit, "$/M-in");
  assertEquals(inRow.as_of, "2026-07-20");
  assertEquals(inRow.source_tier, 3);
  assertEquals(rows.find((r) => r.metric_id === "token.anthropic.claude-sonnet.out")!.as_of, AS_OF);
});
Deno.test("parseVendorCapture tags tier-1 as-reported with capture as_of", () => {
  const rows = parseVendorCapture("vendor_anthropic", {
    vendor: "Anthropic", source_url: "https://anthropic.com/pricing", as_of: "2026-07-25",
    models: [{ model: "claude-opus", input_per_million: 15, output_per_million: 75 }],
  }, AS_OF);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].source, "vendor_anthropic");
  assertEquals(rows[0].confidence, "as-reported");
  assertEquals(rows[0].as_of, "2026-07-25");
});
Deno.test("parseCapabilityCapture emits quality + tps", () => {
  const rows = parseCapabilityCapture("artificial_analysis", {
    items: [{ model: "gpt-4o", quality_adj: 71, tokens_per_sec: 120 }],
  }, AS_OF);
  assertEquals(rows.map((r) => r.unit).sort(), ["index-level", "tokens/sec"]);
});

// ── B) gpu rental ─────────────────────────────────────────────────────────────
Deno.test("parseAzureRetail normalizes per-VM price to $/GPU-hr and classifies mode", () => {
  const payload = { Items: [
    { armSkuName: "Standard_ND96isr_H100_v5", productName: "ND96isr H100 v5", armRegionName: "eastus", retailPrice: 98.32, type: "Consumption", meterName: "ND96isr H100 v5" },
    { armSkuName: "Standard_ND96isr_H100_v5 Spot", productName: "ND96isr H100 v5", armRegionName: "eastus", retailPrice: 40, type: "Consumption", meterName: "ND96isr H100 v5 Spot" },
    { armSkuName: "irrelevant", productName: "D2s v3", armRegionName: "eastus", retailPrice: 0.1, type: "Consumption" },
  ] };
  const rows = parseAzureRetail(payload, AS_OF);
  assertEquals(rows.length, 2);                 // the non-GPU VM is skipped
  const od = rows.find((r) => r.pricing_mode === "ondemand")!;
  assertEquals(od.value, Math.round((98.32 / 8) * 1e4) / 1e4);
  assertEquals(od.unit, "$/GPU-hr");
  assertEquals(od.confidence, "verified");
  assert(rows.some((r) => r.pricing_mode === "spot"));
});
Deno.test("parseAwsOffers normalizes per-GPU and keeps purchase mode", () => {
  const rows = parseAwsOffers([
    { instanceType: "p5.48xlarge", region: "us-east-1", gpuClass: "h100", gpus: 8, pricePerHour: 98.32, purchaseMode: "ondemand" },
    { instanceType: "p5.48xlarge", region: "us-east-1", gpuClass: "h100", gpus: 8, pricePerHour: 55, purchaseMode: "reserved" },
  ], AS_OF);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].metric_id, "gpu.h100.ondemand.aws.us-east-1");
  assertEquals(rows[1].pricing_mode, "reserved");
});
Deno.test("parseNeocloudListing keys by provider", () => {
  const rows = parseNeocloudListing("together_ai", [{ gpu_class: "H100", value: "1.75" }], AS_OF, "https://together.ai/pricing");
  assertEquals(rows[0].metric_id, "gpu.h100.ondemand.together_ai.list");
  assertEquals(rows[0].value, 1.75);
  assertEquals(rows[0].source, "neocloud");
});

// ── C) futures — never a price for a non-tradeable instrument ───────────────────
Deno.test("buildFutures emits status only until trading; price only once trading", () => {
  const rows = buildFutures([
    { source: "futures_cme", venue: "CME", instrument: "compute", status: "announced-pending", price: 123 }, // price must be ignored
    { source: "futures_ice_ornn", venue: "ICE", instrument: "compute", status: "trading", price: 45.6, volume: 1000 },
  ], AS_OF);
  const pending = rows.filter((r) => r.provider === "CME");
  assertEquals(pending.length, 1);
  assertEquals(pending[0].unit, "status");
  assertEquals(pending[0].value, null);        // no price leaked for a non-tradeable instrument
  const trading = rows.filter((r) => r.provider === "ICE");
  assert(trading.some((r) => r.unit === "index-level" && r.value === 45.6));
  assert(trading.some((r) => r.unit === "contracts" && r.value === 1000));
  assert(trading.some((r) => r.unit === "status"));
});
Deno.test("defaultFutures are all non-trading (no prices)", () => {
  const rows = buildFutures(defaultFutures(), AS_OF);
  assert(rows.every((r) => r.unit === "status" && r.value === null));
});

// ── D) demand context + third-party indices display gate ────────────────────────
Deno.test("parseDemandCapture emits context rows with supplied unit", () => {
  const rows = parseDemandCapture({ source: "demand_iea", as_of: "2026-06-30",
    items: [{ subject: "dc-power-2030-twh", value: 945, unit: "TWh" }] }, AS_OF);
  assertEquals(rows[0].category, "D");
  assertEquals(rows[0].unit, "TWh");
  assertEquals(rows[0].as_of, "2026-06-30");
});
Deno.test("parseIndexCapture is ALWAYS display_allowed=false (ingest-only)", () => {
  const rows = parseIndexCapture({ source: "idx_tokenix_acpi", label: "ACPI", value: 102.4, category: "A" }, AS_OF);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].display_allowed, false);
  assert(rows[0].value !== null);              // value is STORED (internal tracking) ...
  assertEquals(rows[0].unit, "index-level");   // ... the API is what withholds it.
});

// ── fusion ──────────────────────────────────────────────────────────────────
Deno.test("region map resolves canonical + provider aliases", () => {
  assertEquals(resolveRegion("us-east-1")!.state_abbr, "VA");
  assertEquals(resolveRegion("eastus")!.iso_rto, "PJM");
  assertEquals(resolveRegion("southcentralus")!.state_abbr, "TX");
  assertEquals(resolveRegion("nope"), null);
  assert(Object.keys(REGION_GRID_MAP).length >= 10);
});
Deno.test("recentGpuMovePct compares latest distinct vs prior distinct", () => {
  assertEquals(recentGpuMovePct([{ value: 2.2, as_of: "b" }, { value: 2.0, as_of: "a" }]), 10);
  assertEquals(recentGpuMovePct([{ value: 2, as_of: "b" }, { value: 2, as_of: "a" }]), null); // no distinct prior
  assertEquals(recentGpuMovePct([{ value: 2, as_of: "a" }]), null);
});
Deno.test("fusionMetrics: null grid figures preserved; why_note only on coincident move", () => {
  const geo = REGION_GRID_MAP["us-east-1"];
  const fusion = { power_price_kwh: 0.086, interconnect_queue_depth_mw: 12000, interconnect_queue_entries: 40, time_to_power: "Facility Study" };
  const moved = fusionMetrics("us-east-1", geo, fusion, AS_OF, [{ value: 2.2, as_of: "b" }, { value: 2.0, as_of: "a" }]);
  const price = moved.find((r) => r.unit === "$/kWh")!;
  assert(price.why_note && price.why_note.includes("N. Virginia"));
  assert(price.why_note!.includes("PJM"));

  const flat = fusionMetrics("us-east-1", geo, fusion, AS_OF, [{ value: 2.0, as_of: "a" }]);
  assertEquals(flat.find((r) => r.unit === "$/kWh")!.why_note, null);

  const missing = fusionMetrics("us-east-1", geo, { power_price_kwh: null, interconnect_queue_depth_mw: null }, AS_OF, []);
  assertEquals(missing.find((r) => r.unit === "$/kWh")!.value, null); // gap explicit, not fabricated
});

// asStatus guardrail
Deno.test("asStatus forces value null + unit status", () => {
  const m = asStatus({ metric_id: "f.x.status", category: "C", subject: "x", provider: "CME",
    region: null, sku: null, pricing_mode: null, as_of: AS_OF, source: "futures_cme",
    source_tier: 2, source_url: null, confidence: "as-reported", display_allowed: true,
    why_note: null, status: "research" });
  assertEquals(m.value, null);
  assertEquals(m.unit, "status");
});
