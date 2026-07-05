# IDF 4.0 Wave 3 — Priority Whitespace Crawlers (FAR-319)

**Date:** 2026-07-05 · **Branch:** `claude/idf-4-subdomain-coverage-id5ln0`
**Precondition:** ✅ VERIFIED — Myke's approvals comment exists on FAR-319 (2026-07-05, comment id 11555): (1) AUTO-137→175 block, (2) AUTO-049 stays Active Email Ingestion with the D18.1 Opposition Tracker reassigned to **AUTO-137**, (3) source_type enum additions approved via named migration + PR only (interim `web_news` fallback acceptable). Also logged on the Notion coverage-matrix approvals block.

## Proposed registry mapping (block AUTO-137→176) — PREPARED, NOT APPLIED

Myke's approval ("Opposition Tracker = AUTO-137, first ID of the block; assign sequentially") supersedes the interim scaffold layout of 2026-06-24 (where AUTO-137=D7.1 and the Opposition Tracker sat on AUTO-176). Resulting renumber — the freed AUTO-176 absorbs the overflow, and **D8.2 stays pinned to AUTO-168** because the 6 Industry Conferences "primary target" annotations (`tblb1S5IKFBPEmUJL`) already reference it:

| AUTO-ID | Sub-domain | Status this wave | Note |
|---|---|---|---|
| AUTO-137 | D18.1 Project Opposition Register | **Designed** (scaffold; NOT built — 15-crawler cap) | ex-AUTO-049 → ex-AUTO-176 reassignment |
| AUTO-138 | D7.1 Direct-to-Chip Liquid Cooling | **Activate** | was AUTO-137 in interim layout |
| AUTO-139 | D7.2 Immersion Cooling | **Activate** | was AUTO-138 |
| AUTO-140 | D7.3 Water Use & Waterless Cooling | **Activate** | was AUTO-139 |
| AUTO-141 | D7.4 Thermal Components & Coolant Supply | **Activate** | was AUTO-140; NRC/USPTO-style primary source later, `web_news` now |
| AUTO-142 | D9.1 AI Factory Orchestration/DCIM | **Activate** | was AUTO-141 |
| AUTO-143 | D9.2 GPU Utilization Economics | **Activate** | was AUTO-142 |
| AUTO-144 | D9.3 Inference Serving & Model Routing | **Activate** | was AUTO-143 |
| AUTO-145 | D9.4 Power-Aware Orchestration | **Activate** | was AUTO-144 |
| AUTO-146 | D10.1 Long-Lead Equipment | **Activate** | was AUTO-154 |
| AUTO-147 | D10.2 GC/EPC Capacity | **Activate** | was AUTO-155 |
| AUTO-148 | D10.3 Modular/Prefab Delivery | **Activate** | was AUTO-156 |
| AUTO-149 | D10.5 Construction Cost Curves | **Activate** | was AUTO-157 |
| AUTO-150 | D4.5 Private Credit & DC Debt | **Activate** (`financial`) | was AUTO-159 |
| AUTO-151 | D4.6 GPU-Backed & Neocloud Financing | **Activate** (`financial`) | was AUTO-158 |
| AUTO-152 | D6.3 AI Labs as Infrastructure Buyers | **Activate** | was AUTO-160 |
| AUTO-153–167 | D1.1/.2/.3/.6, D2.1–2.4/2.9, D11.1/.2/.6, D16.5/.6, D17.3 | Designed (renumbered scaffolds) | |
| AUTO-168 | D8.2 Conference Intelligence (cowork) | Designed — **pinned** | conference-table annotations reference it |
| AUTO-169–176 | D14.7, D8.4/.5, D14.1, D8.3, D5.3/.4, D18.3 | Designed (renumbered scaffolds) | D5.3/5.4, D8.4/8.5, D14.1, D18.3 = Claude-Routine/cowork editorial workstream — out of crawler scope |

**Airtable change list for Myke (Registry `appxfti7VuoHYUeu6` / `tbl1ef6FgxUc3Uevg`, Status field `fldk6NPtWxxhcH5Qi`, batches ≤10, `typecast: true`):**
1. Re-map the Designed rows of the block to the table above (name + IFS sub-domain + AUTO-ID per row).
2. Flip AUTO-138→152 Designed→Active **only after** this PR merges, migration `20260705000001` applies, `faraday-crawl` v1.2 deploys, and the dry-run yields are reviewed (never flip before the dry run — standing rule).
3. AUTO-137 row = D18.1 Opposition Tracker, stays Designed. The old AUTO-176 Opposition row becomes D18.3 per the renumber.

