// FAR-287 — Build the cached IDF 4.0 taxonomy snapshot the calendar generator
// draws from. Pure/deterministic, no network: reads committed inputs
//   scripts/far287/idf-threads.json          (116 Threads: code, domain, tags, name)
//   docs/idf4-coverage/coverage-matrix.csv   (FAR-199 per-Thread coverage verdict)
// and writes scripts/far287/idf-taxonomy-snapshot.json.
//
// The affinity graph (Theater -> [Sector]) is derived BOTTOM-UP from Thread Theme
// tags (per the FAR-287 drift resolution), using NON-CANDIDATE Threads only. A
// Thread tagged all 7 Themes (D8.2, D22.x) is valid against every Theater.
//
// Run: node scripts/far287/build-snapshot.mjs   (validate graph separately vs SQL)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

export const REGISTRY_VERSION = "IDF 4.0";
export const NOTION_PAGE = "37189a0c16808199bca1cf304a45bbde";

// Candidate-maturity Threads (Notion §05, below the 8-artifact activation
// threshold) — excluded from puzzle material per rotation rule 4.
export const CANDIDATE_THREADS = new Set([
  "D12.4", "D12.6", "D12.7", "D13.4", "D13.5", "D14.6", "D14.7",
]);

// Theaters (Notion §03). Public-facing names.
export const THEATERS = [
  { id: "T-001", name: "The Power Reckoning",     tagline: "The grid wasn't built for this." },
  { id: "T-002", name: "The Thermal Reckoning",   tagline: "Air is over. The question is what replaces it." },
  { id: "T-003", name: "The Consent Crisis",      tagline: "Communities are the new permitting authority." },
  { id: "T-004", name: "The Capital Concentration", tagline: "Fewer hands. More capital. Higher stakes." },
  { id: "T-005", name: "The Inference Economy",   tagline: "Training built the factories. Inference fills them." },
  { id: "T-006", name: "The Sovereign AI Race",   tagline: "Compute is the new strategic reserve." },
  { id: "T-007", name: "The New Energy Stack",    tagline: "The grid is no longer the default." },
];

// Sectors (Notion §04 Domain display names). All Domain-level maturity = Established.
export const SECTORS = {
  D1:  "Chips & Density",
  D2:  "Power Architecture",
  D3:  "Grid & Regulatory",
  D4:  "M&A & Capital Markets",
  D5:  "Hyperscaler Activity",
  D6:  "New Entrants",
  D7:  "Cooling & Water Technology",
  D8:  "People & Signals",
  D9:  "Orchestration Intelligence & Control Plane",
  D10: "Construction",
  D11: "Sustainability",
  D12: "Networking & Interconnect",
  D13: "Community Relations",
  D14: "Real Estate & Site Selection",
  D15: "Sovereign AI & Geopolitics",
  D16: "Cyber & Physical Security and Resilience",
  D17: "Workforce & Labor Markets",
  D18: "Community Opposition & Regulatory Risk",
  D19: "Tax, Incentives & Fiscal Policy",
  D20: "Facility IT & Operational Technology",
  D21: "Insurance & Risk Markets",
  D22: "Industry Media & Analyst Coverage",
  D23: "Outage Intelligence & Emergency Response",
};

// JPAS tiers (public.jpas_tiers) — INTERNAL ONLY, never surfaced to subscribers.
export const JPAS_TIERS = [
  { code: "PWR", name: "Power & Energy" },
  { code: "REG", name: "Regulatory Environment" },
  { code: "LBR", name: "Labor & Workforce" },
  { code: "ENV", name: "Environmental Risk" },
  { code: "WTR", name: "Water & Cooling Readiness" },
  { code: "RSC", name: "Real Estate / Site" },
  { code: "INC", name: "Incentives" },
  { code: "COM", name: "Community & Social" },
  { code: "NET", name: "Network & Connectivity Infrastructure" },
];

