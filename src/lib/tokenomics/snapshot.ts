// Snapshot assembler — turns append-only vintages into the typed
// scoreboard_snapshot the front end consumes. Pure: no I/O. The route reads
// recent vintages (≈90d) from tokenomics_metrics and passes them in.
//
// DISPLAY GATE (locked scope #2): third-party constructed indices are
// INGEST-ONLY. Any reading with display_allowed=false returns existence + as-of
// + source + a "licensed source — display pending" placeholder, with value NULL.
// Token/GPU cells are vendor prices (display_allowed=true); the gated indices
// live in the `indices` array with their values suppressed.
//
// metric_id conventions the assembler keys on:
//   token.<model>.<dim>[.provider]   category A, meta.dimension ∈ in|out|tps|quality_adj
//   gpu.<class>.<mode>.<provider>[.region]  category B, pricing_mode set
//   index.<slug>                     category A/B index-level (gate applies)
//   futures.<venue>.<instrument>     category C, meta.status / venue / instrument

import type {
  StoredReading,
  ScoreboardSnapshot,
  IndexCell,
  TokenRow,
  GpuGroup,
  GpuCell,
  FuturesRow,
  Footnote,
  FusionBlock,
  NeocloudRoster,
  SourceTier,
} from './types.ts';
import { latestByAsOf, pctChange, sparkline } from './series.ts';

export const DISPLAY_PENDING_NOTE = 'licensed source — display pending';

interface MetricSeries {
  metric_id: string;
  latest: StoredReading;
  points: ReturnType<typeof latestByAsOf>;
}

// Group flat readings into one series per metric_id, keeping the latest vintage's
// full row (for labels/meta/source) alongside the de-duped point history.
function groupByMetric(readings: StoredReading[]): Map<string, MetricSeries> {
  const buckets = new Map<string, StoredReading[]>();
  for (const r of readings) {
    if (!buckets.has(r.metric_id)) buckets.set(r.metric_id, []);
    buckets.get(r.metric_id)!.push(r);
  }
  const out = new Map<string, MetricSeries>();
  for (const [metric_id, rows] of buckets) {
    const points = latestByAsOf(rows);
    // latest = row with the max as_of (then max ingested_at)
    const latest = [...rows].sort(
      (a, b) =>
        Date.parse(b.as_of) - Date.parse(a.as_of) ||
        (b.ingested_at ? Date.parse(b.ingested_at) : 0) - (a.ingested_at ? Date.parse(a.ingested_at) : 0),
    )[0];
    out.set(metric_id, { metric_id, latest, points });
  }
  return out;
}

function tier(r: StoredReading): SourceTier {
  return r.source_tier;
}

