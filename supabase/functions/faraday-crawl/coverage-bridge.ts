// Faraday — IDF 4.0 Coverage-Gap Bridge config (FAR IDF-4 / FAR-319)
// =============================================================================
// IDs GRANTED 2026-06-24 (Myke); block layout RESHAPED 2026-07-05 per the Myke
// approvals comment on FAR-319:
//   AUTO-137        = D18.1 Opposition Tracker (first ID of the block —
//                     reassigned off AUTO-049, superseding the interim AUTO-176
//                     assignment). Designed, inert.
//   AUTO-138 → 152  = WAVE3_ACTIVATION — the 15 priority whitespace crawlers
//                     (D7.1–7.4, D9.1–9.4, D10.1/.2/.3/.5, D4.5/.6, D6.3),
//                     wired into index.ts's AUTOMATIONS via mergeApproved.
//   AUTO-153 → 176  = WHITESPACE_SCAFFOLDS — remaining Designed routines,
//                     renumbered (AUTO-176 freed by the Opposition move;
//                     D8.2 pinned at AUTO-168 for the Industry Conferences
//                     table annotations). Inert until built.
// Registry renumber is a PREPARED change list (PR description) — not applied.
//
// TIER1_ACTIVATION (AUTO-060–069) and TIER2_ACTIVATION (AUTO-070–119) are wired
// into index.ts's AUTOMATIONS via mergeApproved and Active in the Registry
// (FAR-200/202, 2026-06-24).
//
// Note on order of operations (kept for the record): never flip Status before the
// dry run succeeds (§2 DONE).
//
// NEXT FREE ID after this block is **AUTO-178** (AUTO-177 = the reassigned
// "PUC & Utility Rate Case Monitor", FAR-204).
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

