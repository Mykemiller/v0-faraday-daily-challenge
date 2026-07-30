// CC-INGEST-TOKENOMICS-SCOREBOARD-1.0  (Faraday Tokenomics Scoreboard back end)  — AUTO-191 (PROPOSED)
// Ingestion orchestrator for the append-only tokenomics_metrics time series. Mirrors
// ingest-state-incentives conventions: verify_jwt=false (cron behind the apikey gateway), per-source
// automation_health_log rows (auto_id distinguished by `source` in notes so partial coverage is
// never silent), content-hash idempotency, optional self-chaining.
//
// Request body (all optional):
//   { secret?, sources?: string[], captures?: {source, payload}[], as_of?: 'YYYY-MM-DD',
//     run_fusion?: boolean, regions?: string[], chain?: boolean }
//   - sources   : restrict to these adapter source_keys (default: all).
//   - captures  : rendered/licensed payloads for manual_capture adapters (403-prone vendors, indices).
//   - run_fusion: also compute fusion rows for `regions` (default true; regions default = DEFAULT_REGIONS).
//   - chain     : cron mode — process, then self-invoke once (kept single-hop; the series is bounded).
//
// GOVERNANCE: no third-party index value is ever DISPLAYED here — indices are stored with
// display_allowed=false; the snapshot API withholds the value. This function only ingests.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { type Metric, dedupeByHash } from "./metrics.ts";
import { buildAdapters, type Adapter } from "./adapters.ts";
import { REGION_GRID_MAP, DEFAULT_REGIONS, fusionMetrics } from "./fusion.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const INGEST_SECRET = Deno.env.get("TOKENOMICS_INGEST_SECRET") ?? "";

const AUTO_ID = "AUTO-191"; // PROPOSED — reserve in Airtable before go-live.
const CRAWLER_ID = "ingest-tokenomics_v1.0";
const INSERT_CHUNK = 500;

type SbClient = ReturnType<typeof createClient>;

function todayUTC(): string { return new Date().toISOString().slice(0, 10); }

async function logHealth(sb: SbClient, row: Record<string, unknown>) {
  await sb.from("automation_health_log").insert({
    log_id: crypto.randomUUID(), auto_id: AUTO_ID, crawler_id: CRAWLER_ID, ...row,
  });
}

