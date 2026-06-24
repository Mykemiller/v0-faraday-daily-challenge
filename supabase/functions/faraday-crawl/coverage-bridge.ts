// Faraday — IDF 4.0 Coverage-Gap Bridge config (FAR IDF-4)
// =============================================================================
// INERT BY DESIGN. Nothing in this module is wired into the live crawl loop in
// index.ts. It is a config-only scaffold staged for review.
//
// Two governance gates (see CLAUDE.md / prompt §6 Boundaries) keep this dormant:
//   1. Flipping any Registry crawler Designed → Active is human-gated (Myke).
//   2. Assigning any new AUTO-### ID is human-gated. New routines below carry
//      PLACEHOLDER ids ("AUTO-NEW-##") until Myke grants a contiguous block.
//      NEXT FREE REAL ID IS **AUTO-137** — NOT AUTO-134. AUTO-134/135/136 are
//      already Active (engine-idf-entities / engine-prognostications /
//      engine-two-analyst). The prompt's "next free = AUTO-134" is stale.
//
// To activate after approval: import TIER1_ACTIVATION / approved whitespace defs
// into index.ts's AUTOMATIONS array (mergeApproved), deploy via branch+PR, run a
// dry run that writes to automation_health_log, THEN flip Status in Airtable.
// Never flip Status before the dry run succeeds (§2 DONE).
// =============================================================================

// Mirror of index.ts AutoDef so this file stays self-contained for review/tests.
export interface AutoDef {
  auto_id: string;
  source_type: string;
  ifs_domains: string[];
  queries: string[];
}

export interface ScaffoldDef extends AutoDef {
  subdomain: string;          // canonical D#.# this routine owns
  placeholder: boolean;        // true => auto_id is a placeholder pending Myke's block
  mechanism: "crawler" | "primary_source" | "cowork" | "claude_routine";
  cadence: string;             // staggered — do not stack on one 06:00 window (§5)
  postgres_insert: string;     // artifacts table insert contract
  primary_source?: string;     // for primary_source / re-point routines
  notes?: string;
}

// ── TIER 1 — dormant DEDICATED crawlers ready to activate (real AUTO-IDs) ───────
// These already exist in the Registry as Status=Designed. Queries authored here;
// source_type matches the Registry row. Merge into AUTOMATIONS on approval.
export const TIER1_ACTIVATION: AutoDef[] = [
  { auto_id: "AUTO-060", source_type: "web_news", ifs_domains: ["D1.4"],
    queries: ["HBM4 HBM4E supply SK Hynix Samsung Micron 2026", "high bandwidth memory data center GPU shortage allocation", "CXL PIM memory bandwidth inference cost 2026"] },
  { auto_id: "AUTO-061", source_type: "web_news", ifs_domains: ["D1.5"],
    queries: ["Groq Cerebras SambaNova Etched inference chip 2026", "inference silicon TCO per token latency economics", "inference accelerator deployment hyperscaler 2026"] },
  { auto_id: "AUTO-062", source_type: "web_news", ifs_domains: ["D1.7"],
    queries: ["AWS Trainium Inferentia Google TPU Meta MTIA Microsoft Maia 2026", "hyperscaler custom AI silicon announcement", "custom accelerator tape-out roadmap data center"] },
  { auto_id: "AUTO-063", source_type: "web_news", ifs_domains: ["D1.8"],
    queries: ["TSMC CoWoS advanced packaging capacity 2026", "SoIC Foveros substrate Ibiden Shinko supply", "advanced packaging constraint AI accelerator 2026"] },
  { auto_id: "AUTO-064", source_type: "web_news", ifs_domains: ["D2.5"],
    queries: ["Oklo X-energy NuScale Kairos TerraPower data center offtake 2026", "SMR nuclear data center power agreement", "nuclear restart data center PPA NRC 2026"] },
  { auto_id: "AUTO-065", source_type: "web_news", ifs_domains: ["D2.6"],
    queries: ["behind the fence gas turbine data center 2026", "Bloom Energy fuel cell data center deployment", "Exxon Chevron data center power generation entry"] },
  { auto_id: "AUTO-066", source_type: "web_news", ifs_domains: ["D2.7"],
    queries: ["data center renewable PPA solar wind storage 2026", "long duration storage data center power contract", "24/7 carbon free energy data center procurement"] },
  { auto_id: "AUTO-067", source_type: "regulatory", ifs_domains: ["D2.8"],
    queries: ["grid interactive load data center demand response 2026", "flexible load curtailment data center interconnection", "load shifting data center grid FERC 2026"] },
  { auto_id: "AUTO-068", source_type: "web_news", ifs_domains: ["D2.10"],
    queries: ["solid state transformer data center ABB Hitachi GE Vernova 2026", "advanced power conversion data center Eaton Heron", "medium voltage power conversion data center 2026"] },
  { auto_id: "AUTO-069", source_type: "web_news", ifs_domains: ["D10.4"],
    queries: ["data center project delivery schedule slippage 2026", "announced vs delivered data center timeline delay", "phased data center delivery construction milestone 2026"] },
];

