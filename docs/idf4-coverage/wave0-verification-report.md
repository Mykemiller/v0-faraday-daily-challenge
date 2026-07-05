# IDF 4.0 Sub-Domain Coverage — Wave 0 Verification Report

**Date:** 2026-07-05 · **Epic:** FAR-319 · **Branch:** `claude/idf-4-subdomain-coverage-id5ln0`
**Supabase project:** `ycadmmngkdhvpcsrcuaq`

---

## 1. Pipeline verification verdict — per stage

### 1.1 `faraday-crawl-daily` (pg_cron jobid 3, 07:00 UTC) — ✅ HEALTHY, 4/4 recent runs

Cross-referenced per the standard pattern:

| Source | Evidence |
|---|---|
| `automation_health_log` (authoritative) | 07-02: 88/88 automations success, 346 found / 346 new · 07-03: 88/88, 330/330 · 07-04: 88/88, 334/334 · 07-05: 88/88, 343 found / 333 new. Each fleet run completes in ~30 min (07:00:02 → ~07:30:40). |
| `cron.job_run_details` (supplementary) | jobid 3 `succeeded` on 07-02, 07-03, 07-04, 07-05 — dispatch confirmed all 4 days. |
| `net._http_response` | **Retention on this project is ~6 hours** (oldest row 2026-07-05 08:20 UTC at time of check), so it cannot attest the 07:00 runs of prior days. In its place: the per-automation health rows are written *by the edge function itself* (proof of execution), and the artifact `new_rows` counts are actual DB writes (proof of outcome). |

**2026-06-23 gather-phase JSON parse failure: RESOLVED** (FAR-188 batching + fence-strip + salvage + per-record isolation, all present in `faraday-crawl/index.ts`). Zero `parse_error:` health rows and zero salvage notes in the last 4 fleet runs; daily yield is stable at 330–346.

### 1.2 `engine_freshness()` — does NOT gate any crawl step; the known bug is confirmed

Live definition (checked 2026-07-05) still checks `jps_history` (`created_at::date = current_date`) and `prediction_probability_log`. It is consumed by **`engine-two-analyst` (AUTO-136)** as a run gate — not by `faraday-crawl`, `enrich-artifacts`, or any artifact-ingest step. Today AUTO-136 logged `freshness_gate jps=false preds=true` and skipped: no `jps_history` row today because `jurisdiction-scorer` itself failed on the Anthropic billing error (below). The repoint fix (check `jw_posture_proposals` instead) remains open — flagged, not fixed here (JW-repo scope, and it does not affect artifact flow).

### 1.3 ⚠️ NEW INCIDENT (unrelated to code, blocks Phase-B backfill + enrichment): Anthropic credits depleted again

Since **~08:00 UTC 2026-07-05** every Anthropic-calling function fails with
`400 … credit balance is too low`:

- `enrich-artifacts` drain (AUTO-030 crawler_id rows, every 30 min): `Enriched 0; permanently failed 6–10` per run — the enrichment backlog is growing.
- `engine-idf-entities` (AUTO-134), `jurisdiction-scorer` (AUTO-130), `engine-two-analyst` (AUTO-136, via the stale-JPS knock-on).

This is the same failure mode as the 2026-06-26 incident. The 07:00 crawl completed *before* the balance ran out; **tomorrow's 07:00 gather will fail fleet-wide if credits are not topped up.** Action for Myke in §6.

---

## 2. Tagging-layer finding: the premise is stale — D#.# codes already flow

The task premise said artifacts carry only domain-level tags. In fact the Tier-1/Tier-2 dedicated crawlers (AUTO-060–119, active since 2026-06-24 per FAR-200/202) write their **D#.# sub-domain code into `artifacts.ifs_domains`** (e.g. `["D1.4"]`). Current corpus (5,855 artifacts):

| Class | Count | Backfill treatment |
|---|---|---|
| Has D#.# tag(s) in `ifs_domains` | 1,903 | **Phase A (deterministic):** split code → `ifs_subdomains`, derive parent → `ifs_domains`. No LLM. |
| Domain-only tags (`D1`…`D23`, legacy `data_centers`/`ai_infrastructure`/`cloud`) | 3,932 | **Phase B (LLM, precision-gated):** classify against the registry rows of the artifact's domains; keep only `high`-confidence, domain-consistent assignments. No match → domain-only stays. |
| Untagged | 20 | Phase B against all 116 labels. |

`faraday_subdomains` is confirmed at **116/116 rows, all active** — the FAR-205 staleness (4 rows) has been resolved since the prompt was written. All 60 distinct D#.# codes currently in the corpus validate against the registry (0 invalid).

## 3. Baseline: **60 / 116 sub-domains fed** (14-day rule, 2026-07-05)

