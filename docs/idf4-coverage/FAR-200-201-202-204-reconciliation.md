# IDF 4.0 Coverage-Gap Bridge — Tier 1/2 Reconciliation Report

**Branch:** `claude/idf-gap-bridge-t1-t2-2evvza` · **Repo:** v0-faraday-daily-challenge
**Verified against live infrastructure 2026-06-24:** Automation Registry
(Airtable `appxfti7VuoHYUeu6` / `tbl1ef6FgxUc3Uevg`, 169 rows), Industry Conferences
(`tblb1S5IKFBPEmUJL`), the running `faraday-crawl` edge function (`index.ts` +
`coverage-bridge.ts`).

> ## ⚠️ Read this first — most of this work was already applied
> A prior session (commit `a7bef8f`, "feat(idf4): activate Tier-1 crawlers
> AUTO-060–069 + apply approved bridge actions") already wrote the FAR-200 / FAR-201
> / most FAR-204 changes to **live Airtable** and recorded **"approved by Myke
> 2026-06-24"** in `CLAUDE.md`. **However, Jira FAR-199/200/201/202/204 are all still
> `To Do`** and FAR-199 still lists every AUTO-ID / flip decision as a *pending human
> gate*. This report does **not** re-apply idempotent writes; it **verifies** live
> state, surfaces the **two genuinely-open items** (an AUTO-050 collision and the
> FAR-202 dry-run gap), and flags the governance contradiction for Myke.
>
> **No new Airtable writes were made in this pass** — every remaining action is
> either already-applied or requires Myke approval (new AUTO-ID / Active-row change /
> gated activation).

---

## 1. FAR-204 — Data-integrity collision/tag change log (before → after)

| # | Item | Before | After (live now) | Who applied | State |
|---|---|---|---|---|---|
| 1 | **AUTO-049 collision** | AUTO-049 claimed by *both* Email Ingestion (Active) and Community Opposition & Moratorium Tracker (Designed) | AUTO-049 = Email Ingestion only; Community Opposition → **AUTO-176** (Designed, `rec5XcFXusDMQ68Y9`) | prior session (Myke-recorded) | ✅ resolved |
| 2 | **AUTO-028/029 conference collision** | 6 Industry-Conferences rows annotated "AUTO-028 / AUTO-028+029 primary target" (meant conference scraping = D8.2) | all 6 repointed to **AUTO-168 (D8.2)** with `[repointed from AUTO-028 — FAR-204]`; Registry AUTO-028 (D12) / AUTO-029 (D13) left Active & correct | prior session | ✅ resolved |
| 3 | **Stale IDF-3.x domain tags** (AUTO-028/029/030/031/032) | pre-4.0 numbers in routing source | `index.ts` AUTOMATIONS corrected: 028→**D12**, 029→**D13**, 030→**D14**, 031→**D11**, 032→**D17** | prior session | ✅ durable fix done |
| 3b | Airtable `IFS Domains` cells still show old numbers + `isStale:true` | — | left as-is | — | ℹ️ **cosmetic** — `IFS Domains` is a *generated `aiText`* field, **not** the routing source; overwriting it regenerates stale. Routing is driven by `index.ts`. |
| 4 | **🔴 AUTO-050 double-assignment (NEW — unresolved)** | — | AUTO-050 is claimed by *both* **"Daily Faraday Todo Digest"** (Active, `recvgnvCL3etK0Vs4`, CC-13 edge fn) **and** **"PUC & Utility Rate Case Monitor"** (Designed, `recEgsBjnuSiGVzmT`, regulatory D3/D18) | — | ⚠️ **OPEN — Myke-gated** |
| 5 | **🟡 AUTO-055 blank Status** | blank | blank ("Lexicon-Powered Puzzle Draft Agent", `recSGrsQQvtaOaDqk`) | — | ⚠️ **OPEN** (hygiene) |

### Open FAR-204 items (require Myke — new ID / explicit status)
- **AUTO-050 collision.** The CC-13 "Daily Faraday Todo Digest" was assigned AUTO-050,
  which a pre-existing **Designed** "PUC & Utility Rate Case Monitor" already held.
  This is the *same class* of bug as the (now-fixed) AUTO-049 collision and was missed.
  **Recommended fix (not applied — needs a new AUTO-ID):** keep AUTO-050 = Todo Digest
  (Active, operational cron); reassign the Designed PUC monitor → **AUTO-177** (next
  free ID). Mirrors the AUTO-049→176 resolution.
- **AUTO-055 blank Status.** Recommend setting **Designed** (matches siblings 053/054/
  056–059). Not applied — ambiguous vs `🟡 Draft`; flagged rather than guessed.

---

## 2. FAR-200 — AUTO-060–069 dry-run / activation report

All 10 dormant **dedicated** crawlers are **already `Active`** in the Registry, with
query sets authored in `coverage-bridge.ts:TIER1_ACTIVATION` and merged into the live
fleet via `mergeApproved(BASE_AUTOMATIONS, TIER1_ACTIVATION)` (`index.ts:110`). The
repo records two health-log dry runs (0 failures, 80 artifacts, all unique
`content_hash` — idempotent re-run `artifacts_new=0`) before the flip.

| AUTO-ID | Sub-Domain | Source Type | Required fields (Auto ID · Status · Source Type · sub-domain · query set) | Verdict | Live Status |
|---|---|---|---|---|---|
| AUTO-060 | D1.4 Memory & HBM | web_news | all present | ✅ pass | **Active** |
| AUTO-061 | D1.5 Inference-Class Silicon | web_news | all present | ✅ pass | **Active** |
| AUTO-062 | D1.7 Hyperscaler Custom Silicon | web_news | all present | ✅ pass | **Active** |
| AUTO-063 | D1.8 Advanced Packaging / CoWoS | web_news | all present (re-point to USPTO recommended) | ✅ pass | **Active** |
| AUTO-064 | D2.5 SMR / Nuclear | web_news | all present (re-point to NRC ADAMS recommended) | ✅ pass | **Active** |
| AUTO-065 | D2.6 Gas & Thermal Gen | web_news | all present | ✅ pass | **Active** |
| AUTO-066 | D2.7 Renewables + Storage PPA | web_news | all present | ✅ pass | **Active** |
| AUTO-067 | D2.8 Grid-Interactive Load | regulatory | all present | ✅ pass | **Active** |
| AUTO-068 | D2.10 Solid-State Transformers | web_news | all present | ✅ pass | **Active** |
| AUTO-069 | D10.4 Project Delivery | web_news | all present | ✅ pass | **Active** |

**Result: 10/10 pass, 10/10 Active. 0 failures.** Nothing to flip — already done.

---

## 3. FAR-201 — Whitespace crawler creation manifest

**Manifest path:** `docs/idf4-coverage/whitespace-crawler-manifest.json`
**Records designed:** **39** (mechanisms: 30 crawler · 4 cowork · 3 claude_routine · 2 primary_source) + 1 related reassignment (AUTO-176).

Covers the prioritized whitespace: **D7 Cooling** (D7.1–7.4, flagship), **D9
Orchestration** (D9.1–9.4), **D1/D2/D10** fills, and the **hot 4.0-new** financing/
buyer threads **D4.6 (GPU-collateral) · D4.5 · D6.3**, plus Tier-2 fills and
cowork/claude-routine synthesis threads.

### Status / gate
- The prompt's "next free AUTO-ID = **AUTO-134**" is **stale**: AUTO-134/135/136 are
  already **Active** engine functions. The correct block is **AUTO-137 → AUTO-175**
  (39 routines); next free after that is **AUTO-177**.
- **These 39 rows already exist in Airtable as `Designed`** (prior session). So the
  "do not write until approved" boundary is, in practice, **already crossed** — the
  rows are registered. FAR-201 therefore remains **Blocked / awaiting Myke
  confirmation** that the AUTO-137→175 block grant + Designed registration is
  sanctioned (Jira still lists it as a pending gate).
- **Source-fit:** D7/D9 manifests deliberately move off `web_news` (coolant-chemistry
  vendors, ASHRAE, OCP GitHub specs, trade press; GitHub infra repos extending the
  already-Active AUTO-045 for D9) — see per-domain `source_recommendation` in the JSON.
- **Taxonomy flag:** prompt named hot threads `D4.6/D4.5/D4.7`; repo scaffolds cover
  D4.6, D4.5, **D6.3** (no D4.7). Confirm intended third thread.

> ⛔ Per §6 Boundaries, no manifest record should be *further* mutated (built/activated)
> until Myke confirms the ID block. ZutaCore / Tracking-Companies reconciliation
> (`tbluDYoK8Nj2DGQ0r`) is required before any **company-targeted cooling crawler**
> (D7.1–7.4) actually ships.

---

## 4. FAR-202 — D11–D23 (AUTO-070–119) audit

**Confirmed span (Airtable):** AUTO-070–119 are **50 contiguous `Designed` rows**
covering D11.x, D12.x, D13.x, D14.2–.6, D15.2–.6, D16.1–.6, D17, D19.x, D20.x, D21.x,
D22.x, D23.x. (AUTO-120 "Tom's Hardware" is also Designed but out of the D11–D23 set.)

### 🔴 Blocking finding — none can pass the activation gate
The mandatory activation contract (`deployment-and-source-fit.md` §2) is
**merge query set → preview deploy → dry-run writes `automation_health_log` → verify
idempotent → ONLY THEN flip `Designed→Active`.** A dry run is impossible without an
authored query set in the running crawler.

**The running `faraday-crawl` edge function wires only 37 automations:** the 27
`BASE_AUTOMATIONS` (AUTO-001…047 subset) + `TIER1_ACTIVATION` (AUTO-060–069).
**None of AUTO-070–119 have a query set anywhere in the running fleet** — they are not
in `index.ts`, and `coverage-bridge.ts` only carries 060–069 (the 137–175 scaffolds
are separate whitespace). The Registry itself has **no `query_template`/`source_url`
field** to audit against.

| Audit dimension | AUTO-070–119 |
|---|---|
| Auto ID present | ✅ all 50 |
| Status = Designed | ✅ all 50 |
| Source Type present | ✅ all 50 (web_news/regulatory/financial/academic/social) |
| Sub-domain tag present | ✅ 48/50 — **AUTO-118 & AUTO-119 carry bare `D17`** (should be D17.2 / D17.1) |
| **Query set wired in running crawler** | ❌ **0/50** |
| **Can complete a dry run** | ❌ **0/50** |

**Result: 0/50 pass the audit. 0 flipped Active. All 50 flagged for Myke.**

Flipping these to `Active` without a wired query set would create rows that report
"Active" but **never crawl** — directly violating the engine invariant that a
`Designed`/`Broad-only` crawler "is **not** coverage." That contradicts the whole
point of the bridge, so I deliberately **did not** flip any.

### Recommended path for Myke (per AUTO-070–119, decide one)
1. **Activate properly** — author query sets for the chosen sub-domains in
   `coverage-bridge.ts` (a `TIER2_ACTIVATION` block), merge, dry-run, *then* flip. This
   is real work, not an Airtable toggle, and should land as its own PR per tier.
2. **Retire / keep Designed** — if a sub-domain isn't a current priority, leave Designed
   (or mark Deprecated). Honest > a misleadingly-"Active" empty crawler.
3. Fix the **AUTO-118/119 bare `D17`** tags → D17.2 / D17.1 at activation time.

---

## 5. Governance contradiction to reconcile (top priority for Myke)

Live Airtable + repo (`CLAUDE.md`, `data-integrity-findings.md`, commit `a7bef8f`)
state these were **applied with Myke's approval on 2026-06-24**:
AUTO-060–069 → Active; AUTO-137–176 registered Designed; AUTO-049→176; conf repoint;
source-tag fix. **But Jira FAR-199/200/201/202/204 are all still `To Do`** and FAR-199
lists each of these as an *open human gate*. Please confirm the approval was real and
move the Jira gates — or, if it was **not** sanctioned, advise on rollback (note:
reverting live Airtable + an already-deployed edge fn is itself disruptive).

---

## 6. Open Myke actions
- **a.** Confirm / formalize the **AUTO-137 → AUTO-175** ID block (39 scaffolds already
  Designed in Airtable). Reconcile the Jira-vs-repo approval contradiction (§5).
- **b.** **AUTO-050 collision** — approve reassigning the Designed "PUC & Utility Rate
  Case Monitor" → **AUTO-177** (keep AUTO-050 = Todo Digest, Active). Set **AUTO-055**
  Status (recommend Designed).
- **c.** **FAR-202** — decide per AUTO-070–119: author query sets + activate (own PR),
  or keep Designed / retire. Fix AUTO-118/119 `D17` → D17.2/D17.1 on activation.
- **d.** Confirm hot-thread taxonomy: `D4.7` (prompt) vs `D6.3` (repo).
- **e.** Review & merge this PR.