// ── minimal RFC-4180 CSV parse (fields may be quoted & contain commas) ─────────
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Coverage verdict per Thread from the FAR-199 matrix -> grade {Dedicated|Broad-only|Whitespace}.
function loadCoverage() {
  const rows = parseCsv(readFileSync(join(REPO, "docs/idf4-coverage/coverage-matrix.csv"), "utf8"));
  const header = rows[0];
  const codeIdx = header.indexOf("Sub-Domain");
  const verdictIdx = header.indexOf("Coverage Verdict");
  const map = {};
  for (const r of rows.slice(1)) {
    if (!r[codeIdx]) continue;
    const v = r[verdictIdx] || "";
    map[r[codeIdx]] = v.startsWith("Dedicated") ? "Dedicated"
      : v === "Broad-only" ? "Broad-only" : "Whitespace";
  }
  return map;
}
const COVERAGE_RANK = { Dedicated: 3, "Broad-only": 2, Whitespace: 1 };

function build() {
  const threads = JSON.parse(readFileSync(join(HERE, "idf-threads.json"), "utf8"));
  const coverage = loadCoverage();

  // annotate threads
  for (const t of threads) {
    t.is_candidate = CANDIDATE_THREADS.has(t.code);
    t.coverage_grade = coverage[t.code] || "Whitespace";
    t.sector_name = SECTORS[t.domain];
  }

  // Affinity graph: for each (theater, sector), the eligible NON-CANDIDATE threads.
  const pairs = {}; // key `${theater}|${sector}` -> { theater, sector, threads:[codes], coverage }
  for (const th of THEATERS) {
    for (const t of threads) {
      if (t.is_candidate) continue;
      if (!t.theme_tags.includes(th.id)) continue;
      const key = `${th.id}|${t.domain}`;
      (pairs[key] ??= { theater_id: th.id, sector_code: t.domain, threads: [], best_coverage: "Whitespace" }).threads.push(t.code);
    }
  }
  for (const p of Object.values(pairs)) {
    p.best_coverage = p.threads
      .map((c) => threads.find((t) => t.code === c).coverage_grade)
      .reduce((a, b) => (COVERAGE_RANK[b] > COVERAGE_RANK[a] ? b : a), "Whitespace");
  }

  const pairList = Object.values(pairs).sort((a, b) =>
    a.theater_id.localeCompare(b.theater_id) || a.sector_code.localeCompare(b.sector_code, undefined, { numeric: true }));

  // single-theater sectors (appear under exactly one theater) -> relaxed floor
  const sectorTheaters = {};
  for (const p of pairList) (sectorTheaters[p.sector_code] ??= new Set()).add(p.theater_id);
  const singleTheaterSectors = Object.entries(sectorTheaters)
    .filter(([, s]) => s.size === 1).map(([code]) => code).sort();

  const snapshot = {
    generated_from: { registry_version: REGISTRY_VERSION, notion_page: NOTION_PAGE,
      supabase_project: "ycadmmngkdhvpcsrcuaq", coverage_matrix: "docs/idf4-coverage/coverage-matrix.csv" },
    theaters: THEATERS,
    sectors: SECTORS,
    jpas_tiers: JPAS_TIERS,
    candidate_threads: [...CANDIDATE_THREADS].sort(),
    threads,
    pairs: pairList,
    derived: {
      pair_count: pairList.length,
      triple_pool: pairList.length * JPAS_TIERS.length,
      per_theater: THEATERS.map((t) => ({ theater_id: t.id,
        sectors: pairList.filter((p) => p.theater_id === t.id).map((p) => p.sector_code) })),
      single_theater_sectors: singleTheaterSectors,
      sectors_covered: [...new Set(pairList.map((p) => p.sector_code))].length,
    },
  };

  writeFileSync(join(HERE, "idf-taxonomy-snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");
  return snapshot;
}

const s = build();
console.log(`threads: ${s.threads.length} (candidates ${s.candidate_threads.length})`);
console.log(`pairs: ${s.derived.pair_count} | triple pool: ${s.derived.triple_pool} | sectors covered: ${s.derived.sectors_covered}/23`);
console.log(`single-theater sectors (relaxed floor 9): ${s.derived.single_theater_sectors.join(", ") || "none"}`);
for (const pt of s.derived.per_theater) console.log(`  ${pt.theater_id}: ${pt.sectors.length} sectors [${pt.sectors.join(", ")}]`);
