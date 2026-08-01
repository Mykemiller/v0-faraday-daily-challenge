# CC-ARTIFACT-TAGGING-SPINE-1.0 — Report

**Date:** 2026-08-01 · **Project:** Supabase `ycadmmngkdhvpcsrcuaq` · **Corpus:** 275,393 artifacts
**Migration:** `20260801120000_artifact_tagging_spine.sql` (APPLIED to prod 2026-08-01; additive only)
**Advisor delta:** exactly 4 intended `rls_enabled_no_policy` INFOs (the new deny-all tables); no new WARN/ERROR.

All §6 STOP conditions were respected: **zero writes to `artifacts`, `entities`,
`artifact_entities`, `jurisdictions`, or any storefront table.** Everything below lives in
new staging/mapping tables and one view.

> **Mid-session ground shift:** the CC-INGEST-METADATA-EXTRACTION backfill ran while this
> task was executing. Corpus citability moved **13,117 → 28,280** (10.3%) between the first
> and last measurement of the same expression, with no new artifacts (275,393 both times).
> All numbers below are the **post-extraction** state unless labelled otherwise.

---

## 1. Domain accuracy (§5.1) — coverage is 99.99%, accuracy is ~42%

Stratified sample: 9 artifacts per domain × 23 domains = 207 rows, judged against IDF 4.0
domain definitions on artifact text (headline/content), not lane intent. 6 rows were too
thin to judge; precision is over the 201 judgeable rows.

**Overall: 42.3% strict (85/201) · 62.2% lenient (correct+partial 125/201).**
Not one domain reaches 90% strict. A tag that is wrong ~half the time routes artifacts
into the wrong briefing — domain tags today are a *collection-lane label*, not a
content property.

| Domain | strict | lenient | n | Domain | strict | lenient | n |
|---|---|---|---|---|---|---|---|
| D1 Chips | 33% | 56% | 9 | D13 Community | 22% | 44% | 9 |
| D2 Power Arch | 25% | 63% | 8 | D14 Real Estate | 67% | 78% | 9 |
| D3 Grid & Reg | 38% | 75% | 8 | **D15 Geopolitics** | **0%** | 38% | 8 |
| D4 M&A | 56% | 67% | 9 | D16 Security | 75% | 88% | 8 |
| D5 Hyperscaler | 11% | 44% | 9 | D17 Workforce | 67% | 67% | 9 |
| D6 New Entrants | 44% | 78% | 9 | **D18 Opposition** | **22%** | 22% | 9 |
| D7 Cooling | 25% | 50% | 8 | **D19 Tax** | **22%** | 22% | 9 |
| D8 People | 33% | 33% | 9 | D20 Facility IT | 67% | 89% | 9 |
| D9 Orchestration | 25% | 50% | 8 | D21 Insurance | 78% | 89% | 9 |
| D10 Construction | 11% | 44% | 9 | D22 Industry Media | 89% | 100% | 9 |
| D11 Sustainability | 44% | 78% | 9 | D23 Outage | 67% | 78% | 9 |
| D12 Networking | 44% | 67% | 9 | | | | |

**Lane-inheritance findings, named:**

- **AUTO-199 is 94.6% of the corpus (260,454 artifacts)** and stamps domains from
  `source_registry.idf_domains` — a per-*source* registration, never a per-artifact read.
  A "local gov watch" Google News lane stamps `[D13, D18]` on every hit, so Memorial Day
  events, obituaries and school-board stories carry Community-Opposition tags.
- Domains that are near-pure single-lane inheritance and fail hardest: **D18** (100%
  AUTO-199 loc lanes, 22% precision), **D19** (`gsearch:st-*` state-watch lanes, 22%),
  **D15** (federal-watch lanes, 0% strict), **D5/D10** (company/feed lanes, 11%).
- Domains where the lane *is* the content survive: **D22** Industry Media (89% — trade
  press is trade press), **D21** Insurance (78%), **D16** Security (75%), **D20** (67%).
- Free-text junk also lives in `ifs_domains`: ~50 non-canonical values
  (`ai_infrastructure`, `Power & Cooling`, `data_centers`, …, ~500 rows) plus dotted
  D#.# codes on some dedicated-crawler rows. The health view surfaces them as their own
  rows rather than hiding them.

## 2. Sub-domain axis (§5.2) — root cause, derivation, measured precision

