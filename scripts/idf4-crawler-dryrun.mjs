#!/usr/bin/env node
// ============================================================================
// idf4-crawler-dryrun.mjs — execute crawler defs once in NO-WRITE mode
// (FAR-319 Wave-1 pattern, used for the Wave-3 activation set).
//
// Runs each automation's query set through the same Anthropic web_search
// gather the faraday-crawl edge function uses — one automation per call so the
// per-crawler yield is unambiguous — and prints a yield table (artifacts
// found, sub-domain tag, sample titles). NOTHING is written to Supabase or
// Airtable; there is no write path in this script at all.
//
// Usage:
//   node scripts/idf4-crawler-dryrun.mjs [--set=wave3|tier1|tier2] [--only=AUTO-138,AUTO-139] [--cap=4]
//
// Env: ANTHROPIC_API_KEY (required). Model matches the fleet (claude-sonnet-4-6,
// override with CRAWL_MODEL).
//
// NOTE 2026-07-05: blocked on the depleted Anthropic credit balance (the same
// incident stalling enrich-artifacts) — re-run after Myke tops up credits.
// ============================================================================

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CRAWL_MODEL || "claude-sonnet-4-6";
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : dflt;
};
const SET = flag("set", "wave3");
const ONLY = flag("only", "").split(",").filter(Boolean);
const CAP = Number(flag("cap", 4)) || 4;

if (!ANTHROPIC_KEY) {
  console.error("ANTHROPIC_API_KEY is required (no-write dry run still needs the gather model).");
  process.exit(1);
}

// Parse the activation arrays straight out of coverage-bridge.ts so this
// harness can never drift from the defs the edge function actually merges.
const bridgePath = path.join(path.dirname(fileURLToPath(import.meta.url)),
  "..", "supabase", "functions", "faraday-crawl", "coverage-bridge.ts");
const src = await readFile(bridgePath, "utf8");
const sectionName = { wave3: "WAVE3_ACTIVATION", tier1: "TIER1_ACTIVATION", tier2: "TIER2_ACTIVATION" }[SET];
if (!sectionName) { console.error(`unknown --set=${SET}`); process.exit(1); }
const start = src.indexOf(`export const ${sectionName}`);
const end = src.indexOf("export const", start + 10);
const section = src.slice(start, end === -1 ? undefined : end);
const defs = [...section.matchAll(/\{ auto_id: "(AUTO-\d+)", source_type: "([^"]+)", ifs_domains: \["([^"]+)"\],\s*queries: \[([^\]]*)\]/g)]
  .map((m) => ({
    auto_id: m[1],
    source_type: m[2],
    subdomain: m[3],
    queries: [...m[4].matchAll(/"([^"]+)"/g)].map((q) => q[1]),
  }))
  .filter((d) => ONLY.length === 0 || ONLY.includes(d.auto_id));

console.log(`Dry run: ${defs.length} crawlers from ${sectionName} (cap ${CAP}/crawler, model ${MODEL}) — NO WRITES.\n`);

async function gatherOne(def) {
  const today = new Date().toISOString().slice(0, 10);
  const system = `You are the Faraday Intelligence daily web crawler (DRY RUN). Use web_search to find genuinely recent (last 24-48h) news for ONE automation. Select up to ${CAP} distinct, high-relevance, recent articles; skip duplicates; prefer original sources.
Return ONLY JSON: {"artifacts":[{"auto_id":"${def.auto_id}","source_url":"https://...","title":"...","source":"Publication","published_at":"ISO-8601 or null"}],"note":"one-line coverage summary"}
Today is ${today}.`;
  const user = `Automation ${def.auto_id} (source_type: ${def.source_type}, sub-domain: ${def.subdomain}) queries:\n${def.queries.map((q) => `- "${q}"`).join("\n")}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 3000, system,
      messages: [{ role: "user", content: user }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6,
        user_location: { type: "approximate", country: "US", timezone: "America/Chicago" } }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const s = cleaned.indexOf("{");
  const parsed = JSON.parse(cleaned.slice(s));
  return Array.isArray(parsed.artifacts) ? parsed.artifacts.slice(0, CAP) : [];
}

const results = [];
for (const def of defs) {
  // Sequential + isolated: one crawler's failure (rate limit, billing, parse)
  // never aborts the rest — the 06-23 failure mode stays impossible here too.
  try {
    const artifacts = await gatherOne(def);
    results.push({ ...def, found: artifacts.length, titles: artifacts.map((a) => String(a.title ?? "").slice(0, 80)) });
    console.log(`✓ ${def.auto_id} ${def.subdomain}: ${artifacts.length} found`);
  } catch (e) {
    results.push({ ...def, found: -1, error: e.message, titles: [] });
    console.error(`✗ ${def.auto_id} ${def.subdomain}: ${e.message}`);
  }
}

console.log(`\n── Yield table (${SET}) ────────────────────────────────────────`);
console.log(`auto_id  | subdomain | found | sample titles`);
for (const r of results) {
  const yieldStr = r.found === -1 ? `FAIL (${r.error?.slice(0, 60)})` : String(r.found);
  console.log(`${r.auto_id} | ${r.subdomain.padEnd(6)} | ${yieldStr}`);
  for (const t of r.titles) console.log(`         |        |   - ${t}`);
}
const ok = results.filter((r) => r.found >= 0);
console.log(`\n${ok.length}/${results.length} crawlers ran; total artifacts found: ${ok.reduce((s, r) => s + r.found, 0)} (nothing written).`);
