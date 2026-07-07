// CC-INGEST-STATE-INCENTIVE-API-1.0  (JPAS T7 Incentives, INC-01..05)  — AUTO-178
// Primary state-published incentive disclosures -> state_incentive_disclosures ->
// fn_state_incentives_resolve_and_score() -> jpas_attributes (SRC 0.85, source='state_disclosure').
//
// v1 scope (Myke-approved): NY live; TX/WA/IL/OH/NJ/LA registered as adapters pending
// per-source endpoint+field-map confirmation (see CC-INGEST-STATE-INCENTIVE-API-1.1). Tier-B
// states (GA/VA/AZ) are the V2 scraping follow-on. Every state logs its own automation_health_log
// row (auto_id=AUTO-178, distinguished by `state` in notes) so partial coverage is never silent.
//
// Batching / cron: large sources (NY ~65k) exceed a single edge worker budget, so each request
// processes a bounded window of `pages` pages from `offset` and reports `next_offset`.
//   - Manual/backfill: caller loops offsets and reads results (chain omitted).
//   - Cron: call with {chain:true}; the function processes one window in the background and
//     self-invokes for the next window (a fresh worker each hop) until the source is exhausted.
// The resolve+score RPC runs every window (idempotent; only touches newly-loaded unresolved rows).
//
// Auth: verify_jwt=false (cron-callable behind the Supabase apikey gateway). If env
// STATE_INCENTIVE_INGEST_SECRET is set, the request body must carry a matching secret (FAR ticket).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const INGEST_SECRET = Deno.env.get("STATE_INCENTIVE_INGEST_SECRET") ?? "";
const NY_APP_TOKEN = Deno.env.get("DATA_NY_APP_TOKEN") ?? "";

const AUTO_ID = "AUTO-178";
const CRAWLER_ID = "ingest-state-incentives_v1.0";
const SCHEMA_VERSION = "v1";
const MAX_PER_STATE = 200000;
const PAGE_SIZE = 1000;
const DEFAULT_PAGES_PER_CALL = 8;

type CommonRecord = {
  state_abbr: string;
  source_key: string;
  source_record_id: string | null;
  recipient_name: string | null;
  project_name: string | null;
  project_address: string | null;
  parcel_id: string | null;
  place_name: string | null;
  county_name: string | null;
  incentive_type: string | null;   // -> INC-02
  raw_incentive_type: string | null;
  program_name: string | null;     // -> INC-05
  statute_citation: string | null; // -> INC-05
  award_value_usd: number | null;  // -> INC-03
  term_start: string | null;       // -> INC-04
  term_end: string | null;
  term_years: number | null;
  source_url: string | null;
  raw: unknown;
};

function normalizeType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/(tax increment|reinvestment zone|\btif\b)/.test(s)) return "tif";
  if (/abat/.test(s)) return "abatement";
  if (/exempt/.test(s)) return "exemption";
  if (/(payment.?in.?lieu|pilot)/.test(s)) return "pilot";
  if (/credit/.test(s)) return "credit";
  if (/grant/.test(s)) return "grant";
  if (/loan/.test(s)) return "loan";
  return "other";
}

function toDate(v: unknown): string | null {
  if (!v || typeof v !== "string") return null;
  const d = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function yearsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start), b = Date.parse(end);
  if (isNaN(a) || isNaN(b) || b < a) return null;
  return Math.round(((b - a) / (365.25 * 864e5)) * 10) / 10;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
}