// ── TIER 2 — D11–D23 dedicated crawlers AUTO-070–119 (FAR-202, approved by Myke
// 2026-06-24: "identify and deploy ... flipped to active"). Query sets authored here
// so the rows actually crawl (Status=Active in the Registry is only truthful once a
// crawler is in the live fleet). AUTO-118→D17.2, AUTO-119→D17.1 (bare "D17" tag fixed
// per the FAR-202 note). Merged into AUTOMATIONS in index.ts via mergeApproved.
export const TIER2_ACTIVATION: AutoDef[] = [
  { auto_id: "AUTO-070", source_type: "regulatory", ifs_domains: ["D11.3"],
    queries: ["data center water stewardship WUE replenishment 2026", "data center water use drought scarcity disclosure", "hyperscaler water restoration commitment data center"] },
  { auto_id: "AUTO-071", source_type: "web_news", ifs_domains: ["D11.4"],
    queries: ["data center heat recovery district heating reuse 2026", "circular economy data center waste heat capture", "heat reuse data center Nordic Europe deployment"] },
  { auto_id: "AUTO-072", source_type: "regulatory", ifs_domains: ["D11.5"],
    queries: ["CSRD data center sustainability reporting 2026", "California SB253 SB261 climate disclosure data center", "EU taxonomy sustainability regulation data center compliance"] },
  { auto_id: "AUTO-073", source_type: "web_news", ifs_domains: ["D12.1"],
    queries: ["long-haul fiber metro dark fiber data center route 2026", "backbone fiber network data center interconnection build", "Lumen Zayo metro fiber data center capacity"] },
  { auto_id: "AUTO-074", source_type: "web_news", ifs_domains: ["D12.2"],
    queries: ["subsea cable data center landing station 2026", "submarine cable consortium hyperscaler announcement", "subsea cable build Google Meta Amazon route"] },
  { auto_id: "AUTO-075", source_type: "web_news", ifs_domains: ["D12.3"],
    queries: ["AI fabric InfiniBand NVLink intra-data-center networking 2026", "scale-up scale-out AI cluster fabric topology", "Ethernet UALink AI training network announcement"] },
  { auto_id: "AUTO-076", source_type: "web_news", ifs_domains: ["D12.4"],
    queries: ["cross-connect interconnection data center Equinix 2026", "carrier-neutral interconnection peering data center", "cross connect ecosystem data center growth"] },
  { auto_id: "AUTO-077", source_type: "web_news", ifs_domains: ["D12.5"],
    queries: ["co-packaged optics CPO data center 2026", "optical transceiver 1.6T linear pluggable data center", "silicon photonics AI networking optical announcement"] },
  { auto_id: "AUTO-078", source_type: "web_news", ifs_domains: ["D12.6"],
    queries: ["small cell edge wireless data center private 5G 2026", "edge computing wireless backhaul deployment", "private network edge data center connectivity"] },
  { auto_id: "AUTO-079", source_type: "web_news", ifs_domains: ["D12.7"],
    queries: ["LEO satellite backhaul Starlink Kuiper data center 2026", "alternative backhaul satellite connectivity edge", "non-terrestrial network data center resilience"] },
  { auto_id: "AUTO-080", source_type: "web_news", ifs_domains: ["D13.1"],
    queries: ["data center community benefit agreement CBA 2026", "host community agreement data center commitments", "community fund data center development negotiation"] },
  { auto_id: "AUTO-081", source_type: "social", ifs_domains: ["D13.2"],
    queries: ["data center opposition movement grassroots protest 2026", "anti data center campaign moratorium residents", "community organizing oppose data center construction"] },
  { auto_id: "AUTO-082", source_type: "regulatory", ifs_domains: ["D13.3"],
    queries: ["data center local permitting public hearing 2026", "planning commission data center rezoning vote", "zoning board data center special use permit hearing"] },
  { auto_id: "AUTO-083", source_type: "web_news", ifs_domains: ["D13.4"],
    queries: ["data center community engagement outreach best practice 2026", "operator community relations data center program", "public engagement data center developer transparency"] },
  { auto_id: "AUTO-084", source_type: "web_news", ifs_domains: ["D13.5"],
    queries: ["data center economic impact jobs tax revenue narrative 2026", "data center local economy study claim dispute", "economic impact report data center community benefit"] },
  { auto_id: "AUTO-085", source_type: "web_news", ifs_domains: ["D14.2"],
    queries: ["Northern Virginia Dallas Phoenix primary data center market 2026", "established data center market vacancy absorption", "primary market data center leasing pricing trend"] },
  { auto_id: "AUTO-086", source_type: "web_news", ifs_domains: ["D14.3"],
    queries: ["emerging data center market secondary tier 2026", "new data center market Indiana Ohio Wisconsin growth", "emerging market data center land power availability"] },
  { auto_id: "AUTO-087", source_type: "web_news", ifs_domains: ["D14.4"],
    queries: ["international data center market Europe Asia expansion 2026", "global data center market entry country growth", "international hyperscaler data center new region"] },
  { auto_id: "AUTO-088", source_type: "web_news", ifs_domains: ["D14.5"],
    queries: ["data center land price per acre acquisition 2026", "industrial land cost data center site purchase", "land banking data center developer acquisition record"] },
  { auto_id: "AUTO-089", source_type: "regulatory", ifs_domains: ["D14.6"],
    queries: ["data center site certification entitlement shovel-ready 2026", "entitled land data center zoning approval", "site readiness certification program data center"] },
  { auto_id: "AUTO-090", source_type: "web_news", ifs_domains: ["D15.2"],
    queries: ["sovereign AI national compute strategy investment 2026", "national AI compute capacity government program", "sovereign cloud national data center initiative"] },
  { auto_id: "AUTO-091", source_type: "web_news", ifs_domains: ["D15.3"],
    queries: ["AI diplomacy bilateral agreement compute chips 2026", "AI cooperation treaty technology export country", "bilateral AI infrastructure agreement government"] },
  { auto_id: "AUTO-092", source_type: "web_news", ifs_domains: ["D15.4"],
    queries: ["strategic minerals rare earth gallium critical supply 2026", "critical mineral supply chain data center chips", "rare earth export restriction semiconductor minerals"] },
  { auto_id: "AUTO-093", source_type: "regulatory", ifs_domains: ["D15.5"],
    queries: ["data sovereignty localization law requirement 2026", "data residency regulation cloud localization country", "data localization mandate data center compliance"] },
  { auto_id: "AUTO-094", source_type: "regulatory", ifs_domains: ["D15.6"],
    queries: ["CFIUS data center foreign investment review 2026", "inbound investment screening data center national security", "foreign acquisition data center review block"] },
  { auto_id: "AUTO-095", source_type: "regulatory", ifs_domains: ["D19.1"],
    queries: ["state local data center tax incentive bill 2026", "sales tax exemption data center legislation state", "property tax abatement data center incentive bill"] },
  { auto_id: "AUTO-096", source_type: "regulatory", ifs_domains: ["D19.2"],
    queries: ["federal tax policy IRA Treasury data center 2026", "investment tax credit data center energy IRA guidance", "federal tax data center depreciation bonus rule"] },
  { auto_id: "AUTO-097", source_type: "regulatory", ifs_domains: ["D19.3"],
    queries: ["OECD Pillar Two global minimum tax data center 2026", "international tax BEPS data center structuring", "Pillar Two implementation multinational data center"] },
  { auto_id: "AUTO-098", source_type: "web_news", ifs_domains: ["D19.4"],
    queries: ["data center tax incentive clawback backlash 2026", "Good Jobs First data center subsidy criticism", "tax break data center failed jobs clawback report"] },
  { auto_id: "AUTO-099", source_type: "web_news", ifs_domains: ["D19.5"],
    queries: ["tax-driven data center deal structuring REIT 2026", "tax-advantaged data center financing structure", "data center sale leaseback tax optimization deal"] },
  { auto_id: "AUTO-100", source_type: "web_news", ifs_domains: ["D20.1"],
    queries: ["building management system BMS HVAC control data center 2026", "data center automation controls vendor announcement", "BMS integration data center facility operations"] },
  { auto_id: "AUTO-101", source_type: "web_news", ifs_domains: ["D20.2"],
    queries: ["DCIM digital twin data center facility 2026", "data center digital twin simulation deployment", "DCIM platform data center operations vendor"] },
  { auto_id: "AUTO-102", source_type: "financial", ifs_domains: ["D21.1"],
    queries: ["data center property casualty insurance premium 2026", "data center insurance market capacity coverage", "P&C insurer data center risk underwriting"] },
  { auto_id: "AUTO-103", source_type: "financial", ifs_domains: ["D21.2"],
    queries: ["cyber insurance data center tech E&O 2026", "cyber liability coverage data center operator", "technology errors omissions insurance data center"] },
  { auto_id: "AUTO-104", source_type: "financial", ifs_domains: ["D21.3"],
    queries: ["parametric climate risk insurance data center 2026", "parametric cover extreme weather data center", "climate risk product data center insurance"] },
  { auto_id: "AUTO-105", source_type: "financial", ifs_domains: ["D21.4"],
    queries: ["lender insurance requirement data center financing 2026", "debt covenant insurance data center project finance", "lender mandated coverage data center construction"] },
  { auto_id: "AUTO-106", source_type: "web_news", ifs_domains: ["D22.1"],
    queries: ["data center news DCD Bisnow Data Center Frontier 2026", "US data center media coverage industry report", "data center trade press coverage announcement"] },
  { auto_id: "AUTO-107", source_type: "web_news", ifs_domains: ["D22.2"],
    queries: ["European data center media coverage 2026", "EU data center industry press DCD Europe", "Europe data center news regulation coverage"] },
  { auto_id: "AUTO-108", source_type: "web_news", ifs_domains: ["D22.3"],
    queries: ["APAC LATAM MENA data center media coverage 2026", "Asia Middle East data center press coverage", "emerging region data center news industry"] },
  { auto_id: "AUTO-109", source_type: "academic", ifs_domains: ["D22.4"],
    queries: ["Gartner IDC 451 data center analyst report 2026", "industry analyst data center market forecast", "analyst research data center infrastructure outlook"] },
  { auto_id: "AUTO-110", source_type: "web_news", ifs_domains: ["D23.1"],
    queries: ["hyperscaler outage status page postmortem 2026", "cloud outage incident report root cause data center", "AWS Azure Google Cloud outage postmortem"] },
  { auto_id: "AUTO-111", source_type: "web_news", ifs_domains: ["D23.2"],
    queries: ["grid event physical disaster data center 2026", "extreme weather power outage data center impact", "substation failure wildfire flood data center disruption"] },
  { auto_id: "AUTO-112", source_type: "web_news", ifs_domains: ["D23.3"],
    queries: ["cyber incident data center infrastructure attack 2026", "ransomware breach data center operator incident", "cyberattack targeting data center critical infrastructure"] },
  { auto_id: "AUTO-113", source_type: "web_news", ifs_domains: ["D23.4"],
    queries: ["business continuity disaster recovery data center 2026", "DR failover resilience data center practice", "data center continuity planning redundancy standard"] },
  { auto_id: "AUTO-114", source_type: "web_news", ifs_domains: ["D16.1"],
    queries: ["enterprise IT cybersecurity data center 2026", "data center IT security posture breach defense", "enterprise security data center network protection"] },
  { auto_id: "AUTO-115", source_type: "web_news", ifs_domains: ["D16.2"],
    queries: ["OT ICS SCADA cybersecurity data center 2026", "operational technology security data center facility", "ICS SCADA vulnerability data center power cooling"] },
  { auto_id: "AUTO-116", source_type: "web_news", ifs_domains: ["D16.3"],
    queries: ["data center physical security access control 2026", "biometric access control data center perimeter", "physical security data center surveillance breach"] },
  { auto_id: "AUTO-117", source_type: "web_news", ifs_domains: ["D16.4"],
    queries: ["state-sponsored APT threat data center critical infrastructure 2026", "nation-state cyber threat data center targeting", "APT group attack data center power grid"] },
  { auto_id: "AUTO-118", source_type: "web_news", ifs_domains: ["D17.2"],
    queries: ["data center operations workforce labor market BLS 2026", "Conference Board data center staffing demand", "data center technician operations hiring labor"] },
  { auto_id: "AUTO-119", source_type: "web_news", ifs_domains: ["D17.1"],
    queries: ["data center construction labor constraint AGC 2026", "skilled trades shortage data center build labor", "construction workforce electrician data center demand"] },
];


