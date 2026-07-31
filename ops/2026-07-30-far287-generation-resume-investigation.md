# CC-DC-BANK-RESUME-1.0 — Phase 0 investigation: resuming the FAR-287 generation run

**Status: Phase 0 complete — STOPPED at the approval gate. No writes were made** (no
Supabase writes, no Airtable writes, no generator invocation; the only local side effect
was regenerating the gitignored `exports/far287-calendar.json`, which left the committed
CSV/review artifacts byte-identical — that regeneration IS the determinism verification).

Investigated 2026-07-31 against live Supabase `ycadmmngkdhvpcsrcuaq` and the live
Airtable Puzzle Bank `appxfti7VuoHYUeu6/tbliJaRmctbIWJC43`.

---

## Headline findings

1. **The blocker the 07-29 plan flagged is moot.** The gitignored calendar JSON is
   trivially and *provably* reproducible: `build-calendar.mjs` is pure/seeded, and the
   regenerated 500 days match the 500 rows already in `dc_daily_theme` **checksum-exact**
   (md5 `0547b9ef1df3839a7b473e204d5b2d0d` on both sides, over
   date|theater|sector|tier|threads|title|blurb|seed|registry). No IDF drift. No code
   patch is required to source the calendar. This ticket is "one command" (plus the
   bookkeeping fixes below).