async function contentHash(r: CommonRecord): Promise<string> {
  const basis = [
    r.state_abbr, r.source_key, r.source_record_id ?? "",
    r.recipient_name ?? "", r.program_name ?? "", r.raw_incentive_type ?? "",
    r.award_value_usd ?? "", r.term_start ?? "", r.term_end ?? "", r.county_name ?? "",
  ].join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type WindowResult = { records: CommonRecord[]; exhausted: boolean };

type Adapter = {
  state_abbr: string;
  source_key: string;
  source_url: string;
  status: "live" | "pending_source_confirmation";
  note?: string;
  fetchWindow?: (offset: number, pages: number) => Promise<WindowResult>;
};

// NY — Empire State Development "Database of Economic Incentives" (Socrata; dataset 26ei-n4eb).
async function fetchWindowNY(offset: number, pages: number): Promise<WindowResult> {
  const base = "https://data.ny.gov/resource/26ei-n4eb.json";
  const records: CommonRecord[] = [];
  let exhausted = false;
  for (let p = 0; p < pages; p++) {
    const off = offset + p * PAGE_SIZE;
    if (off >= MAX_PER_STATE) { exhausted = true; break; }
    const url = `${base}?$limit=${PAGE_SIZE}&$offset=${off}&$order=project_id_number`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (NY_APP_TOKEN) headers["X-App-Token"] = NY_APP_TOKEN;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`NY Socrata ${res.status}: ${await res.text()}`);
    const rows = await res.json() as Record<string, string>[];
    for (const row of rows) {
      const start = toDate(row.start_date);
      const end = toDate(row.end_date);
      records.push({
        state_abbr: "NY",
        source_key: "ny_esd_dei",
        source_record_id: row.project_id_number ?? null,
        recipient_name: row.recipient_name ?? row.original_recipient ?? null,
        project_name: row.name_of_project ?? null,
        project_address: null,
        parcel_id: null,
        place_name: null,
        county_name: row.county ?? null,
        incentive_type: normalizeType(row.assistance_type),
        raw_incentive_type: row.assistance_type ?? null,
        program_name: row.program_through_which_the_funding_was_awarded ?? null,
        statute_citation: null, // NY DEI publishes no statute cite
        award_value_usd: num(row.total_lead_agency_benefits_awarded ?? row.assistance_amount),
        term_start: start,
        term_end: end,
        term_years: yearsBetween(start, end),
        source_url: "https://data.ny.gov/d/26ei-n4eb",
        raw: row,
      });
    }
    if (rows.length < PAGE_SIZE) { exhausted = true; break; }
  }
  return { records, exhausted };
}

const ADAPTERS: Adapter[] = [
  { state_abbr: "NY", source_key: "ny_esd_dei", status: "live",
    source_url: "https://data.ny.gov/d/26ei-n4eb", fetchWindow: fetchWindowNY },
  { state_abbr: "TX", source_key: "tx_comptroller_lda_tif", status: "pending_source_confirmation",
    source_url: "https://comptroller.texas.gov/transparency/open-data/",
    note: "TX Comptroller Local Development Agreement + TIF datasets (bulk CSV/Socrata). Confirm dataset ids + field map." },
  { state_abbr: "WA", source_key: "wa_dor_incentives", status: "pending_source_confirmation",
    source_url: "https://data.wa.gov/",
    note: "WA DOR tax-incentive disclosure open data. Confirm dataset id + field map." },
  { state_abbr: "IL", source_key: "il_edge", status: "pending_source_confirmation",
    source_url: "https://www2.illinois.gov/dceo/",
    note: "IL DCEO EDGE credit / corporate accountability. Confirm machine-readable endpoint." },
  { state_abbr: "OH", source_key: "oh_development", status: "pending_source_confirmation",
    source_url: "https://development.ohio.gov/",
    note: "OH incentive/TIF disclosure. Confirm machine-readable endpoint + field map." },
  { state_abbr: "NJ", source_key: "nj_eda", status: "pending_source_confirmation",
    source_url: "https://data.nj.gov/",
    note: "NJ EDA transparency / incentive awards open data. Confirm dataset id + field map." },
  { state_abbr: "LA", source_key: "la_itep", status: "pending_source_confirmation",
    source_url: "https://www.opportunitylouisiana.gov/",
    note: "LA Industrial Tax Exemption Program (ITEP) board dataset. Confirm export/field map." },
];

