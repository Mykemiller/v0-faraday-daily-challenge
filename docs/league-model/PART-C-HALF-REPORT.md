# CC-LEAGUE-MODEL-1.0 — Part C½ run report (2026-08-01)

Puzzle serving cut from Airtable to Supabase: `dc_puzzle_bank_staging` now
holds the complete forward serve set with original Public IDs, the serving
code path is ready behind `DC_PUZZLE_SOURCE`, and the only remaining cutover
step is the Vercel env flip (Myke's step — see the checklist at the bottom).

**Why urgent:** the Airtable Puzzle Bank's coverage ends **2026-08-14** — zero
records carry a Go Live Date after it. On 2026-08-15 the nightly rotator finds
nothing to promote and serving dies, on either source. The cutover removes the
Airtable dependency; refilling the bank past Aug 14 is CC-2 (separate,
sequenced next).

## Scope decision (Myke, 2026-08-01): "Forward only import"

> "There should be no reason to continue backfilling the Airtable Puzzle Bank."

The planned full 373-row backfill was descoped to the **forward set only**:

- **Imported (98 rows):** 7 `Live` (2026-08-01) + 91 `Published`
  (2026-08-02 → 2026-08-14), 7 puzzle types × 14 days, every row keeping its
  original Airtable Public ID.
- **Skipped (~268 rows):** all `Retired`/historical rows. Safe because no
  runtime path resolves a retired Public ID — `getSignalDropAnswer` searches
  Live rows only, `/api/challenge/today` reads Live only, and the FAR-287
  Answers page reads `dc_daily_page_content`, not the bank. Old share links
  render the share card from the URL payload, not a bank lookup.
- AC4 accordingly narrowed to: **all imported rows retain original Public
  IDs** (verified below).

## How the import ran (container egress is policy-blocked)

No `AIRTABLE_API_KEY` exists in Vault or edge-function secrets, and the
container cannot reach airtable.com/supabase.co directly (403 on CONNECT), so
`backfill-airtable-to-staging.mjs` could not run as-is. The import instead ran
as **Airtable MCP reads → per-day SQL INSERTs** (Supabase MCP), transcribing
the script's exact `mapRecord()` mapping:

- Same `content_hash` recipe (`sha256('airtable:'‖rec‖'\n'‖content‖'\n'‖pub‖'\n'‖pid)`
  via `extensions.digest`), same `generation_batch_id`
  (`00000000-0000-4000-a000-202607290001`), same `generator_model`
  (`airtable-import-v1`), `validation_status='imported'`, `status='Approved'`,
  `answer_key = upper(word)` for Signal Drop only, subject_fingerprint slug.
- **One deliberate divergence:** forward rows carry
  `theme_date = go_live_date` (Q3 decision) — real `dc_daily_theme` rows exist
  from 2026-08-01, so the historical "relax to NULL" rule doesn't apply here.
- Hints copied verbatim (`Hint 1/2/3` field ids
  `fldslxMavx5nDKnlX`/`fld83FpwECv4quR7r`/`fldftQhOPgsAPt6Fl`). The Aug 8–11
  batches predate hint authoring in Airtable and imported as NULL — faithful
  to source, not a loss.
- Each day's INSERT used a `RETURNING` guard: Public ID echoed back, Signal
  Drop `answer_key = puzzle_content->>'word'`, non-Signal `answer_key IS NULL`.
  **98/98 returned `answer_ok = true`.**

## Acceptance — verified live 2026-08-01

1. **Counts:** 105 imported rows total = 98 forward + 7 pilot (the 2026-07-29
   pilot import, now `Unpublished`, inert — never served, never rotated).
   By state: 7 `Live` @ 2026-08-01 · 91 `Published` @ 2026-08-02..14 ·
   7 `Unpublished` pilot · 0 anything else.
2. **Coverage:** exactly one row per (puzzle_type, go_live_date) for all
   7 types × 14 days = 98 slots; zero duplicate `airtable_record_id` among
   forward rows; 105 distinct `content_hash`.
3. **AC4 — Public IDs preserved:** 105/105 rows carry a Public ID, all
   distinct, all equal to their Airtable original (RETURNING check per row).
   `dc_public_id_seq` untouched at 365 — `trg_dc_assign_public_id` returns
   early when `public_id` is already set, so imports never mint.
4. **Rotation dry run (rolled back):** `fn_dc_rotate_live_set('2026-08-02')`
   → Aug 2's 7 promoted to `Live`, Aug 1's 7 retired, **exactly 7 Live**
   after. The forward set rotates end-to-end.
5. **AC6 — answer never in a client payload:** `npm run test:puzzle-bank`
   asserts the Signal Drop answer word is absent from everything
   `getLivePuzzles()` returns and that `answer_key` is never selected on the
   serve path (the `ACCEPTANCE:` test). `toPublicSignalPuzzle` strip survives.
6. **AC7 — RLS:** zero anon/authenticated/public policies on any `dc_*`
   table (live `pg_policies` check). Staging stays deny-all, service-role only.

## Schema change

`supabase/migrations/20260801000005_league_model_part_c_half_staging_season_id.sql`
— `dc_puzzle_bank_staging.season_id uuid NULL → seasons(id)`. **Applied to
prod 2026-08-01** (as `league_model_part_c_half_staging_season_id`). Nullable
forward hook only; the serve path never reads it, and season slates remain
`season_config`/`season_games` (Game Library D4 unchanged).

## Code changes (this PR)

- `src/lib/puzzle-bank.js`: `PUZZLE_TYPES` re-export repointed
  `airtable-puzzle-bank.js` → `supabase-puzzle-bank.js` (identical list), so
  the Phase-5 Airtable-lib deletion won't orphan the facade's re-export.
- `scripts/dc-migrate/backfill-airtable-to-staging.mjs`: header now records
  the forward-only supersession — do not `--apply` a historical backfill.
- `docs/dc-supabase-serving/README.md`: status + runbook updated (steps 1–2
  done; flip → watch → delete remain).

**Deliberately NOT done:** the Airtable lib (`airtable-puzzle-bank.js`) and
the `day-content.ts` Airtable path are untouched — deletion is gated on the
flag flip **plus one watched rotation cycle** (guardrail). `DC_PUZZLE_SOURCE`
remains unset in prod (= airtable) until Myke flips it.

## Cutover checklist (Myke)

1. Vercel → `v0-faraday-daily-challenge-n2u5` → env `DC_PUZZLE_SOURCE=supabase`
   (Production) → redeploy. That single flip switches `/api/challenge/today`,
   `/api/challenge/guess`, `/api/cron/rotate`, and the day-content sync.
   **Rollback at any time: unset the env + redeploy** (Airtable path intact).
2. Watch the next 05:00/06:00 UTC rotation + 05:10/06:10 day-content sync —
   same summary shapes, 7 Live after.
3. Say the word and the Airtable serving path gets deleted (Phase 5 final):
   remove `airtable-puzzle-bank.js`, collapse the facade, strip the
   `day-content.ts` Airtable branch + flag.
4. **Before 2026-08-15:** CC-2 must land new approved rows in staging
   (`fn_dc_approve_puzzles`) or the bank runs dry regardless of source.