**Root cause of 2.9%: never attempted for 94.6% of the corpus.** `ifs_subdomains` is
written only by the dedicated Tier-1/2/3 crawlers (AUTO-060+, FAR-319 `splitIfsTags`),
whose 7,829 artifacts are already 100% tagged. AUTO-199's `source_registry` stores
domain-grain `idf_domains` only — there is no D#.# mechanism on the lane that produces
almost everything. (Note: `ifs_subdomains` is `'{}'` — an empty array, not NULL — on the
untagged rows; any query guarding with `array_length(...)=0` silently matches nothing.
Use `coalesce(cardinality(...),0)=0`.)

**Derivation built and staged (v1):** 31 rules in `tagspine_subdomain_rules` —
30 parent-domain-gated content-regex rules + 1 lane rule (`feed:nws-alerts` → D23.2) —
produced **6,919 candidate tags on 5,993 artifacts** in `artifact_subdomain_candidates`.
Applying them would move sub-domain coverage 7,880 → ~13,870 artifacts (2.9% → 5.0%).

**Measured precision (200-row hand-check): 69.5% strict (139/200) · 90.0% lenient.**
**Below the 90% bar → STOP honoured: nothing was written to `artifacts.ifs_subdomains`.**
The candidates remain staged.

Per-rule variance is the real finding (n≥5 rules):

| Rule | strict | n | Verdict |
|---|---|---|---|
| D3.4 Transmission/FERC | 100% | 13 | ship-ready |
| D7.2 Immersion cooling | 100% | 5 | ship-ready |
| D18.2 Permitting denial | 89% | 27 | near-bar |
| D3.3 Rate cases/PUC | 86% | 14 | near-bar |
| D15.1 Export controls | 86% | 7 | near-bar |
| D19.1 Tax incentives | 78% | 9 | needs DC-context gate |
| D13.2 Opposition movements | 71% | 21 | needs DC-context gate |
| D3.2 State moratorium | 53% | 15 | grain confusion (local vs state) |
| D13.3 Local permitting | 47% | 15 | fails — generic rezonings |
| D2.5 Nuclear offtake | 0% strict / 100% lenient | 7 | grain: nuclear news ≠ DC offtake |
| D23.2 NWS lane | 17% strict | 6 | routine advisories dilute it |

The dominant failure mode is **inherited domain noise**: a keyword can only confirm a
sub-domain if the artifact is in scope for the parent domain at all, and (§1) it often
isn't. The v2 path: (a) require a data-center/infrastructure context term for the
D13/D18/D19 rules; (b) split "moratorium" by state-vs-local grain; (c) drop D2.5/D23.2
as keyword rules; (d) LLM classification at enrichment time for the long tail (§6 below).
Projected coverage if only the ≥85%-strict rules were applied: ~2,600 tags / ~2,400
artifacts (7,880 → ~10,300, 3.7%) — honest but small; the real coverage lever is the
write path, not backfill.

## 3. Jurisdiction axis (§5.3) — built, measured, populated at entity path only

`artifact_jurisdictions` (artifact_id, jurisdiction_id, confidence, method, source_ref)
exists and is populated. Spine facts that shaped the matcher: `jurisdictions` names carry
census LSAD suffixes ("Columbus city", "Springfield township"); there are **no CDP rows**
(Ashburn, VA literally cannot resolve at place level); 193 country rows exist; the metro
tier has corrupt `state_abbr` values ("Northern Virginia"→TN, "Chicago"→ID) and got
exact-full-name matching at 0.7 confidence only.

**Entity normalisation (`tagspine_geo_entity_map`) — all 270 geography entities classified:**

| Status | n | Notes |
|---|---|---|
| resolved | 146 | 39 country_exact · 39 state_exact · 27 qualified_exact · 14 country_containment (foreign cities → their country) · 13 city_unique_national · 9 county_exact · 3 alias_state_country · 2 metro_exact |
| held_ambiguous | 78 | the review queue: multi-match names (Georgia state-vs-country, Lancaster ×3 entities), name-form mismatches (Boise → "Boise City city", Indianapolis → "Indianapolis city (balance)", "City of St. Louis"), missing rows (Ashburn/Sterling CDPs, Iran has no country row) |
| non_jurisdictional | 46 | 13 ISO/RTOs (PJM ×2, ERCOT ×2, MISO ×2, SPP ×2, CAISO, NYISO, ISO-NE, Eastern Interconnection, Mid-Continent) · 27 regions/supranational (Asia Pacific + Asia-Pacific dupe, EU ×2, Silicon Valley, …) · 3 org-misclassified entities (Georgia General Assembly, Brookville Borough Council, Louisville Metro) · 2 neighborhoods · 1 dev district |