// ── WHITESPACE — NEW routines (PLACEHOLDER ids; flip to real AUTO-137+ on grant) ─
// Mechanism per §3.4. source/queries are the config-driven source list. Each
// declares its cadence (staggered) + the artifacts-table insert contract. None
// run until (a) Myke grants the AUTO-ID block and (b) they're merged + deployed.
export const WHITESPACE_SCAFFOLDS: ScaffoldDef[] = [
  // ---- Tier 1: D7 Cooling (entire domain whitespace — flagship T-002) ----
  { auto_id: "AUTO-NEW-01", placeholder: true, mechanism: "crawler", subdomain: "D7.1", source_type: "web_news",
    cadence: "daily 06:05 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D7.1'])",
    ifs_domains: ["D7.1"], queries: ["direct to chip liquid cooling CDU Vertiv CoolIT Motivair JetCool 2026", "DLC cold plate data center deployment", "liquid cooling capex data center 2026"] },
  { auto_id: "AUTO-NEW-02", placeholder: true, mechanism: "crawler", subdomain: "D7.2", source_type: "web_news",
    cadence: "daily 06:10 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D7.2'])",
    ifs_domains: ["D7.2"], queries: ["immersion cooling Submer Iceotope LiquidStack 2026", "two-phase immersion data center TCO", "immersion vs DLC data center deployment 2026"] },
  { auto_id: "AUTO-NEW-03", placeholder: true, mechanism: "crawler", subdomain: "D7.3", source_type: "web_news",
    cadence: "daily 06:15 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D7.3'])",
    ifs_domains: ["D7.3"], queries: ["data center water use WUE waterless cooling 2026", "data center water stress drought siting", "evaporative cooling alternative data center 2026"] },
  { auto_id: "AUTO-NEW-04", placeholder: true, mechanism: "primary_source", subdomain: "D7.4", source_type: "web_news",
    cadence: "weekly Mon 07:00 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D7.4'])",
    primary_source: "ASHRAE/standards bodies + coolant-chemistry vendors (3M/Chemours PFAS exit, Boyd, Parker, Danfoss)",
    ifs_domains: ["D7.4"], queries: ["coolant chemistry PG25 two-phase dielectric PFAS-free data center 2026", "3M Chemours fluorinated fluid exit data center coolant", "cold plate manifold quick disconnect supply constraint 2026"] },
  // ---- Tier 1: D9 Orchestration (whitespace — T-005) ----
  { auto_id: "AUTO-NEW-05", placeholder: true, mechanism: "crawler", subdomain: "D9.1", source_type: "web_news",
    cadence: "daily 06:20 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D9.1'])",
    ifs_domains: ["D9.1"], queries: ["NVIDIA DSX NVL72 AI factory orchestration DCIM 2026", "AI factory cluster management software 2026", "data center orchestration control plane announcement"] },
  { auto_id: "AUTO-NEW-06", placeholder: true, mechanism: "crawler", subdomain: "D9.2", source_type: "web_news",
    cadence: "daily 06:25 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D9.2'])",
    ifs_domains: ["D9.2"], queries: ["run:ai GPU utilization scheduling multi-tenancy 2026", "GPU compute scheduling economics benchmark", "GPU utilization optimization data center 2026"] },
  { auto_id: "AUTO-NEW-07", placeholder: true, mechanism: "crawler", subdomain: "D9.3", source_type: "web_news",
    cadence: "daily 06:30 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D9.3'])",
    ifs_domains: ["D9.3"], queries: ["vLLM TensorRT-LLM Triton inference serving model routing 2026", "KV cache management inference control plane", "model router token economics scheduling 2026"] },
  { auto_id: "AUTO-NEW-08", placeholder: true, mechanism: "crawler", subdomain: "D9.4", source_type: "web_news",
    cadence: "daily 06:35 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D9.4'])",
    ifs_domains: ["D9.4"], queries: ["power-aware workload orchestration carbon-aware compute 2026", "grid-responsive scheduling demand response data center software", "carbon aware compute scheduling 2026"] },
  // ---- Tier 1: D1 whitespace ----
  { auto_id: "AUTO-NEW-09", placeholder: true, mechanism: "crawler", subdomain: "D1.1", source_type: "web_news",
    cadence: "daily 06:40 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D1.1'])",
    ifs_domains: ["D1.1"], queries: ["NVIDIA Blackwell Vera Rubin Feynman roadmap 2026", "NVIDIA GPU generational transition infrastructure impact", "NVIDIA datacenter GPU roadmap announcement 2026"] },
  { auto_id: "AUTO-NEW-10", placeholder: true, mechanism: "crawler", subdomain: "D1.2", source_type: "web_news",
    cadence: "daily 06:45 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D1.2'])",
    ifs_domains: ["D1.2"], queries: ["rack power density 120kW OCP ORW 2026", "kW per rack roadmap data center design", "high density rack data center facility forcing function 2026"] },
  { auto_id: "AUTO-NEW-11", placeholder: true, mechanism: "crawler", subdomain: "D1.3", source_type: "web_news",
    cadence: "daily 06:50 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D1.3'])",
    ifs_domains: ["D1.3"], queries: ["AMD Instinct MI Intel Gaudi merchant accelerator 2026", "merchant inference silicon architecture 2026", "AMD Intel data center GPU competition 2026"] },
  { auto_id: "AUTO-NEW-12", placeholder: true, mechanism: "crawler", subdomain: "D1.6", source_type: "web_news",
    cadence: "weekly Tue 07:05 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D1.6'])",
    ifs_domains: ["D1.6"], queries: ["NVIDIA GPU allocation hyperscaler neocloud sovereign 2026", "GPU secondary market allocation leading indicator", "chip allocation supply politics data center 2026"] },
  // ---- Tier 1: D2 whitespace ----
  { auto_id: "AUTO-NEW-13", placeholder: true, mechanism: "crawler", subdomain: "D2.1", source_type: "web_news",
    cadence: "daily 06:55 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D2.1'])",
    ifs_domains: ["D2.1"], queries: ["800V DC power distribution data center 2026", "415V AC to 800V DC data center NFPA OCP", "facility to rack DC power architecture 2026"] },
  { auto_id: "AUTO-NEW-14", placeholder: true, mechanism: "crawler", subdomain: "D2.2", source_type: "web_news",
    cadence: "daily 07:10 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D2.2'])",
    ifs_domains: ["D2.2"], queries: ["behind the meter data center economics decision framework 2026", "BTM data center power asset mix", "behind the meter generation data center 2026"] },
  { auto_id: "AUTO-NEW-15", placeholder: true, mechanism: "crawler", subdomain: "D2.3", source_type: "web_news",
    cadence: "daily 07:15 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D2.3'])",
    ifs_domains: ["D2.3"], queries: ["data center UPS BESS lithium-ion power conditioning 2026", "data center energy storage UPS evolution", "battery energy storage data center 2026"] },
  { auto_id: "AUTO-NEW-16", placeholder: true, mechanism: "crawler", subdomain: "D2.4", source_type: "web_news",
    cadence: "daily 07:20 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D2.4'])",
    ifs_domains: ["D2.4"], queries: ["in-rack DC power delivery bus bar hot swap shelf 2026", "GPU-native DC-DC converter rack power", "inside rack power delivery data center 2026"] },
  { auto_id: "AUTO-NEW-17", placeholder: true, mechanism: "crawler", subdomain: "D2.9", source_type: "web_news",
    cadence: "weekly Wed 07:25 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D2.9'])",
    ifs_domains: ["D2.9"], queries: ["data center microgrid islanding switchgear black start 2026", "island mode paralleling data center power", "microgrid integration data center 2026"] },
  // ---- Tier 1: D10 whitespace ----
  { auto_id: "AUTO-NEW-18", placeholder: true, mechanism: "crawler", subdomain: "D10.1", source_type: "web_news",
    cadence: "daily 07:30 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D10.1'])",
    ifs_domains: ["D10.1"], queries: ["transformer switchgear generator lead time data center 2026", "long lead equipment ABB Hitachi Eaton data center", "data center equipment supply chain constraint 2026"] },
  { auto_id: "AUTO-NEW-19", placeholder: true, mechanism: "crawler", subdomain: "D10.2", source_type: "web_news",
    cadence: "daily 07:35 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D10.2'])",
    ifs_domains: ["D10.2"], queries: ["data center GC EPC Mortenson Turner DPR capacity 2026", "stick built data center execution contractor", "data center general contractor backlog 2026"] },
  { auto_id: "AUTO-NEW-20", placeholder: true, mechanism: "crawler", subdomain: "D10.3", source_type: "web_news",
    cadence: "daily 07:40 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D10.3'])",
    ifs_domains: ["D10.3"], queries: ["prefabricated modular data center PMDC skid 2026", "containerized cooling power module Vertiv Schneider BladeRoom", "modular data center delivery 2026"] },
  { auto_id: "AUTO-NEW-21", placeholder: true, mechanism: "crawler", subdomain: "D10.5", source_type: "web_news",
    cadence: "weekly Thu 07:45 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D10.5'])",
    ifs_domains: ["D10.5"], queries: ["data center construction cost per MW inflation 2026", "data center materials labor cost curve regional", "construction cost escalation data center 2026"] },
  // ---- Tier 1.5: hot 4.0-new financing / buyer threads ----
  { auto_id: "AUTO-NEW-22", placeholder: true, mechanism: "primary_source", subdomain: "D4.6", source_type: "financial",
    cadence: "daily 08:00 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D4.6'])",
    primary_source: "GPU-collateral / neocloud debt filings (CoreWeave/Lambda facilities), NVIDIA vendor financing, warehouse facilities",
    ifs_domains: ["D4.6"], queries: ["GPU collateralized lending CoreWeave Lambda debt facility 2026", "NVIDIA vendor financing warehouse facility neocloud", "GPU backed financing circularity risk 2026"] },
  { auto_id: "AUTO-NEW-23", placeholder: true, mechanism: "crawler", subdomain: "D4.5", source_type: "financial",
    cadence: "daily 08:05 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D4.5'])",
    ifs_domains: ["D4.5"], queries: ["data center ABS securitization private credit Apollo Ares 2026", "hyperscaler bond issuance lease-backed structure", "data center project finance private credit 2026"] },
  { auto_id: "AUTO-NEW-24", placeholder: true, mechanism: "crawler", subdomain: "D6.3", source_type: "web_news",
    cadence: "daily 08:10 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D6.3'])",
    ifs_domains: ["D6.3"], queries: ["OpenAI Stargate Anthropic xAI Colossus infrastructure buyer 2026", "AI lab capacity owner data center principal", "model developer infrastructure consortium 2026"] },
  // ---- Tier 2: smaller whitespace fills ----
  { auto_id: "AUTO-NEW-25", placeholder: true, mechanism: "crawler", subdomain: "D11.1", source_type: "regulatory",
    cadence: "weekly Mon 08:15 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D11.1'])",
    ifs_domains: ["D11.1"], queries: ["24/7 carbon free energy matching additionality data center 2026", "clean energy procurement REC CFE corporate reporting", "data center renewable procurement disclosure 2026"] },
  { auto_id: "AUTO-NEW-26", placeholder: true, mechanism: "crawler", subdomain: "D11.2", source_type: "regulatory",
    cadence: "weekly Mon 08:20 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D11.2'])",
    ifs_domains: ["D11.2"], queries: ["data center carbon accounting GHG protocol scope 1 2 3 2026", "TCFD CDP data center operational emissions", "data center carbon disclosure 2026"] },
  { auto_id: "AUTO-NEW-27", placeholder: true, mechanism: "crawler", subdomain: "D11.6", source_type: "web_news",
    cadence: "weekly Mon 08:25 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D11.6'])",
    ifs_domains: ["D11.6"], queries: ["embodied carbon low carbon concrete Sublime Brimstone data center 2026", "green steel recycled copper data center materials", "embodied carbon materials data center 2026"] },
  { auto_id: "AUTO-NEW-28", placeholder: true, mechanism: "crawler", subdomain: "D16.5", source_type: "web_news",
    cadence: "weekly Tue 08:30 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D16.5'])",
    ifs_domains: ["D16.5"], queries: ["firmware BMC supply chain SBOM hardware implant data center 2026", "software supply chain vendor risk data center security", "third party risk SBOM data center 2026"] },
  { auto_id: "AUTO-NEW-29", placeholder: true, mechanism: "crawler", subdomain: "D16.6", source_type: "web_news",
    cadence: "weekly Tue 08:35 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D16.6'])",
    ifs_domains: ["D16.6"], queries: ["SOC threat hunting incident response data center 2026", "tabletop exercise data center security operations", "incident response practice data center 2026"] },
  { auto_id: "AUTO-NEW-30", placeholder: true, mechanism: "crawler", subdomain: "D17.3", source_type: "regulatory",
    cadence: "weekly Wed 08:40 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D17.3'])",
    ifs_domains: ["D17.3"], queries: ["visa policy specialized data center roles immigration 2026", "regional labor competition data center campus workforce incentive", "workforce development incentive data center siting 2026"] },
  { auto_id: "AUTO-NEW-31", placeholder: true, mechanism: "crawler", subdomain: "D14.7", source_type: "web_news",
    cadence: "weekly Wed 08:45 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D14.7'])",
    ifs_domains: ["D14.7"], queries: ["build to suit powered shell own vs lease data center campus 2026", "campus portfolio strategy data center build model", "powered shell takedown data center 2026"] },
  // ---- Cowork (analyst-judgment synthesis — not crawlable) ----
  { auto_id: "AUTO-NEW-32", placeholder: true, mechanism: "cowork", subdomain: "D8.2", source_type: "synthesis",
    cadence: "weekly Fri 09:00 America/Chicago", postgres_insert: "artifacts(synthesis; ifs_domains=['D8.2'])",
    primary_source: "Industry Conferences table (tblb1S5IKFBPEmUJL) — gated on AUTO-028/029 ID conflict resolution",
    ifs_domains: ["D8.2"], queries: ["[Scheduled Cowork] conference panel-topic evolution DCD/GTC/OCP Summit"] },
  { auto_id: "AUTO-NEW-33", placeholder: true, mechanism: "cowork", subdomain: "D8.4", source_type: "synthesis",
    cadence: "weekly Fri 09:15 America/Chicago", postgres_insert: "artifacts(synthesis; ifs_domains=['D8.4'])",
    ifs_domains: ["D8.4"], queries: ["[Scheduled Cowork] founder/operator network mapping, board interlocks, repeat operators"] },
  { auto_id: "AUTO-NEW-34", placeholder: true, mechanism: "cowork", subdomain: "D8.5", source_type: "synthesis",
    cadence: "weekly Fri 09:30 America/Chicago", postgres_insert: "artifacts(synthesis; ifs_domains=['D8.5'])",
    ifs_domains: ["D8.5"], queries: ["[Scheduled Cowork] earnings-call & investor-day signal extraction (capex guidance, backlog, tone)"] },
  { auto_id: "AUTO-NEW-35", placeholder: true, mechanism: "cowork", subdomain: "D14.1", source_type: "synthesis",
    cadence: "monthly 1st 09:45 America/Chicago", postgres_insert: "artifacts(synthesis; ifs_domains=['D14.1'])",
    ifs_domains: ["D14.1"], queries: ["[Scheduled Cowork] site selection methodology scoring frameworks synthesis"] },
  { auto_id: "AUTO-NEW-36", placeholder: true, mechanism: "crawler", subdomain: "D8.3", source_type: "social",
    cadence: "daily 08:50 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D8.3'])",
    ifs_domains: ["D8.3"], queries: ["data center hiring velocity cooling power specialist scarcity 2026", "operator talent migration data center engineering", "specialized hiring signal data center 2026"] },
  // ---- Claude Routine (lightweight scheduled retrieve+classify) ----
  { auto_id: "AUTO-NEW-37", placeholder: true, mechanism: "claude_routine", subdomain: "D5.3", source_type: "web_news",
    cadence: "weekly Thu 09:00 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D5.3'])",
    ifs_domains: ["D5.3"], queries: ["[Claude Routine] build vs lease hyperscaler powered shell wholesale leasing QTS Vantage Aligned"] },
  { auto_id: "AUTO-NEW-38", placeholder: true, mechanism: "claude_routine", subdomain: "D5.4", source_type: "web_news",
    cadence: "weekly Thu 09:15 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D5.4'])",
    ifs_domains: ["D5.4"], queries: ["[Claude Routine] cloud region launch availability zone sovereign region capacity geography"] },
  { auto_id: "AUTO-NEW-39", placeholder: true, mechanism: "claude_routine", subdomain: "D18.3", source_type: "web_news",
    cadence: "weekly Thu 09:30 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_domains=['D18.3'])",
    ifs_domains: ["D18.3"], queries: ["[Claude Routine] data center reputational political risk op-ed ballot measure national press"] },
];

