#!/usr/bin/env node
// IDF 4.0 Data-Source Coverage Matrix generator (FAR — IDF-4 coverage-gap bridge)
//
// Single source of truth for this artifact. Encodes every one of the 116 IDF 4.0
// Sub-Domains (Notion 37189a0c-1680-8199-bca1-cf304a45bbde) against the live
// Automation Registry (Airtable appxfti7VuoHYUeu6 / tbl1ef6FgxUc3Uevg, snapshot
// 2026-06-23). Emits coverage-matrix.csv + coverage-matrix.md.
//
// Verdict vocabulary (four-value, per §2 DONE):
//   Dedicated-Active   — a dedicated D#.# crawler exists AND is Active in the Registry
//   Dedicated-Designed — a dedicated D#.# crawler exists but is dormant (Status=Designed)
//   Broad-only         — no dedicated crawler; an Active domain-level broad crawler hits the parent Domain
//   Whitespace         — no dedicated crawler; broad crawlers do not meaningfully reach this thread
//
// NOTE: As of the snapshot, NO dedicated sub-domain crawler is Active — the entire
// AUTO-060→119 dedicated set is Designed/dormant. So "Dedicated-Active" has zero
// rows today; it exists in the vocabulary as the post-activation target state.
//
// A `Designed` or `Broad-only` crawler is NOT coverage (§5 No fabricated coverage).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "idf4-coverage");

// Broad (domain-level, Active) crawlers that incidentally touch each Domain.
// AUTO-027 "Emerging Players Weekly" is tagged All Domains and omitted from every
// row's broad list (it touches everything; listing it adds no signal).
const BROAD_BY_DOMAIN = {
  D1: "AUTO-001, AUTO-036, AUTO-038, AUTO-040, AUTO-041, AUTO-046, AUTO-047",
  D2: "AUTO-037, AUTO-040, AUTO-041, AUTO-043",
  D3: "AUTO-003, AUTO-011, AUTO-012, AUTO-013, AUTO-016, AUTO-017, AUTO-029, AUTO-037",
  D4: "AUTO-018, AUTO-019, AUTO-020, AUTO-023, AUTO-024, AUTO-038, AUTO-042, AUTO-044, AUTO-046",
  D5: "AUTO-020, AUTO-022, AUTO-023, AUTO-030, AUTO-032, AUTO-038, AUTO-046",
  D6: "AUTO-002, AUTO-015, AUTO-019, AUTO-032, AUTO-033, AUTO-046",
  D7: "AUTO-001, AUTO-014, AUTO-021, AUTO-023, AUTO-031, AUTO-040, AUTO-041",
  D8: "AUTO-037, AUTO-046",
  D9: "AUTO-001, AUTO-014, AUTO-015, AUTO-021, AUTO-024, AUTO-034, AUTO-045",
  D10: "AUTO-028",
  D11: "AUTO-029, AUTO-031",
  D12: "AUTO-028",
  D13: "AUTO-029, AUTO-031",
  D14: "AUTO-030",
  D15: "AUTO-033, AUTO-047",
  D16: "AUTO-034",
  D17: "AUTO-032",
  D18: "AUTO-029, AUTO-052",
  D19: "AUTO-012, AUTO-013",
  D20: "—",
  D21: "AUTO-018",
  D22: "AUTO-023",
  D23: "AUTO-034",
};

// Per-sub-domain rows. dedicated: AUTO-id of the dedicated crawler (Registry name
// tags this exact D#.#) or null. dStatus: that crawler's Registry Status.
// verdict + action per the four-value rule and §3.3/§3.4 mechanism assignment.
const D = (id, name, dedicated, dStatus, verdict, action) =>
  ({ id, name, dedicated, dStatus, verdict, action });