**Propagation:** resolved entities × `artifact_entities` → **17,970 pairs · 14,807
artifacts (5.38% of corpus)**; 14,363 artifacts at confidence ≥ 0.8. Grain is honest but
coarse: state+country methods carry ~88% of pairs; county+place grain is only ~1,250 pairs.

**Precision (75-pair hand-check): 61 correct · 14 plausible · 0 wrong · 0 thin.**
No contradicted tag in the sample — the entity path **passes** the 90% bar (81% affirmed,
100% uncontradicted; the 14 "plausible" are headlines too short to confirm, with the
entity extracted from full text the judge couldn't see).

**The lane-scope method was measured and rejected.** The `gsearch:loc-<place>-<lsad>-<st>`
lanes (728 lanes, 30,767 artifacts) map deterministically to spine rows via
`source_registry.fetch_config->>'entity'` ("Fairfax city, VA" — exactly the census name
format), which looked like an 11%-coverage shortcut. A 100-row aboutness check killed it:
**49% about the target place**, 5% containing-county, 17% state-level stories, 28% other
places entirely (wrong-state homonyms: Lincoln ND→NE, Page ND→AZ, McIntosh ND→GA), 2 thin.
**Far below 90% → not populated** into `artifact_jurisdictions`. It could return as a
*prior* combined with content confirmation, never alone.

**Honest ceiling:** only 6.5% of artifacts carry any geography entity, so the entity path
tops out near where it is now (5.4%). Raising jurisdiction coverage materially means
jurisdiction resolution at entity-extraction time in the enrichment path (§6), not more
matching cleverness on the existing 270 entities.

**Held-for-review queue: 78 entities** (in `tagspine_geo_entity_map`, status
`held_ambiguous`, each with candidate_count + note).

## 4. `v_artifact_tagging_health` — definition and current output

One view, service-role only (anon/authenticated revoked). Rows per (ifs_domain ×
source_type) with rollups per domain and a corpus `'(all)'` row computed on the
un-exploded base (multi-domain artifacts not double-counted). Columns: artifacts, citable,
subdomain_tagged, subdomain_candidate_staged, jurisdiction_resolved, jurisdiction_ge_080,
library_ready, jw_ready, academy_ready.

Corpus row, 2026-08-01 (post-metadata-extraction):

| artifacts | citable | subdomain_tagged | staged candidates | jurisdiction (≥0.8) | library_ready | jw_ready |
|---|---|---|---|---|---|---|
| 275,393 | 28,280 (10.3%) | 7,880 (2.9%) | 5,993 | 14,807 (14,363) | 7,880 | 3,721 |

Jurisdiction-sensitive domains (rollup rows):

| Domain | artifacts | citable | citable % | jur ≥0.8 | jw_ready |
|---|---|---|---|---|---|
| D18 Risk & Opposition | 31,045 | 278 | **0.9%** | 1,612 | 63 |
| D13 Community & Local | 36,525 | 5,723 | 15.7% | 2,409 | 860 |
| D19 Tax & Incentives | 12,440 | 741 | 6.0% | 2,097 | 260 |
| D3 Grid & Regulatory | 25,922 | 3,139 | 12.1% | 2,929 | 632 |
| D22 Industry Media | 184,140 | 3,449 | 1.9% | 6,389 | 388 |

## 5. Ready-count per consumer

All three predicates require **citable** (Faraday's Take must anchor to a factual citation).

| Consumer | Predicate | Ready today | Of corpus |
|---|---|---|---|
| Briefing Library | citable ∧ domain ∧ sub-domain | **7,880** | 2.9% |
| JW / State Agents | citable ∧ jurisdiction conf ≥ 0.8 | **3,721** | 1.4% |
| Academy | citable ∧ domain ∧ sub-domain | **7,880** | 2.9% |

These are small numbers and they are the point. The library/academy pool is exactly the
dedicated-crawler output (every sub-domain-tagged artifact happens to be citable); the JW
pool is dominated by state-grain tags — county/place-grain jw_ready is a few hundred.
Caveat carried from §1: the *domain* component of library_ready is only ~42% accurate,
so even the 7,880 overstates what is truly briefing-safe until domain tags are verified
at artifact grain.

## 6. Write-path enforcement proposal (not implemented)

Point of enforcement: the **enrichment stage** (`enrich-artifacts-drain`), which already
runs an LLM per artifact — not the crawler (which knows only the lane) and not serve time.

1. **Citability flag computed on write.** The §4 citable expression becomes a generated
   column (or trigger-stamped boolean) on `artifacts`. Cheap, deterministic, closes the
   "is this publishable" question at ingest.
2. **Sub-domain classification in the enrichment prompt.** The enrichment call already
   reads the text; extend its output schema with `ifs_subdomains: D#.#[]` validated
   against `faraday_subdomains` (the FAR-319 trigger already strips invalid codes).
   Multi-label, may return empty — **never force a label**. The deterministic rules
   (≥85%-strict subset) stay as a cheap pre-pass; disagreement flags for review.
3. **Jurisdiction resolution at entity-extraction time.** When `engine-idf-entities`
   emits a geography entity, resolve it through `tagspine_geo_entity_map` (exact match →
   `artifact_jurisdictions` row with method+confidence; new names → map row with status
   `unmatched` for the held queue). The map table becomes the growing gazetteer;
   ambiguous stays held, exactly as in this pass.
4. **Domain honesty.** Keep lane domains as a *prior*; let enrichment confirm or replace
   at artifact grain (same LLM call as #2). Until then, treat `ifs_domains` as
   lane-provenance metadata, not content truth.
5. **When an artifact cannot be tagged: admit it untagged, flagged.** Hold-on-ingest
   would starve the pipeline (94.6% of intake is uncitable news stubs that are still
   useful as signal). The readiness predicates already exclude untagged artifacts from
   every product surface, which is the enforcement that matters. A `tagging_status`
   flag (`complete` / `partial` / `untagged`) on `artifact_enrichments` makes the gap
   queryable so it cannot silently reopen.

## 7. The D18 finding — restated with the new citability data

At task start D18 was **31,045 artifacts, 0 citable**. After the metadata-extraction
backfill it is **278 citable (0.9%)** — the axis moved, the conclusion did not. D18 is
one lane: AUTO-199's 728 local-gov-watch Google News searches, 99% `news.google.com/rss`
redirect stubs with ~150-character headline fragments, stamped `[D13,D18]` regardless of
content (measured D18 domain precision: 22%).

For the **Opposition Register** and **Permitting Denial** products this means: the corpus
*detects* signal (1,842 D18 artifacts match opposition/denial keyword rules; 1,612 have a
≥0.8 jurisdiction) but can *publish* almost none of it under the citation rule — only
63 D18 artifacts are jw_ready. **D18 products cannot ship from this corpus until the
loc-lane ingest resolves Google News redirects to real publisher URLs and titles at
fetch time.** That is ingestion remediation (the CC-INGEST-METADATA-EXTRACTION lane),
not tagging work — no amount of tagging fixes an uncitable source.

## 8. Myke actions

1. **Bulk sub-domain writes:** approve/deny promoting the ≥85%-strict rule subset
   (~2,400 artifacts: D3.4, D7.2, and — at your bar tolerance — D18.2/D3.3/D15.1 at
   86–89%) from `artifact_subdomain_candidates` into `artifacts.ifs_subdomains`. The
   full v1 set (69.5% strict) stays refused under the 90% bar.
2. **JW confidence threshold:** the view currently reports at ≥ 0.8 (includes
   state/country/county/qualified-city; excludes metro 0.7 and country-containment 0.7).
   Confirm 0.8, or set your own.
3. **Held-ambiguous queue (78 entities):** dispose of the high-traffic ones first —
   Ashburn (52 links; CDP missing from spine — add CDPs, or map to Loudoun County by
   containment?), Georgia state-vs-country (322 links), Indianapolis/Boise name-form
   fixes, Northern Virginia-as-metro.
4. **D18 ship decision:** per §7 — hold Opposition Register / Permitting Denial until
   loc-lane ingestion is remediated, or ship a "signal-only, no-citation" tier
   explicitly. Under the current governing rule, they cannot ship.
5. (Optional, from §1) Sanction an enrichment-stage domain re-verification pass — the
   42% domain accuracy is the widest quality gap this task measured and no product
   predicate currently protects against it.
