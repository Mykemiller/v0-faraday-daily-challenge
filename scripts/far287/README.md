# FAR-287 — Puzzle Bank 500-day themed generation pipeline

Generates 500 themed days × 7 game types = 3,500 puzzle records into **Supabase
staging** (`dc_puzzle_bank_staging`), each with 3 escalating hints. Airtable sync is
**built but dry-run by default** — nothing bulk-writes to the production Puzzle Bank.

## Run order

| Step | Command | Writes | Gate |
|---|---|---|---|
| Snapshot | `node scripts/far287/build-snapshot.mjs` | `idf-taxonomy-snapshot.json` | — |
| Calendar | `node scripts/far287/build-calendar.mjs` | `exports/far287-calendar.{json,csv}`, `docs/far287-calendar-review.md` | **review** |
| Load calendar | `node scripts/far287/emit-calendar-sql.mjs <run_id> <dir>` → apply SQL | `dc_daily_theme` | — |
| Generate (pilot) | `node scripts/far287/generate-puzzles.mjs --pilot` | `dc_puzzle_bank_staging` (70) | **pilot** |
| Generate (full) | `node scripts/far287/generate-puzzles.mjs` | `dc_puzzle_bank_staging` (3,500) | — |
| Validate | `node scripts/far287/validate-staging.mjs --write` | `validation_status` + QA report | — |
| Export CSV | `node scripts/far287/export-csv.mjs --run <id>` | `exports/puzzle-bank-<id>.csv` | — |
| Sync (dry-run) | `node scripts/far287/sync-puzzle-bank-to-airtable.mjs` | nothing (default) | **do not `--execute`** |

## Environment (fails loud if missing)

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — staging read/write + corpus + taxonomy.
- `ANTHROPIC_API_KEY` — generation (`FAR287_GEN_MODEL`, default `claude-sonnet-4-6`).
- `AIRTABLE_API_KEY` — corpus (enriched companies, lexicon) + existing-bank non-repeat
  check; **required for `--execute` sync only.**

## Generator flags

`--dry-run` (validate + sample, write nothing) · `--pilot` (first 10 days = 70 records,
then stop at the gate) · `--limit N` · `--type "<name>"` · `--resume <run_id>` ·
`--refresh-corpus` · `--batch N` (8–12).

## Guarantees

- Every staged row is `status='Draft'` / `published='Unpublished'`; **Public ID never set.**
- `content_hash` unique; `unique(puzzle_type, go_live_date)`; per-type `subject_fingerprint`
  90-day non-repeat (vs the live Airtable bank + this run).
- Copy is count-agnostic, public-label-only, no `T-###`/`D#.#` ids (enforced, not spot-checked).
- No bulk writes to Airtable; no writes to Notion. Rotator (AUTO-128) untouched.

## Modules

- `lib/puzzle-schema.mjs` — per-type validation, round-trip `extractAnswer` (mirrors
  `src/lib/day-content.ts`), hint/copy checks, hashing, defensive JSON parse. Tested:
  `lib/puzzle-schema.test.mjs` (`node --test`).
- `lib/prompts.mjs` — 7 per-type prompt templates (schema + exemplar + theme tuple +
  subject + difficulty + hint/copy rules).
- `lib/corpus.mjs` — corpus cache (enriched companies / lexicon / signals / tiers) +
  pure per-day subject pools.
- `lib/clients.mjs` — raw-fetch Supabase / Anthropic / Airtable clients.