const ROWS = [
  // D1 — Chips & Density (8)
  D("D1.1","GPU Architecture & Roadmap",null,null,"Broad-only","New crawler (NVIDIA roadmap) — Tier 1"),
  D("D1.2","Rack & Power Density Progression",null,null,"Broad-only","New crawler (OCP ORW / kW-per-rack) — Tier 1"),
  D("D1.3","Competing Silicon & Merchant Accelerators",null,null,"Broad-only","New crawler (AMD/Intel/merchant) — Tier 1"),
  D("D1.4","Memory (HBM & Next-Gen)","AUTO-060","Designed","Dedicated-Designed","Activate (Tier 1)"),
  D("D1.5","Inference-Class Silicon & Economics","AUTO-061","Designed","Dedicated-Designed","Activate (Tier 1)"),
  D("D1.6","Chip Allocation & Supply Politics",null,null,"Broad-only","New crawler (allocation/secondary mkt) — Tier 1"),
  D("D1.7","Hyperscaler-Class Silicon & Custom Accelerators","AUTO-062","Designed","Dedicated-Designed","Activate (Tier 1)"),
  D("D1.8","Advanced Packaging & Substrate Capacity","AUTO-063","Designed","Dedicated-Designed","Activate (Tier 1) + re-point: USPTO + foundry capacity"),
  // D2 — Power Architecture (10)
  D("D2.1","800V DC Power Distribution",null,null,"Broad-only","New crawler — Tier 1"),
  D("D2.2","BTM Strategy & Cross-Cutting Economics",null,null,"Broad-only","New crawler — Tier 1"),
  D("D2.3","UPS, Storage & Power Conditioning",null,null,"Broad-only","New crawler — Tier 1"),
  D("D2.4","DC Power Delivery at the Rack",null,null,"Broad-only","New crawler — Tier 1"),
  D("D2.5","Nuclear & SMR Offtake","AUTO-064","Designed","Dedicated-Designed","Activate (Tier 1) + re-point: NRC ADAMS primary source"),
  D("D2.6","Behind-the-Fence Gas & Fuel Cells","AUTO-065","Designed","Dedicated-Designed","Activate (Tier 1)"),
  D("D2.7","Renewables, Storage & PPAs for DC Power","AUTO-066","Designed","Dedicated-Designed","Activate (Tier 1)"),
  D("D2.8","Grid-Interactive Load & Demand Response","AUTO-067","Designed","Dedicated-Designed","Activate (Tier 1)"),
  D("D2.9","Microgrid Integration & Islanding",null,null,"Broad-only","New crawler — Tier 1"),
  D("D2.10","Solid-State Transformers & Advanced Power Conversion","AUTO-068","Designed","Dedicated-Designed","Activate (Tier 1)"),
  // D3 — Grid & Regulatory (5)
  D("D3.1","Interconnection Queue & Grid Access",null,null,"Broad-only","Strong broad (AUTO-003/016); monitor"),
  D("D3.2","State Moratorium & Legislative Landscape",null,null,"Broad-only","Strong broad (AUTO-013); monitor"),
  D("D3.3","Utility Rate Cases & PUC Proceedings",null,null,"Broad-only","Broad (AUTO-049/050 designed); activate w/ D18"),
  D("D3.4","Transmission Buildout & FERC Policy",null,null,"Whitespace","Primary-source connector: FERC eLibrary / Order 1920"),
  D("D3.5","Large-Load Tariff Design & Co-Location Rules",null,null,"Whitespace","Primary-source connector: FERC/PJM dockets"),
  // D4 — M&A & Capital Markets (6)
  D("D4.1","PE & Infrastructure Fund Activity",null,null,"Broad-only","Broad (AUTO-019/020); monitor"),
  D("D4.2","DC REIT Performance & Valuation",null,null,"Broad-only","Broad (AUTO-020/042); monitor"),
  D("D4.3","Sovereign Wealth & Institutional Capital",null,null,"Broad-only","Broad (AUTO-019/033); monitor"),
  D("D4.4","Integrated Infrastructure Vendor M&A",null,null,"Broad-only","Broad (AUTO-019); monitor"),
  D("D4.5","Private Credit & DC Debt Financing",null,null,"Whitespace","New crawler (4.0-new) — Tier 1.5"),
  D("D4.6","GPU-Backed & Neocloud Financing",null,null,"Whitespace","Primary-source connector: GPU-collateral/neocloud debt filings — Tier 1.5 (hot)"),
  // D5 — Hyperscaler Activity (4)
  D("D5.1","Big 5 Capex & Campus Announcements",null,null,"Broad-only","Broad (AUTO-038); monitor"),
  D("D5.2","Hyperscaler Custom Silicon Strategy",null,null,"Broad-only","Broad (AUTO-038/062-designed); monitor"),
  D("D5.3","Build-vs-Lease & Colocation Strategy",null,null,"Whitespace","Claude Routine (build-vs-lease) — 4.0-new"),
  D("D5.4","Capacity Geography & Region Expansion",null,null,"Whitespace","Claude Routine (capacity geography) — 4.0-new"),
  // D6 — New Entrants (3)
  D("D6.1","Neocloud Infrastructure",null,null,"Broad-only","Broad (AUTO-024/044); monitor"),
  D("D6.2","Sovereign AI Programs & National Compute (capital lens)",null,null,"Broad-only","Broad (AUTO-033); monitor"),
  D("D6.3","AI Labs & Model Developers as Infrastructure Buyers",null,null,"Whitespace","New crawler — Tier 1.5 (hot)"),
  // D7 — Cooling & Water Technology (4) — entire domain whitespace, flagship T-002
  D("D7.1","Direct-to-Chip Liquid Cooling (DLC)",null,null,"Whitespace","New crawler — Tier 1 (flagship T-002)"),
  D("D7.2","Immersion Cooling",null,null,"Whitespace","New crawler — Tier 1 (flagship T-002)"),
  D("D7.3","Water Use & Waterless Cooling Strategies",null,null,"Whitespace","New crawler — Tier 1 (flagship T-002)"),
  D("D7.4","Thermal Components & Coolant Supply Chain",null,null,"Whitespace","Primary-source connector: standards bodies + coolant chemistry (3M/Chemours/PFAS) — Tier 1"),
  // D8 — People & Signals (5)
  D("D8.1","Executive Movement & C-Suite Intelligence","AUTO-046","Active","Dedicated-Active","Covered (AUTO-046 Active); monitor"),
  D("D8.2","Conference Intelligence & Speaking Circuit",null,null,"Whitespace","Scheduled Cowork — after AUTO-028/029 ID conflict resolved"),
  D("D8.3","Talent Flows & Specialized Hiring Signals",null,null,"Whitespace","New crawler (hiring velocity)"),
  D("D8.4","Founder & Operator Network Mapping",null,null,"Whitespace","Scheduled Cowork (network mapping)"),
  D("D8.5","Earnings-Call & Investor-Day Signal Extraction",null,null,"Whitespace","Scheduled Cowork (earnings extraction)"),
  // D9 — Orchestration Intelligence & Control Plane (4) — whitespace, T-005
  D("D9.1","AI Factory Orchestration & DCIM",null,null,"Whitespace","New crawler — Tier 1 (T-005)"),
  D("D9.2","GPU Utilization & Compute Scheduling Economics",null,null,"Whitespace","New crawler — Tier 1 (T-005)"),
  D("D9.3","Inference Serving & Model-Routing Infrastructure",null,null,"Whitespace","New crawler — Tier 1 (T-005)"),
  D("D9.4","Power-Aware & Grid-Responsive Workload Orchestration",null,null,"Whitespace","New crawler — Tier 1 (T-005)"),
  // D10 — Construction (5)
  D("D10.1","Long-Lead Equipment & Supply Chain",null,null,"Whitespace","New crawler — Tier 1"),
  D("D10.2","GC/EPC Capacity & Stick-Built Execution",null,null,"Whitespace","New crawler — Tier 1"),
  D("D10.3","Modular & Prefabricated Delivery",null,null,"Whitespace","New crawler — Tier 1"),
  D("D10.4","Project Delivery & Schedule Intelligence","AUTO-069","Designed","Dedicated-Designed","Activate (Tier 1)"),
  D("D10.5","Construction Cost Curves & Inflation",null,null,"Whitespace","New crawler — Tier 1"),
  // D11 — Sustainability (6)
  D("D11.1","Clean Energy Procurement (PPA/REC/CFE)",null,null,"Whitespace","New crawler"),
  D("D11.2","Carbon Accounting & Scope 1-3",null,null,"Whitespace","New crawler"),
  D("D11.3","Water Stewardship & Rights","AUTO-070","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D11.4","Heat Recovery & Circular DC","AUTO-071","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D11.5","Sustainability Regulation & Disclosure","AUTO-072","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D11.6","Embodied Carbon & Materials",null,null,"Whitespace","New crawler"),
  // D12 — Networking & Interconnect (7)
  D("D12.1","Long-Haul & Dark Fiber Leasing","AUTO-073","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D12.2","Subsea Cable Systems","AUTO-074","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D12.3","AI Back-End Fabric & Interconnect","AUTO-075","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D12.4","Cross-Connect & Cloud On-Ramp","AUTO-076","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D12.5","Optical Transceivers & Co-Packaged Optics","AUTO-077","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D12.6","Small Cell, Private 5G & Terrestrial Wireless","AUTO-078","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D12.7","LEO / Satellite Broadband","AUTO-079","Designed","Dedicated-Designed","Activate (Tier 2)"),
  // D13 — Community Relations (5)
  D("D13.1","Community Benefits & Host Agreements","AUTO-080","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D13.2","Opposition Movements & Organized Groups","AUTO-081","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D13.3","Local Permitting & Entitlement Strategy","AUTO-082","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D13.4","Public Engagement Practice","AUTO-083","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D13.5","Economic Impact Narratives & Legitimacy","AUTO-084","Designed","Dedicated-Designed","Activate (Tier 2)"),
  // D14 — Real Estate & Site Selection (7)
  D("D14.1","Site Selection Methodology",null,null,"Whitespace","Scheduled Cowork (methodology synthesis)"),
  D("D14.2","Primary Market Intelligence (NA Tier 1)","AUTO-085","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D14.3","Emerging & Second-Tier Markets","AUTO-086","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D14.4","International Markets","AUTO-087","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D14.5","Land Pricing & Acquisition","AUTO-088","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D14.6","Site Certification & Readiness","AUTO-089","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D14.7","Campus Portfolio Strategy & Build Models",null,null,"Whitespace","New crawler (cross-link D5.3)"),
  // D15 — Sovereign AI & Geopolitics (6)
  D("D15.1","Chip Export Controls & Outbound Dual-Use",null,null,"Broad-only","Broad (AUTO-047 BIS Active); monitor"),
  D("D15.2","National Compute Strategies & Sovereign Programs","AUTO-090","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D15.3","Bilateral & Multilateral AI Diplomacy","AUTO-091","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D15.4","Strategic Minerals & Upstream Supply","AUTO-092","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D15.5","Data Sovereignty & Cross-Border Flows","AUTO-093","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D15.6","Inbound Investment Screening","AUTO-094","Designed","Dedicated-Designed","Activate (Tier 2)"),
  // D16 — Cyber & Physical Security and Resilience (6)
  D("D16.1","Enterprise IT & Cloud Security","AUTO-114","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D16.2","OT / ICS / SCADA Cybersecurity","AUTO-115","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D16.3","Physical Security & Access Control","AUTO-116","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D16.4","State-Sponsored & Advanced Persistent Threats","AUTO-117","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D16.5","Software Supply Chain & Vendor Risk",null,null,"Whitespace","New crawler"),
  D("D16.6","Security Operations & Incident Response",null,null,"Whitespace","New crawler"),
  // D17 — Workforce & Labor Markets (3)
  D("D17.1","Construction & Skilled Trades Labor","AUTO-119","Designed","Dedicated-Designed","Activate (Tier 2) — registry tag 'D17' → set D17.1"),
  D("D17.2","Operations & Technical Workforce","AUTO-118","Designed","Dedicated-Designed","Activate (Tier 2) — registry tag 'D17' → set D17.2"),
  D("D17.3","Immigration, Policy & Regional Labor Competition",null,null,"Whitespace","New crawler"),
  // D18 — Community Opposition & Regulatory Risk (3)
  D("D18.1","Project Opposition Register","AUTO-049","Designed","Dedicated-Designed","Activate (Tier 2) — ⚠ AUTO-049 ID collision (see findings)"),
  D("D18.2","Regulatory & Permitting Denial Tracking","AUTO-051","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D18.3","Reputational & Political Risk Register","AUTO-052","Designed","Dedicated-Designed","Claude Routine (reputational/political risk)"),
  // D19 — Tax, Incentives & Fiscal Policy (5)
  D("D19.1","State & Local Tax Incentives","AUTO-095","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D19.2","Federal Tax Policy","AUTO-096","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D19.3","International Tax & Transfer Pricing","AUTO-097","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D19.4","Tax Incentive Backlash & Clawback","AUTO-098","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D19.5","Tax-Driven Deal Structuring","AUTO-099","Designed","Dedicated-Designed","Activate (Tier 2)"),
  // D20 — Facility IT & Operational Technology (2)
  D("D20.1","Building Management Systems & HVAC Control","AUTO-100","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D20.2","Facility DCIM & Digital Twin","AUTO-101","Designed","Dedicated-Designed","Activate (Tier 2)"),
  // D21 — Insurance & Risk Markets (4)
  D("D21.1","DC Property & Casualty Insurance","AUTO-102","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D21.2","Cyber Insurance & Tech E&O","AUTO-103","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D21.3","Climate & Parametric Risk Products","AUTO-104","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D21.4","Lender Insurance & Risk Transfer","AUTO-105","Designed","Dedicated-Designed","Activate (Tier 2)"),
  // D22 — Industry Media & Analyst Coverage (4)
  D("D22.1","U.S. Media Coverage","AUTO-106","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D22.2","EU Media Coverage","AUTO-107","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D22.3","APAC / LATAM / MENA Media Coverage","AUTO-108","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D22.4","Industry Analysts","AUTO-109","Designed","Dedicated-Designed","Activate (Tier 2)"),
  // D23 — Outage Intelligence & Emergency Response (4)
  D("D23.1","Major Outage Postmortems","AUTO-110","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D23.2","Grid Events & Physical Disasters","AUTO-111","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D23.3","Cyber Incidents Targeting DC Infrastructure","AUTO-112","Designed","Dedicated-Designed","Activate (Tier 2)"),
  D("D23.4","Business Continuity & Disaster Recovery","AUTO-113","Designed","Dedicated-Designed","Activate (Tier 2)"),
];