// ── WAVE 3 — priority whitespace crawlers AUTO-138–152 (FAR-319, 2026-07-05) ────
// Myke's FAR-319 approval comment (2026-07-05) reassigned the block: AUTO-137 =
// the D18.1 Opposition Tracker ("first ID of the new block", ex-AUTO-049 →
// ex-AUTO-176 → AUTO-137), with sequential assignment after it. The 15 priority
// whitespace sub-domains therefore take AUTO-138→152 and graduate here from
// WHITESPACE_SCAFFOLDS; the remaining scaffolds are renumbered AUTO-153→176
// below (AUTO-176 was freed by the Opposition Tracker's move to AUTO-137).
// D8.2 deliberately KEEPS AUTO-168 — the 6 "primary target" annotations in the
// Industry Conferences table (tblb1S5IKFBPEmUJL) already point at it.
//
// Every def: exactly one D#.# tag (splitIfsTags in index.ts routes it into
// artifacts.ifs_subdomains with the parent derived into ifs_domains), ≥4
// query-sources drawn from IDF 4.0 registry scope language + named players
// checked against Tracking Companies (tbluDYoK8Nj2DGQ0r; absentees are on the
// corpus-gap list in docs/idf4-coverage/wave3-whitespace-activation.md, per the
// ZutaCore principle — absence in the corpus is a gap, not a finding).
// Merged into AUTOMATIONS in index.ts; deploy is gated on PR merge + the
// 20260705000001 ifs_subdomains migration being applied first.
export const WAVE3_ACTIVATION: AutoDef[] = [
  // ---- Cooling (T-002, Tier 1) — entire D7 domain was whitespace ----
  { auto_id: "AUTO-138", source_type: "web_news", ifs_domains: ["D7.1"],
    queries: ["direct to chip liquid cooling CDU Vertiv CoolIT Motivair JetCool 2026", "DLC cold plate deployment data center GPU rack 2026", "liquid cooling retrofit data center capex announcement", "ZutaCore two-phase direct-to-chip cooling deployment 2026", "DCD data center liquid cooling direct-to-chip coverage"] },
  { auto_id: "AUTO-139", source_type: "web_news", ifs_domains: ["D7.2"],
    queries: ["immersion cooling Submer Iceotope LiquidStack GRC 2026", "two-phase immersion cooling data center TCO", "single-phase immersion tank deployment data center 2026", "immersion vs direct-to-chip cooling adoption comparison"] },
  { auto_id: "AUTO-140", source_type: "web_news", ifs_domains: ["D7.3"],
    queries: ["data center water use WUE waterless cooling 2026", "data center water consumption drought community dispute", "closed loop zero water cooling data center announcement 2026", "data center water permit restriction siting decision"] },
  { auto_id: "AUTO-141", source_type: "web_news", ifs_domains: ["D7.4"],
    queries: ["coolant chemistry PG25 dielectric fluid PFAS-free data center 2026", "3M Chemours fluorinated fluid exit data center coolant", "cold plate manifold quick disconnect supply chain constraint 2026", "coolant distribution unit vendor capacity Boyd Danfoss data center"] },
  // ---- Orchestration (T-005, Tier 1) ----
  { auto_id: "AUTO-142", source_type: "web_news", ifs_domains: ["D9.1"],
    queries: ["NVIDIA Mission Control AI factory orchestration 2026", "AI factory cluster management DCIM software announcement", "GPU cluster control plane orchestration platform launch 2026", "Schneider EcoStruxure Vertiv DCIM AI factory integration"] },
  { auto_id: "AUTO-143", source_type: "web_news", ifs_domains: ["D9.2"],
    queries: ["run:ai GPU utilization scheduling multi-tenancy 2026", "GPU cluster utilization rate benchmark economics", "Kubernetes GPU scheduling fractional allocation 2026", "idle GPU capacity stranded compute cost study"] },
  { auto_id: "AUTO-144", source_type: "web_news", ifs_domains: ["D9.3"],
    queries: ["vLLM TensorRT-LLM Triton inference serving 2026", "model routing inference gateway load balancing LLM", "KV cache management inference infrastructure 2026", "cost per token inference serving economics announcement"] },
  { auto_id: "AUTO-145", source_type: "web_news", ifs_domains: ["D9.4"],
    queries: ["power-aware workload orchestration carbon-aware compute 2026", "grid-responsive data center scheduling demand response software", "Emerald AI power flexible AI workload orchestration", "carbon aware scheduling compute load shifting 2026"] },
  // ---- Construction (Tier 1) ----
  { auto_id: "AUTO-146", source_type: "web_news", ifs_domains: ["D10.1"],
    queries: ["transformer switchgear generator lead time data center 2026", "long lead equipment ABB Hitachi Energy Eaton GE Vernova data center", "data center electrical equipment backlog supply chain 2026", "chiller generator delivery delay data center construction"] },
  { auto_id: "AUTO-147", source_type: "web_news", ifs_domains: ["D10.2"],
    queries: ["data center general contractor Mortenson Turner DPR Holder 2026", "EPC capacity data center construction backlog", "hyperscale data center build contractor award announcement 2026", "data center construction execution labor constraint"] },
  { auto_id: "AUTO-148", source_type: "web_news", ifs_domains: ["D10.3"],
    queries: ["prefabricated modular data center PMDC skid 2026", "containerized power cooling module Vertiv Schneider BladeRoom", "modular data center factory build delivery announcement 2026", "prefab data center Compass modular construction method"] },
  { auto_id: "AUTO-149", source_type: "web_news", ifs_domains: ["D10.5"],
    queries: ["data center construction cost per MW inflation 2026", "data center build cost escalation materials labor", "hyperscale campus construction cost estimate benchmark 2026", "data center capex cost curve regional comparison"] },
  // ---- Capital (Tier 1.5, hot) ----
  { auto_id: "AUTO-150", source_type: "financial", ifs_domains: ["D4.5"],
    queries: ["data center ABS securitization private credit Apollo Ares Blackstone 2026", "data center debt facility project finance announcement 2026", "hyperscaler bond issuance lease-backed data center structure", "private credit fund data center lending commitment 2026"] },
  { auto_id: "AUTO-151", source_type: "financial", ifs_domains: ["D4.6"],
    queries: ["GPU collateralized lending CoreWeave Lambda debt facility 2026", "NVIDIA vendor financing neocloud warehouse facility", "GPU backed loan chip collateral depreciation risk 2026", "neocloud financing Crusoe Nebius debt raise announcement"] },
  // ---- New Entrants (Tier 1.5, hot) ----
  { auto_id: "AUTO-152", source_type: "web_news", ifs_domains: ["D6.3"],
    queries: ["OpenAI Stargate data center buildout 2026", "Anthropic xAI Colossus infrastructure investment announcement", "Mistral AI compute infrastructure buildout Europe 2026", "AI lab direct data center ownership capacity deal"] },
];

