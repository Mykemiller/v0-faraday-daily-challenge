# CC-DC-SUPABASE-SERVING-1.0 — Puzzle Bank serving: Airtable → Supabase

Repoints the Daily Challenge serving path onto `dc_puzzle_bank_staging` and
(at Phase 5) retires the Airtable Puzzle Bank code path. Airtable stays in use
everywhere else (Academy catalog, lexicon, FAR-287 generation corpus).

## Status (2026-08-01 — CC-LEAGUE-MODEL-1.0 Part C½)

| Phase | State | Where |
|---|---|---|
| 1 — schema (public_id · approval gate · transactional rotator) | **DONE, applied to prod** | `supabase/migrations/20260729000001_dc_supabase_serving.sql` |
| 2 — serving lib, same 4 exports | **DONE** (10 unit tests) | `src/lib/supabase-puzzle-bank.js` · `npm run test:puzzle-bank` |
| 3 — `DC_PUZZLE_SOURCE` flag | **DONE** (default `airtable`) | `src/lib/puzzle-bank.js` + the 3 routes |
| 4 — import | **DONE — forward-only (Myke), 98 rows in prod staging** | `docs/league-model/PART-C-HALF-REPORT.md` |
| 5 — cutover | **Ready: flip the flag (Myke, Vercel) → watch one rotation → delete Airtable path** | runbook below |

**Step-1 change (Myke, 2026-08-01): "Forward only import."** The full
historical backfill was descoped — the ~268 Retired rows never get imported
(no runtime path resolves a retired public id; `getSignalDropAnswer` only
searches Live rows). The 98 forward rows (7 Live 2026-08-01 + 91 Published
2026-08-02..14, every original Public ID preserved) were imported via
Airtable MCP + SQL with the backfill script's exact field mapping, except
`theme_date = go_live_date` (real `dc_daily_theme` rows exist from
2026-08-01). Full evidence: `docs/league-model/PART-C-HALF-REPORT.md`.

Verified 2026-07-29:

- **Trigger + RPCs** exercised against prod in a rolled-back transaction
  (9 assertions): draft never mints · approve mints `RACK-26-07-30-00365` ·
  approve idempotent · rotate promotes without re-mint · same-day rotate no-op ·
  next-day retire (strictly-before) keeps the id · unknown type refuses to mint ·
  generated rows still require theme/hints/answer (CHECK) · **atomicity: a
  forced retire-step failure rolled back the promote step** (the Airtable
  rotator's partial-failure mode is gone). Sequence re-seeded to 365 after.
- **Pilot import**: today's 7 Live Airtable rows are in staging (same mapping +
  `content_hash` convention as the backfill script, so a later full `--apply`
  reconciles them as unchanged).
- **Parity (pilot)**: both real libs run over the real 7-type Live set →
  all 7 `getLivePuzzles()` payloads deep-equal, `getSignalDropAnswer` identical,
  Signal Drop answer absent from both payloads.

## Decisions applied (from the ticket, D1–D8)

- **Public ID** `TYPE4-YY-MM-DD-NNNNN`, GLOBAL counter (`dc_public_id_seq`),
  minted by trigger **only on the first transition into
  Published/Live/Retired** — drafts never carry one (FAR-287 guarantee). Rows
  that already have an id (backfill) are never re-minted.
- **Sequence seeded at 365** = (max Airtable numeric suffix `00364`, measured
  2026-07-29 across all 373 rows) + 1. The 9 id-less rows are Unpublished
  drafts, consistent with assign-on-publish. If Airtable mints more ids before
  cutover, the backfill dry-run reports the new max and prints the `setval` to
  run.
- **Rotation = `fn_dc_rotate_live_set(p_today)`** — one transaction, exact
  AUTO-128 semantics (promote `Published` + `= today` first; retire `Live` +
  `< today` strictly-before), idempotent, summary shape identical to the old
  `rotateLiveSet` return.
- **Approval gate = `fn_dc_approve_puzzles(p_dates, p_actor)`** — the only
  sanctioned Unpublished→Published path; stamps `approved_by/approved_at`.
  Nothing auto-publishes.
- **RLS unchanged**: deny-all, service-role only; both RPCs are
  `revoke`d from anon/authenticated. No anon policy anywhere.
- **theme_date for imports — decided: relax, don't fabricate.** The 373
  historical rows predate the theme calendar (`dc_daily_theme` starts
  2026-08-01; bank go-lives start 2026-06-24 → 38 uncovered days). Synthetic
  theme rows were rejected because `theme_title`/`theme_blurb` are
  subscriber-facing editorial copy (About page) — fabricating them risks fake
  copy shipping. Instead `theme_date`/`hint_*`/`answer_key` are nullable **only
  for rows with `airtable_record_id` set** (`dc_staging_import_or_complete`
  CHECK); everything CC-2 generates still requires the full set.

## Cutover runbook (Phase 5 — do in order)

1. ~~Full backfill~~ **DONE 2026-08-01 as the forward-only import** (see
   Status above). Do not run the backfill script `--apply` for history.
2. ~~Parity~~ **DONE**: per-row RETURNING checks on all 98 imports (public_id
   preserved, Signal Drop `answer_key = word`, jsonb parses) + a rolled-back
   live `fn_dc_rotate_live_set('2026-08-02')` dry run (7 promote / 7 retire /
   exactly 7 Live).
3. **Flip** `DC_PUZZLE_SOURCE=supabase` in Vercel + redeploy. This switches all
   three routes AND the day-content sync source (D8) at once.
4. **Watch one rotation cycle** (05:00/06:00 UTC crons): `/api/cron/rotate`
   should log the same summary shape; `/api/cron/sync-day-content` (05:10/06:10)
   should upsert normally. Approve/publish flow for new days:
   `select fn_dc_approve_puzzles(array['YYYY-MM-DD']::date[], 'myke');`
5. **Only then delete the Airtable path**: remove
   `src/lib/airtable-puzzle-bank.js`, collapse `src/lib/puzzle-bank.js` to a
   re-export of the supabase module, strip the Airtable domain-registry
   round-trip + `PUZZLE_BANK_*` imports from `day-content.ts`, remove the flag.

**Rollback at any point before step 5:** unset `DC_PUZZLE_SOURCE` (or set
`airtable`) + redeploy — the Airtable path is untouched until step 5.

## Known gaps / follow-ups

- **Faraday Take (FAR-389)**: staging has no `faradays_take`/`take_byline`
  columns (Airtable doesn't have the fields yet either — still blocked on
  Myke). The staging-sourced sync emits null takes; the win screen keeps its
  explanation fallback. When Take authoring lands, add the two columns to
  staging and thread them through `buildDayContentRowFromStaging`.
- The 9 Unpublished April drafts have no Puzzle Content → the backfill skips
  them (reported). They carry no Public ID and were never serveable.
- After cutover, `scripts/far287/sync-puzzle-bank-to-airtable.mjs` (staging →
  Airtable push) becomes vestigial; retire it with the Airtable path.
- CC-2 (fill the bank) sequences BEFORE this cutover completes — this migration
  does not fill the bank. **The bank runs dry after 2026-08-14** (the last
  Published day in Airtable AND in staging) — with or without the cutover,
  2026-08-15 has nothing to promote. New days flow: insert/generate into
  staging → `fn_dc_approve_puzzles` → nightly rotation.
