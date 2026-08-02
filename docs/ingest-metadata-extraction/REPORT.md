# CC-INGEST-METADATA-EXTRACTION-1.0 — Report

Recover title and publisher metadata already present in `public.artifacts`
but invisible to the `match_artifacts` v1.2 citability predicate. All numbers
measured live against prod `ycadmmngkdhvpcsrcuaq` on **2026-08-01**.

> **EXECUTED 2026-08-01 — Myke approved all five §9 actions in PR #142.**
> Applied in this order (so no gap window exists):
> 1. `source-poller` **v1.4** deployed (fn version 15) — canonical
>    `title`/`summary` on every insert, `source` gated off for
>    `scope='query_feed'`. First post-deploy run: `success=true`, 23/23 ok.
> 2. Part 1 migration applied — all gates passed.
> 3. Part 2 applied: the ~245k-row rewrite exceeds the 60s MCP statement
>    window, so the identical approved UPDATE was pre-applied in six bounded
>    batches (sliced via the staging snapshot), then the migration ran as
>    recorded — its idempotent full UPDATE swept drift (0 rows remained) and
>    the gates passed.
> 4. **Verified: citable = 28,280 (exactly the projection)**; titled 273,652
>    (= total − 1,568 bare − 173 headline-less, exact); both hard guards 0.
>    Security advisors: zero findings touching artifacts/source-poller.
> 5. Scratch tables `cc_ingest_metadata_staging` / `cc_ingest_metadata_sample`
>    dropped (0 remaining).

## 1. Canonical envelope contract

**Canonical keys: `title`, `summary`, `source`** — kept exactly as the ticket
recommends, for two reasons that compound: the live `match_artifacts` v1.2
predicate already reads them, and the 13,276 legacy rows already conform. The
inverse direction (canonicalising on `source_name`) would have required a
function change plus a 13k-row legacy rewrite for zero benefit.

Mapping:

| Generation | title | summary | source | preserved as-is |
|---|---|---|---|---|
| Legacy (`faraday-crawl`, 13,276 rows) | already present | already present | already present (159 rows lack it) | `url`, `keyword_matches`, `published_at`, … |
| Current (`source-poller`, 260,549 rows) | ← first line of `raw_content` | ← text after first `\n\n` | ← `source_name` **iff a real publisher** | `source_name`, `source_key`, `license`, `license_status`, `idf_domains`, `confidence_cap` |

Additive only: `signal_envelope || jsonb_strip_nulls(...)`; no key dropped, no
existing non-empty value overwritten (COALESCE guards on every written key).
Because the canonical keys are the keys v1.2 already reads, **the
`match_artifacts` function needs no change** — the citability predicate is
"updated to read the canonical keys" vacuously, with zero regression risk.

## 2. Channel classification (measured)

Every row falls into exactly one channel; overlaps verified zero.

| Channel | Definition | Rows |
|---|---|---|
| `legacy` | envelope `title` non-empty | 13,276 |
| `stub` | `source_name` LIKE `Google News search:%` | 245,213 |
| `direct_pub` | `source_name` non-empty, not a search label | 15,336 |
| `bare` | none of the above | 1,568 |

Notes reconciling the ticket's table: the ticket's "14,844 direct rows with
`source_name` absent" = 13,276 legacy + 1,568 bare. All 245,213 stub URLs are
`news.google.com/rss` redirects and every stub's `source_name` is a search
label (both directions verified — no stub-URL row has a real publisher label
and no search label sits on a non-stub URL). A third sliver the ticket didn't
enumerate: 137 rows with `source` but no title — all have body-only
`raw_content` (0 have a `\n\n` break), so they stay uncitable; they are inside
the bare channel and are untouched.

## 3. Extraction rules

- **Title** = `btrim(split_part(raw_content, '\n', 1))`. Rejected when:
  blank; or the row is an unbroken body (no newline **and** >200 chars, per
  §5.2); or the first line exceeds **300 chars** — an added sanity cap beyond
  the ticket's rules (real headlines in the corpus max out at 288 chars in the
  stub channel; longer "first lines" are body sentences). The cap rejected
  body-shaped rows only; it is documented here for Myke to confirm.
