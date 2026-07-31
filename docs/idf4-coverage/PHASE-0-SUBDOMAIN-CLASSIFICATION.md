# CC-IDF4-SUBDOMAIN-COVERAGE-1.0 — Phase 0 root cause

**Status:** BLOCKING gate. Findings below. **No writes performed. Awaiting go/no-go.**
**Date:** 2026-07-31 · **Project:** Supabase `ycadmmngkdhvpcsrcuaq` · **Epic:** FAR-319

---

## Headline

The brief's governing hypothesis is confirmed, and the mechanism is narrower and
cheaper to fix than "the classifier is under-scoped."

**There is no sub-domain classifier running in production, and there never was one on
the path that produces 99% of artifacts.** The 1,962 rows carrying `ifs_subdomains`
are the residue of a **one-time backfill script run on 2026-07-05**, not the output of
any recurring job. Nothing has written that column in 26 days.

Two separate defects, neither of which is a failure — both are **wiring gaps**:

| # | Defect | Blast radius | Model spend to fix |
|---|---|---|---|
| 1 | `source-poller` carries each source's domain tags in `signal_envelope.idf_domains` but **never copies them into the `ifs_domains` column** | 250,067 artifacts (94.6% of corpus) have `ifs_domains = NULL` despite the data being present in the same row | **$0** — pure SQL |
| 2 | The deployed `faraday-crawl` predates `splitIfsTags()`, so dedicated crawlers still write `D#.#` sub-domain codes **into `ifs_domains`** instead of `ifs_subdomains` | 5,396 rows since 2026-07-05, growing ~370/day | **$0** — deploy + SQL |

Only the *residual* gap — poller artifacts that carry no sub-domain signal at all —
needs an LLM, and that is the cheapest part of the job.

---

## Q1. What code path writes `artifacts.ifs_subdomains`?

**Answer: `supabase/functions/faraday-crawl/index.ts` — `splitIfsTags()` — and it is
NOT DEPLOYED.**

Not AUTO-134 (`engine-idf-entities`). That function writes `entities` and
`artifact_entities`; it does not touch `ifs_subdomains`. AUTO-134 is cleared as a
suspect.

Evidence that the column has no live writer:

```
last ifs_subdomains write : 2026-07-05 15:12:49+00
first                     : 2026-06-24 00:26:35+00
rows ever                 : 1,962   across 65 distinct auto_ids
```

Every one of those 65 auto_ids is a Tier-1/Tier-2 dedicated crawler (AUTO-060–119).
Those crawlers are **still running today** (7,299 rows, last seen 2026-07-30) — they
simply stopped populating `ifs_subdomains` after 07-05.

The `AUTO-164`/`AUTO-176` rows show the before/after side by side in one table:

| auto_id | `ifs_domains` | `ifs_subdomains` | rows | what this is |
|---|---|---|---|---|
| AUTO-164 | `{D3.1}` | `{}` | 84 | **current deployed behavior** — dotted code in the wrong column |
| AUTO-164 | `{D3}` | `{D3.1}` | 11 | correct shape, written by the 07-05 backfill |
| AUTO-176 | `{D3.2}` | `{}` | 85 | current |
| AUTO-176 | `{D3}` | `{D3.2}` | 12 | backfilled |

The 11/12-row slices are what `scripts/idf4-subdomain-backfill.mjs` (Phase A
deterministic split) produced in a single run. The 84/85-row slices are what
production has emitted every day since.

