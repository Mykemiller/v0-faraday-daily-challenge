# FAR-287 — Phase 0 Investigation Report

**Target:** 500 themed days × 7 game types = 3,500 puzzle records into Supabase staging.
**Repo:** `v0-faraday-daily-challenge` (the engine-as-site). Branch
`claude/puzzle-bank-500-day-generation-njx6lm`.
**Status:** Investigation complete. **STOP gate — awaiting sign-off before Phase 1.**
All findings below are read-only; no writes to Airtable, Notion, or Supabase occurred.

---

## 0.1–0.2 Repo contract (outranks everything)

- **Consumer** `/api/challenge/today` (`src/app/api/challenge/today/route.js`) → reads
  `Published = "Live"` via `getLivePuzzles()` (`src/lib/airtable-puzzle-bank.js`). Returns
  `{ [type]: {...content, __publicId} }`; a type whose JSON won't parse is omitted and the
  component falls back to a built-in mock. Signal Drop is the only type whose answer is
  stripped (`toPublicSignalPuzzle`) before the client; guesses validate server-side via
  `/api/challenge/guess`.
- **Rotator** `/api/cron/rotate` + `rotateLiveSet()`: promote `Published="Published" AND
  Go Live Date = today(America/Chicago)` → `Live`; retire `Published="Live" AND Go Live
  Date < today` → `Retired`. Idempotent, day-granular. **We must not touch rotator logic**
  (out of scope) — but our staged rows must land as `Draft`/`Unpublished` so they are
  invisible to it until Myke approves + schedules them in Airtable.
- **7 `Puzzle Content` schemas** fully documented in `docs/puzzle-schemas.md` from real
  2026-07-23 records. Key hard constraints: Rackl = **exactly 4 groups × 4 items**; Circuit
  carries a content **`timeLimit`**; The Brief carries **`brief` (\n\n-split) + `readTime`**;
  MCQ `correct` is **0-based**; Signal Drop `word` is the answer (single A–Z token) and is
  stripped client-side; The Stack `correctOrder` should be identity over pre-ranked `items`.

## 0.3 Existing bank sample

373 records; 7 types × ~53 contiguous days. Real exemplars captured per type (see schema
doc). **Observation:** the bank's in-content `domain` label is free-text and inconsistent
("Compute", "Grid", "GPU & Accelerators"…) — **not** an IDF code. FAR-287 will set
`Puzzle Content.domain` to the **Sector display name** (public, count-agnostic) and keep IDF
codes only in staging columns. Difficulty is not encoded in existing content (no weekly
curve observed) → **default 40/40/20 easy/medium/hard**, reported here per spec.

## 0.4 Calendar boundary

- **Global MAX `Go Live Date` = 2026-07-31** (all 7 types, `Published`, `Approved`).
  `Live` set = 2026-07-23; `Retired` ≤ 2026-07-22; `Published` (future) = 07-24 → 07-31.
- The recent window is **contiguous, 7 puzzles/day, no per-type gaps** behind the max.
- **Run window: start 2026-08-01, 500 consecutive days → through 2027-12-13** (one puzzle
  per type per day; no backfill needed). DB-enforced `unique(puzzle_type, go_live_date)`.

## 0.5 IDF 4.0 taxonomy — pulled live + drift

Pulled the canonical Notion page (`37189a0c16808199bca1cf304a45bbde`) live: **7 Themes,
23 Domains, 116 Sub-Domains.** Public labels enforced: **Theater / Sector / Thread / Signal**.

### Drift check (Notion is canonical)
| Registry | Count | Verdict |
|---|---|---|
| Notion §05 Sub-Domains | 116 | canonical |
| Supabase `faraday_subdomains` | 116, all active | **zero drift** — `theme_tags` match Notion exactly, incl. "All" tags (D8.2, D22.x) and the 7 Candidates |
| Airtable Sub-Domain Registry `tbla7rtRY9AaeoWhu` | **116**, Status Active, real D#.# IDs (updated 2026-07-05) | **aligned** — supersedes the stale "59 Coming Soon" note in CLAUDE.md/FAR-205 |
| Airtable IDF Domain Registry `tbltFtmWgBYPuRLSc` | 23, `Domain ID` D1–D23 | aligned |
| Airtable IDF Theme Registry `tbl9BRMxHm5fL8oy5` | 7, T-001–T-007 | aligned on themes, **but** its "Cross-Domain Span" mirrors §03 (see gap below) |

**We source the taxonomy from Notion at run time** and cross-check `faraday_subdomains`
(which is a faithful mirror and convenient for programmatic access). No registry is being
edited.