- **Summary** (direct channel only) = text after the first `\n\n`, only when a
  title was extracted and no summary exists. The poller writes `raw_content`
  as `title\n\nsummary`, so this is the crawler's own summary half. Stub
  "summaries" are junk duplicates of the headline — never written.
- **Publisher** = `source_name` **only** in the direct channel. Never for
  stubs, never URL-derived, never headline-suffix-derived, never model-derived.
- **Stub titles** are extracted **as-is**, including Google's trailing
  `" - Publisher"` suffix — it is Google's own title text; stripping it risks
  truncating hyphenated headlines, and mining it for a publisher is forbidden.
  (Myke can reverse the keep-suffix call; see §7.)
- **Bare channel: excluded entirely** — decided by the measured sample, see §4.

## 4. 200-row hand-checked sample

Deterministic stratified draw (`md5(artifact_id)` order): 100 direct, 60 stub,
40 bare. Preserved in `public.cc_ingest_metadata_sample` (RLS deny-all) for
review; the full extraction is in `public.cc_ingest_metadata_staging`. Both
are scratch evidence tables — drop after sign-off.

| Channel | Sampled | Accepted titles | Accepted correct | Rejections | Rejections correct | Precision |
|---|---|---|---|---|---|---|
| direct_pub | 100 | 96 | **96** | 4 | 4 | **100%** |
| stub | 60 | 60 | **60** | 0 | — | **100%** |
| bare | 40 | 20 | **11** | 20 | 20 | **~55%** → channel excluded |

**Write-set precision (direct + stub, the only channels written): 156/156 =
100%**, clearing the ≥98% bar. Publisher values in the direct sample were
genuine publications in all 100 cases (Texas Tribune, heise online,
TeleSíntese, Data Center Market, NVD, …).

Every rejected / flagged case:

- **Direct rejections (4/4 correct)**: 3× Telecompaper and 1× iMasons rows
  whose `raw_content` is an unbroken aggregate body (`"GLOBAL 10:16 Skywave
  to offer…"`) — exactly the §5.2 "body, not a headline" class. Corpus-wide:
  173 direct rows share this shape; they gain a publisher but no title and
  stay uncitable.
- **Direct flagged-but-faithful (2, counted correct)**: a PR Newswire
  category-RSS item whose feed title is literally `"STEM (Science, Tech,
  Engineering, Math)"`, and a Cloudflare Status maintenance item
  (`"AMS (Amsterdam) on 2026-07-29"`). Both are the publisher's own item
  titles — feed-level junk, not extraction error. NVD rows title as bare CVE
  ids (`CVE-2026-57600`) — terse but correct.