// ─── Indices (display-gated) ─────────────────────────────────────────────────
function buildIndices(series: MetricSeries[]): IndexCell[] {
  return series
    .filter((s) => s.metric_id.startsWith('index.'))
    .map((s) => {
      const r = s.latest;
      const gated = r.display_allowed === false;
      const attribution = (r.meta?.attribution as string | undefined) ?? null;
      const cell: IndexCell = {
        metric_id: r.metric_id,
        label: r.subject ?? r.metric_id,
        value: gated ? null : r.value,
        unit: r.unit,
        delta_7d: gated ? null : pctChange(s.points, 7),
        delta_30d: gated ? null : pctChange(s.points, 30),
        spark: gated ? [] : sparkline(s.points),
        source: r.source,
        tier: tier(r),
        as_of: r.as_of,
        display_allowed: !gated,
        attribution,
      };
      if (gated) cell.note = DISPLAY_PENDING_NOTE;
      return cell;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ─── Tokens ──────────────────────────────────────────────────────────────────
function buildTokens(series: MetricSeries[]): TokenRow[] {
  const tokenSeries = series.filter((s) => s.metric_id.startsWith('token.'));
  // group by model (subject), keep each dimension's latest reading
  const byModel = new Map<string, { rows: MetricSeries[]; model: string }>();
  for (const s of tokenSeries) {
    const model = s.latest.subject ?? s.metric_id;
    if (!byModel.has(model)) byModel.set(model, { rows: [], model });
    byModel.get(model)!.rows.push(s);
  }
  const out: TokenRow[] = [];
  for (const { rows, model } of byModel.values()) {
    const dim = (name: string) => rows.find((s) => (s.latest.meta?.dimension as string) === name);
    const inS = dim('in');
    const outS = dim('out');
    const tpsS = dim('tps');
    const qadjS = dim('quality_adj');
    // representative source/as_of/confidence = the "in" price row, else first row
    const rep = (inS ?? outS ?? rows[0]).latest;
    out.push({
      model,
      in: inS?.latest.value ?? null,
      out: outS?.latest.value ?? null,
      quality_adj: qadjS?.latest.value ?? (rep.meta?.quality_adj as number | undefined) ?? null,
      tps: tpsS?.latest.value ?? (rep.meta?.tps as number | undefined) ?? null,
      delta_7d: inS ? pctChange(inS.points, 7) : null,
      source: rep.source,
      tier: rep.source_tier,
      as_of: rep.as_of,
      confidence: rep.confidence,
    });
  }
  return out.sort((a, b) => a.model.localeCompare(b.model));
}

// ─── GPUs ────────────────────────────────────────────────────────────────────
// Group by gpu_class (subject). Within a class, one cell per (provider, region),
// merging the ondemand/reserved/spot pricing_modes.
function buildGpus(series: MetricSeries[], providerFilter?: (provider: string) => boolean): GpuGroup[] {
  const gpuSeries = series.filter((s) => s.metric_id.startsWith('gpu.'));
  const byClass = new Map<string, MetricSeries[]>();
  for (const s of gpuSeries) {
    const cls = s.latest.subject ?? 'Unknown';
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls)!.push(s);
  }

  const groups: GpuGroup[] = [];
  for (const [gpu_class, rows] of byClass) {
    const byCell = new Map<string, { provider: string; region: string | null; modes: Map<string, MetricSeries> }>();
    for (const s of rows) {
      const provider = s.latest.provider ?? 'unknown';
      if (providerFilter && !providerFilter(provider)) continue;
      const region = s.latest.region ?? null;
      const key = `${provider}|${region ?? ''}`;
      if (!byCell.has(key)) byCell.set(key, { provider, region, modes: new Map() });
      const mode = s.latest.pricing_mode ?? 'ondemand';
      byCell.get(key)!.modes.set(mode, s);
    }
    const cells: GpuCell[] = [];
    for (const { provider, region, modes } of byCell.values()) {
      const rep = (modes.get('ondemand') ?? [...modes.values()][0]).latest;
      const cell: GpuCell = {
        provider,
        ondemand: modes.get('ondemand')?.latest.value ?? null,
        region,
        source: rep.source,
        tier: rep.source_tier,
        as_of: rep.as_of,
        confidence: rep.confidence,
      };
      const reserved = modes.get('reserved') ?? modes.get('committed');
      if (reserved) cell.reserved = reserved.latest.value;
      if (modes.get('spot')) cell.spot = modes.get('spot')!.latest.value;
      cells.push(cell);
    }
    if (cells.length) groups.push({ gpu_class, cells: cells.sort((a, b) => a.provider.localeCompare(b.provider)) });
  }
  return groups.sort((a, b) => a.gpu_class.localeCompare(b.gpu_class));
}

// ─── Futures ─────────────────────────────────────────────────────────────────
// Store status always; a PRICE only when the instrument actually trades. Never
// render a price for a non-tradeable instrument.
function buildFutures(series: MetricSeries[]): FuturesRow[] {
  return series
    .filter((s) => s.metric_id.startsWith('futures.'))
    .map((s) => {
      const r = s.latest;
      const status = (r.meta?.status as FuturesRow['status']) ?? 'research';
      const row: FuturesRow = {
        venue: (r.meta?.venue as string) ?? r.provider ?? 'unknown',
        instrument: (r.meta?.instrument as string) ?? r.subject ?? r.metric_id,
        status,
        as_of: r.as_of,
        source: r.source,
      };
      if (status === 'trading' && r.value !== null) {
        row.price = r.value;
        if (r.meta?.volume != null) row.volume = r.meta.volume as number;
      }
      return row;
    })
    .sort((a, b) => a.venue.localeCompare(b.venue));
}

export interface BuildSnapshotOpts {
  region: string;
  roster: NeocloudRoster;
  fusion: FusionBlock | null;
  // Which providers to render in gpu cells. The API includes 4 fixed + full
  // candidate pool; the front end trims to 4 fixed + the pick. Omit = all.
  gpuProviderFilter?: (provider: string) => boolean;
  footnotes?: Footnote[];
  asOfOverride?: string;
}

export function buildSnapshot(readings: StoredReading[], opts: BuildSnapshotOpts): ScoreboardSnapshot {
  const seriesMap = groupByMetric(readings);
  const series = [...seriesMap.values()];

  const indices = buildIndices(series);
  const tokens = buildTokens(series);
  const gpus = buildGpus(series, opts.gpuProviderFilter);
  const futures = buildFutures(series);

  // snapshot as_of = the most recent as_of across all displayed readings
  const asOf =
    opts.asOfOverride ??
    series.reduce<string>((max, s) => (Date.parse(s.latest.as_of) > Date.parse(max) ? s.latest.as_of : max), '1970-01-01T00:00:00Z');

  return {
    as_of: asOf,
    region: opts.region,
    indices,
    tokens,
    gpus,
    neocloud_roster: opts.roster,
    fusion: opts.fusion,
    futures,
    footnotes: opts.footnotes ?? [],
  };
}
