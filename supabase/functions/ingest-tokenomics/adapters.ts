// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — per-source adapters for groups A/B/C/D.
//
// Zero-fabrication contract: every adapter's PARSE step is a pure function over a payload the
// source actually returned (unit-tested with captured fixtures). A 403'd / empty / unpublished
// source yields NOTHING (logged "not published"), never a guessed value. Semi-manual (403-prone)
// vendor pages flow their rendered capture through the same parser via the request body so an
// as-of + confidence='as-reported' is always attached.
//
// Adapter statuses:
//   live                        — public endpoint fetched on cadence.
//   manual_capture              — 403-prone / licensed; ingested from a POSTed rendered capture.
//   pending_source_confirmation — endpoint/field-map or key not yet confirmed (no-op, logged).

import {
  type Metric, type Category, type PricingMode, type Confidence,
  buildMetricId, num, toDate, asStatus,
} from "./metrics.ts";
import { allNeoclouds } from "./roster.ts";

export type AdapterStatus = "live" | "manual_capture" | "pending_source_confirmation";

export type Adapter = {
  source: string;                 // source_key (matches tokenomics_source_registry)
  category: Category;
  status: AdapterStatus;
  note?: string;
  // live adapters implement fetch(); manual_capture adapters implement parse() over a supplied payload.
  fetchLive?: (asOf: string) => Promise<Metric[]>;
  parseCapture?: (payload: unknown, asOf: string) => Metric[];
};

// ─────────────────────────────────────────────────────────────────────────────
// A) TOKEN / INFERENCE PRICING
// ─────────────────────────────────────────────────────────────────────────────

// Commodity cross-vendor feed: aipricing.guru /api/pricing.json (public JSON, tier 3).
// Expected row shape (defensive to key drift): { provider, model, input_per_million|input,
// output_per_million|output, updated_at? }.  Prices are $/M tokens.
export function parseAipricingGuru(payload: unknown, asOf: string): Metric[] {
  const rows = Array.isArray(payload) ? payload
    : (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data))
      ? (payload as { data: unknown[] }).data : [];
  const out: Metric[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const provider = String(r.provider ?? r.vendor ?? "").trim() || null;
    const model = String(r.model ?? r.name ?? "").trim() || null;
    if (!model) continue;
    const inP = num(r.input_per_million ?? r.input ?? r.prompt);
    const outP = num(r.output_per_million ?? r.output ?? r.completion);
    const rowAsOf = toDate(r.updated_at) ?? asOf;
    const base = {
      category: "A" as Category, subject: model, provider, region: null, sku: model,
      pricing_mode: "list" as PricingMode, as_of: rowAsOf,
      source: "aipricing_guru", source_tier: 3 as const,
      source_url: "https://aipricing.guru/api/pricing.json",
      confidence: "as-reported" as Confidence, display_allowed: true, why_note: null,
    };
    if (inP !== null) out.push({ ...base, metric_id: buildMetricId("token", provider ?? "x", model, "in"), value: inP, unit: "$/M-in" });
    if (outP !== null) out.push({ ...base, metric_id: buildMetricId("token", provider ?? "x", model, "out"), value: outP, unit: "$/M-out" });
  }
  return out;
}

// Frontier vendor list pricing (OpenAI/Anthropic/Google/xAI). 403-prone → rendered/semi-manual.
// Capture shape: { vendor, source_url?, as_of?, models:[{model, input_per_million, output_per_million}] }.
export function parseVendorCapture(source: string, payload: unknown, asOf: string): Metric[] {
  const p = (payload ?? {}) as { vendor?: string; source_url?: string; as_of?: string; models?: Record<string, unknown>[] };
  const vendor = String(p.vendor ?? "").trim() || null;
  const rowAsOf = toDate(p.as_of) ?? asOf;
  const out: Metric[] = [];
  for (const m of p.models ?? []) {
    const model = String(m.model ?? "").trim();
    if (!model) continue;
    const inP = num(m.input_per_million);
    const outP = num(m.output_per_million);
    const base = {
      category: "A" as Category, subject: model, provider: vendor, region: null, sku: model,
      pricing_mode: "list" as PricingMode, as_of: rowAsOf, source, source_tier: 1 as const,
      source_url: p.source_url ?? null, confidence: "as-reported" as Confidence,
      display_allowed: true, why_note: null,
    };
    if (inP !== null) out.push({ ...base, metric_id: buildMetricId("token", vendor ?? source, model, "in"), value: inP, unit: "$/M-in" });
    if (outP !== null) out.push({ ...base, metric_id: buildMetricId("token", vendor ?? source, model, "out"), value: outP, unit: "$/M-out" });
  }
  return out;
}

