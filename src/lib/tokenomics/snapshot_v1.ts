// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — TRANSFORM: raw tokenomics_metrics rows -> the front-end
// `ScoreboardSnapshot` contract (scoreboard-contract.ts). Pure; deno-testable. This is what makes
// the FE's `httpAdapter` a thin fetch: the backend returns exactly the shape the FE consumes.
//
// Invariants honored:
//   * Every number is a Figure. Missing value -> not_published (never a guessed number / bare dash).
//   * Display gate: display_allowed=false (licensed third-party index) -> license_pending, no value.
//   * Zero fabrication: non-US regions have no Faraday grid data -> fusion/power = not_published.
//   * timeToPowerMonths has no real source column -> not_published (study-phase is a label, not months).
//   * Derived figures (indices, implied power share) are provenance:"constructed" with a footnote.

import type { RawMetricRow, SourceRegistryRow } from "./types";
import {
  type ScoreboardSnapshot, type Figure, type DisplayState, type Provenance, type Provider,
  type ProviderId, type GpuRow, type RateCell, type TokenRow, type IndexTile, type FusionPanel,
  type FuturesChip, type Source, type Footnote, type RegionId, type ISODate,
  REGION_MODEL, REGION_IDS, ingestRegionToId,
} from "./scoreboard-contract";
import { NEOCLOUD_ROSTER } from "./roster";

// ── inputs the route gathers ──────────────────────────────────────────────────
export type FusionResult = {
  power_price_kwh: number | null;
  interconnect_queue_depth_mw?: number | null;
  time_to_power?: string | null;     // study-phase proxy (label, not months)
  as_of?: string | null;
};
export type AssembleV1Input = {
  rows: RawMetricRow[];                                   // freshest reading per metric (selected region-scoped)
  sourceRegistry: SourceRegistryRow[];
  fusionByRegion: Partial<Record<RegionId, FusionResult>>; // per-region grid fusion (US only)
  selectedRegion: RegionId;
  generatedAt: ISODate;
  lastIngestBySource?: Record<string, string>;
};

// GPU board power draw (kW per GPU) — documented assumptions for the implied-power-share derivation.
const GPU_KW: Record<string, number> = { h100: 0.7, h200: 0.7, b200: 1.0, gb200: 1.2 };

// Human cadence -> seconds (drives the FE's auto-stale). Defaults to daily.
function cadenceSec(cadence: string | undefined): number {
  switch ((cadence || "").toLowerCase()) {
    case "weekly": return 604800;
    case "quarterly": return 7776000;
    case "yearly": return 31536000;
    case "event": case "publisher": return 604800;
    default: return 86400; // daily
  }
}

function provFromConfidence(c: string | undefined): Provenance {
  return c === "unverified" ? "snippet" : "reported";
}

const FRONTIER_VENDORS = new Set(["openai", "anthropic", "google", "xai"]);

const HYPERSCALERS: { id: ProviderId; name: string; source: string }[] = [
  { id: "aws", name: "AWS", source: "cloud_aws" },
  { id: "azure", name: "Azure", source: "cloud_azure" },
  { id: "gcp", name: "GCP", source: "cloud_gcp" },
];

const FUTURES_PARTNER: Record<string, string> = {
  futures_cme: "Silicon Data", futures_ice_ornn: "Ornn",
  futures_ice_nativx: "NATIVX (COIL)", futures_shfe: "—",
};

// ── Figure builders ────────────────────────────────────────────────────────────
type FigOpts = {
  asOf?: string | null; source?: string | null; sourceRegistry?: Map<string, SourceRegistryRow>;
  provenance?: Provenance; precision?: number; footnoteIds?: string[];
  gatedState?: DisplayState;            // state to use when value is null (default not_published)
  displayAllowed?: boolean;             // false => license_pending regardless of value
};
function fig(value: number | null | undefined, unit: string, opts: FigOpts = {}): Figure {
  const src = opts.source ? opts.sourceRegistry?.get(opts.source) : undefined;
  const base: Figure = {
    state: "not_published", unit,
    ...(opts.source ? { sourceId: opts.source } : {}),
    ...(opts.footnoteIds ? { footnoteIds: opts.footnoteIds } : {}),
    ...(opts.precision !== undefined ? { precision: opts.precision } : {}),
  };
  if (opts.displayAllowed === false) return { ...base, state: "license_pending" };
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { ...base, state: opts.gatedState ?? "not_published" };
  }
  return {
    ...base, state: "value", value,
    ...(opts.asOf ? { asOf: opts.asOf } : {}),
    cadenceSec: cadenceSec(src?.cadence),
    provenance: opts.provenance ?? provFromConfidence(undefined),
  };
}