// SOURCE-FIT RE-POINTS (documentation hook). Sub-domains whose correct source is a
// primary database, not generic web_news. "wired" => a connector path exists to
// extend; "recommended" => proposed, not yet wired.
export const SOURCE_FIT_REPOINTS = [
  { subdomain: "D2.5", from: "web_news (AUTO-064)", to: "NRC ADAMS primary source", status: "recommended" },
  { subdomain: "D3.4", from: "broad web_news", to: "FERC eLibrary / Order 1920 docket", status: "recommended" },
  { subdomain: "D3.5", from: "broad web_news", to: "FERC / PJM docket filings", status: "recommended" },
  { subdomain: "D1.8", from: "web_news (AUTO-063)", to: "USPTO + foundry capacity disclosures", status: "recommended" },
  { subdomain: "D7.4", from: "n/a (whitespace)", to: "standards bodies + coolant chemistry (3M/Chemours/PFAS)", status: "recommended" },
  { subdomain: "D9.x", from: "broad web_news", to: "GitHub infra repos — extend AUTO-045 (already Active)", status: "wired (extends AUTO-045)" },
  { subdomain: "D4.6", from: "broad financial", to: "GPU-collateral / neocloud debt filings", status: "recommended" },
] as const;

// Inert merge helper — call ONLY from index.ts AFTER approval + dry run.
// Throws on duplicate auto_id so a double-merge can never silently shadow a row.
export function mergeApproved(base: AutoDef[], approved: AutoDef[]): AutoDef[] {
  const seen = new Set(base.map((a) => a.auto_id));
  for (const a of approved) {
    if (seen.has(a.auto_id)) throw new Error(`mergeApproved: duplicate auto_id ${a.auto_id}`);
    seen.add(a.auto_id);
  }
  return [...base, ...approved];
}
