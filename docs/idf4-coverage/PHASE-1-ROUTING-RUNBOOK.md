# CC-IDF4-SUBDOMAIN-COVERAGE-1.0 — Phase 1 routing runbook

**Status:** steps 1, 2, 4 **APPLIED to prod 2026-07-31** (Myke: "Apply steps 1-4").
Step 3 (deploy) **BLOCKED** — see the conflict below. Steps 5–7 not started.
**Date:** 2026-07-31 · **Supersedes nothing** — builds on
`docs/idf4-coverage/PHASE-0-SUBDOMAIN-CLASSIFICATION.md` (merged, PR #125).

---

## Execution results

| Step | Outcome |
|---|---|
| 1 — migration `20260731000001` + `…002` | ✅ Applied. Trigger installed, verification gate passed, probe discarded, **0 existing rows modified** |
| 2 — poller domain propagation | ✅ **250,067 rows tagged.** Domain coverage **5.4% → 100.0%** (264,300 / 264,320) |
| 3 — deploy `faraday-crawl` | ⛔ **BLOCKED** — would activate 15 automations incl. AUTO-140 (see below) |
| 4 — split mis-filed `D#.#` | ✅ **5,918 rows split.** Zero dotted codes remain in `ifs_domains` |

Reconciliation check: 1,962 pre-existing + 5,918 split = **7,880 rows with a
sub-domain**, matching exactly — the validation trigger stripped nothing.

Advisor impact: **396 → 394 findings, zero new.** The first migration introduced
two `security_definer_function_executable` WARNs; `20260731000002` removed the
unnecessary `SECURITY DEFINER` and cleared both.

### ⚠️ Correction to the Phase 0 reclassification

**The 25 featureless sub-domains are still featureless. Sub-domain coverage did
not move: 91/116 fed before, 91/116 after.**

Phase 0 predicted six of them (D18.1–.3, D6.1, D6.2, D15.1) were
"routing-gap-only" and would light up from steps 1–4 alone. **That prediction was
wrong**, and the reason is structural rather than incidental:

`source_registry` tags at **domain grain only** — it has no sub-domain column.
Propagating poller tags therefore can never produce a `D#.#` code, no matter how
many rows it fixes. A sub-domain code exists only if a crawler emits one. Phase 0
noted the missing grain as an open item but still classified those six as
routing-only; those two facts contradict each other and the classification was
the wrong one.

**What steps 1–4 did deliver is real and was the prerequisite:** the 27,392 D18
artifacts, 9,772 D6, 4,375 D15 and so on are now *visible and classifiable*
instead of invisible, and the sub-domain measurement now reads one column
correctly rather than straddling two conventions. But turning that pool into
sub-domain coverage requires the classifier (step 6) or a crawler that emits the
codes — not routing.

**The D18.1 canary was therefore not a fair test and remains unresolved.** It
cannot light up while no automation emits `D18.1`; AUTO-206 tags `{D11, D3}`.
Fixing that config error is a precondition for the canary to mean anything.

### Parent-domain pools now visible (were all reporting 0)

| D18 | D6 | D15 | D5 | D4 | D7 | D16 | D14 | D8 | D17 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 27,392 | 9,772 | 4,375 | 3,619 | 3,477 | 2,299 | 1,436 | 1,437 | 934 | 548 |

### ⛔ Why step 3 is blocked

Deploying the repo's `faraday-crawl` does more than pick up `splitIfsTags()` and
the dual-tags. The repo merges **`WAVE3_ACTIVATION` (AUTO-138–152) into the live
`AUTOMATIONS` fleet**; the deployed v15 does not. Deploying would therefore
enable 15 crawlers on the 07:00 cron.

**AUTO-140 is in that range** — and Myke's 2026-07-31 addendum explicitly
reclassified AUTO-140 as a zero-source Phase 2 **build target** whose status
"stays untouched until their sources are registered and validated." The brief
also states plainly: *"Do not enable any automation."*

Verified the deploy is otherwise safe: the repo is a strict superset of the
deployment (**no automation exists only in the deployment**, so nothing would be
lost), and the repo adds AUTO-179–182 only inside the inert
`WHITESPACE_SCAFFOLDS` array, which `index.ts` never merges.

Two ways forward, both needing a decision:
1. **Deploy with `WAVE3_ACTIVATION` removed from the `AUTOMATIONS` merge** —
   gets `splitIfsTags()` + the dual-tags, activates nothing. Requires a small
   committed change so deployed ≡ `main`.
2. **Deploy as-is**, accepting activation of AUTO-138–152 — needs explicit
   sign-off that supersedes the addendum for the other 14.

Until one is chosen, ~370 artifacts/day keep landing with `D#.#` in
`ifs_domains`. Step 4 is idempotent and can simply be re-run afterwards.

---

## Myke addendum decisions, absorbed

### 1. Taxonomy — dual-tag, do not re-route ✅ implemented

Both collisions are now additive dual-tags in
`supabase/functions/faraday-crawl/coverage-bridge.ts`. Existing routing is
untouched and artifact history is preserved.

| AUTO | was | now | derived parents |
|---|---|---|---|
| AUTO-062 Hyperscaler Custom Silicon | `["D1.7"]` | `["D1.7", "D5.2"]` | D1 + D5 |
| AUTO-090 Sovereign AI Programs | `["D15.2"]` | `["D15.2", "D6.2"]` | D15 + D6 |

`splitIfsTags()` already handles multi-sub-domain arrays correctly — it
accumulates into Sets and derives every parent, so `["D1.7","D5.2"]` yields
`ifs_subdomains = {D1.7, D5.2}` and `ifs_domains = {D1, D5}`. **No change to the
splitter was required.**

Dual-tagging is now the standing default for cross-domain collisions. Any
further collision will be proposed, not silently resolved.

### ⚠️ AUTO-033 — one discrepancy, flagged rather than implemented

The addendum says *"AUTO-090 / AUTO-033 keep D15.2; add D6.2."* AUTO-090 does
carry `D15.2` and has been dual-tagged. **AUTO-033 does not carry `D15.2`** — it
is a broad regulatory crawler tagging four *parent* domains:

```ts
{ auto_id: "AUTO-033", source_type: "regulatory",
  ifs_domains: ["D15","D6","D4","D1"], ... }
```

**Recommendation: do NOT add `D6.2` to AUTO-033.** Its three queries cover
sovereign AI *and* US–China chip geopolitics *and* general national-security AI
investment. A precise sub-domain code on a deliberately broad crawler would
stamp `D6.2` onto every artifact it returns, including export-control and
chip-competition stories that are not national-compute-programme news. That
pollutes D6.2 rather than feeding it, and D6.2's coverage number would then be
measuring the wrong thing.

AUTO-090 is the dedicated D15.2/D6.2 feed and is the correct carrier. AUTO-033
already contributes `D6` at parent grain, which is accurate.

**This needs a yes/no from Myke.** It is left unimplemented either way.

### 2. The nine AUTO scaffolds — Phase 2 build targets ✅ confirmed

Independently verified against `source_registry`:

```
AUTO-140, 158, 168, 169, 170, 171, 173, 174, 175
  → 0 rows. No sources, no feed_urls, no last_artifact_at.
```

The query returns an empty set — not rows with null feeds, **no rows at all**.
Myke's verification holds exactly. These are name-only scaffolds holding a
reserved AUTO-ID and a scoped title.

They will be reported in the Phase 2 source table as ordinary gaps. Their
Airtable Status stays untouched until sources are registered and validated.
The Phase 0 report's phrase "activate, do not duplicate" is **withdrawn** — there
is nothing to activate.

### 3. Phase 0 remains blocking ✅ honored

No migration applied, no function deployed, no backfill executed, no Airtable
write, no automation status changed.

---

## Prepared artifacts

| File | What it is | State |
|---|---|---|
| `supabase/migrations/20260731000001_artifacts_fill_ifs_domains_from_envelope.sql` | Trigger mirroring `signal_envelope->idf_domains` into `ifs_domains` when empty | **Proposal — not applied** |
| `scripts/idf4-propagate-poller-domains.mjs` | Batched history backfill for the 250,067 rows | **Dry-run default — not run** |
| `supabase/functions/faraday-crawl/coverage-bridge.ts` | Dual-tag edits (AUTO-062, AUTO-090) | **Committed — not deployed** |

### Why a trigger instead of patching `source-poller`

**`source-poller`'s source is not checked into any repository.** It is not in
`v0-faraday-daily-challenge`, not in the `Faraday` engine repo, and not in `jw`.
It exists only as a deployed Supabase edge function (v13). Patching it would
mean editing code fetched from the deployment and pushing it back — which the
governance rule *"branch-and-PR only for any code change"* forbids, since there
is no branch for it to land on.

A trigger is in-repo, reviewable as a named migration, and additionally covers
every other ingest path that populates `signal_envelope` but forgets the column.

**Filed as a follow-up: vendor `source-poller` into version control.** The
function producing 94.6% of the corpus having no version-controlled source is a
governance gap independent of this workstream.

### Migration safety properties

- Fires **only** when `ifs_domains` is NULL or empty — never overwrites a real tag.
- Writes **only** well-formed parent codes (`^D\d+$`); junk and `D#.#` codes are
  rejected, because mixing sub-domain codes into `ifs_domains` is the exact
  defect this workstream exists to fix.
- Never touches `ifs_subdomains`, so it cannot trip
  `trg_artifacts_validate_ifs_subdomains`.
- DDL only — **modifies zero existing rows.** History is the script's job.
- Carries an in-migration verification gate that inserts a probe row, asserts
  `{"idf_domains":["D18","D6","not-a-code","D7.1"]}` normalizes to exactly
  `{D18, D6}`, then raises to discard the probe. An unexpected result aborts
  the migration.

Verified against live schema before writing: `artifacts` has **no foreign keys**
(only PK + `unique(content_hash)`), so the probe insert is legal; `content_length`
is GENERATED and is not supplied.

---

## Execution order — each step gated

**Step 1 — apply migration `20260731000001`.** Forward fix. Must land *before*
the backfill, or the poller keeps producing untagged rows faster than the script
drains them. Requires `apply_migration` sign-off.

**Step 2 — run the backfill dry, read the output, then `--write`.**
`node scripts/idf4-propagate-poller-domains.mjs` → inspect the code-set
distribution → re-run with `--write`. Resumable and self-terminating; `--max=N`
caps a first cautious pass. Zero model spend.

**Step 3 — deploy `faraday-crawl`.** Picks up `splitIfsTags()` (stops the daily
mis-filing, ~370 rows/day) *and* the dual-tag edits in the same deploy. Migration
`20260705000001` is already applied, so the column is ready.

**Step 4 — re-run Phase A of `scripts/idf4-subdomain-backfill.mjs`** over the
5,396 rows written since 2026-07-05. That script already implements exactly this
split; no new tooling needed. Zero model spend.

**Step 5 — the D18.1 canary. STOP HERE AND CHECK.**
D18.1 is served by four Active automations and has zero artifacts. If steps 1–4
do not light it up, the Phase 0 diagnosis is wrong and no further spend is
justified. Note AUTO-206 tags `{D11, D3}` for what the registry calls a D18.1
opposition feed — that config error must be fixed for the canary to be a fair
test, and it is *not* fixed by anything above.

**Step 6 — LLM classification of the residual 98,980 rows (~$30–70).** Only
after step 5 passes. Separate sign-off.

**Step 7 — coverage assertion on AUTO-178** (alert at 7 days, not "ever").

---

## Rollback

| Step | Reversal |
|---|---|
| 1 | `drop trigger trg_artifacts_fill_ifs_domains on public.artifacts;` — the function is `create or replace`, so re-applying is safe |
| 2 | Rows changed are exactly those matching `crawler_id like 'source-poller%'` with previously-empty `ifs_domains`; re-emptying is a single scoped UPDATE. No data is destroyed — the source of truth stays in `signal_envelope`. |
| 3 | Redeploy the prior `faraday-crawl` version |
| 4 | Phase A moves codes between columns; the inverse is mechanical |

Nothing in steps 1–4 discards information. Every value written is derived from
data already present in the same row.

---

## Open questions for Myke

1. **AUTO-033 — add `D6.2` or leave it at parent grain?** Recommend leave it;
   see the flag above.
2. **Vendor `source-poller` into version control?** Recommend yes, as its own
   piece of work. It is currently unreviewable and un-rollback-able.