function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function assembleSnapshotV1(input: AssembleV1Input): ScoreboardSnapshot {
  const { rows, selectedRegion, generatedAt } = input;
  const regMap = new Map(input.sourceRegistry.map((r) => [r.source_key, r]));
  const seg = (id: string) => id.split(".");
  const last = input.lastIngestBySource ?? {};

  // ── providers ────────────────────────────────────────────────────────────────
  const providers: Provider[] = [
    ...HYPERSCALERS.map((h) => ({ id: h.id, name: h.name, group: "hyperscaler" as const, slot: "fixed" as const })),
    ...NEOCLOUD_ROSTER.fixed.map((p) => ({ id: p.key, name: p.label, group: "neocloud" as const, slot: "fixed" as const })),
    ...NEOCLOUD_ROSTER.candidates.map((p) => ({ id: p.key, name: p.label, group: "neocloud" as const, slot: "candidate" as const })),
  ];
  const providerIds = new Set(providers.map((p) => p.id));

  // ── GPU rows (Figure-wrapped, region-bucketed) ─────────────────────────────────
  const GPU_IDS: GpuRow["id"][] = ["h100", "h200", "b200", "gb200"];
  const GPU_LABEL: Record<string, string> = { h100: "H100", h200: "H200", b200: "B200", gb200: "GB200" };
  const gpuAcc: Record<string, Record<string, Partial<Record<"ondemand" | "reserved" | "spot", { v: number | null; asOf: string | null; source: string }>>>> = {};
  for (const r of rows) {
    if (!r.metric_id.startsWith("gpu.")) continue;
    const cls = r.subject ?? seg(r.metric_id)[1];
    const provider = r.provider ?? seg(r.metric_id)[3];
    if (!GPU_IDS.includes(cls as GpuRow["id"]) || !providerIds.has(provider)) continue;
    // Region bucket: neocloud list rows (region null) are global; hyperscaler rows must match region.
    const bucket = r.region === null ? selectedRegion : ingestRegionToId(r.region);
    if (r.region !== null && bucket !== selectedRegion) continue;
    const mode = r.pricing_mode === "list" ? "ondemand"
      : (r.pricing_mode === "committed" ? "reserved" : r.pricing_mode) as "ondemand" | "reserved" | "spot" | undefined;
    if (!mode) continue;
    gpuAcc[cls] ??= {}; gpuAcc[cls][provider] ??= {};
    if (!gpuAcc[cls][provider][mode]) gpuAcc[cls][provider][mode] = { v: r.value, asOf: r.as_of, source: r.source };
  }
  const gpuRows: GpuRow[] = GPU_IDS.map((id) => {
    const cells: Record<ProviderId, RateCell> = {};
    for (const p of providers) {
      const got = gpuAcc[id]?.[p.id] ?? {};
      const src = p.group === "hyperscaler" ? HYPERSCALERS.find((h) => h.id === p.id)!.source : "neocloud";
      const mk = (m: "ondemand" | "reserved" | "spot") =>
        fig(got[m]?.v ?? null, "$/GPU-hr", { asOf: got[m]?.asOf, source: got[m]?.source ?? src, sourceRegistry: regMap, precision: 2 });
      cells[p.id] = { onDemand: mk("ondemand"), reserved: mk("reserved"), spot: mk("spot") };
    }
    return { id, label: GPU_LABEL[id], cells };
  });

  // ── token rows ─────────────────────────────────────────────────────────────────
  const tokAcc = new Map<string, { vendor: string; model: string; in?: RawMetricRow; out?: RawMetricRow; qa?: RawMetricRow; tps?: RawMetricRow }>();
  for (const r of rows) {
    if (!r.metric_id.startsWith("token.")) continue;
    const parts = seg(r.metric_id);
    const vendor = parts[1] ?? "";
    const model = r.subject ?? parts.slice(2, -1).join(".");
    const key = `${vendor}.${model}`;
    const cur = tokAcc.get(key) ?? { vendor, model };
    if (r.unit === "$/M-in") cur.in = r;
    else if (r.unit === "$/M-out") cur.out = r;
    else if (r.unit === "tokens/sec") cur.tps = r;
    else if (r.unit === "index-level") cur.qa = r; // token.*.qualityadj
    tokAcc.set(key, cur);
  }
  const tokenRows: TokenRow[] = [...tokAcc.entries()].map(([id, t]): TokenRow => ({
    id, vendor: t.vendor, model: t.model,
    tier: FRONTIER_VENDORS.has(t.vendor) ? "frontier" : "commodity",
    inputPerM: fig(t.in?.value ?? null, "$/M tok", { asOf: t.in?.as_of, source: t.in?.source, sourceRegistry: regMap, provenance: provFromConfidence(t.in?.confidence), displayAllowed: t.in?.display_allowed }),
    outputPerM: fig(t.out?.value ?? null, "$/M tok", { asOf: t.out?.as_of, source: t.out?.source, sourceRegistry: regMap, provenance: provFromConfidence(t.out?.confidence), displayAllowed: t.out?.display_allowed }),
    qualityAdjusted: fig(t.qa?.value ?? null, "$/capability", { asOf: t.qa?.as_of, source: t.qa?.source, sourceRegistry: regMap, provenance: provFromConfidence(t.qa?.confidence), displayAllowed: t.qa?.display_allowed }),
    throughputTps: fig(t.tps?.value ?? null, "tok/s", { asOf: t.tps?.as_of, source: t.tps?.source, sourceRegistry: regMap, provenance: provFromConfidence(t.tps?.confidence), displayAllowed: t.tps?.display_allowed }),
  })).sort((a, b) => (a.vendor + a.model).localeCompare(b.vendor + b.model));

  // ── fusion panel (selected region) ───────────────────────────────────────────
  const geo = REGION_MODEL[selectedRegion];
  const f = input.fusionByRegion[selectedRegion];
  const powerKwh = geo.state_abbr ? (f?.power_price_kwh ?? null) : null;      // non-US => null
  const queueMw = geo.state_abbr ? (f?.interconnect_queue_depth_mw ?? null) : null;
  // implied power share = median H100 board draw × $/kWh ÷ median H100 on-demand $/GPU-hr
  const h100OnDemand = median(
    Object.values(gpuAcc["h100"] ?? {}).map((m) => m.ondemand?.v).filter((v): v is number => v != null),
  );
  const impliedShare = (powerKwh != null && h100OnDemand != null && h100OnDemand > 0)
    ? Math.round(((GPU_KW.h100 * powerKwh) / h100OnDemand) * 1000) / 10 : null;
  const fusion: FusionPanel = {
    region: selectedRegion,
    powerPrice: fig(powerKwh, "$/kWh", { asOf: f?.as_of, source: "fusion_faraday", sourceRegistry: regMap, provenance: "reported", precision: 4, footnoteIds: geo.state_abbr ? undefined : ["f_nonus"] }),
    impliedPowerSharePct: fig(impliedShare, "%", { asOf: f?.as_of, source: "fusion_faraday", sourceRegistry: regMap, provenance: "constructed", precision: 1, footnoteIds: ["f_power_share"] }),
    queueDepthGw: fig(queueMw != null ? Math.round((queueMw / 1000) * 100) / 100 : null, "GW", { asOf: f?.as_of, source: "fusion_faraday", sourceRegistry: regMap, provenance: "reported", precision: 2, footnoteIds: geo.state_abbr ? undefined : ["f_nonus"] }),
    // No real months column — study phase is a label, not a lead time. Never fabricated.
    timeToPowerMonths: fig(null, "months", { source: "fusion_faraday", sourceRegistry: regMap, footnoteIds: ["f_ttp"] }),
    whyItMoved: {
      headline: "[placeholder] Grid signal vs. compute price",
      body: f?.time_to_power
        ? `[placeholder] Deepest interconnection study phase in ${geo.label}: ${f.time_to_power}. Editorial note pending.`
        : "[placeholder] Editorial 'why it moved' note pending.",
      author: "Faraday Desk", asOf: (f?.as_of ?? generatedAt), placeholder: true,
    },
  };

  // ── index tiles (Faraday-derived / constructed; fusion tile = license_pending per locked scope) ──
  const tokenBlend = median(tokenRows.flatMap((t) =>
    (t.inputPerM.state === "value" && t.outputPerM.state === "value")
      ? [((t.inputPerM.value! + t.outputPerM.value!) / 2)] : []));
  const gpuIndex = h100OnDemand;
  const qaMedian = median(tokenRows.flatMap((t) => t.qualityAdjusted.state === "value" ? [t.qualityAdjusted.value!] : []));
  const indexTiles: IndexTile[] = [
    { id: "token_price_index", label: "Token Price Index",
      figure: fig(tokenBlend, "index", { source: "aipricing_guru", sourceRegistry: regMap, provenance: "constructed", precision: 2, footnoteIds: ["f_constructed"] }) },
    { id: "gpu_rental_index", label: "GPU Rental Index",
      figure: fig(gpuIndex, "index", { source: "cloud_azure", sourceRegistry: regMap, provenance: "constructed", precision: 2, footnoteIds: ["f_constructed"] }) },
    { id: "quality_adjusted", label: "Quality-Adjusted $/Capability",
      figure: fig(qaMedian, "index", { source: "artificial_analysis", sourceRegistry: regMap, provenance: "constructed", precision: 2, footnoteIds: ["f_constructed"] }) },
    // Locked scope: the Fusion headline tile renders license-pending in this build (real fusion data
    // lives in the Fusion panel above). Third-party fusion indices are ingest-only.
    { id: "fusion", label: "Fusion", emphasis: true,
      figure: fig(null, "index", { source: "idx_silicon_gpu", sourceRegistry: regMap, displayAllowed: false, footnoteIds: ["f_indices"] }) },
  ];

  // ── futures chips ────────────────────────────────────────────────────────────
  const futAcc = new Map<string, { venue: string; instrument: string; source: string; status: string; asOf: string | null }>();
  for (const r of rows) {
    if (!r.metric_id.startsWith("futures.")) continue;
    const key = `${r.provider}.${r.subject}`;
    const cur = futAcc.get(key) ?? { venue: r.provider ?? seg(r.metric_id)[1], instrument: r.subject ?? seg(r.metric_id)[2], source: r.source, status: "research", asOf: r.as_of };
    if (r.unit === "status") { cur.status = (r.why_note ?? "").replace(/^status:/, "") || cur.status; cur.asOf = r.as_of; }
    futAcc.set(key, cur);
  }
  const statusMap: Record<string, FuturesChip["status"]> = { "trading": "trading", "announced-pending": "pending", "pending": "pending", "research": "research" };
  const futures: FuturesChip[] = [...futAcc.values()].map((x, i) => ({
    id: `fut${i + 1}`, venue: x.venue, partner: FUTURES_PARTNER[x.source] ?? "—",
    status: statusMap[x.status] ?? "research", asOf: x.asOf ?? generatedAt,
  })).sort((a, b) => (a.venue + a.partner).localeCompare(b.venue + b.partner));

  // ── regions[] (all regions; powerPrice per region) ───────────────────────────
  const regions = REGION_IDS.map((id) => {
    const g = REGION_MODEL[id]; const rf = input.fusionByRegion[id];
    return {
      id, label: g.label,
      powerPrice: fig(g.state_abbr ? (rf?.power_price_kwh ?? null) : null, "$/kWh",
        { asOf: rf?.as_of, source: "fusion_faraday", sourceRegistry: regMap, provenance: "reported", precision: 4,
          footnoteIds: g.state_abbr ? undefined : ["f_nonus"] }),
    };
  });

  // ── sources ──────────────────────────────────────────────────────────────────
  const presentSources = new Set(rows.map((r) => r.source));
  presentSources.add("fusion_faraday");
  const sources: Source[] = [...presentSources].map((key) => {
    const m = regMap.get(key);
    const licenseStatus: Source["licenseStatus"] = !m ? "internal"
      : m.is_third_party_index ? (m.display_allowed ? "licensed" : "pending")
      : /^fusion|^demand/.test(key) ? "internal" : "public";
    return {
      id: key, name: m?.label ?? key, tier: (`T${m?.tier ?? 3}` as Source["tier"]),
      cadence: m?.cadence ?? "daily", licenseStatus,
      ...(last[key] ? { lastIngest: last[key] } : {}),
      ...(m?.attribution ? { note: `attribution: ${m.attribution}` } : {}),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // ── footnotes ──────────────────────────────────────────────────────────────────
  const footnotes: Footnote[] = [
    { id: "f_stale", marker: "⚑", text: "Stale is computed from as-of + cadence, not authored: a figure is stale when now − asOf > cadence × 1.5." },
    { id: "f_power_share", marker: "1", text: "Implied power share = assumed GPU board draw (kW) × regional $/kWh ÷ on-demand $/GPU-hr. Draw assumptions: H100/H200 0.7 kW, B200 1.0 kW, GB200 1.2 kW per GPU." },
    { id: "f_ttp", marker: "2", text: "Time-to-power in months is not published: Faraday's grid data exposes the deepest interconnection study phase (a label), not a lead-time estimate. Shown as not published rather than fabricated." },
    { id: "f_nonus", marker: "3", text: "Fusion power price and interconnection queue are US-only (EIA utility territories + FERC queue). EU/Nordics/Middle-East regions show 'not published' pending non-US grid sources." },
    { id: "f_constructed", marker: "4", text: "Index tiles are Faraday-derived (constructed) baskets over ingested readings, not third-party indices." },
    { id: "f_indices", marker: "5", text: "Third-party constructed indices (Ornn/OCPI, Tokenix/ACPI, TPI, Epoch/AA, Silicon Data) are ingest-only — display pending licensing sign-off." },
  ];

  return {
    schemaVersion: "1.0", generatedAt, regions, selectedRegion, providers,
    indexTiles, tokenRows, gpuRows, fusion, futures, sources, footnotes,
  };
}