## Sources & corpus check (ZutaCore principle)

Each crawler ships ≥4 query-sources drawn from the IDF 4.0 registry scope language and named players. Tracking Companies (`tbluDYoK8Nj2DGQ0r`, 469 rows) was checked for every named player:

- **Present** (linkable via Target Companies): Vertiv, Motivair, JetCool, ZutaCore, Submer, Iceotope, LiquidStack, Green Revolution Cooling (GRC), 3M, Chemours, Parker Lord, NVIDIA, run:ai (NVIDIA), Schneider Electric, Mortenson, Turner Construction, DPR Construction, Ares Management, Blackstone, CoreWeave, Lambda Labs, OpenAI, Stargate (OpenAI/SoftBank/Oracle), Anthropic, xAI, Mistral AI, Crusoe, Nebius, Eaton, ABB, Hitachi Energy, GE Vernova.
- **CORPUS GAPS** (named in query sets but ABSENT from Tracking Companies — for Myke to add; not silently added): **CoolIT Systems** (D7.1), **Boyd Corporation** (D7.4), **Danfoss** (D7.4), **Holder Construction** (D10.2), **BladeRoom** (D10.3), **Compass Datacenters** (D10.3), **Apollo Global Management** (D4.5), **Emerald AI** (D9.4).

## Dry-run status — ⛔ BLOCKED on Anthropic credits

The no-write harness is `scripts/idf4-crawler-dryrun.mjs` (`--set=wave3`; parses the defs straight out of `coverage-bridge.ts` so it cannot drift; one crawler per call for unambiguous per-crawler yield; per-crawler failure isolation). It cannot run today: the Anthropic API credit balance depleted at ~08:00 UTC 2026-07-05 (see the Wave-0 report §1.3) — the same incident stalling `enrich-artifacts`. **Run the dry run after credits are topped up and paste the yield table here before any Airtable Status flip.**

## Volume & quality guards

- Per-crawler cap stays **4 artifacts/run** (PER_AUTO_CAP — well under the 25 ceiling). Fleet grows 87 → 102 automations: worst-case 408 found/day vs the ~400/day soft cap, but observed find-rate at 87 automations is 330–346, so projected ~390–405 — **at the cap boundary; monitor the first week** and trim broad-crawler caps if the ceiling is breached.
- Dedup: same `content_hash` upsert (`ignoreDuplicates`) path as the rest of the fleet; collision rate per crawler will be visible in `automation_health_log.artifacts_duped`.
- Health logging: automatic — the fleet writes one health row per automation per run under its own AUTO-ID.
- Failure isolation: batched Anthropic calls (`BATCH_SIZE=3`, `Promise.allSettled`) — one bad batch logs its 3 automations only.
- Tagging: defs carry D#.# only; `splitIfsTags()` (Wave 0) routes it into `ifs_subdomains` and derives the parent into `ifs_domains`. **Deploy gated on migration `20260705000001` applying first.**
- Enrichment drain: 15 more crawlers ≈ +55–60 artifacts/day into the every-30-min drain — fine when credits exist (it processes 10/run = 480/day ceiling), but the drain is currently failing on billing; include `enrich_status` backlog depth in the first post-activation report.

## Activation-threshold trajectory (8 tagged artifacts → Candidate→Active governance)

At the design cap (4/run/day) each daily crawler reaches 8 artifacts in **2 days**; at a conservative observed-fleet-average yield of 2–3 new/run after dedup, **3–4 days**. Weekly-cadence sub-domains none in this set (all 15 run daily via the 07:00 fleet). Per-crawler observed trajectories to be confirmed from the dry-run + first week of `automation_health_log` (dry-run currently blocked, above).

## Coverage projection

Baseline 60/116 fed (Wave-0 report) + 15 Wave-3 sub-domains ⇒ **75/116 (65%) — over the ≥70/116 target** once the 15 crawlers have run for a day or two. The Phase-B backfill (Wave 0) adds further broad-only sub-domains (D1.1–1.3, D3.x, D4.1–4.4, D5.x, D8.x…) on top, toward ~85/116.

## Out of scope (boundaries respected)

- D3.4/D3.5 FERC docket connectors — separate primary-source workstream; NRC/FERC/USPTO `source_type` enum values NOT added (approved but migration-gated; `web_news` interim per Myke's comment).
- Claude-Routine sub-domains (D5.3/5.4, D8.4/8.5, D14.1, D18.3) untouched.
- No Airtable writes, no cron changes, no deploys, no taxonomy edits.