2. **Phases 1 and 2 were already partially executed by a prior session — DB-side only.**
   The ticket's ground truth (dated 2026-07-30) says 7 staging rows are `published='Live'`
   and the run row has bare params. Live state today: the 7 rows are already demoted to
   `Approved`/`Unpublished` (public IDs retained, batch id intact — exactly the ticket's
   D5), and `dc_puzzle_generation_runs.params` already carries
   `backfilled_by: "CC-DC-BANK-RESUME-1.0 Phase 2"` with
   `calendar_completed_at: 2026-07-29 01:58:45Z` / `calendar_themes_written: 500`.
   The repo-side deliverables of those phases (this report, the Phase-1 regression test,
   the Phase-2 code fixes to the generator's bookkeeping) do **not** exist — no branch or
   PR carries them. Remaining Phase 1/2 work is repo-side only.
3. **A resume entry point exists and is usable as-is**: `--resume <run_id>` in
   `generate-puzzles.mjs`. It reuses the run row, keys `generation_batch_id` to it, and
   skips (type, date) pairs already written for that run. D4 (advance run
   `34dd26f6-9fe7-40be-bfcd-7a733031e2e5` in place) is directly supported.
4. **One hard operational blocker for Phase 3**: `ANTHROPIC_API_KEY` is not provisioned
   in this session's environment (checked by name only). `SUPABASE_SERVICE_ROLE_KEY` and
   `AIRTABLE_API_KEY` are present; `SUPABASE_URL` is trivial
   (`https://ycadmmngkdhvpcsrcuaq.supabase.co`). Provision the Anthropic key (and confirm
   the account has credit — the crawl fleet has twice stalled on a depleted balance, per
   CLAUDE.md incident notes) before the pilot.

## Ground truth re-verified (2026-07-31)

| Fact | Ticket (07-30) | Live now | Delta |
|---|---|---|---|
| `dc_daily_theme` | 500 rows, 2026-08-01→2027-12-13, 0 incomplete | 500 / 2026-08-01→2027-12-13 / 0 incomplete | none |
| Themes with any staged puzzle | 0 of 500 | 0 of 500 | none |
| Run row | `calendar_built`, written 0, failed 0, `completed_at` null | same status/counts, but params backfilled by a prior CC-DC-BANK-RESUME session | **Phase 2 backfill already applied (DB)** |
| Staging rows | 7, `published='Live'`, go_live 2026-07-28 | 7, `status='Approved'`, **`published='Unpublished'`**, public IDs retained (`RACK-26-07-28-00337`…`FREQ-26-07-28-00343`), batch `…-202607290001` | **Phase 1 demote already applied (DB)** |
| `staging where published='Live'` | 7 (the landmine) | **0** | landmine already neutralized |
| Migration objects | all present | trigger `trg_dc_assign_public_id`, `fn_dc_rotate_live_set`, `fn_dc_approve_puzzles`, `dc_staging_published_gld_idx`, `dc_puzzle_bank_staging_type_date_uniq` all present; `dc_public_id_seq.last_value` = 365 | none |
| `DC_PUZZLE_SOURCE` | unset in prod | not touched by this session (D6) | none |
| Airtable bank | 373 records, max Go Live Date 2026-08-14 | `totalRecordCount: 373`, max Go Live Date 2026-08-14 (Published) | none |

The two deltas are explained (a prior session of this same ticket), not anomalous — so
per D8 they are reported here rather than treated as stop-the-world, and nothing was
"fixed and continued."

Note on the 7 pilot rows: they carry non-NULL `public_id` because the trigger minted IDs
on their earlier transition to Live; demotion correctly does not revoke an ID. Acceptance
criterion 5 ("all `public_id` NULL") applies to the 3,500 *generated* rows (a different
`generation_batch_id`), not these imports.

---

## Q1 — Where does the generator read its calendar from?

**From disk, and only from disk.** `scripts/far287/generate-puzzles.mjs:40`:

```js
const CAL = JSON.parse(readFileSync("exports/far287-calendar.json", "utf8"));
```

There is no code path that reads `dc_daily_theme`. The JSON is explicitly gitignored
(`.gitignore`, last line: `exports/far287-calendar.json`) and was absent from the clone.

**Regeneration is the cheaper path, and it is verified safe:**

- `scripts/far287/build-calendar.mjs` is pure and deterministic: seeded PRNG
  (`mulberry32`/`xmur3` from seed `far287-v1`, lines 31, 40–48), reads only the
  **committed** snapshot `scripts/far287/idf-taxonomy-snapshot.json` (line 59), uses no
  network and no wall clock (the JSON's timestamp field is the literal
  `"generated_at_placeholder"`, line 290). Defaults: `--seed far287-v1`,
  `--start 2026-08-01` (lines 31–32), `REGISTRY_VERSION "IDF 4.0"` (line 34) — exactly
  the run row's recorded parameters.
- **Ran it (local-only).** It emitted 500 days, all constraints PASS — and left the
  committed `exports/far287-calendar.csv` and `docs/far287-calendar-review.md`
  byte-identical (`git status` clean), i.e. neither the builder nor the snapshot has
  drifted since the calendar was committed (`0ebf4bb`).
- **Compared against prod.** md5 over
  `theme_date|theater_id|sector_code|jpas_tier_code|thread_codes|theme_title|theme_blurb|rotation_seed|registry_version`
  for all 500 rows, ordered by date:
  - live `dc_daily_theme` (SQL `string_agg`): `0547b9ef1df3839a7b473e204d5b2d0d`
  - regenerated JSON (node, same canonical string): `0547b9ef1df3839a7b473e204d5b2d0d`

  **Identical. No divergence ⇒ no STOP condition; the IDF registry has not drifted.**

**Proposed (optional, Phase 2): a preflight guard, not a rewire.** A ~15-line check at
generator start — recompute the JSON-side checksum, `sbSelect` the same aggregate from
`dc_daily_theme`, abort on mismatch — makes the disk/DB equivalence an enforced invariant
for the full run instead of a one-time verification. Not required to proceed.

## Q2 — What advances the run record?

The generator itself, and **only at two moments**:

- `generate-puzzles.mjs:95-96` — INSERTs a **new** run row (`status: "running"`) only
  when invoked without `--resume` (and not `--dry-run`).
- `generate-puzzles.mjs:171-172` — the **only UPDATE**: after the full loop finishes, it
  sets `completed_at`, `written_count`, `failed_count`, and
  `status = PILOT ? "pilot_complete" : "complete"`.

Nothing in the calendar-load path touches the run row: `emit-calendar-sql.mjs` (whole
file, 27 lines) only emits `insert into public.dc_daily_theme … on conflict do nothing`
batches stamped with `generation_run_id`; applying those batches on 07-29 therefore left
the run row untouched. The row itself was created out-of-band on 07-24 with
`status='calendar_built'` (a status string the generator never writes — it knows only
`running`/`pilot_complete`/`complete`). That is the whole bookkeeping gap: **the code was
never missing an *updater*; the calendar phase simply has no writer, and the generator
was never invoked.** The factual backfill half of Phase 2 (recording that the calendar
completed 07-29 with 500 themes) has since been applied to `params` by a prior session.

**Remaining Phase-2 code defects (proposed fixes, not yet written):**

1. **Resume overwrites instead of accumulates** — on `--resume`, line 171 writes the
   *current invocation's* `written`/`failed` over the row, losing prior totals. Fix:
   count `generation_batch_id = run_id` rows in staging for `written_count` (ground
   truth), accumulate `failed_count`, or store per-invocation counts in `params`.
2. **Status is set unconditionally** to `complete`/`pilot_complete` at process end even
   when hundreds of items failed. Fix: only `complete` when written == target; otherwise
   a resumable status (e.g. `generating`).
3. **No mid-run checkpointing** — a crash leaves the row stale until the next full pass
   ends (ticket Phase 4 requires checkpointed `written_count`). Fix: update the row every
   N batches.
4. **`--resume` never flips status back to `running`** at start (line 94–96 skips the
   insert and writes nothing).
5. **Pilot-size mismatch**: `--pilot` = first **10** days = 70 records
   (`generate-puzzles.mjs:35`), but ticket Phase 3 specifies **7** days / 49 puzzles.
   Running `--limit 7` gets the right scope but then line 172 stamps `complete` instead
   of `pilot_complete`. Small patch needed (make the pilot day-count a flag, or treat any
   `--limit` run as non-terminal).

## Q3 — Is there a resume entry point?

**Yes.** `--resume <run_id>` (`generate-puzzles.mjs:37`):

- line 94: `runId = RESUME || randomUUID()` — the supplied id becomes
  `generation_batch_id` on every inserted row (line 159), matching D4 (no second run row;
  line 95's insert is skipped when resuming).
- lines 101–105: builds an `already` set from
  `dc_puzzle_bank_staging?select=puzzle_type,go_live_date&generation_batch_id=eq.<run_id>`
  and skips those (type, date) pairs (line 115) — idempotent re-entry.
- Below that sit the schema safety nets: `unique(puzzle_type, go_live_date)`
  (`supabase/migrations/20260724000001_create_dc_puzzle_bank_staging.sql:94`) and unique
  `content_hash` (line 87 of the same migration).

So the correct invocation for this ticket is
`node scripts/far287/generate-puzzles.mjs --limit 7 --resume 34dd26f6-9fe7-40be-bfcd-7a733031e2e5`
(pilot), then the same with no limit (full run). The "actual gap" is not a missing
worker — it is the bookkeeping defects above plus the fact nobody has ever run it.

**Two sharp edges to respect when running (flagged for the Phase-3 gate):**

- `sbInsert` always sends `Prefer: resolution=merge-duplicates`
  (`scripts/far287/lib/clients.mjs:22`) and the generator passes
  `on_conflict=content_hash` (line 163) — a hash-identical regeneration would *update*
  the existing row in place. Within a single `--resume` run the `already` set prevents
  ever re-generating a written (type, date), so reviewed content is not overwritten —
  but **never run the generator without `--resume` once staging has rows** (a fresh
  batch id empties the `already` set, and (type,date) collisions then surface as
  per-item failures rather than skips).
- Batch/array pairing is positional (`arr[k]`, line 134): if the model returns fewer
  objects than requested items, later items' content can bind to the wrong theme date.
  The per-puzzle theme-binding review in Phase 3 (ticket requirement) is the check that
  catches this class; worth watching specifically.

## Q4 — Promotion path from staging to serving

Confirmed sufficient once the flag flips; nothing needs to write back to Airtable
meanwhile.

- Generated rows land `status='Draft'` / `published='Unpublished'`, `public_id` NULL
  (generator row literal, `generate-puzzles.mjs:153`; trigger mints only on the first
  transition into Published/Live/Retired —
  `supabase/migrations/20260729000001_dc_supabase_serving.sql`, D2 guarantee).
- Under `DC_PUZZLE_SOURCE` unset (= airtable, current prod), staging serves nothing:
  the facade `src/lib/puzzle-bank.js` routes all three routes + day-content sync to the
  Airtable lib. Filled Draft staging rows are inert. Confirmed `staging_live = 0` today,
  so even the supabase path would currently serve nothing.
- Post-flip: `fn_dc_approve_puzzles(dates[], actor)` is the only Unpublished→Published
  path (nothing auto-publishes), and `fn_dc_rotate_live_set(date)` promotes
  Published+today / retires Live+strictly-before in one transaction. Both verified
  against prod in the rolled-back 9-assertion harness on 07-29
  (`docs/dc-supabase-serving/README.md:17-31`), and all objects re-confirmed present
  today (trigger, both fns, `(published, go_live_date)` index, sequence at 365).
- **Pre-cutover Airtable window needs no writes**: the stopgap re-date
  (`docs/far287-stopgap/README.md`, APPLIED 07-29) gives Airtable a full 7-type set for
  every date through **2026-08-14**, re-verified live today (373 records, max Go Live
  Date 08-14). `scripts/far287/sync-puzzle-bank-to-airtable.mjs` stays untouched
  (guardrail: never `--execute`) and is slated to become vestigial at cutover
  (`docs/dc-supabase-serving/README.md:93-94`).
- Known cutover-time collision (not a generation blocker, feeds D7/Phase 5): once the
  bank is full, staging will hold *generated* rows for 08-01→08-14 while Airtable serves
  *recycled* rows for the same dates. Which set players see is decided solely by the
  flag + Myke's D7 call; the two stores don't conflict mechanically.

## Q5 — Cost and runtime estimate (3,500 puzzles)

Basis: model `claude-sonnet-4-6` (`scripts/far287/lib/clients.mjs:28`, overridable via
`FAR287_GEN_MODEL`), current pricing $3 / $15 per MTok (input/output). One API call per
batch of `--batch` items (default 10, clamped 8–12) of one type
(`generate-puzzles.mjs:125-131`), `max_tokens: 4096`. Prompt sizes measured with the real
templates against the real calendar (10-item batches, realistic subject strings):
system ≈ 1,350 chars, user ≈ 5,500–6,000 chars → **≈ 1,850–2,000 input tokens/call**.

| | Calls | Input tokens | Output tokens (≤cap) | Cost |
|---|---|---|---|---|
| Full run: 500 days × 7 types, batch 10 | 350 | ~0.70M | ≤1.43M (cap) / ~1.1M realistic | **≈ $19–24** |
| Per day (7 puzzles) | 0.7 | ~1.4K | ~2.9K | **≈ $0.05** |
| Pilot: 7 days × 7 types (1 call/type) | 7 | ~14K | ≤29K | **≈ $0.40** |

- **Runtime**: sequential (no concurrency in the loop). ~45–70 s/call at near-cap output
  → **≈ 4.5–7 h** for the full run single pass, plus a one-time corpus build
  (`--refresh-corpus`, minutes). Pilot: ~5–10 min. Budget 1–3 additional `--resume`
  passes to mop up validation/model failures (each pass only regenerates failed
  (type, date) slots, so incremental cost is proportional to the failure rate —
  historically-typical few-percent → single-digit dollars).
- **Truncation risk worth managing**: 4,096 output tokens across 10 puzzles is tight for
  content-heavy types (The Brief's 3-paragraph brief + 3 questions + hints can run
  500–700 tokens/puzzle). A truncated array is salvaged object-by-object
  (`parseArray`, lines 44–57) with the tail failing validation — recoverable via
  `--resume`, but consider `--batch 8` for The Brief/Rackl, or observe the pilot's
  failure pattern first.
- **Prerequisites to run**: `ANTHROPIC_API_KEY` (**missing in this environment** — and
  verify credit balance), `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`,
  `AIRTABLE_API_KEY` (non-repeat fingerprint check reads the live bank; fails soft to
  run-internal dedupe only — `generate-puzzles.mjs:65-86` — which would weaken the
  "no collision with the historical 373" acceptance check, so treat it as required).

---

## Remaining work if Phase 0 is approved

1. **Phase 1 (repo-side remainder)**: the demote is done; add the regression test —
   assert `count(*) where published='Live' and go_live_date <> current serve date` is 0
   (the invariant `fn_dc_rotate_live_set` maintains), wired as `npm run test:staging-live`
   alongside the existing `test:*` conventions.
2. **Phase 2 (repo-side remainder)**: the factual backfill is done; implement the five
   generator bookkeeping fixes listed under Q2 (+ optionally the Q1 preflight checksum
   guard).
3. **Phase 3 pilot**: `--limit 7 --resume 34dd26f6-…` after env provisioning; report
   per-puzzle fields per the ticket; verify 49 rows Draft/Unpublished/`public_id` NULL,
   0 duplicate `content_hash`, 0 `subject_fingerprint` collisions vs the 373. **Full
   review gate before Phase 4.**

**STOP.** Awaiting explicit approval before any Phase 1–3 action.