// ── Validation: exactly 116, counts per Domain match the 4.0 canon ──────────────
const CANON_COUNTS = { D1:8,D2:10,D3:5,D4:6,D5:4,D6:3,D7:4,D8:5,D9:4,D10:5,D11:6,D12:7,D13:5,D14:7,D15:6,D16:6,D17:3,D18:3,D19:5,D20:2,D21:4,D22:4,D23:4 };
const counts = {};
for (const r of ROWS) { const dom = r.id.split(".")[0]; counts[dom] = (counts[dom]||0)+1; }
let ok = ROWS.length === 116;
for (const [dom, n] of Object.entries(CANON_COUNTS)) if (counts[dom] !== n) { ok = false; console.error(`COUNT MISMATCH ${dom}: have ${counts[dom]||0}, canon ${n}`); }
if (ROWS.length !== 116) console.error(`ROW COUNT ${ROWS.length} != 116`);
if (!ok) process.exit(1);

// ── Verdict tally ───────────────────────────────────────────────────────────────
const tally = {};
for (const r of ROWS) tally[r.verdict] = (tally[r.verdict]||0)+1;

// ── Emit CSV ────────────────────────────────────────────────────────────────────
const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
const header = ["Sub-Domain","Name","Dedicated Crawler","Dedicated Status","Broad Crawlers (Active, parent Domain)","Coverage Verdict","Bridging Action"];
const csvLines = [header.map(esc).join(",")];
for (const r of ROWS) {
  const dom = r.id.split(".")[0];
  csvLines.push([
    r.id, r.name, r.dedicated || "—", r.dStatus || "—",
    BROAD_BY_DOMAIN[dom] || "—", r.verdict, r.action,
  ].map(esc).join(","));
}

