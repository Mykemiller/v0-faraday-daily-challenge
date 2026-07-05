#!/usr/bin/env node
// ============================================================================
// idf4-subdomain-backfill.mjs — classify existing artifacts into IDF 4.0
// sub-domains (FAR-319 Wave 0).
//
// DRY-RUN BY DEFAULT. Nothing is written unless --write is passed, and --write
// requires the ifs_subdomains column (migration 20260705000001) to be applied.
//
// Two phases:
//   Phase A (deterministic, no LLM): dedicated-crawler artifacts already carry
//     D#.# codes inside ifs_domains (the pre-Wave-0 convention). Split them:
//     D#.# → ifs_subdomains, derived parent D# → ifs_domains. Codes are
//     validated against the live faraday_subdomains registry (116 rows).
//   Phase B (LLM, precision-gated): domain-only and untagged artifacts are
//     classified by Claude against the registry rows for their tagged domains
//     (all 116 for untagged). Only `confidence: "high"` assignments whose
//     parent domain is consistent with the artifact's existing tags are kept.
//     No confident match → the artifact keeps its domain-only tags. Precision
//     over recall: no forced assignments, ever.
//
// Usage:
//   node scripts/idf4-subdomain-backfill.mjs [--phase=a|b|all] [--limit=N]
//        [--sample=25] [--write]
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (required)
//   ANTHROPIC_API_KEY                          (required for phase B)
//   BACKFILL_MODEL                             (default claude-sonnet-4-6,
//                                               matches the fleet CRAWL_MODEL)
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.BACKFILL_MODEL || "claude-sonnet-4-6";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  return hit.includes("=") ? hit.split("=")[1] : true;
};
const WRITE = flag("write", false) === true;
const PHASE = String(flag("phase", "all")).toLowerCase();
const LIMIT = Number(flag("limit", 0)) || 0; // 0 = no limit
const SAMPLE = Number(flag("sample", 25)) || 25;

const SUB_RE = /^D\d+\.\d+$/;
const DOM_RE = /^D\d+$/;
const PAGE = 1000;
const LLM_BATCH = 15; // artifacts per Anthropic call — small enough to never truncate
const WRITE_CONCURRENCY = 8;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const rest = async (path, init = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
};

// splitIfsTags — mirror of the pure helper in faraday-crawl/index.ts.
function splitIfsTags(tags, registry) {
  const domains = new Set();
  const subdomains = new Set();
  for (const raw of tags ?? []) {
    const t = String(raw).trim();
    if (!t) continue;
    if (SUB_RE.test(t)) {
      if (registry.has(t)) {
        subdomains.add(t);
        domains.add(t.split(".")[0]);
      } else {
        // Format-valid but not in the 116-row canon — keep the parent domain
        // so the artifact is never orphaned, drop the unknown code.
        domains.add(t.split(".")[0]);
      }
    } else {
      domains.add(t);
    }
  }
  return { domains: [...domains].sort(), subdomains: [...subdomains].sort() };
}

async function fetchRegistry() {
  const rows = await rest("faraday_subdomains?select=subdomain_code,domain_code,display_name&order=subdomain_code&limit=200");
  if (rows.length < 116) throw new Error(`faraday_subdomains has ${rows.length} rows — expected 116. Aborting (registry is the label canon).`);
  return rows;
}

async function fetchAllArtifacts() {
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await rest(
      `artifacts?select=artifact_id,auto_id,ifs_domains,raw_content,signal_envelope&order=discovered_at.desc&limit=${PAGE}&offset=${offset}`,
    );
    all.push(...page);
    if (page.length < PAGE || (LIMIT && all.length >= LIMIT)) break;
  }
  return LIMIT ? all.slice(0, LIMIT) : all;
}

const titleOf = (a) =>
  (a.signal_envelope?.title || String(a.raw_content ?? "").split("\n")[0] || "").slice(0, 90);