// ── WHITESPACE — remaining Designed routines (renumbered 2026-07-05) ────────────
// Post-Wave-3 layout of the approved block per Myke's FAR-319 approvals:
//   AUTO-137          = D18.1 Opposition Tracker (first ID of the block — the
//                       ex-AUTO-049/ex-AUTO-176 reassignment; Designed, NOT in
//                       Wave 3's 15-crawler build cap; next activation slot)
//   AUTO-138 → 152    = WAVE3_ACTIVATION above (graduated out of this list)
//   AUTO-153 → 176    = the 24 remaining scaffolds below (AUTO-176 freed by the
//                       Opposition Tracker move; D8.2 pinned to AUTO-168)
// Ids are reserved (Designed in the Registry — renumber change list prepared,
// not applied); each routine is built + activated later.
export const WHITESPACE_SCAFFOLDS: ScaffoldDef[] = [
  // ---- D18.1 Opposition Tracker — first ID of the block (Myke, 2026-07-05) ----
  { auto_id: "AUTO-137", placeholder: false, mechanism: "crawler", subdomain: "D18.1", source_type: "web_news",
    cadence: "daily 06:00 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D18.1'])",
    notes: "Community Opposition & Moratorium Tracker — reassigned off AUTO-049 (stays Email Ingestion) then off AUTO-176 to AUTO-137 per the FAR-319 approvals comment. Distinct from D13.2 grassroots-movement coverage: this is the project-level opposition REGISTER.",
    ifs_domains: ["D18.1"], queries: ["data center project opposition register moratorium tracker 2026", "data center project blocked delayed lawsuit referendum", "county moratorium data center development enacted 2026", "data center rejected permit denied project canceled opposition"] },
  // ---- Tier 1: D1 whitespace ----
  { auto_id: "AUTO-153", placeholder: false, mechanism: "crawler", subdomain: "D1.1", source_type: "web_news",
    cadence: "daily 06:40 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D1.1'])",
    ifs_domains: ["D1.1"], queries: ["NVIDIA Blackwell Vera Rubin Feynman roadmap 2026", "NVIDIA GPU generational transition infrastructure impact", "NVIDIA datacenter GPU roadmap announcement 2026"] },
  { auto_id: "AUTO-154", placeholder: false, mechanism: "crawler", subdomain: "D1.2", source_type: "web_news",
    cadence: "daily 06:45 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D1.2'])",
    ifs_domains: ["D1.2"], queries: ["rack power density 120kW OCP ORW 2026", "kW per rack roadmap data center design", "high density rack data center facility forcing function 2026"] },
  { auto_id: "AUTO-155", placeholder: false, mechanism: "crawler", subdomain: "D1.3", source_type: "web_news",
    cadence: "daily 06:50 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D1.3'])",
    ifs_domains: ["D1.3"], queries: ["AMD Instinct MI Intel Gaudi merchant accelerator 2026", "merchant inference silicon architecture 2026", "AMD Intel data center GPU competition 2026"] },
  { auto_id: "AUTO-156", placeholder: false, mechanism: "crawler", subdomain: "D1.6", source_type: "web_news",
    cadence: "weekly Tue 07:05 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D1.6'])",
    ifs_domains: ["D1.6"], queries: ["NVIDIA GPU allocation hyperscaler neocloud sovereign 2026", "GPU secondary market allocation leading indicator", "chip allocation supply politics data center 2026"] },
  // ---- Tier 1: D2 whitespace ----
  { auto_id: "AUTO-157", placeholder: false, mechanism: "crawler", subdomain: "D2.1", source_type: "web_news",
    cadence: "daily 06:55 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D2.1'])",
    ifs_domains: ["D2.1"], queries: ["800V DC power distribution data center 2026", "415V AC to 800V DC data center NFPA OCP", "facility to rack DC power architecture 2026"] },
  { auto_id: "AUTO-158", placeholder: false, mechanism: "crawler", subdomain: "D2.2", source_type: "web_news",
    cadence: "daily 07:10 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D2.2'])",
    ifs_domains: ["D2.2"], queries: ["behind the meter data center economics decision framework 2026", "BTM data center power asset mix", "behind the meter generation data center 2026"] },
  { auto_id: "AUTO-159", placeholder: false, mechanism: "crawler", subdomain: "D2.3", source_type: "web_news",
    cadence: "daily 07:15 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D2.3'])",
    ifs_domains: ["D2.3"], queries: ["data center UPS BESS lithium-ion power conditioning 2026", "data center energy storage UPS evolution", "battery energy storage data center 2026"] },
  { auto_id: "AUTO-160", placeholder: false, mechanism: "crawler", subdomain: "D2.4", source_type: "web_news",
    cadence: "daily 07:20 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D2.4'])",
    ifs_domains: ["D2.4"], queries: ["in-rack DC power delivery bus bar hot swap shelf 2026", "GPU-native DC-DC converter rack power", "inside rack power delivery data center 2026"] },
  { auto_id: "AUTO-161", placeholder: false, mechanism: "crawler", subdomain: "D2.9", source_type: "web_news",
    cadence: "weekly Wed 07:25 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D2.9'])",
    ifs_domains: ["D2.9"], queries: ["data center microgrid islanding switchgear black start 2026", "island mode paralleling data center power", "microgrid integration data center 2026"] },
  // ---- Tier 2: smaller whitespace fills ----
  { auto_id: "AUTO-162", placeholder: false, mechanism: "crawler", subdomain: "D11.1", source_type: "regulatory",
    cadence: "weekly Mon 08:15 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D11.1'])",
    ifs_domains: ["D11.1"], queries: ["24/7 carbon free energy matching additionality data center 2026", "clean energy procurement REC CFE corporate reporting", "data center renewable procurement disclosure 2026"] },
  { auto_id: "AUTO-163", placeholder: false, mechanism: "crawler", subdomain: "D11.2", source_type: "regulatory",
    cadence: "weekly Mon 08:20 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D11.2'])",
    ifs_domains: ["D11.2"], queries: ["data center carbon accounting GHG protocol scope 1 2 3 2026", "TCFD CDP data center operational emissions", "data center carbon disclosure 2026"] },
  { auto_id: "AUTO-164", placeholder: false, mechanism: "crawler", subdomain: "D11.6", source_type: "web_news",
    cadence: "weekly Mon 08:25 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D11.6'])",
    ifs_domains: ["D11.6"], queries: ["embodied carbon low carbon concrete Sublime Brimstone data center 2026", "green steel recycled copper data center materials", "embodied carbon materials data center 2026"] },
  { auto_id: "AUTO-165", placeholder: false, mechanism: "crawler", subdomain: "D16.5", source_type: "web_news",
    cadence: "weekly Tue 08:30 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D16.5'])",
    ifs_domains: ["D16.5"], queries: ["firmware BMC supply chain SBOM hardware implant data center 2026", "software supply chain vendor risk data center security", "third party risk SBOM data center 2026"] },
  { auto_id: "AUTO-166", placeholder: false, mechanism: "crawler", subdomain: "D16.6", source_type: "web_news",
    cadence: "weekly Tue 08:35 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D16.6'])",
    ifs_domains: ["D16.6"], queries: ["SOC threat hunting incident response data center 2026", "tabletop exercise data center security operations", "incident response practice data center 2026"] },
  { auto_id: "AUTO-167", placeholder: false, mechanism: "crawler", subdomain: "D17.3", source_type: "regulatory",
    cadence: "weekly Wed 08:40 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D17.3'])",
    ifs_domains: ["D17.3"], queries: ["visa policy specialized data center roles immigration 2026", "regional labor competition data center campus workforce incentive", "workforce development incentive data center siting 2026"] },
  // ---- Cowork (analyst-judgment synthesis — not crawlable) ----
  // D8.2 PINNED to AUTO-168: Industry Conferences "primary target" annotations
  // (tblb1S5IKFBPEmUJL) already reference this id — do not renumber it.
  { auto_id: "AUTO-168", placeholder: false, mechanism: "cowork", subdomain: "D8.2", source_type: "synthesis",
    cadence: "weekly Fri 09:00 America/Chicago", postgres_insert: "artifacts(synthesis; ifs_subdomains=['D8.2'])",
    primary_source: "Industry Conferences table (tblb1S5IKFBPEmUJL) — gated on AUTO-028/029 ID conflict resolution",
    ifs_domains: ["D8.2"], queries: ["[Scheduled Cowork] conference panel-topic evolution DCD/GTC/OCP Summit"] },
  { auto_id: "AUTO-169", placeholder: false, mechanism: "crawler", subdomain: "D14.7", source_type: "web_news",
    cadence: "weekly Wed 08:45 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D14.7'])",
    ifs_domains: ["D14.7"], queries: ["build to suit powered shell own vs lease data center campus 2026", "campus portfolio strategy data center build model", "powered shell takedown data center 2026"] },
  { auto_id: "AUTO-170", placeholder: false, mechanism: "cowork", subdomain: "D8.4", source_type: "synthesis",
    cadence: "weekly Fri 09:15 America/Chicago", postgres_insert: "artifacts(synthesis; ifs_subdomains=['D8.4'])",
    ifs_domains: ["D8.4"], queries: ["[Scheduled Cowork] founder/operator network mapping, board interlocks, repeat operators"] },
  { auto_id: "AUTO-171", placeholder: false, mechanism: "cowork", subdomain: "D8.5", source_type: "synthesis",
    cadence: "weekly Fri 09:30 America/Chicago", postgres_insert: "artifacts(synthesis; ifs_subdomains=['D8.5'])",
    ifs_domains: ["D8.5"], queries: ["[Scheduled Cowork] earnings-call & investor-day signal extraction (capex guidance, backlog, tone)"] },
  { auto_id: "AUTO-172", placeholder: false, mechanism: "cowork", subdomain: "D14.1", source_type: "synthesis",
    cadence: "monthly 1st 09:45 America/Chicago", postgres_insert: "artifacts(synthesis; ifs_subdomains=['D14.1'])",
    ifs_domains: ["D14.1"], queries: ["[Scheduled Cowork] site selection methodology scoring frameworks synthesis"] },
  { auto_id: "AUTO-173", placeholder: false, mechanism: "crawler", subdomain: "D8.3", source_type: "social",
    cadence: "daily 08:50 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D8.3'])",
    ifs_domains: ["D8.3"], queries: ["data center hiring velocity cooling power specialist scarcity 2026", "operator talent migration data center engineering", "specialized hiring signal data center 2026"] },
  // ---- Claude Routine (lightweight scheduled retrieve+classify) ----
  { auto_id: "AUTO-174", placeholder: false, mechanism: "claude_routine", subdomain: "D5.3", source_type: "web_news",
    cadence: "weekly Thu 09:00 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D5.3'])",
    ifs_domains: ["D5.3"], queries: ["[Claude Routine] build vs lease hyperscaler powered shell wholesale leasing QTS Vantage Aligned"] },
  { auto_id: "AUTO-175", placeholder: false, mechanism: "claude_routine", subdomain: "D5.4", source_type: "web_news",
    cadence: "weekly Thu 09:15 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D5.4'])",
    ifs_domains: ["D5.4"], queries: ["[Claude Routine] cloud region launch availability zone sovereign region capacity geography"] },
  { auto_id: "AUTO-176", placeholder: false, mechanism: "claude_routine", subdomain: "D18.3", source_type: "web_news",
    cadence: "weekly Thu 09:30 America/Chicago", postgres_insert: "artifacts(content_hash dedupe; ifs_subdomains=['D18.3'])",
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
