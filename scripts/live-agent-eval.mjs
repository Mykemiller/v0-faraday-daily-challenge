// CC-06 / FAR-29 — Live Agent eval harness.
//
// Scores the no-confabulation behaviour against eval/live-agent-eval.jsonl:
//   • "grounded" cases must return a grounded answer WITH ≥1 citation.
//   • "refuse"   cases must decline (grounded:false) — the corpus-gap guard.
//
// Two modes (auto-selected):
//
//   FULL (end-to-end) — set LIVE_AGENT_URL + LIVE_AGENT_TOKEN:
//     LIVE_AGENT_URL=https://faraday-intelligence.ai/api/live-agent \
//     LIVE_AGENT_TOKEN=<a valid dc_sessions token for an entitled subscriber> \
//     node scripts/live-agent-eval.mjs
//   Exercises retrieval → grounding → generation → citations through the route.
//
//   RETRIEVAL (gate only) — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY:
//     SUPABASE_SERVICE_ROLE_KEY=… node scripts/live-agent-eval.mjs
//   Calls the search_artifacts_text RPC and applies the same grounding gate
//   (COVERAGE_FLOOR) the route uses — no generation, no token spend. Requires
//   the live_agent_rag migration applied to the target project.
//
// Exit code is non-zero if the pass rate is below PASS_THRESHOLD.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_PATH = join(HERE, "..", "eval", "live-agent-eval.jsonl");
const COVERAGE_FLOOR = 0.34; // keep in sync with src/lib/live-agent.ts
const PASS_THRESHOLD = 0.9;

function loadCases() {
  return readFileSync(EVAL_PATH, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// One case → { grounded:boolean, citations:number } as the system would answer.
async function runFull(c, url, token) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: c.q, token, request_id: `eval-${c.id}` }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 402/403 are entitlement problems with the eval token, not model behaviour.
    throw new Error(`HTTP ${res.status}: ${data.error || "error"}`);
  }
  return { grounded: data.grounded === true, citations: (data.citations || []).length };
}

async function runRetrieval(c, base, key) {
  const res = await fetch(`${base}/rest/v1/rpc/search_artifacts_text`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query_text: c.q, match_count: 8 }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  const maxCoverage = rows.reduce((m, r) => Math.max(m, r.coverage ?? 0), 0);
  const grounded = rows.length > 0 && maxCoverage >= COVERAGE_FLOOR;
  return { grounded, citations: grounded ? Math.min(rows.length, 6) : 0 };
}

function judge(c, out) {
  if (c.expect === "grounded") return out.grounded && out.citations >= 1;
  if (c.expect === "refuse") return !out.grounded;
  return false;
}

async function main() {
  const cases = loadCases();
  const url = process.env.LIVE_AGENT_URL;
  const token = process.env.LIVE_AGENT_TOKEN;
  const base = process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let mode, run;
  if (url && token) {
    mode = "FULL";
    run = (c) => runFull(c, url, token);
  } else if (key) {
    mode = "RETRIEVAL";
    run = (c) => runRetrieval(c, base, key);
  } else {
    console.error(
      "No mode configured. Set LIVE_AGENT_URL + LIVE_AGENT_TOKEN (full), or SUPABASE_SERVICE_ROLE_KEY (retrieval).",
    );
    process.exit(2);
  }

  console.log(`Live Agent eval — mode=${mode}, ${cases.length} cases\n`);
  let pass = 0;
  const fails = [];
  for (const c of cases) {
    try {
      const out = await run(c);
      const ok = judge(c, out);
      if (ok) pass++;
      else fails.push(`${c.id} (${c.expect}) → grounded=${out.grounded} cites=${out.citations}`);
      console.log(`${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(7)} expect=${c.expect.padEnd(9)} grounded=${out.grounded} cites=${out.citations}`);
    } catch (e) {
      fails.push(`${c.id}: ${e.message}`);
      console.log(`ERR   ${c.id.padEnd(7)} ${e.message}`);
    }
  }

  const rate = pass / cases.length;
  console.log(`\nPass rate: ${pass}/${cases.length} = ${(rate * 100).toFixed(1)}%`);
  if (fails.length) console.log("Failures:\n  " + fails.join("\n  "));
  process.exit(rate >= PASS_THRESHOLD ? 0 : 1);
}

main();
