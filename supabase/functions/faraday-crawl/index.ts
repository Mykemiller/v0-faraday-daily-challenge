// Faraday — Daily Web Crawler (AUTO-040 orchestrator → per-automation batching)
// Supabase Edge Function — POST /functions/v1/faraday-crawl
//
// HARDENING (2026-06-23):
//   Root cause of 07:00 UTC crash: single Anthropic call for all automations hit
//   MAX_TOKENS=8000 and truncated at position 26257, zeroing the entire run.
//   Fix: split AUTOMATIONS into concurrent batches of BATCH_SIZE (3), each with
//   its own API call and try/catch. One bad batch logs per-automation failures
//   without affecting the rest of the fleet.
//
// PARSER HARDENING ORDER (per spec):
//   1. Batch chunking so no single call can exceed token budget.
//   2. Strip ```json fences + trim before parse (extractAndParse).
//   3. On parse failure, salvage complete object elements from the partial string.
//   4. Log raw payload excerpt to automation_health_log.errors on salvage/failure.
//
// FLEET EXPANSION: 8 → 27 web-search-eligible automations, reconciled against
//   the Airtable Automation Registry (appxfti7VuoHYUeu6 / tbl1ef6FgxUc3Uevg).
//   MCP-dependent automations (LinkedIn, CB Insights, Morningstar, DC Hub, SEC
//   EDGAR) are excluded — they still require the full desktop-agent run.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Config ───────────────────────────────────────────────────────────────────
const CRAWL_MODEL = "claude-sonnet-4-6";
const WEB_SEARCH_TOOL = "web_search_20250305";
const MAX_TOKENS_PER_BATCH = 8000;   // safe per 3-automation batch
const MAX_SEARCHES_PER_BATCH = 10;   // web_search budget per API call
const PER_AUTO_CAP = 4;              // max artifacts per automation
const BATCH_SIZE = 3;                // automations per Anthropic call
const CRON_TOKEN = "fcron_9mK3pX7qR2vN8wYz4tB6sL1dH5jG0aE";

// ─── Automation Registry (web-search-eligible, active in Airtable) ─────────────
// Sorted by AUTO-ID. Locked ranges: AUTO-027–032 (Intelligence Crawl),
// AUTO-121–127 (Daily Challenge). AUTO-040 re-assigned from orchestrator
// wrapper to its correct Airtable identity (arXiv Pre-Publication Feed).
interface AutoDef {
  auto_id: string;
  source_type: string;
  ifs_domains: string[];
  queries: string[];
}