// ── Emit Markdown ───────────────────────────────────────────────────────────────
const md = [];
md.push("# IDF 4.0 — Data-Source Coverage Matrix");
md.push("");
md.push("_Generated by `scripts/idf4-coverage-matrix.mjs`. Registry snapshot 2026-06-23 (Airtable `appxfti7VuoHYUeu6` / `tbl1ef6FgxUc3Uevg`). Canon: Notion `37189a0c-1680-8199-bca1-cf304a45bbde`._");
md.push("");
md.push("**116 Sub-Domains · 23 Domains.** A `Designed` or `Broad-only` crawler is **not** coverage. `AUTO-027` (All Domains) is omitted from every broad list — it touches everything.");
md.push("");
md.push("## Verdict tally");
md.push("");
md.push("| Verdict | Count |");
md.push("|---|---|");
for (const v of ["Dedicated-Active","Dedicated-Designed","Broad-only","Whitespace"]) md.push(`| ${v} | ${tally[v]||0} |`);
md.push(`| **Total** | **${ROWS.length}** |`);
md.push("");
md.push("## Matrix");
md.push("");
md.push("| Sub-Domain | Name | Dedicated | Status | Broad (parent Domain) | Verdict | Bridging Action |");
md.push("|---|---|---|---|---|---|---|");
for (const r of ROWS) {
  const dom = r.id.split(".")[0];
  md.push(`| ${r.id} | ${r.name} | ${r.dedicated||"—"} | ${r.dStatus||"—"} | ${BROAD_BY_DOMAIN[dom]||"—"} | ${r.verdict} | ${r.action} |`);
}
md.push("");

import { mkdirSync } from "node:fs";
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "coverage-matrix.csv"), csvLines.join("\n") + "\n");
writeFileSync(join(OUT_DIR, "coverage-matrix.md"), md.join("\n"));
console.log(`OK — ${ROWS.length} rows. Verdict tally:`, tally);
console.log(`Wrote ${OUT_DIR}/coverage-matrix.{csv,md}`);