// Quality-adjusted / throughput publishers (Epoch AI, Artificial Analysis).
// Capture shape: { source_url?, as_of?, items:[{model, quality_adj?, tokens_per_sec?}] }.
export function parseCapabilityCapture(source: string, payload: unknown, asOf: string): Metric[] {
  const p = (payload ?? {}) as { source_url?: string; as_of?: string; items?: Record<string, unknown>[] };
  const rowAsOf = toDate(p.as_of) ?? asOf;
  const attribution = source === "epoch_ai" ? "Epoch AI" : "Artificial Analysis";
  const out: Metric[] = [];
  for (const it of p.items ?? []) {
    const model = String(it.model ?? "").trim();
    if (!model) continue;
    const base = {
      category: "A" as Category, subject: model, provider: attribution, region: null, sku: model,
      pricing_mode: null as PricingMode, as_of: rowAsOf, source, source_tier: 1 as const,
      source_url: p.source_url ?? null, confidence: "as-reported" as Confidence,
      display_allowed: true, why_note: null,
    };
    const q = num(it.quality_adj);
    const tps = num(it.tokens_per_sec);
    if (q !== null) out.push({ ...base, metric_id: buildMetricId("token", source, model, "qualityadj"), value: q, unit: "index-level" });
    if (tps !== null) out.push({ ...base, metric_id: buildMetricId("token", source, model, "tps"), value: tps, unit: "tokens/sec" });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// B) GPU RENTAL
// ─────────────────────────────────────────────────────────────────────────────

// Azure Retail Prices API — genuinely public/keyless. https://prices.azure.com/api/retail/prices
// Filters to ND-series GPU VMs. Maps meterName/skuName -> gpu_class, retailPrice -> $/GPU-hr
// (Azure prices are per-VM; per-GPU normalization uses the VM's GPU count).
const AZURE_ND_GPU_COUNT: Record<string, { gpu_class: string; gpus: number }> = {
  "ND96isr H100 v5": { gpu_class: "h100", gpus: 8 },
  "ND96isr H200 v5": { gpu_class: "h200", gpus: 8 },
  "ND GB200 v6":     { gpu_class: "gb200", gpus: 4 },
};
export function parseAzureRetail(payload: unknown, asOf: string): Metric[] {
  const items = (payload && typeof payload === "object" && Array.isArray((payload as { Items?: unknown[] }).Items))
    ? (payload as { Items: Record<string, unknown>[] }).Items : [];
  const out: Metric[] = [];
  for (const it of items) {
    const skuName = String(it.armSkuName ?? it.skuName ?? "");
    const productName = String(it.productName ?? "");
    const match = Object.entries(AZURE_ND_GPU_COUNT).find(([k]) => skuName.includes(k) || productName.includes(k));
    if (!match) continue;
    const [, { gpu_class, gpus }] = match;
    const perVm = num(it.retailPrice);
    if (perVm === null || gpus <= 0) continue;
    const region = String(it.armRegionName ?? it.location ?? "").trim() || null;
    const type = String(it.type ?? "Consumption");            // Consumption | Reservation
    const isSpot = /spot/i.test(skuName) || /spot/i.test(String(it.meterName ?? ""));
    const mode: PricingMode = isSpot ? "spot" : type === "Reservation" ? "reserved" : "ondemand";
    out.push({
      metric_id: buildMetricId("gpu", gpu_class, mode, "azure", region ?? "global"),
      category: "B", subject: gpu_class, provider: "azure", region, sku: skuName || null,
      pricing_mode: mode, value: Math.round((perVm / gpus) * 1e4) / 1e4, unit: "$/GPU-hr",
      as_of: asOf, source: "cloud_azure", source_tier: 1,
      source_url: "https://prices.azure.com/api/retail/prices",
      confidence: "verified", display_allowed: true, why_note: null,
    });
  }
  return out;
}

// AWS EC2 GPU — normalized-offer intake (the Price List bulk JSON is mapped upstream to this shape
// by fetchLive; the parser is what tests pin). Offer: { instanceType, region, gpuClass, gpus,
// pricePerHour, purchaseMode }.
export function parseAwsOffers(offers: unknown, asOf: string): Metric[] {
  const rows = Array.isArray(offers) ? offers as Record<string, unknown>[] : [];
  const out: Metric[] = [];
  for (const o of rows) {
    const gpuClass = String(o.gpuClass ?? "").trim();
    const price = num(o.pricePerHour);
    const gpus = num(o.gpus) ?? 1;
    if (!gpuClass || price === null || gpus <= 0) continue;
    const region = String(o.region ?? "").trim() || null;
    const mode = (String(o.purchaseMode ?? "ondemand") as PricingMode);
    out.push({
      metric_id: buildMetricId("gpu", gpuClass, mode ?? "ondemand", "aws", region ?? "global"),
      category: "B", subject: gpuClass, provider: "aws", region,
      sku: String(o.instanceType ?? "") || null, pricing_mode: mode,
      value: Math.round((price / gpus) * 1e4) / 1e4, unit: "$/GPU-hr",
      as_of: asOf, source: "cloud_aws", source_tier: 1,
      source_url: "https://aws.amazon.com/ec2/pricing/", confidence: "verified",
      display_allowed: true, why_note: null,
    });
  }
  return out;
}

// Neocloud on-demand $/GPU-hr — normalized listing intake, one call per provider.
// listing: [{ gpu_class, value, pricing_mode? }]. provider is a roster key.
export function parseNeocloudListing(provider: string, listing: unknown, asOf: string, sourceUrl: string | null): Metric[] {
  const rows = Array.isArray(listing) ? listing as Record<string, unknown>[] : [];
  const out: Metric[] = [];
  for (const r of rows) {
    const gpu = String(r.gpu_class ?? "").trim().toLowerCase();
    const v = num(r.value ?? r.price ?? r.usd_per_gpu_hr);
    if (!gpu || v === null) continue;
    const mode = (String(r.pricing_mode ?? "ondemand") as PricingMode);
    out.push({
      metric_id: buildMetricId("gpu", gpu, mode ?? "ondemand", provider, "list"),
      category: "B", subject: gpu, provider, region: null, sku: null, pricing_mode: mode,
      value: v, unit: "$/GPU-hr", as_of: asOf, source: "neocloud", source_tier: 2,
      source_url: sourceUrl, confidence: "as-reported", display_allowed: true, why_note: null,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// C) FUTURES MARKET — status; a PRICE is emitted ONLY when status === 'trading' and a price is
// actually supplied. Never render a price for a non-tradeable instrument.
// ─────────────────────────────────────────────────────────────────────────────

export type FuturesInstrument = {
  source: string; venue: string; instrument: string;
  status: "research" | "announced-pending" | "trading";
  price?: number | null; volume?: number | null; source_url?: string | null;
};
export function buildFutures(instruments: FuturesInstrument[], asOf: string): Metric[] {
  const out: Metric[] = [];
  for (const f of instruments) {
    const idBase = buildMetricId("futures", f.venue, f.instrument);
    const common = {
      category: "C" as Category, subject: f.instrument, provider: f.venue, region: null,
      sku: null, as_of: asOf, source: f.source, source_tier: 2 as const,
      source_url: f.source_url ?? null, confidence: "as-reported" as Confidence,
      display_allowed: true,
    };
    // Always record the status reading.
    out.push(asStatus({ ...common, metric_id: buildMetricId(idBase, "status"), pricing_mode: null, status: f.status, why_note: `status:${f.status}` }));
    // Price ONLY once trading AND a real price is present.
    if (f.status === "trading" && num(f.price) !== null) {
      out.push({ ...common, metric_id: buildMetricId(idBase, "price"), pricing_mode: null,
        value: num(f.price), unit: "index-level", why_note: null });
      if (num(f.volume) !== null) {
        out.push({ ...common, metric_id: buildMetricId(idBase, "volume"), pricing_mode: null,
          value: num(f.volume), unit: "contracts", why_note: null });
      }
    }
  }
  return out;
}

// The tracked futures map (status maintained here; flips to 'trading' + price via a capture when an
// instrument actually lists). As-of stamped at ingest.
export function defaultFutures(): FuturesInstrument[] {
  return [
    { source: "futures_cme",        venue: "CME",  instrument: "compute-x-silicondata", status: "announced-pending" },
    { source: "futures_ice_ornn",   venue: "ICE",  instrument: "compute-x-ornn",        status: "research" },
    { source: "futures_ice_nativx", venue: "ICE",  instrument: "compute-x-nativx-coil", status: "research" },
    { source: "futures_shfe",       venue: "SHFE", instrument: "compute",               status: "research" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// D) DEMAND-SIDE CONTEXT — capture intake for forecasts / disclosures.
// capture: { source, source_url?, as_of?, items:[{subject, value, unit}] }
// ─────────────────────────────────────────────────────────────────────────────
export function parseDemandCapture(payload: unknown, asOf: string): Metric[] {
  const p = (payload ?? {}) as { source?: string; source_url?: string; as_of?: string; items?: Record<string, unknown>[] };
  const source = String(p.source ?? "").trim();
  if (!source) return [];
  const rowAsOf = toDate(p.as_of) ?? asOf;
  const out: Metric[] = [];
  for (const it of p.items ?? []) {
    const subject = String(it.subject ?? "").trim();
    const v = num(it.value);
    const unit = String(it.unit ?? "").trim();
    if (!subject || v === null || !unit) continue;
    out.push({
      metric_id: buildMetricId("demand", source, subject), category: "D", subject,
      provider: source, region: (it.region ? String(it.region) : null), sku: null,
      pricing_mode: null, value: v, unit, as_of: rowAsOf, source, source_tier: 1,
      source_url: p.source_url ?? null, confidence: "as-reported", display_allowed: true, why_note: null,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// THIRD-PARTY CONSTRUCTED INDICES (A & B) — INGEST-ONLY. display_allowed=false ALWAYS.
// LOCKED SCOPE DECISION #2: ingest the value for internal tracking; the snapshot API withholds it.
// capture: { source, source_url?, as_of?, label?, value }
// ─────────────────────────────────────────────────────────────────────────────
export function parseIndexCapture(payload: unknown, asOf: string): Metric[] {
  const p = (payload ?? {}) as { source?: string; source_url?: string; as_of?: string; label?: string; value?: unknown; category?: string };
  const source = String(p.source ?? "").trim();
  const v = num(p.value);
  if (!source || v === null) return [];
  const category = (p.category === "B" ? "B" : "A") as Category;
  return [{
    metric_id: buildMetricId("index", source), category, subject: p.label ?? source,
    provider: source, region: null, sku: null, pricing_mode: null,
    value: v,                      // stored for internal tracking...
    unit: "index-level", as_of: toDate(p.as_of) ?? asOf, source, source_tier: 1,
    source_url: p.source_url ?? null, confidence: "as-reported",
    display_allowed: false,        // ...but NEVER displayed until per-source gate flips + licensing.
    why_note: null,
  }];
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE FETCHERS (guarded; a non-OK response yields [] = "not published", never a guess)
// ─────────────────────────────────────────────────────────────────────────────
async function safeJson(url: string, headers: Record<string, string> = {}): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchAzureLive(asOf: string): Promise<Metric[]> {
  // Query ND-series consumption + reservation prices (US regions), paging via nextPageLink.
  const base = "https://prices.azure.com/api/retail/prices?currencyCode=USD"
    + "&$filter=" + encodeURIComponent("serviceName eq 'Virtual Machines' and contains(armSkuName,'ND')");
  const all: Metric[] = [];
  let url: string | null = base;
  let pages = 0;
  while (url && pages < 6) {
    const j = await safeJson(url) as { Items?: unknown[]; NextPageLink?: string } | null;
    if (!j) break;
    all.push(...parseAzureRetail(j, asOf));
    url = j.NextPageLink ?? null;
    pages++;
  }
  return all;
}

async function fetchAipricingLive(asOf: string): Promise<Metric[]> {
  const j = await safeJson("https://aipricing.guru/api/pricing.json");
  return j ? parseAipricingGuru(j, asOf) : [];
}

// Registry of adapters the orchestrator iterates. Only 'live' ones fetch on cadence; the rest are
// no-ops until a capture is POSTed (manual_capture) or an endpoint/key is confirmed (pending).
export function buildAdapters(): Adapter[] {
  return [
    // A
    { source: "aipricing_guru", category: "A", status: "live", fetchLive: fetchAipricingLive },
    { source: "vendor_openai",    category: "A", status: "manual_capture", parseCapture: (p, a) => parseVendorCapture("vendor_openai", p, a),    note: "403-prone; POST rendered capture." },
    { source: "vendor_anthropic", category: "A", status: "manual_capture", parseCapture: (p, a) => parseVendorCapture("vendor_anthropic", p, a), note: "403-prone; POST rendered capture." },
    { source: "vendor_google",    category: "A", status: "manual_capture", parseCapture: (p, a) => parseVendorCapture("vendor_google", p, a),    note: "403-prone; POST rendered capture." },
    { source: "vendor_xai",       category: "A", status: "manual_capture", parseCapture: (p, a) => parseVendorCapture("vendor_xai", p, a),       note: "403-prone; POST rendered capture." },
    { source: "epoch_ai",            category: "A", status: "manual_capture", parseCapture: (p, a) => parseCapabilityCapture("epoch_ai", p, a) },
    { source: "artificial_analysis", category: "A", status: "manual_capture", parseCapture: (p, a) => parseCapabilityCapture("artificial_analysis", p, a) },
    { source: "idx_tokenix_acpi",   category: "A", status: "manual_capture", parseCapture: parseIndexCapture, note: "INGEST-ONLY; display_allowed=false." },
    { source: "idx_tpi",            category: "A", status: "manual_capture", parseCapture: parseIndexCapture, note: "INGEST-ONLY; display_allowed=false." },
    { source: "idx_ornn_otpi",      category: "A", status: "manual_capture", parseCapture: parseIndexCapture, note: "INGEST-ONLY; display_allowed=false." },
    { source: "idx_silicon_sdlltk", category: "A", status: "manual_capture", parseCapture: parseIndexCapture, note: "INGEST-ONLY; display_allowed=false." },
    // B
    { source: "cloud_azure", category: "B", status: "live", fetchLive: fetchAzureLive },
    { source: "cloud_aws",   category: "B", status: "pending_source_confirmation", parseCapture: parseAwsOffers, note: "Price List bulk JSON -> normalized offers; confirm region set + SKU->gpuClass map." },
    { source: "cloud_gcp",   category: "B", status: "pending_source_confirmation", note: "Cloud Billing Catalog API needs CLOUD_BILLING_API_KEY; confirm SKU map." },
    { source: "neocloud",    category: "B", status: "pending_source_confirmation", note: "Per-provider listings -> parseNeocloudListing; confirm each roster provider's pricing endpoint." },
    { source: "idx_silicon_gpu", category: "B", status: "manual_capture", parseCapture: parseIndexCapture, note: "INGEST-ONLY; display_allowed=false." },
    { source: "idx_ornn_ocpi",   category: "B", status: "manual_capture", parseCapture: parseIndexCapture, note: "INGEST-ONLY; display_allowed=false." },
    // C — status built from the tracked map every run (event/monthly cadence).
    { source: "futures_cme",        category: "C", status: "live", fetchLive: async (a) => buildFutures(defaultFutures().filter(f => f.source === "futures_cme"), a) },
    { source: "futures_ice_ornn",   category: "C", status: "live", fetchLive: async (a) => buildFutures(defaultFutures().filter(f => f.source === "futures_ice_ornn"), a) },
    { source: "futures_ice_nativx", category: "C", status: "live", fetchLive: async (a) => buildFutures(defaultFutures().filter(f => f.source === "futures_ice_nativx"), a) },
    { source: "futures_shfe",       category: "C", status: "live", fetchLive: async (a) => buildFutures(defaultFutures().filter(f => f.source === "futures_shfe"), a) },
    // D — context captures (fusion is computed by the orchestrator via RPC, not an adapter).
    { source: "demand_iea",          category: "D", status: "manual_capture", parseCapture: parseDemandCapture },
    { source: "demand_goldman",      category: "D", status: "manual_capture", parseCapture: parseDemandCapture },
    { source: "demand_morganstanley",category: "D", status: "manual_capture", parseCapture: parseDemandCapture },
    { source: "demand_mix",          category: "D", status: "manual_capture", parseCapture: parseDemandCapture },
    { source: "demand_hyperscaler",  category: "D", status: "manual_capture", parseCapture: parseDemandCapture },
  ];
}

// Expose the neocloud provider list for the orchestrator/docs.
export const NEOCLOUD_KEYS = allNeoclouds().map((p) => p.key);