Computed with the pre-migration variant of `docs/idf4-coverage/subdomain-feed-coverage.sql` (D#.# codes in `ifs_domains`, trailing 14 days, ≥1 artifact). 3,081 artifacts discovered in the window.

- **Wave 1 (AUTO-060–069) done-when metric is ALREADY satisfied** — all 10 Tier-1 sub-domains are fed: D1.4 (40 artifacts/14d), D1.5 (40), D1.7 (36), D1.8 (40), D2.5 (32), D2.6 (32), D2.7 (40), D2.8 (40), D2.10 (40), D10.4 (38).
- **Wave 2 (AUTO-070–119) targets are likewise already fed** — the Tier-2 activation of 2026-06-24 covers them; they make up the bulk of the 60.
- **The 56 unfed sub-domains** are exactly the whitespace + broad-only set, including the full Wave-3 priority 15 (D7.1–7.4, D9.1–9.4, D10.1/.2/.3/.5, D4.5, D4.6, D6.3) plus broad-only rows a Phase-B backfill can feed from existing artifacts (D1.1–1.3, D1.6, D3.1–3.5, D4.1–4.4, D5.1–5.4, D6.1–6.2, D8.1–8.5, D2.1–2.4, D2.9, D11.1/.2/.6, D14.1/.7, D15.1, D16.5/.6, D17.3, D18.1–18.3).

**Path to ≥70/116:** the remaining gap is closed not by more Tier-1/2 activation (done) but by (a) Phase-B backfill + the Wave-0 classifier feeding broad-only sub-domains from the existing daily flow of broad crawlers (AUTO-001, 023, 027, 033, 036, 038, 046 et al.), and (b) Wave-3 whitespace crawlers.

## 4. What this PR adds (nothing applied/deployed)

1. **Migration `supabase/migrations/20260705000001_add_ifs_subdomains_to_artifacts.sql`** — `artifacts.ifs_subdomains text[] NOT NULL DEFAULT '{}'`, GIN index, and a BEFORE trigger validating every element against `faraday_subdomains.subdomain_code` (invalid codes are stripped with a WARNING, never rejecting the row — ingest chunks of 10 must not fail nine good rows for one bad tag). Additive + reversible (rollback in file). **NOT applied.**
2. **Crawl classifier extension** — `splitIfsTags()` in `faraday-crawl/index.ts` (pure, exported, 5 new unit tests): dedicated-crawler D#.# codes now land in `ifs_subdomains` with the parent domain derived into `ifs_domains`; `crawl_metadata.crawler_version` → 1.2. **Deploy ordering: migration first, then function** (the function writes the new column).
3. **Backfill `scripts/idf4-subdomain-backfill.mjs`** — dry-run by default (`--write` to apply, after approval), Phase A/B as in §2, per-batch failure isolation, 25-row sample printout. Phase B blocked today by the credit balance (§1.3) — Phase A is LLM-free and unblocked once the migration applies.
4. **Coverage query `docs/idf4-coverage/subdomain-feed-coverage.sql`** — one row per registry sub-domain (code, domain, name, artifacts_14d, last_artifact_at, fed), reading both the new column and the historical D#.#-in-`ifs_domains` convention so it is correct before/during/after backfill.

## 5. Dry-run sample (Phase A, 25 rows, computed read-only against prod)

25/25 deterministic splits validated against the registry; representative rows (full method: old tags → new domains · new subdomains):

| auto_id | title (truncated) | old | → domains | → subdomains |
|---|---|---|---|---|
| AUTO-060 | Nvidia Vera Rubin Enters Full Production: Samsung, SK Hynix… | ["D1.4"] | ["D1"] | ["D1.4"] |
| AUTO-061 | Cerebras Systems Inc. — FY2026 Financial Results (Form 8-K) | ["D1.5"] | ["D1"] | ["D1.5"] |
| AUTO-063 | TSMC CoWoS Supply-Demand Gap Reportedly Seen Narrowing… | ["D1.8"] | ["D1"] | ["D1.8"] |
| AUTO-064 | X-Energy raises $1.02B in record nuclear IPO as Amazon-backe… | ["D2.5"] | ["D2"] | ["D2.5"] |
| AUTO-066 | TotalEnergies to Provide 1 GW of Solar Capacity to Power Goo… | ["D2.7"] | ["D2"] | ["D2.7"] |
| AUTO-067 | FERC Launches Aggressive Targeted Action to Speed Large Load… | ["D2.8"] | ["D2"] | ["D2.8"] |
| AUTO-068 | Enphase Energy Announces Development of IQ Solid-State Trans… | ["D2.10"] | ["D2"] | ["D2.10"] |

(The remaining 18 sample rows are identical in kind; the full 25 print on any `node scripts/idf4-subdomain-backfill.mjs --phase=a` run.)

## 6. Myke actions

1. **🔴 Top up Anthropic API credits** (same as 06-26 incident). Until then: enrichment is failing every 30 min, and tomorrow's 07:00 fleet gather will 400 fleet-wide. Everything else in this report is gated behind artifact flow.
2. **Approve/merge this PR**, then in order: apply migration `20260705000001` → deploy `faraday-crawl` (v1.2) → run backfill Phase A (`node scripts/idf4-subdomain-backfill.mjs --phase=a`, review sample, re-run `--write`).
3. **Approve backfill Phase B write-run** (LLM classification of the 3,952 domain-only/untagged artifacts) after credits are restored and the Phase-B dry-run sample is reviewed.
4. **Decide the `engine_freshness()` repoint** (`jps_history` → `jw_posture_proposals`) — JW-repo change, currently only gates `engine-two-analyst`.
5. Note: **Waves 1–2 of the prompt set are already live** (FAR-200/202, 2026-06-24) and their done-when metrics pass; no crawler activation work remains there. The 70/116 push runs through the Phase-B backfill + Wave-3 whitespace crawlers.