// Process every requested adapter for one window. Returns per-state results and whether any
// LIVE state still has more data (=> caller should advance the cursor). `logPending` gates the
// pending-adapter no-op rows so a multi-hop chain logs them once (first hop), not every hop.
async function runWindow(
  sb: ReturnType<typeof createClient>,
  adapters: Adapter[],
  offset: number,
  pages: number,
  logPending: boolean,
): Promise<{ results: unknown[]; anyLiveMore: boolean }> {
  const results: unknown[] = [];
  let anyLiveMore = false;

  for (const a of adapters) {
    const started = new Date().toISOString();
    const logBase = { auto_id: AUTO_ID, crawler_id: CRAWLER_ID };

    if (a.status !== "live" || !a.fetchWindow) {
      if (logPending) {
        await sb.from("automation_health_log").insert({
          log_id: crypto.randomUUID(), ...logBase,
          run_started_at: started, run_completed_at: new Date().toISOString(),
          artifacts_found: 0, artifacts_new: 0, artifacts_duped: 0, success: true,
          notes: JSON.stringify({ state: a.state_abbr, status: "pending_source_confirmation",
                                  source_key: a.source_key, source_url: a.source_url, note: a.note }),
        });
      }
      results.push({ state: a.state_abbr, status: "pending_source_confirmation" });
      continue;
    }

    try {
      const { records, exhausted } = await a.fetchWindow(offset, pages);
      if (!exhausted) anyLiveMore = true;

      let inserted = 0;
      const seen = new Set<string>();
      for (let i = 0; i < records.length; i += PAGE_SIZE) {
        const slice = records.slice(i, i + PAGE_SIZE);
        const rows: Record<string, unknown>[] = [];
        for (const r of slice) {
          const hash = await contentHash(r);
          if (seen.has(hash)) continue;
          seen.add(hash);
          rows.push({ ...r, state_source_schema_version: SCHEMA_VERSION, content_hash: hash });
        }
        if (!rows.length) continue;
        const { data, error } = await sb
          .from("state_incentive_disclosures")
          .upsert(rows, { onConflict: "content_hash", ignoreDuplicates: true })
          .select("id");
        if (error) throw new Error(`upsert: ${error.message}`);
        inserted += data?.length ?? 0;
      }

      const { data: rpc, error: rpcErr } = await sb
        .rpc("fn_state_incentives_resolve_and_score", { p_state_abbr: a.state_abbr });
      if (rpcErr) throw new Error(`rpc: ${rpcErr.message}`);

      const next_offset = exhausted ? null : offset + pages * PAGE_SIZE;

      await sb.from("automation_health_log").insert({
        log_id: crypto.randomUUID(), ...logBase,
        run_started_at: started, run_completed_at: new Date().toISOString(),
        artifacts_found: records.length,
        artifacts_new: inserted,
        artifacts_duped: records.length - inserted,
        success: true,
        notes: JSON.stringify({ state: a.state_abbr, status: "live", source_key: a.source_key,
                                offset, next_offset, resolve: rpc }),
      });
      results.push({ state: a.state_abbr, status: "live", offset, found: records.length,
                     new: inserted, next_offset, resolve: rpc });
    } catch (e) {
      await sb.from("automation_health_log").insert({
        log_id: crypto.randomUUID(), ...logBase,
        run_started_at: started, run_completed_at: new Date().toISOString(),
        artifacts_found: 0, artifacts_new: 0, artifacts_duped: 0, success: false,
        errors: { message: String(e instanceof Error ? e.message : e) },
        notes: JSON.stringify({ state: a.state_abbr, status: "error", source_key: a.source_key, offset }),
      });
      results.push({ state: a.state_abbr, status: "error",
                     error: String(e instanceof Error ? e.message : e) });
    }
  }

  return { results, anyLiveMore };
}

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  let body: { states?: string[]; secret?: string; offset?: number; pages?: number; chain?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body allowed */ }

  if (INGEST_SECRET && body.secret !== INGEST_SECRET) return json({ error: "unauthorized" }, 401);

  const offset = Math.max(0, body.offset ?? 0);
  const pages = Math.max(1, body.pages ?? DEFAULT_PAGES_PER_CALL);
  const chain = body.chain === true;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const wanted = body.states?.map((s) => s.toUpperCase());
  const adapters = wanted ? ADAPTERS.filter((a) => wanted.includes(a.state_abbr)) : ADAPTERS;

  // Cron mode: process this window in the background, then self-invoke the next window (fresh
  // worker) until exhausted. Respond immediately so no single worker holds the whole drain.
  if (chain) {
    const selfUrl = `${SUPABASE_URL}/functions/v1/ingest-state-incentives`;
    EdgeRuntime.waitUntil((async () => {
      const { anyLiveMore } = await runWindow(sb, adapters, offset, pages, offset === 0);
      if (anyLiveMore) {
        await fetch(selfUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${ANON_KEY}`,
            "apikey": ANON_KEY,
          },
          body: JSON.stringify({
            states: wanted, offset: offset + pages * PAGE_SIZE, pages, chain: true,
            ...(INGEST_SECRET ? { secret: INGEST_SECRET } : {}),
          }),
        }).catch(() => {/* next hop failure is captured by its own telemetry */});
      }
    })());
    return json({ ok: true, mode: "chain", auto_id: AUTO_ID, offset, dispatched: true }, 202);
  }

  // Manual / backfill mode: run one window and return results.
  const { results } = await runWindow(sb, adapters, offset, pages, true);
  return json({ ok: true, crawler_id: CRAWLER_ID, auto_id: AUTO_ID, ran: results.length, results });
});