### §03 gap → registry correction for Myke (do not edit Notion)
The §03 *Domains* column, unioned across all 7 Themes, covers only **17 of 23** Domains.
**Missing: D8, D16, D17, D20, D22, D23.** Yet §05 sub-domain records for those six *do*
carry Theme tags (e.g. D16.x → T-006; D8.2 & all D22.x → *All*; D20.x → T-001/T-002;
D23.x → T-001/T-003/T-005/T-006; D17.x → T-003/T-004). **Per the brief, we build the
Theater↔Sector affinity graph bottom-up from Sub-Domain Theme tags** (full 23-Domain
coverage), not from §03. **Flagging the §03 column as a registry correction for Myke** — the
Airtable Theme Registry's "Cross-Domain Span" inherits the same gap.

### Derived Theater ↔ Sector affinity graph (bottom-up, non-candidate threads)
| Theater | Sectors (count) |
|---|---|
| T-001 Power Reckoning | D1,D2,D3,D5,D8,D9,D10,D12,D13,D14,D20,D21,D22,D23 — **14** |
| T-002 Thermal Reckoning | D1,D2,D4,D7,D8,D10,D11,D12,D20,D22 — **10** |
| T-003 Consent Crisis | D3,D7,D8,D11,D13,D14,D15,D17,D18,D19,D21,D22,D23 — **13** |
| T-004 Capital Concentration | D4,D5,D6,D8,D10,D12,D14,D15,D17,D19,D21,D22 — **12** |
| T-005 Inference Economy | D1,D4,D5,D6,D8,D9,D12,D15,D22,D23 — **10** |
| T-006 Sovereign AI Race | D1,D2,D4,D5,D6,D8,D12,D14,D15,D16,D19,D21,D22,D23 — **14** |
| T-007 New Energy Stack | D2,D3,D8,D11,D22 — **5** |

- **78 valid (Theater, Sector) pairs** (slightly above the brief's ~70–75 estimate; the
  estimate predates the live tags — reporting the exact derived count). All 23 Sectors appear.
- "All"-tagged Threads (D8.2; D22.1–4) make **D8 and D22 valid against every Theater**.
- **× 9 JPAS tiers = 702 unique (Theater, Sector, tier) triples ≥ 500.** Overall pool is
  sufficient. **But see the two constraint conflicts in §Feasibility below.**

