# IDF 4.0 Coverage Bridge — Deployment / Dry-Run Plan + Source-Fit Re-Points

_FAR IDF-4. Branch `claude/idf-4-coverage-gap-qvyjeg`. No production deploy in this PR (§6 Boundaries: branch + PR only). Registry snapshot 2026-06-23._

Companion artifacts:
- `docs/idf4-coverage/coverage-matrix.md` / `.csv` — the 116-row matrix.
- `supabase/functions/faraday-crawl/coverage-bridge.ts` — inert scaffold config.
- `docs/idf4-coverage/data-integrity-findings.md` — the four flags + escalations.

---

## 1. What this PR does and does NOT do

**Does:** builds the coverage matrix, authors the Tier-1 dedicated-crawler query
sets (AUTO-060–069), scaffolds 39 new whitespace routines as inert config with
placeholder IDs, documents source-fit re-points, and the data-integrity flags.

**Does NOT (all human-gated — §4 Autonomy / §6 Boundaries):**
- Flip any Registry crawler `Designed → Active`.
- Assign any real `AUTO-###` ID (placeholders only).
- Add any `source_type` enum value.
- Re-route any **Active** crawler's `IFS Domains`.
- Deploy the edge function to production.

Nothing in `coverage-bridge.ts` is imported by `index.ts`, so deploying this branch
changes **zero** runtime behaviour. The activation is a deliberate, separate step.

---

## 2. Activation sequence (per dormant crawler — run only after ID/flip approval)

The "never flip Status before the dry run succeeds" contract (§2 DONE):

1. **Merge config.** In `index.ts`, `import { TIER1_ACTIVATION, mergeApproved } from "./coverage-bridge.ts"` and `const AUTOMATIONS = mergeApproved(BASE_AUTOMATIONS, TIER1_ACTIVATION)`. `mergeApproved` throws on any duplicate `auto_id`, so a double-merge can never silently shadow a live row.
2. **Deploy to a preview** (not prod) via branch + PR. Never deploy a red build.
3. **Dry run.** `POST /functions/v1/faraday-crawl` with the cron bearer. The run writes one `automation_health_log` row per `auto_id` (`run_started_at`, `run_completed_at`, `artifacts_found/new/duped`, `success`, `errors`). This is the health-log proof required before any flip.
4. **Verify idempotency.** Re-run immediately. `artifacts` upserts `onConflict: content_hash, ignoreDuplicates: true`, so the second run must produce `artifacts_new = 0` for unchanged input. Confirm in the health log.
5. **Flip Status.** Only now set the Registry row(s) `Designed → Active` in Airtable (`tbl1ef6FgxUc3Uevg`, field `fldk6NPtWxxhcH5Qi`).

### Tier-1 activation candidates (dormant DEDICATED crawlers — real IDs exist)

| AUTO-ID | Sub-Domain | source_type | Before | After (post dry-run) |
|---|---|---|---|---|
| AUTO-060 | D1.4 Memory (HBM) | web_news | Designed | Active |
| AUTO-061 | D1.5 Inference-Class Silicon | web_news | Designed | Active |
| AUTO-062 | D1.7 Hyperscaler Custom Silicon | web_news | Designed | Active |
| AUTO-063 | D1.8 Advanced Packaging | web_news | Designed | Active (+ re-point, §4) |
| AUTO-064 | D2.5 Nuclear & SMR | web_news | Designed | Active (+ re-point, §4) |
| AUTO-065 | D2.6 Gas & Fuel Cells | web_news | Designed | Active |
| AUTO-066 | D2.7 Renewables & PPAs | web_news | Designed | Active |
| AUTO-067 | D2.8 Grid-Interactive Load | regulatory | Designed | Active |
| AUTO-068 | D2.10 Solid-State Transformers | web_news | Designed | Active |
| AUTO-069 | D10.4 Project Delivery | web_news | Designed | Active |

> D7 (Cooling) and D9 (Orchestration) — the other two flagship Tier-1 domains —
> have **no dormant dedicated crawler to activate**; they are full whitespace and
> are addressed by the new scaffolds (AUTO-NEW-01..08), gated on the ID block.

### Tier ordering (land each as its own PR for incremental approval)
- **Tier 1** — AUTO-060–069 activation + D7/D9/D1/D2/D10 whitespace crawlers.
- **Tier 1.5** — hot 4.0-new threads D4.6 (GPU-collateral), D4.5, D6.3.
- **Tier 2** — the fully-designed domains D11–D23 (AUTO-070–119) activate-only.
- **Source-fit** — primary-source re-points (§4).
- **Cowork / Routine** — D8.2/8.4/8.5, D14.1, D5.3/5.4, D18.3.

---

## 3. Cadence discipline (§5)

New routines are **staggered** across 06:05–09:45 America/Chicago (see each
scaffold's `cadence`). News-velocity threads run daily; slow regulatory /
synthesis threads run weekly or monthly. No two routines share an exact slot
(asserted by `coverage-bridge.test.ts`). Do **not** stack 39 jobs on one 06:00
window — the test guards against it.

---

## 4. Source-fit re-points (web_news is the wrong source)

| Sub-Domain | Current source | Correct primary source | Status |
|---|---|---|---|
| D2.5 Nuclear & SMR | web_news (AUTO-064) | **NRC ADAMS** filings | Recommended |
| D3.4 Transmission & FERC | broad web_news | **FERC eLibrary / Order 1920** docket | Recommended |
| D3.5 Large-Load Tariff & Co-Location | broad web_news | **FERC / PJM** dockets | Recommended |
| D1.8 Advanced Packaging | web_news (AUTO-063) | **USPTO** + foundry capacity disclosures | Recommended |
| D7.4 Thermal Components & Coolant | n/a (whitespace) | **Standards bodies + coolant chemistry** (3M/Chemours/PFAS) | Recommended |
| D9.x Orchestration | broad web_news | **GitHub infra repos** — extend the already-Active AUTO-045 | **Wired path** (extend AUTO-045) |
| D4.6 GPU-Backed & Neocloud Financing | broad financial | **GPU-collateral / neocloud debt filings** | Recommended |

Only the D9.x → GitHub path is "wired" in the sense that the connector already
exists (AUTO-045 GitHub Infrastructure Repo Monitor is Active); extending its repo
list to orchestration projects needs no new connector. Every other row is a
**recommendation** — standing up an NRC/FERC/USPTO connector is new source-type
work and may need a `source_type` enum addition (gated).

---

## 5. ZutaCore / Tracking-Companies check (§5 Quality)

Before any company-targeted crawler ships, reconcile its target list against
`Tracking Companies` (`tbluDYoK8Nj2DGQ0r`) for missing subsidiaries / portfolio /
recent M&A. Flagged for the cooling scaffolds in particular (D7.1–7.4): confirm
ZutaCore (two-phase DLC) and recent cooling M&A are present before activation, so
a coverage crawler doesn't silently miss a key player.