Confirming the deploy gap: the deployed `faraday-crawl` is **version 15, last updated
2026-07-04**. `splitIfsTags()` landed on branch `claude/idf-4-subdomain-coverage-id5ln0`
on **2026-07-05** — one day later. CLAUDE.md records the intended sequence ("apply the
migration, THEN deploy faraday-crawl v1.2"); the migration was applied, the deploy
never happened.

**Since 2026-07-05, 5,396 Tier-1/2 artifacts carry a `D#.#` code — 100% of them in
`ifs_domains`, 0% in `ifs_subdomains`.** The sub-domain signal is being captured
correctly and filed in the wrong drawer.

---

## Q2. What is the selection predicate? Why ~1,200 of 260,121 rows?

**There is no predicate, because there is no selector.** The ~1,200 figure is an
artifact of the 30-day window still reaching back to 2026-07-05. Recomputed against
the actual write history: **0 rows in the last 26 days.**

The deeper answer is that the two ingest paths have completely different tagging
behavior, and the dominant one tags nothing:

| crawler | artifacts | `ifs_domains` set | `ifs_subdomains` set | share of corpus |
|---|---:|---:|---:|---:|
| `source-poller_v1.x` | 250,067 | **0** | **0** | 94.6% |
| `AUTO-*` (faraday-crawl) | 14,253 | 14,233 | 1,962 (all pre-07-05) | 5.4% |

`source-poller` is not throttled, capped, or cost-limited. It writes the domain tags —
just not to the column anything reads:

```ts
// supabase/functions/source-poller/index.ts — pollOne()
signal_envelope: {
  source_key: src.source_key,
  idf_domains: src.idf_domains,   // ← the tags land HERE
  ...
},
// ifs_domains is never set on the insert
```

Verified across the whole poller corpus:

```
poller_rows           : 250,067
signal_envelope.idf_domains present & non-empty : 250,067  (100%)
ifs_domains column set                          :       0  (0%)
distinct source_keys                            :   7,700
```

**250,067 artifacts are one `UPDATE` away from being domain-tagged, at zero model
cost.** Projected domain distribution once propagated:

| D22 | D13 | D18 | D3 | D19 | D2 | D6 | D15 | D1 | D11 | D4 | D5 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 178,578 | 32,028 | **27,392** | 21,250 | 11,100 | 8,336 | **7,849** | 3,400 | 2,111 | 1,743 | **1,730** | **1,379** |

Bolded are parent domains of the 25 featureless sub-domains. Every one of the ten has
a substantial pool waiting: D18 **27,392**, D6 **7,849**, D15 3,400, D4 1,730,
D5 1,379, D7 923, D16 743, D14 614, D8 369, D17 186.

---

## Q3. Is it failing, or under-scoped?

**Neither. It is absent.** Every relevant job is green, and there are no failed HTTP
calls anywhere in the window:

```
cron.job_run_details, trailing 7 days
  enrich-artifacts-drain   1,008 runs   1,008 ok   0 failed
  source-poller-run          168 runs     168 ok   0 failed
  faraday-crawl-daily          7 runs       7 ok   0 failed
  engine-idf-entities          7 runs       7 ok   0 failed

net._http_response, trailing 3 days
  status 200 × 193       (no non-200 rows at all)
```

There is **no cron entry that classifies sub-domains** — `cron.job` has 60 active jobs
and none of them targets that column. The pipeline is healthy and doing exactly what
it was built to do; sub-domain classification was simply never wired into it.

One related finding worth flagging separately: the **Wave-3 whitespace crawlers
AUTO-138–152 produced exactly 4 artifacts each on 2026-07-21 and nothing since**, and
**AUTO-140 and AUTO-137 have produced zero artifacts ever**. That is a distinct
stall from the classification gap and needs its own diagnosis.

---

## Q4. Does the classifier have the 116-code vocabulary?

Not applicable — there is no classifier to hold a vocabulary. But the **vocabulary
itself is sound and ready**:

- `faraday_subdomains` holds **116 active codes**, matching the IDF 4.0 canon.
- The BEFORE trigger from migration `20260705000001` validates `D#.#` codes against
  that table and **strips** invalid ones with a warning rather than rejecting the row.
- Migration `20260705000001` **is applied** — the `ifs_subdomains` column exists and
  accepts writes. Only the function deploy is missing.

So the validation layer is in place and has been silently correct this whole time. It
has simply had almost nothing to validate.

---

## Q5. Marginal cost per 1,000 artifacts classified

Only the residual slice needs a model. Sizing it:

| Slice | Rows | Needs LLM? |
|---|---:|---|
| Poller rows, relevance-gated **in** (`enrich_status <> 'skipped'`) | 98,980 | Yes |
| Poller rows, relevance-gated **out** (`enrich_status = 'skipped'`) | 151,087 | **No** — the poller already decided these are query-lane noise not worth LLM spend; classifying them would contradict that gate |
| Tier-1/2 dotted codes already in `ifs_domains` | 5,396 | **No** — deterministic column move |
| Poller domain tags in `signal_envelope` | 250,067 | **No** — deterministic copy |

**Estimate, `claude-sonnet-4-6` @ $3 / $15 per MTok, 20 artifacts per call, shared
system prompt (116 codes + instructions) under prompt caching:**

| | per 1,000 | 98,980 rows |
|---|---:|---:|
| Standard API | **~$0.60–0.70** | **~$60–70** |
| Batch API (50%) | **~$0.30–0.35** | **~$30–35** |

Assumptions: artifact content averages **237 chars** (p90 332) — these are RSS
headline+summary snippets, not full documents — so ~100 input tokens each including
title/URL overhead; ~20 output tokens each (JSON with 1–3 codes); ~2,000-token cached
system prompt amortized across 50 calls per 1,000 artifacts.

If the 151k skipped rows were included anyway, add roughly **$90–105 standard /
$45–55 batch**. Not recommended.

**The full backfill costs less than $70, and under $35 on the Batch API.** Cost is not
the constraint on this work — the missing deploy is.

---

## Recommended remediation, in dependency order

Each step is independently valuable and independently revertible.

**Step 1 — Propagate poller domain tags (no model spend, no deploy).**
One named migration copying `signal_envelope->'idf_domains'` into `ifs_domains` for
250,067 rows, plus a trigger or a one-line change in `pollOne()` so new rows land
tagged. Takes domain coverage from **5.4% → ~99%** immediately.

**Step 2 — Deploy `faraday-crawl` with `splitIfsTags()` (no model spend).**
Stops the daily production of mis-filed `D#.#` codes. The code is already written,
reviewed, and merged; migration `20260705000001` is already applied. This is a deploy,
not a development task.

**Step 3 — Deterministic backfill of mis-filed codes (no model spend).**
Phase A of `scripts/idf4-subdomain-backfill.mjs` already does exactly this. Re-run it
over the 5,396 rows written since 07-05. Purely mechanical: move `D#.#` from
`ifs_domains` to `ifs_subdomains`, derive parent `D#` into `ifs_domains`.

**Step 4 — Verify the D18.1 canary before spending anything on Step 5.**
D18.1 is served by four Active automations (AUTO-137, 183, 193, 206) and has zero
artifacts. AUTO-206's 26 artifacts are tagged `{D11, D3}` — no D18 at all, let alone
D18.1. If Steps 1–3 do not light up D18.1, the diagnosis is wrong and Step 5 should
not proceed.

**Step 5 — LLM classification of the residual 98,980 poller rows (~$30–70).**
Newest-first, prioritizing the ten parent domains that own the 25 featureless
sub-domains. Only after Step 4 confirms the model.

**Step 6 — Add a coverage assertion to AUTO-178** so a sub-domain that stops producing
alerts within 7 days rather than "ever." Had this existed, the 07-05 regression would
have paged on 07-12 instead of surfacing 26 days later.

---

## Reclassification of the 25 (preliminary)

Full per-sub-domain evidence belongs in the Phase 2 report, but the Phase 0 data
already separates them:

- **Routing-gap-only** — parent domain has a large untagged pool; expect these to
  light up from Steps 1–3 with no new feeds: **D18.1, D18.2, D18.3** (27,392 D18
  artifacts), **D6.1, D6.2** (7,849), **D15.1** (3,400).
- **Routing + thin-source** — real pool but modest; likely need routing *plus* a few
  targeted feeds: **D4.1–D4.4, D4.6** (1,730), **D5.1–D5.4** (1,379), **D7.1, D7.4**
  (923), **D16.5, D16.6** (743), **D14.1** (614).
- **Genuine source gap** — parent pool too thin for routing alone to produce coverage:
  **D8.1, D8.2, D8.4, D8.5** (369 across all of D8), **D17.3** (186).

Note this ordering inverts the brief's implied plan: the largest wins need **no new
sources at all**, and the sub-domains that genuinely need feed-building are the
smallest group (6 of 25).

---

## Open items flagged, not acted on

1. **`ifs_*` vs `idf_*` naming.** `artifacts` uses `ifs_domains`/`ifs_subdomains`;
   `source_registry` uses `idf_domains`. Flagged per the brief; **not renamed**.
2. **Wave-3 crawler stall.** AUTO-138–152 produced 4 artifacts each on 2026-07-21 and
   stopped; AUTO-137 and AUTO-140 have never produced. Separate defect, separate fix.
3. **`source_registry` has no sub-domain grain.** Phase 1 proposes `idf_subdomains
   text[]` as a classifier prior. Named migration only, not drafted yet.
4. **AUTO-206 tagging is wrong at the source.** Its automation definition tags
   `{D11, D3}` for what the registry calls a D18.1 opposition feed. This is a config
   error in the automation, independent of the column-routing bug.

---

## What was NOT done

Per the brief's blocking gate: **zero writes.** No migration applied, no function
deployed, no Airtable record touched, no automation status changed, no AUTO-ID
assigned, no source registered. Every finding above came from read-only queries
against the live database and the checked-in source.