// ── Phase B: LLM classification, precision-gated ─────────────────────────────
async function classifyBatch(batch, registryRows, registrySet) {
  const labelLines = (domains) =>
    registryRows
      .filter((r) => domains.length === 0 || domains.includes(r.domain_code))
      .map((r) => `${r.subdomain_code} — ${r.display_name} (domain ${r.domain_code})`)
      .join("\n");

  const items = batch.map((a) => {
    const domains = (a.ifs_domains ?? []).filter((t) => DOM_RE.test(t));
    return { id: a.artifact_id, domains, title: titleOf(a), summary: String(a.signal_envelope?.summary ?? "").slice(0, 400) };
  });

  const system = `You classify AI-infrastructure news artifacts into IDF 4.0 sub-domains.
For each artifact, choose 0–3 sub-domain codes ONLY from the allowed list given for that artifact. If no sub-domain clearly and specifically matches, return an empty list — a wrong assignment is worse than none. Return ONLY JSON:
{"classifications":[{"artifact_id":"...","subdomains":["D1.4"],"confidence":"high|medium|low"}]}
Set confidence "high" only when the artifact's title/summary is unmistakably about that sub-domain's specific topic.`;

  const user = items
    .map((it) =>
      `ARTIFACT ${it.id}\nExisting domains: ${it.domains.join(",") || "(none)"}\nTitle: ${it.title}\nSummary: ${it.summary}\nAllowed sub-domains:\n${labelLines(it.domains)}`,
    )
    .join("\n\n---\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const parsed = JSON.parse(cleaned.slice(start));

  const byId = new Map(items.map((it) => [it.id, it]));
  const out = new Map();
  for (const c of parsed.classifications ?? []) {
    const item = byId.get(String(c.artifact_id));
    if (!item || c.confidence !== "high" || !Array.isArray(c.subdomains)) continue;
    const valid = c.subdomains
      .map(String)
      .filter((s) => SUB_RE.test(s) && registrySet.has(s))
      // domain-consistency: if the artifact has domain tags, the sub-domain's
      // parent must be one of them (untagged artifacts skip this check).
      .filter((s) => item.domains.length === 0 || item.domains.includes(s.split(".")[0]));
    if (valid.length) out.set(item.id, [...new Set(valid)].sort());
  }
  return out;
}

async function writeUpdates(updates) {
  let done = 0;
  const queue = [...updates];
  const worker = async () => {
    for (;;) {
      const u = queue.shift();
      if (!u) return;
      await rest(`artifacts?artifact_id=eq.${u.artifact_id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(u.patch),
      });
      done++;
      if (done % 200 === 0) console.log(`  … ${done}/${updates.length} written`);
    }
  };
  await Promise.all(Array.from({ length: WRITE_CONCURRENCY }, worker));
  return done;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const registryRows = await fetchRegistry();
const registrySet = new Set(registryRows.map((r) => r.subdomain_code));
console.log(`Registry loaded: ${registryRows.length} sub-domains. Mode: ${WRITE ? "WRITE" : "DRY-RUN"}, phase=${PHASE}${LIMIT ? `, limit=${LIMIT}` : ""}`);

const artifacts = await fetchAllArtifacts();
console.log(`Artifacts fetched: ${artifacts.length}`);

const hasSub = (a) => (a.ifs_domains ?? []).some((t) => SUB_RE.test(String(t)));
const phaseARows = artifacts.filter(hasSub);
const phaseBRows = artifacts.filter((a) => !hasSub(a));

const sample = [];
const updates = [];

// Phase A — deterministic split
if (PHASE === "a" || PHASE === "all") {
  for (const a of phaseARows) {
    const { domains, subdomains } = splitIfsTags(a.ifs_domains, registrySet);
    updates.push({ artifact_id: a.artifact_id, patch: { ifs_domains: domains, ifs_subdomains: subdomains } });
    if (sample.length < SAMPLE) {
      sample.push({ method: "deterministic", id: a.artifact_id, title: titleOf(a), old: a.ifs_domains, domains, subdomains });
    }
  }
  console.log(`\nPhase A (deterministic): ${phaseARows.length} artifacts get ifs_subdomains from existing D#.# tags.`);
}

// Phase B — LLM classification of domain-only / untagged artifacts
if (PHASE === "b" || PHASE === "all") {
  if (!ANTHROPIC_KEY) {
    console.log(`\nPhase B SKIPPED: ANTHROPIC_API_KEY not set. ${phaseBRows.length} domain-only/untagged artifacts pending.`);
  } else {
    console.log(`\nPhase B (LLM, model ${MODEL}): classifying ${phaseBRows.length} domain-only/untagged artifacts …`);
    let classified = 0;
    let kept = 0;
    for (let i = 0; i < phaseBRows.length; i += LLM_BATCH) {
      const batch = phaseBRows.slice(i, i + LLM_BATCH);
      try {
        const results = await classifyBatch(batch, registryRows, registrySet);
        for (const a of batch) {
          classified++;
          const subs = results.get(a.artifact_id);
          if (!subs) continue; // precision gate: keeps domain-only tags
          kept++;
          updates.push({ artifact_id: a.artifact_id, patch: { ifs_subdomains: subs } });
          if (sample.length < SAMPLE) {
            sample.push({ method: "llm", id: a.artifact_id, title: titleOf(a), old: a.ifs_domains, domains: a.ifs_domains, subdomains: subs });
          }
        }
      } catch (e) {
        // One failing batch (rate limit, parse, billing) never aborts the run.
        console.error(`  batch ${i / LLM_BATCH} failed, skipping its ${batch.length} artifacts: ${e.message}`);
      }
      if (classified % 300 < LLM_BATCH) console.log(`  … ${classified}/${phaseBRows.length} examined, ${kept} confidently assigned`);
    }
    console.log(`Phase B: ${kept}/${phaseBRows.length} artifacts confidently assigned; the rest keep domain-only tags (no forced assignments).`);
  }
}

// Sample table
console.log(`\n── Sample (${sample.length}) ─────────────────────────────────────────`);
for (const s of sample) {
  console.log(`[${s.method}] ${s.id}\n  ${s.title}\n  ${JSON.stringify(s.old)} → domains ${JSON.stringify(s.domains)} · subdomains ${JSON.stringify(s.subdomains)}`);
}

if (!WRITE) {
  console.log(`\nDRY-RUN complete: ${updates.length} artifact updates computed, 0 written. Re-run with --write after approval.`);
} else {
  console.log(`\nWriting ${updates.length} updates …`);
  const done = await writeUpdates(updates);
  console.log(`Done: ${done} artifacts updated.`);
}