const AUTOMATIONS: AutoDef[] = [
  // --- Original 8 backbone ---
  { auto_id: "AUTO-001", source_type: "web_news", ifs_domains: ["D1","D3","D5","D6","D7","D9"],
    queries: ["AI infrastructure data center news today","GPU compute chip announcement AI","hyperscaler cloud AI investment capex"] },
  { auto_id: "AUTO-011", source_type: "web_news", ifs_domains: ["D3","D11"],
    queries: ["local government data center permit approved denied","community opposition AI data center construction news","local news data center announcement zoning 2026"] },
  { auto_id: "AUTO-012", source_type: "regulatory", ifs_domains: ["D3"],
    queries: ["Good Jobs First data center subsidy deal tracker","tax incentive data center state economic development 2026","corporate welfare data center public record database"] },
  { auto_id: "AUTO-013", source_type: "regulatory", ifs_domains: ["D3"],
    queries: ["state legislature data center AI infrastructure bill 2026","data center legislation passed signed law 2026","state policy data center regulation tax incentive"] },
  { auto_id: "AUTO-014", source_type: "web_news", ifs_domains: ["D7","D9"],
    queries: ["iMasons AI data center innovation announcement 2026","data center cooling efficiency breakthrough technology","edge computing infrastructure product launch 2026"] },
  { auto_id: "AUTO-016", source_type: "regulatory", ifs_domains: ["D3"],
    queries: ["ERCOT large load interconnection data center Texas 2026","Texas grid reliability AI data center power demand","ERCOT load forecast AI facility request"] },
  { auto_id: "AUTO-017", source_type: "web_news", ifs_domains: ["D3"],
    queries: ["FERC data center AI power ruling order","Congress AI infrastructure legislation","DOE data center energy policy"] },
  { auto_id: "AUTO-023", source_type: "web_news", ifs_domains: ["D4","D5","D7"],
    queries: ["Goldman Sachs Morgan Stanley data center AI research report","analyst note AI compute infrastructure investment thesis"] },
  { auto_id: "AUTO-024", source_type: "web_news", ifs_domains: ["D9"],
    queries: ["AI infrastructure startup product launch announcement 2026","data center startup venture funding Series A B 2026","emerging AI compute company news product"] },
  { auto_id: "AUTO-027", source_type: "web_news", ifs_domains: ["D1","D2","D3","D4","D5","D6","D7","D8","D9","D10"],
    queries: ["new entrant data center company announcement funding 2026","emerging player hyperscaler alternative AI compute","startup scale AI data center infrastructure launch"] },
  { auto_id: "AUTO-028", source_type: "web_news", ifs_domains: ["D10","D6","D4"],
    queries: ["AI data center networking InfiniBand 800G","optical interconnect AI training cluster"] },
  { auto_id: "AUTO-029", source_type: "regulatory", ifs_domains: ["D11","D3"],
    queries: ["community opposition data center development NIMBYism 2026","data center community benefits agreement public meeting","neighborhood data center rezoning opposition support"] },
  { auto_id: "AUTO-030", source_type: "permit_utility", ifs_domains: ["D12","D4","D5"],
    queries: ["data center land acquisition real estate deal 2026","data center site selection campus campus announcement","industrial land data center development permit construction"] },
  { auto_id: "AUTO-031", source_type: "web_news", ifs_domains: ["D13","D7","D3"],
    queries: ["data center PPA renewable energy sustainability","AI data center carbon water usage ESG"] },
  { auto_id: "AUTO-032", source_type: "web_news", ifs_domains: ["D14","D5","D6"],
    queries: ["data center technician workforce shortage hiring 2026","AI infrastructure skilled labor salary jobs","data center workforce training program announcement"] },
  { auto_id: "AUTO-033", source_type: "regulatory", ifs_domains: ["D15","D6","D4","D1"],
    queries: ["sovereign AI national data center strategy 2026","geopolitics semiconductor AI chip US China competition","national security AI infrastructure government investment"] },
  { auto_id: "AUTO-034", source_type: "regulatory", ifs_domains: ["D16","D9","D5"],
    queries: ["data center physical cybersecurity incident 2026","critical infrastructure protection AI facility security","ransomware attack data center outage incident security"] },
  { auto_id: "AUTO-036", source_type: "web_news", ifs_domains: ["D1"],
    queries: ["NVIDIA AMD GPU data center announcement","rack density watt per rack AI data center","custom AI chip ASIC TPU silicon"] },
  { auto_id: "AUTO-037", source_type: "web_news", ifs_domains: ["D2","D3","D8"],
    queries: ["data center behind the meter power natural gas","800VDC data center power architecture","data center grid interconnection power"] },
  { auto_id: "AUTO-038", source_type: "financial", ifs_domains: ["D5","D1","D4"],
    queries: ["hyperscaler capex earnings AI data center","Microsoft Google Amazon Meta AI infrastructure spend"] },
  { auto_id: "AUTO-040", source_type: "academic", ifs_domains: ["D1","D2","D7"],
    queries: ["arxiv preprint AI compute energy efficiency 2026","academic paper data center thermal management new publication","arxiv machine learning infrastructure hardware benchmark"] },
  { auto_id: "AUTO-041", source_type: "academic", ifs_domains: ["D1","D2","D7"],
    queries: ["IEEE Spectrum data center technology article 2026","Nature Energy data center power efficiency publication June 2026","academic journal AI infrastructure research announcement"] },
  { auto_id: "AUTO-043", source_type: "regulatory", ifs_domains: ["D2","D8","D3"],
    queries: ["ASHRAE data center cooling standard update 2026","FERC NOPR data center interconnection standard draft rule","BICSI data center infrastructure standard revision"] },
  { auto_id: "AUTO-044", source_type: "financial", ifs_domains: ["D9","D4"],
    queries: ["AI infrastructure startup Crunchbase funding announcement 2026","Y Combinator AI data center company batch 2026","seed round AI compute infrastructure new company"] },
  { auto_id: "AUTO-045", source_type: "web_news", ifs_domains: ["D1","D9"],
    queries: ["open source AI infrastructure project release GitHub 2026","hyperscaler open source data center software tool announcement","developer tool AI compute infrastructure launch"] },
  { auto_id: "AUTO-046", source_type: "social", ifs_domains: ["D1","D4","D5","D6"],
    queries: ["data center CEO CTO CDO hired resigned appointed 2026","AI infrastructure executive leadership change announcement","NVIDIA AMD Google Microsoft Meta executive role change 2026"] },
  { auto_id: "AUTO-047", source_type: "regulatory", ifs_domains: ["D15","D1","D3"],
    queries: ["BIS export control AI chip GPU 2026","US export restriction semiconductor advanced AI rule","export control announcement data center AI hardware"] },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface CrawledArtifact {
  auto_id: string;
  source_type: string;
  source_url: string;
  title: string;
  source: string;
  summary: string;
  published_at: string | null;
  ifs_domains: string[];
  keyword_matches: string[];
}

interface BatchResult {
  artifacts: CrawledArtifact[];
  rawNote: string;
  salvaged: boolean;
  rawExcerpt?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function validIso(s: string | null): string {
  if (!s) return new Date().toISOString();
  const t = Date.parse(s);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

// extractAndParse: strip fences, attempt full parse; on failure, salvage
// complete artifact objects from the truncated payload.
// Returns { artifacts, note, salvaged, rawExcerpt } — never throws.
export function extractAndParse(text: string): { artifacts: unknown[]; note: string; salvaged: boolean; rawExcerpt?: string } {
  // Tier 1: strip ```json fences and trim
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // Tier 2: locate the opening bracket and scan for balanced close
  const start = cleaned.search(/[\{\[]/);
  if (start !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = start; i < cleaned.length; i++) {
      if (cleaned[i] === "{" || cleaned[i] === "[") depth++;
      else if (cleaned[i] === "}" || cleaned[i] === "]") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const candidate = end !== -1 ? cleaned.slice(start, end + 1) : cleaned.slice(start);
    try {
      const parsed = JSON.parse(candidate);
      return { artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [], note: String(parsed.note ?? ""), salvaged: false };
    } catch { /* fall through to salvage */ }
  }

  // Tier 3: salvage — scan for complete {...} objects that look like artifacts
  const salvaged: unknown[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const objStart = cleaned.indexOf("{", i);
    if (objStart === -1) break;
    let depth = 0;
    let objEnd = -1;
    for (let j = objStart; j < cleaned.length; j++) {
      if (cleaned[j] === "{") depth++;
      else if (cleaned[j] === "}") { depth--; if (depth === 0) { objEnd = j; break; } }
    }
    if (objEnd === -1) break; // rest is truncated
    try {
      const obj = JSON.parse(cleaned.slice(objStart, objEnd + 1));
      if (obj.auto_id && obj.source_url && obj.title) salvaged.push(obj);
    } catch { /* malformed object, skip */ }
    i = objEnd + 1;
  }

  return {
    artifacts: salvaged,
    note: `salvaged ${salvaged.length} artifacts from truncated response`,
    salvaged: true,
    rawExcerpt: cleaned.slice(0, 500),
  };
}

// ─── Per-batch gather ─────────────────────────────────────────────────────────
async function gatherBatch(anthropicKey: string, batch: AutoDef[]): Promise<BatchResult> {
  const today = new Date().toISOString().slice(0, 10);
  const system = `You are the Faraday Intelligence daily web crawler. Use web_search to find genuinely recent (last 24–48h) news on AI infrastructure: data centers, GPUs/compute, power, networking, policy, capital markets.

For EACH automation, run its queries and select up to ${PER_AUTO_CAP} distinct, high-relevance, recent articles. Skip duplicates (same story across outlets). Prefer original sources.

Return ONLY a JSON object — no prose, no markdown, no backticks:
{"artifacts":[{"auto_id":"AUTO-XXX","source_type":"web_news","source_url":"https://...","title":"...","source":"Publication","summary":"2-sentence factual summary","published_at":"ISO-8601 or null","ifs_domains":["D1"],"keyword_matches":["..."]}],"note":"one-line coverage summary"}

Rules: auto_id and ifs_domains MUST come from the automation definition. source_url must be a real article URL found via search (not a homepage). Today is ${today}.`;

  const user = `Automations to run:\n${batch.map(a =>
    `- ${a.auto_id} (source_type: ${a.source_type}, domains: ${a.ifs_domains.join(",")}): ${a.queries.map(q => `"${q}"`).join("; ")}`
  ).join("\n")}\n\nReturn combined JSON now.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CRAWL_MODEL,
      max_tokens: MAX_TOKENS_PER_BATCH,
      system,
      messages: [{ role: "user", content: user }],
      tools: [{
        type: WEB_SEARCH_TOOL,
        name: "web_search",
        max_uses: MAX_SEARCHES_PER_BATCH,
        user_location: { type: "approximate", country: "US", timezone: "America/Chicago" },
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n");

  const { artifacts: rawArtifacts, note, salvaged, rawExcerpt } = extractAndParse(text);

  const valid: Record<string, AutoDef> = {};
  for (const a of batch) valid[a.auto_id] = a;

  const seen = new Set<string>();
  const perAuto: Record<string, number> = {};
  const artifacts: CrawledArtifact[] = [];
  for (const r of rawArtifacts as Record<string, unknown>[]) {
    const def = valid[String(r.auto_id ?? "")];
    if (!def || !r.source_url || !r.title) continue;
    const url = String(r.source_url).trim();
    if (seen.has(url)) continue;
    if ((perAuto[def.auto_id] ?? 0) >= PER_AUTO_CAP) continue;
    seen.add(url);
    perAuto[def.auto_id] = (perAuto[def.auto_id] ?? 0) + 1;
    artifacts.push({
      auto_id: def.auto_id,
      source_type: def.source_type,
      source_url: url,
      title: String(r.title).slice(0, 500),
      source: String(r.source ?? "").slice(0, 200),
      summary: String(r.summary ?? "").slice(0, 1000),
      published_at: typeof r.published_at === "string" ? r.published_at : null,
      ifs_domains: def.ifs_domains,
      keyword_matches: Array.isArray(r.keyword_matches) ? r.keyword_matches.slice(0, 10).map(String) : [],
    });
  }
  return { artifacts, rawNote: note, salvaged, rawExcerpt };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  const runStarted = new Date().toISOString();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (provided !== serviceKey && provided !== CRON_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  if (!anthropicKey) {
    return new Response(JSON.stringify({ skipped: true, reason: "ANTHROPIC_API_KEY not set" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Split automations into concurrent batches
  const batches: AutoDef[][] = [];
  for (let i = 0; i < AUTOMATIONS.length; i += BATCH_SIZE) {
    batches.push(AUTOMATIONS.slice(i, i + BATCH_SIZE));
  }

  // Run all batches concurrently; one failing batch never blocks the others
  const batchResults = await Promise.allSettled(
    batches.map(batch => gatherBatch(anthropicKey, batch))
  );

  // Collect all artifacts; track per-auto failures from settled rejections
  const allArtifacts: CrawledArtifact[] = [];
  const failedAutoIds = new Set<string>();
  const batchErrors: Record<string, string> = {};

  for (let bi = 0; bi < batchResults.length; bi++) {
    const result = batchResults[bi];
    const batch = batches[bi];
    if (result.status === "fulfilled") {
      allArtifacts.push(...result.value.artifacts);
      if (result.value.salvaged) {
        for (const a of batch) {
          batchErrors[a.auto_id] = `salvaged; truncated payload: ${result.value.rawExcerpt?.slice(0, 200) ?? ""}`;
        }
      }
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      for (const a of batch) {
        failedAutoIds.add(a.auto_id);
        batchErrors[a.auto_id] = msg;
      }
    }
  }

  // Build artifact rows with shared content_hash dedup
  const now = new Date().toISOString();
  const rows = await Promise.all(allArtifacts.map(async (a) => {
    const raw_content = `${a.title}\n\n${a.summary}`;
    return {
      crawler_id: `${a.auto_id}_v1.0`,
      auto_id: a.auto_id,
      source_type: a.source_type,
      source_url: a.source_url,
      raw_content,
      content_hash: await sha256Hex(raw_content),
      signal_envelope: { title: a.title, url: a.source_url, source: a.source, summary: a.summary, published_at: validIso(a.published_at), keyword_matches: a.keyword_matches },
      crawl_metadata: { crawler_version: "1.1", auto_id: a.auto_id, run_date: now.slice(0, 10), search_method: "edge_web_search_batched", crawled_at: now },
      ifs_domains: a.ifs_domains,
      published_at: validIso(a.published_at),
      discovered_at: now,
      enrich_status: "pending",
      enrich_queued_at: now,
    };
  }));

  let inserted: Array<{ auto_id: string }> = [];
  if (rows.length > 0) {
    const { data, error } = await supabase
      .from("artifacts")
      .upsert(rows, { onConflict: "content_hash", ignoreDuplicates: true })
      .select("auto_id");
    if (error) {
      console.error("artifact upsert error:", error.message);
    } else {
      inserted = data ?? [];
    }
  }

  // Per-automation health logs
  const foundByAuto: Record<string, number> = {};
  for (const a of allArtifacts) foundByAuto[a.auto_id] = (foundByAuto[a.auto_id] ?? 0) + 1;
  const newByAuto: Record<string, number> = {};
  for (const r of inserted) newByAuto[r.auto_id] = (newByAuto[r.auto_id] ?? 0) + 1;

  const healthRows = AUTOMATIONS.map(a => {
    const found = foundByAuto[a.auto_id] ?? 0;
    const fresh = newByAuto[a.auto_id] ?? 0;
    const failed = failedAutoIds.has(a.auto_id);
    const errMsg = batchErrors[a.auto_id];
    return {
      auto_id: a.auto_id,
      crawler_id: `${a.auto_id}_v1.0`,
      run_started_at: runStarted,
      run_completed_at: new Date().toISOString(),
      artifacts_found: found,
      artifacts_new: fresh,
      artifacts_duped: found - fresh,
      success: !failed,
      errors: errMsg ? [errMsg] : [],
      notes: failed
        ? `faraday-crawl batch failed: ${errMsg?.slice(0, 400)}`
        : `faraday-crawl v1.1 batched; ${found} found, ${fresh} new${errMsg ? ` (salvaged)` : ""}`,
    };
  });

  await supabase.from("automation_health_log").insert(healthRows);

  const totalFound = allArtifacts.length;
  const totalNew = inserted.length;
  return new Response(JSON.stringify({
    ok: true,
    automations_total: AUTOMATIONS.length,
    automations_failed: failedAutoIds.size,
    artifacts_found: totalFound,
    artifacts_new: totalNew,
    artifacts_duped: totalFound - totalNew,
    batches: batches.length,
  }), { headers: { "Content-Type": "application/json" } });
});
