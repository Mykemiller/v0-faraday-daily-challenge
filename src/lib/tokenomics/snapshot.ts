// SUPERSEDED (kept as the reference implementation of the original backend-prompt contract).
// The PUBLIC API now serves the front-end `ScoreboardSnapshot` contract via snapshot_v1.ts +
// server.ts (see docs/tokenomics-scoreboard/DATA-MAP.md). This assembler and its shape in types.ts
// are no longer wired to a route; retained for reference/tests. Prefer snapshot_v1.ts.
//
// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — snapshot assembler (pure). Turns raw display-gated metric
// rows + the source registry into the typed scoreboard_snapshot. Routing is by metric_id prefix:
//   token.*   -> tokens (in/out/quality_adj/tps)     gpu.*    -> gpus (per gpu_class, per provider)
//   index.*   -> indices (VALUE WITHHELD if gated)    futures.*-> futures (status; price iff trading)
//   demand.fusion.<region>.* -> fusion block
//
// DISPLAY GATE: rows arrive already gated by fn_tokenomics_snapshot_rows (value nulled when
// display_allowed=false). This assembler additionally attaches the "licensed source — display
// pending" placeholder + label + as-of + source so a gated index still returns existence, never a
// value. It NEVER un-nulls a value.

import {
  type RawMetricRow, type SourceRegistryRow, type ScoreboardSnapshot, type IndexCell,
  type TokenRow, type GpuClassRow, type GpuCell, type FusionBlock, type FuturesRow, type Footnote,
  type Tier, type Confidence, DISPLAY_PENDING_PLACEHOLDER,
} from "./types";
import { rosterForSnapshot } from "./roster";
import { REGION_GRID_MAP } from "./fusion";

export type AssembleOpts = {
  region: string;
  as_of: string;
  sourceRegistry: SourceRegistryRow[];
  timeToPower?: string | null;   // from fn_scoreboard_fusion (not a metric row); optional
  sparks?: Record<string, { as_of: string; value: number }[]>; // metric_id -> sparkline points
};

function reg(map: Map<string, SourceRegistryRow>, source: string) {
  return map.get(source);
}