- **Bare accepted-but-wrong (9/20)**: LinkedIn post first sentences ("AI-ready
  infrastructure depends on more than selecting the newest technology."),
  truncated post fragments, and one synthetic label
  (`"google LinkedIn Post 2026-06-09T00:00:00Z"`). First-line-as-title is not
  a valid rule for this channel → **excluded from the backfill**. Its 550
  candidate titles are forfeited; those rows were never citable-eligible
  anyway (no publisher).
- **Bare rejections (20/20 correct)**: unbroken bodies, one raw JSON blob.

## 5. Row counts

| Population | Rows | Outcome |
|---|---|---|
| Direct: gain title + summary + publisher → **citable** | **15,163** | title, summary (14,054 of them), source |
| Direct: unbroken body — gain publisher only, no title, stay uncitable | 173 | source only |
| Stub: gain title, stay uncitable (URL condition) | 245,213 | title only — **Myke decision** |
| Bare: unchanged (precision fail / no publisher) | 1,568 | nothing |
| Legacy: unchanged (authoritative) | 13,276 | nothing |

Drift note: the corpus grows ~10.5k rows/day — ~10.2k stubs + ~340
legacy-shape rows (faraday-crawl already lands canonical). The direct-gap
channel showed **0 arrivals in the trailing 24h**, so 15,336/15,163 should be
stable; stub counts will be higher at apply time. Migration gates are
therefore invariant-based, not exact-count.

## 6. Projected citable count

**13,117 (today, reproduced exactly) + 15,163 = 28,280** vs the ticket's
28,453 estimate. The gap is exactly the **173** direct rows with unbroken-body
`raw_content` — no headline is genuinely recoverable for them, so per §5.2
they correctly stay uncitable. (The ticket's 15,336 recoverable figure counted
publishers; 173 of those rows can't also yield a title.)

Verified in a BEGIN..ROLLBACK dry-run against prod (Part 1 executed in full):
15,336 rows updated · 15,163 newly citable · `gain = expected` · 0
Google-label sources · 0 stub-URL rows with a source · rollback confirmed
clean afterwards. Part 2 proven on a 40,000-row slice: 40,000 titles, 0
sources, 0 rows became citable.

## 7. Regression — v1.2 table re-run

Function unchanged (see §1), probe = an existing citable chunk's own embedding
(`chunk_id 6bf38784…`, the PR #140 method), `match_count = 10`,
`citable_only = false` unless noted:

| Call | v1.2 (PR #140 baseline) | This re-run | Direct-SQL genuine count |
|---|---|---|---|
| no filters, threshold 0.0 | 10 | **10** | ≥10 |
| `published_since = 2026-07-25` | 10 | **10** | ≥10 |
| `similarity_threshold = 0.5` | 10 | **10** | ≥10 |
| `similarity_threshold = 0.8` | 6 (its probe) | **9** | **9** (scarcity, not starvation) |
| `citable_only = true`, t=0.0 | — | **10** | ≥10 |

Self-probe returns its own artifact at rank 1, similarity 1.0000. Inside the
Part-1 dry-run transaction (post-backfill state), the `citable_only = true`
call still returned 10/10 — the enlarged citable pool serves correctly.
Scenarios with `citable_only = false` are structurally unaffected by envelope
writes (retrieval is embedding + URL/date filters); the affected surface is
the citable pool and the `is_citable` flag, both verified above.

## 8. Crawler write-path (outside this repo — follow-up ticket)

The current-generation writer is the **deployed `source-poller` edge function
(AUTO-199, CC-SOURCE-SCALE-500)** — its source is not in this repo, jw, or
Faraday. It already holds the parsed item title/summary at insert time and
builds `raw_content` from them. Specified follow-up
(**CC-INGEST-CANONICAL-WRITE**, one-line-diff scale): in `pollOne()`'s row
construction, extend `signal_envelope` with
`title: it.title`, `summary: it.summary || undefined`, and
`source: src.scope === 'query_feed' ? undefined : src.name` — the scope guard
keeps search labels out of `source` at the source. After it deploys, re-run
the Part-1/Part-2 UPDATE statements (they are idempotent) as a sweep to close
the gap-window tail. `faraday-crawl` (the legacy-shape writer, still active at
~340 rows/day) already lands canonical keys and needs no change.

## 9. Myke actions

1. **Approve or reject the bulk write** — Part 1
   (`20260801130000_ingest_metadata_envelope_backfill_direct.sql`): 15,336
   rows, raises citable to ~28,280. Apply via `apply_migration`; gates
   self-verify and roll back on failure.
2. **Decide stub titles** — Part 2 (`20260801130001…`): 245k+ rows gain
   titles, zero citability change, positions ticket B. Recommended: yes.
   Strike the file if no. Note the multi-minute runtime (apply via
   `apply_migration`/psql, not the 60s interactive window).
3. **Confirm the canonical key direction** (`title`/`summary`/`source`
   canonical; `source_name` et al. preserved) and the two judgment calls:
   the 300-char title sanity cap, and keeping Google's `" - Publisher"`
   suffix in stub titles.
4. Approve the **CC-INGEST-CANONICAL-WRITE** follow-up for `source-poller`
   (§8), plus the post-deploy idempotent sweep re-run.
5. After sign-off: drop the scratch evidence tables
   `cc_ingest_metadata_staging` and `cc_ingest_metadata_sample`.