// Persist a batch of metrics (append-only). Dedup on the underlying figure first, then upsert on the
// vintage key so a replay of an unchanged reading is a no-op and a changed value inserts a new row.
async function persist(sb: SbClient, metrics: Metric[]): Promise<{ found: number; inserted: number; duped: number }> {
  const { rows, duped } = await dedupeByHash(metrics);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const slice = rows.slice(i, i + INSERT_CHUNK);
    const { data, error } = await sb
      .from("tokenomics_metrics")
      .upsert(slice, { onConflict: "metric_id,as_of,source,content_hash", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`upsert: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return { found: metrics.length, inserted, duped };
}

// Run one adapter and log its own health row. `captures` maps source -> payload for manual adapters.
async function runAdapter(
  sb: SbClient, a: Adapter, asOf: string, captures: Map<string, unknown>,
): Promise<Record<string, unknown>> {
  const started = new Date().toISOString();
  try {
    let metrics: Metric[] = [];
    let mode = a.status;

    if (a.status === "live" && a.fetchLive) {
      metrics = await a.fetchLive(asOf);
    } else if (a.parseCapture && captures.has(a.source)) {
      metrics = a.parseCapture(captures.get(a.source), asOf);
      mode = "manual_capture";
    } else {
      // pending, or manual with no capture supplied this run => explicit no-op (never a guess).
      await logHealth(sb, {
        run_started_at: started, run_completed_at: new Date().toISOString(),
        artifacts_found: 0, artifacts_new: 0, artifacts_duped: 0, success: true,
        notes: JSON.stringify({ source: a.source, category: a.category, status: a.status,
                                outcome: "no_data_this_run", note: a.note ?? null }),
      });
      return { source: a.source, status: a.status, outcome: "no_data_this_run" };
    }

    const { found, inserted, duped } = await persist(sb, metrics);
    await logHealth(sb, {
      run_started_at: started, run_completed_at: new Date().toISOString(),
      artifacts_found: found, artifacts_new: inserted, artifacts_duped: found - inserted + duped,
      success: true,
      notes: JSON.stringify({ source: a.source, category: a.category, status: mode, as_of: asOf }),
    });
    return { source: a.source, status: mode, found, new: inserted };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    await logHealth(sb, {
      run_started_at: started, run_completed_at: new Date().toISOString(),
      artifacts_found: 0, artifacts_new: 0, artifacts_duped: 0, success: false,
      errors: { message: msg },
      notes: JSON.stringify({ source: a.source, category: a.category, status: "error" }),
    });
    return { source: a.source, status: "error", error: msg };
  }
}

// D) FUSION — wired first. For each region, resolve region->geography (REGION_GRID_MAP), call the
// fn_scoreboard_fusion RPC, and persist region-keyed D rows (power price $/kWh) + a why_note when a
// GPU price move in the region coincides with a grid signal.
async function runFusion(sb: SbClient, asOf: string, regions: string[]): Promise<Record<string, unknown>> {
  const started = new Date().toISOString();
  try {
    let found = 0, inserted = 0;
    const perRegion: Record<string, unknown>[] = [];
    for (const region of regions) {
      const geo = REGION_GRID_MAP[region];
      if (!geo) { perRegion.push({ region, outcome: "no_geo_mapping" }); continue; }
      const { data, error } = await sb.rpc("fn_scoreboard_fusion", { p_state_abbr: geo.state_abbr, p_iso_rto: geo.iso_rto ?? null });
      if (error) throw new Error(`fusion rpc (${region}): ${error.message}`);
      const fusion = data as Record<string, unknown>;

      // Pull the latest region-keyed GPU on-demand reading to test for a coincident move (why_note).
      const { data: gpuRows } = await sb
        .from("tokenomics_metrics")
        .select("value, as_of")
        .eq("category", "B").eq("region", region).eq("pricing_mode", "ondemand")
        .order("as_of", { ascending: false }).limit(30);

      const metrics = fusionMetrics(region, geo, fusion, asOf, (gpuRows ?? []) as { value: number|null; as_of: string }[]);
      const r = await persist(sb, metrics);
      found += r.found; inserted += r.inserted;
      perRegion.push({ region, state: geo.state_abbr, iso: geo.iso_rto ?? null, written: r.inserted,
                       power_price_kwh: fusion.power_price_kwh, queue_mw: fusion.interconnect_queue_depth_mw });
    }
    await logHealth(sb, {
      run_started_at: started, run_completed_at: new Date().toISOString(),
      artifacts_found: found, artifacts_new: inserted, artifacts_duped: found - inserted, success: true,
      notes: JSON.stringify({ source: "fusion_faraday", category: "D", regions: perRegion, as_of: asOf }),
    });
    return { source: "fusion_faraday", found, new: inserted, regions: perRegion };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    await logHealth(sb, {
      run_started_at: started, run_completed_at: new Date().toISOString(),
      artifacts_found: 0, artifacts_new: 0, artifacts_duped: 0, success: false,
      errors: { message: msg }, notes: JSON.stringify({ source: "fusion_faraday", category: "D", status: "error" }),
    });
    return { source: "fusion_faraday", status: "error", error: msg };
  }
}

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  let body: {
    secret?: string; sources?: string[]; captures?: { source: string; payload: unknown }[];
    as_of?: string; run_fusion?: boolean; regions?: string[]; chain?: boolean;
  } = {};
  try { body = await req.json(); } catch { /* empty body allowed */ }

  if (INGEST_SECRET && body.secret !== INGEST_SECRET) return json({ error: "unauthorized" }, 401);

  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(body.as_of ?? "") ? body.as_of! : todayUTC();
  const captures = new Map<string, unknown>((body.captures ?? []).map((c) => [c.source, c.payload]));
  const runFusionFlag = body.run_fusion !== false; // fusion first, on by default
  const regions = body.regions?.length ? body.regions : DEFAULT_REGIONS;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const wanted = body.sources?.length ? new Set(body.sources) : null;
  const adapters = buildAdapters().filter((a) => !wanted || wanted.has(a.source));

  const doWork = async () => {
    const results: Record<string, unknown>[] = [];
    // FUSION JOIN FIRST (locked scope decision #3).
    if (runFusionFlag && (!wanted || wanted.has("fusion_faraday"))) {
      results.push(await runFusion(sb, asOf, regions));
    }
    for (const a of adapters) results.push(await runAdapter(sb, a, asOf, captures));
    return results;
  };

  if (body.chain === true) {
    EdgeRuntime.waitUntil((async () => {
      await doWork();
      // single-hop chain: the series is bounded per run; a second hop only re-runs pending no-ops.
      await fetch(`${SUPABASE_URL}/functions/v1/ingest-tokenomics`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
        body: JSON.stringify({ as_of: asOf, run_fusion: false, chain: false, ...(INGEST_SECRET ? { secret: INGEST_SECRET } : {}) }),
      }).catch(() => {/* next hop has its own telemetry */});
    })());
    return json({ ok: true, mode: "chain", auto_id: AUTO_ID, as_of: asOf, dispatched: true }, 202);
  }

  const results = await doWork();
  return json({ ok: true, crawler_id: CRAWLER_ID, auto_id: AUTO_ID, as_of: asOf, ran: results.length, results });
});