export function assembleSnapshot(rows: RawMetricRow[], opts: AssembleOpts): ScoreboardSnapshot {
  const regMap = new Map(opts.sourceRegistry.map((r) => [r.source_key, r]));
  const seg = (id: string) => id.split(".");

  // ── indices ────────────────────────────────────────────────────────────────
  const indices: IndexCell[] = rows
    .filter((r) => r.metric_id.startsWith("index."))
    .map((r) => {
      const meta = reg(regMap, r.source);
      const gated = !r.display_allowed;
      return {
        metric_id: r.metric_id,
        label: meta?.label ?? r.subject ?? r.source,
        value: gated ? null : r.value,       // never emit a gated value
        unit: r.unit,
        delta_7d: gated ? null : (r.delta_7d ?? null),
        delta_30d: gated ? null : (r.delta_30d ?? null),
        spark: gated ? null : (opts.sparks?.[r.metric_id] ?? null),
        source: r.source,
        tier: r.source_tier,
        as_of: r.as_of,
        display_allowed: r.display_allowed,
        attribution: meta?.attribution ?? null,
        ...(gated ? { placeholder: DISPLAY_PENDING_PLACEHOLDER } : {}),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  // ── tokens (group by model) ──────────────────────────────────────────────────
  const tokenByModel = new Map<string, TokenRow>();
  for (const r of rows.filter((x) => x.metric_id.startsWith("token."))) {
    const model = r.subject ?? seg(r.metric_id).slice(-2, -1)[0] ?? r.metric_id;
    const cur = tokenByModel.get(model) ?? {
      model, in: null, out: null, quality_adj: null, tps: null, delta_7d: null,
      source: r.source, tier: r.source_tier as Tier, as_of: r.as_of, confidence: r.confidence as Confidence,
    };
    if (r.unit === "$/M-in") { cur.in = r.value; cur.delta_7d = r.delta_7d ?? cur.delta_7d; }
    else if (r.unit === "$/M-out") cur.out = r.value;
    else if (r.unit === "tokens/sec") cur.tps = r.value;
    else if (r.unit === "index-level") cur.quality_adj = r.value; // token.*.qualityadj
    // keep the freshest as_of / most-authoritative tier
    if ((r.as_of ?? "") > (cur.as_of ?? "")) cur.as_of = r.as_of;
    if (r.source_tier < cur.tier) { cur.tier = r.source_tier; cur.source = r.source; cur.confidence = r.confidence; }
    tokenByModel.set(model, cur);
  }
  const tokens = [...tokenByModel.values()].sort((a, b) => a.model.localeCompare(b.model));

  // ── gpus (group by gpu_class -> provider cell) ───────────────────────────────
  // Include neocloud list rows (region null = global) + hyperscaler rows matching the region.
  const gpuRows = rows.filter((r) => r.metric_id.startsWith("gpu.") &&
    (r.region === null || r.region === opts.region));
  const byClass = new Map<string, Map<string, GpuCell>>();
  for (const r of gpuRows) {
    const gpu_class = r.subject ?? seg(r.metric_id)[1] ?? "unknown";
    const provider = r.provider ?? seg(r.metric_id)[3] ?? "unknown";
    if (!byClass.has(gpu_class)) byClass.set(gpu_class, new Map());
    const cells = byClass.get(gpu_class)!;
    const cell = cells.get(provider) ?? {
      provider, ondemand: null, reserved: null, spot: null, region: r.region,
      source: r.source, tier: r.source_tier as Tier, as_of: r.as_of, confidence: r.confidence as Confidence,
    };
    if (r.pricing_mode === "ondemand") cell.ondemand = r.value;
    else if (r.pricing_mode === "reserved" || r.pricing_mode === "committed") cell.reserved = r.value;
    else if (r.pricing_mode === "spot") cell.spot = r.value;
    else if (r.pricing_mode === "list") cell.ondemand = cell.ondemand ?? r.value; // neocloud list == on-demand
    if ((r.as_of ?? "") > (cell.as_of ?? "")) cell.as_of = r.as_of;
    cells.set(provider, cell);
  }
  const gpus: GpuClassRow[] = [...byClass.entries()]
    .map(([gpu_class, cells]) => ({ gpu_class, cells: [...cells.values()].sort((a, b) => a.provider.localeCompare(b.provider)) }))
    .sort((a, b) => a.gpu_class.localeCompare(b.gpu_class));

  // ── fusion block (from demand.fusion.<region>.*) ─────────────────────────────
  const fusionPrefix = `demand.fusion.${opts.region}.`;
  const fRows = rows.filter((r) => r.metric_id.startsWith(fusionPrefix));
  let fusion: FusionBlock | null = null;
  if (fRows.length || opts.timeToPower) {
    const priceRow = fRows.find((r) => r.unit === "$/kWh");
    const queueRow = fRows.find((r) => r.unit === "MW");
    fusion = {
      region: opts.region,
      power_price_kwh: priceRow?.value ?? null,
      interconnect_queue_depth: queueRow?.value ?? null,
      time_to_power: opts.timeToPower ?? null,
      why_note: priceRow?.why_note ?? null,
      as_of: priceRow?.as_of ?? queueRow?.as_of ?? null,
    };
  }

  // ── futures (status; price only when a price row exists = trading) ───────────
  const futByKey = new Map<string, FuturesRow>();
  for (const r of rows.filter((x) => x.metric_id.startsWith("futures."))) {
    const key = `${r.provider}|${r.subject}`;
    const cur = futByKey.get(key) ?? {
      venue: r.provider ?? seg(r.metric_id)[1] ?? "?",
      instrument: r.subject ?? seg(r.metric_id)[2] ?? "?",
      status: "research", as_of: r.as_of, source: r.source,
    };
    if (r.unit === "status") {
      cur.status = (r.why_note ?? "").replace(/^status:/, "") || cur.status;
      cur.as_of = r.as_of;
    } else if (r.unit === "index-level") {
      cur.price = r.value;   // present only when the instrument trades
    }
    futByKey.set(key, cur);
  }
  const futures = [...futByKey.values()].sort((a, b) => (a.venue + a.instrument).localeCompare(b.venue + b.instrument));

  // ── footnotes (one per source present) ───────────────────────────────────────
  const presentSources = new Set(rows.map((r) => r.source));
  const footnotes: Footnote[] = [...presentSources]
    .map((s, i): Footnote | null => {
      const meta = reg(regMap, s);
      if (!meta) return null;
      return {
        ref: `f${i + 1}`, source: meta.label, tier: meta.tier, cadence: meta.cadence,
        note: meta.is_third_party_index && !meta.display_allowed
          ? DISPLAY_PENDING_PLACEHOLDER
          : (meta.attribution ? `attribution: ${meta.attribution}` : ""),
      };
    })
    .filter((x): x is Footnote => x !== null)
    .sort((a, b) => a.source.localeCompare(b.source));

  return {
    as_of: opts.as_of,
    region: opts.region,
    indices, tokens, gpus,
    neocloud_roster: rosterForSnapshot(),
    fusion, futures, footnotes,
  };
}

// Convenience: is a region a known key? (route validation)
export function isKnownRegion(region: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGION_GRID_MAP, region);
}