### Exclusions & weighting (reported per rules 4–5)
- **Candidate Threads excluded** (confirmed live from §05, exactly the brief's list):
  **D12.4, D12.6, D12.7, D13.4, D13.5, D14.6, D14.7.** Excluding them removes no
  (Theater,Sector) pair except **(T-005, D14)** (D14.7 was its only T-005 link) — already
  reflected above.
- **Coverage down-weighting (rule 5):** the FAR-199 coverage matrix
  (`docs/idf4-coverage/coverage-matrix.{md,csv}`, mirrored to Notion) is reachable in-repo
  and will weight Dedicated-Active > Broad-only > Whitespace at Thread-selection time. The
  live bridge notion doc lists 31 Whitespace threads; we down-weight, never exclude.

## 0.6 Company roster reconciliation

| Source | Size | Nature |
|---|---|---|
| Supabase `public.tracking_companies` | **7,824** (all active) | authoritative universe; 3 cols only (`company_id`, `name`, `active`) — no facts |
| Airtable `Tracking Companies` `tbluDYoK8Nj2DGQ0r` | **469** | enrichment: HQ, C-suite, revenue, MW, cooling/energy strategy, primary Domain link, classification |
| Join key | **473** Supabase rows carry an Airtable `rec…` id (7,351 are `src…`) | direct FK to the enrichment layer |

**Enriched intersection ≈ 469 companies** (the 473 rec-id rows map onto the 469 Airtable
records) — with quality caveats: the Airtable layer contains explicit `⚠️ DUPLICATE — DELETE`
rows, "Coming Soon —" placeholders, and `emptyDependency` cells, so the **clean** fact-bearing
set is realistically ~**400**. **This ~400, not 7,824, is the ceiling for company-anchored
puzzles that assert verifiable facts.** The 7,824-name universe is usable only for
name-recognition/grouping material that asserts nothing beyond existence.

## 0.7 Signals — flavor layer (live figures)

`public.signals` = **397** rows, 2 sources: `pipeline:auto:enrichment` (394; 2026-07-04 →
2026-07-23, ~**19-day** rolling window; 100% domain-tagged, 71% subdomain-tagged, 100%
company-tagged) + `Faraday desk` (3; 2026-06-20). Narrower than the brief's ~33-day guess;
still a **rolling window, not an archive.** `theme_tags`/`domain_tags`/`subdomain_tags` join
directly to the IDF graph. **Use as flavor only** — theme framing, `Signal Drop`/`The Brief`
premises, and `faradays_take` as hint-tone reference. Not a backbone.

### Adjacent signal tables — include/exclude recommendation
| Table | Rows | Recommendation |
|---|---|---|
| `jw_signal_events` | **115,302** | **EXCLUDE** — high-volume operational telemetry, not editorial. |
| `usgs_gauge_signals` | 974 | **EXCLUDE** — raw water-gauge telemetry; only as an aggregate stat for a WTR-tier ranking, never verbatim. |
| `jds_country_signals` | 272 | **EXCLUDE from bulk**; optional flavor for T-006/D15 sovereignty days only. |
| `puc_signals` | 158 | **CONDITIONAL** — usable for D3.3 (PUC/rate-case) Thread framing; verify per-row before quoting. |
| `opposition_signals` | 98 | **CONDITIONAL** — good D13/D18 (Consent Crisis) framing; treat as premise, not asserted fact. |
| `jurisdiction_signals` | 54 | **EXCLUDE from bulk** — jurisdiction telemetry; risks implying a real JPS/JDS score (forbidden). |
Default posture: **do not bulk-ingest**; `signals` (397) is the only editorial signal layer,
used as flavor. The others are telemetry and are excluded or gated.

## 0.8 Remaining corpus (access confirmed)

| Source | Count | Use |
|---|---|---|
| Airtable Lexicon `tblibfOpAa5wh0dA5` | **540** (Approved) | prime Dark Fiber / Signal Drop / definitional MCQ material (term, definition, example, category) |
| Supabase `jpas_tiers` | **9** — PWR, REG, LBR, ENV, WTR, RSC, INC, COM, NET | tier layer (internal only; never surfaced) |
| Supabase `jpas_attribute_registry` | 66 | tier attribute vocabulary (framing only, no scores) |
| Supabase `entities` | 1,217 | supporting named entities |
| Supabase `artifacts` | **208,110** | deep well for MCQ/brief premises (via the tagged IDF graph) |

## 0.9 Feasibility per game type (under theme constraints)

Pool math: 78 (Theater,Sector) pairs × 9 tiers = **702 unique triples** for a 500-day run
(71% utilization). Theater-balance is satisfiable: per-theater unique-triple caps
(126/90/117/108/90/126/45 for T-001..T-007) sum to 702; applying the 1.3×-mean cap (~93)
leaves 597 selectable ≥ 500. **Two genuine conflicts to resolve (below).**

Per type, against the corpus:
- **Circuit / Frequency / The Brief** (generated Q&A from Thread scope + artifacts + signals):
  effectively unbounded distinct items → **500 sustainable.**
- **Rackl** (4×4 grouping from domain vocab + lexicon): combinatorially ample → **sustainable.**
- **Dark Fiber** (6 term/def pairs): 540 lexicon terms + generatable domain glossary →
  **sustainable** via themed subsets (subject-fingerprint on the set).
- **Signal Drop** (1 answer word/day/type = 500 distinct words): **tightest of the word
  types** — needs 500 distinct theme-relevant single tokens. Lexicon (540) + domain vocabulary
  covers it, but requires dedup discipline. **Feasible; watch for near-duplicates.**
- **The Stack** (verifiable total ranking): **the tightest type** — every puzzle needs real,
  ordered, checkable quantities. Draws from the **enriched intersection (~400 companies with
  MW/revenue)** + quantitative domain facts. 500 distinct verifiable rankings is achievable
  but is where near-duplication risk is highest. **Feasible with the enriched set as the
  primary well; flag for extra QA.**

**Conclusion: 3,500 themed rows are feasible.** No type falls below 500 under the constraints.

---

## Decisions requiring Myke's ruling before Phase 1

1. **Sector floor vs triple-uniqueness conflict (must resolve).** Rules 2 and 3 collide for
   **single-Theater Sectors**: **D16** (Threads tagged T-006 only) and **D18** (T-003 only)
   can each yield at most **1 Theater × 9 tiers = 9** unique (Theater,Sector,tier) triples —
   **below the "every Sector ≥ 12" floor**, which is impossible without repeating a triple.
   *Recommended:* **relax the floor to 9 for single-Theater Sectors** (D16, D18), keeping
   strict no-triple-repeat everywhere. Alternative: permit ≤3 controlled triple reuses for
   D16/D18 only. **Need your pick.**
2. **T-007 is thin (5 Sectors → 45 unique triples).** It cannot reach the ~71/theater mean
   without triple-repeats. It will land ~45 appearances (0.63× mean) — under the 1.3× ceiling
   but noticeably light. Acceptable? (No floor rule on Theaters exists; confirming intent.)
3. **§03 registry correction** — logged above for you to apply in Notion at your discretion
   (we will not edit it).
4. **Difficulty curve** — no weekly pattern exists in the current bank; proceeding with
   **40/40/20** unless you specify otherwise.

## What Phase 1 will do once cleared
Create the additive Supabase staging schema (`dc_daily_theme`, `dc_puzzle_bank_staging`,
`dc_puzzle_generation_runs`; RLS service-role write, no anon read) — then Phase 2 emits the
**500-day calendar for your review (hard checkpoint)** before any puzzle generation.
