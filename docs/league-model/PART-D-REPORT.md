# Part D — Season builder + generate-puzzles-on-approval (CC-FARADAY-LEAGUE-1.0)

**Status: BUILT.** Migration `20260801140000_league_model_part_d_season_generation.sql`
**APPLIED to prod 2026-08-01** (Myke-approved via the Phase 0 gate reply); all DB
acceptance checks exercised live inside `BEGIN..ROLLBACK` (zero fixture residue).
Phase 0 findings: `PART-D-PHASE0-FINDINGS.md`.

## Myke's gate decisions (2026-08-01)

- **Worker runtime = Vercel** ("use vercel edge function"). Implemented as
  Vercel-hosted **Node API routes** rather than the literal Edge runtime — Edge
  caps execution far below a generation batch; the Node routes get
  `maxDuration = 300` and run the same code on the same platform with the same
  env (`ANTHROPIC_API_KEY`, `AIRTABLE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are
  already provisioned in Vercel, which also resolved the credentials question).
- **"There is no logo match game"** — re-confirmed; rejected by the validator
  (`dead_game`) and covered by tests.
- The Phase 0 report's recommended reconciliations drew no objection and are
  implemented as proposed (below).

## What shipped

### 1. Schema (migration `20260801140000…`)

- **`dc_daily_theme.season_id`** (NULL = the 500-row reusable corpus, DEC-1).
  Uniqueness restructure — required by acceptance 5 (two overlapping seasons,
  same date, own theme rows):
  - full unique index `(season_id, theme_date)` (the composite FK target),
  - partial unique `theme_date WHERE season_id IS NULL` (preserves the corpus
    one-row-per-date invariant the old `UNIQUE(theme_date)` provided),
  - old simple FK + `UNIQUE(theme_date)` dropped; **composite FK
    `dc_staging_theme_fk (season_id, theme_date)`** added (MATCH SIMPLE — the
    98 season-less C½ import rows skip the check; documented trade-off).
- **`dc_puzzle_generation_runs`** + `season_id`, `run_kind` (pilot|full),
  `superseded_at`, `last_heartbeat_at`, `phase_cursor` + in-flight partial
  index. **Run `34dd26f6` superseded (DEC-3)** — its 500 theme rows stay as corpus.
- **`seasons.pilot_approved_at` / `generated_at`** (DEC-5 gates).
- **`season_games.puzzle_count`** (DEC-2's home on the live slate table;
  NULL = one per day).
- **Locked seasons reject config mutation at the DB level**:
  `trg_season_config_locked_guard` + child-table guards on `season_games`,
  `season_difficulty_mix`, `season_theme_mix`. One deliberate exemption:
  UPDATEs touching ONLY `{state, effective_from, effective_to, applied_at}`
  pass, so `season_config_promote`/`_apply_due`/`_cancel` still work on a
  locked season (otherwise the hourly cron could abort on a locked season and
  take every other season's flip down with it). Content edits, INSERTs
  (clone), DELETEs and all child writes are refused with SQLSTATE `55P03`.

Live `BEGIN..ROLLBACK` evidence (all PASS): same theme date accepted in two
seasons/two leagues · duplicate (season, date) rejected · corpus invariant
holds · composite FK rejects an unmatched season row and accepts a matched one
· locked season rejects a config content update and a child slate insert ·
bookkeeping-only update passes. Advisor: **no new findings** (the dc_* INFOs
and season_* `rls_disabled_in_public` ERRORs are pre-existing documented posture).

### 2. Validation — `src/lib/league-office/generation-logic.ts` (pure, 17 tests)

Conditions 1–10 mapped onto the live model; implemented once, server-side
(`getGenerationStatus`), rendered verbatim by the panel:

| Spec | Live mapping |
|---|---|
| 3–4 game list | enabled `season_games` rows → `game_catalog` `lifecycle_state='live'` + `runtime_key` (never a hardcoded list); Logo Match explicitly `dead_game` |
| 5 `puzzle_count` | new `season_games.puzzle_count`; `< dayCount` errors; `> dayCount` **warns** — the live bank's global `UNIQUE (puzzle_type, go_live_date)` stores one puzzle per game per day, so DEC-2's surplus is not representable until that constraint becomes league-aware (v1 single-league, DEC-4). Worker generates exactly the day count. |
| 6 difficulty mix | `season_difficulty_mix` — global rows must total 100; per-game overrides per game |
| 7 theme emphasis | `season_theme_mix` (Theater → Sector → Thread) — the SECTOR codes ARE the D1–D23 domain codes, so every `sector_code` is checked against the **live** Domain Registry Active set (`fetchActiveDomainCodes`, fail-soft to the corpus-derived set); non-excluded rows must total 100 |
| WARNs | D16/D18 sector emphasis >15% (floor_relaxed) · >2,000-puzzle runs · surplus requests |

### 3. Worker — `src/lib/generation/worker.ts` (Vercel, sliced)

Two entry points, one engine, DB-only coordination:
`POST /api/lo/generation/worker` (staff "Advance now") and
`GET /api/cron/generation-worker` (**vercel.json, every 10 minutes**), both
`maxDuration=300`, each running one bounded slice (~250 s budget):

- **Phase A (themes):** each season date gets its own `dc_daily_theme` row
  (season_id set) **derived from the corpus calendar** — mix *exclusions* are
  honored by substituting the nearest non-excluded corpus row; target
  percentages steer validation, not row-by-row re-derivation (v1 — the corpus
  was built balanced under FAR-287's constraints and re-deriving would need all
  of that machinery). Idempotent via `on_conflict(season_id, theme_date)`.
- **Phase B (puzzles):** pending slots recomputed each slice against the global
  `(puzzle_type, go_live_date)` set — dates the C½ import already covers count
  as covered, never regenerated. Batches of 8–12 per type through the ported
  FAR-287 prompt/validation chain (`src/lib/generation/puzzle-schema.js`,
  `prompts.js` — verbatim ports; schema → answer-key → hint-escalation → copy
  compliance → subject-fingerprint non-repeat vs the whole bank →
  `content_hash`). Model `claude-sonnet-4-6` (env `DC_GEN_MODEL`).
- **Contract:** heartbeat + `phase_cursor` + honest counters checkpointed after
  every batch (`written_count` = rows actually in staging for the run); pilot =
  **one puzzle per configured game (DEC-5)** on the first globally-free date; a
  zero-progress full sweep with failures ends `failed_short` — stops and
  reports, never silently finishes short; full-run completion stamps
  `seasons.generated_at`.
- **DEC-6/DEC-7 guards:** rows land Draft/Unpublished, `public_id` never
  written (trigger-minted on publish); Airtable access is GET-only and lives
  ONLY in `src/lib/generation/corpus.ts` — `npm run test:generation-readonly`
  fails the suite if a write (or a second Airtable access point) ever appears,
  and asserts the corpus read is present and used.

### 4. League Office UI + Tier 2

`GenerationPanel` in `/league-office/seasons/[id]` ("Puzzle generation" card):
server-derived checklist + warnings · **Generate pilot → Approve pilot →
Generate puzzles → Approve puzzles (n) → Lock season** (lock stays blocked
until `generated_at`; it calls the existing PATCH `op=lock`) · run cards with
written/target, heartbeat, **Advance now** · pilot review table (type, name,
difficulty, topic, date, answer key) · **stall banner** (heartbeat silent
>30 min) · **bank-minimum alarm** (any configured game under 14 days of
Published/Live coverage ahead — the AUTO-031 role from the bank's own field
docs, finally implemented). Panel polls every 15 s while a run is in flight.

Writes go through the existing funnel: `executeAction` cases
`season.generate_pilot` / `season.generate_full` / `season.approve_pilot` /
`season.approve_puzzles` → `generation-write.ts`, one `lo_audit_log` row each
(`domain='seasons'`), every action re-deriving the server-side status first.
`season.approve_puzzles` calls **`fn_dc_approve_puzzles(dates[], actor)`**
(C½ D4 — the only Unpublished→Published path; the trigger mints Public IDs).

## Acceptance matrix

| # | Criterion | Verified |
|---|---|---|
| 1 | unmet conditions render as the disabled-button reasons | server-derived checklist; 17 unit tests cover every condition code |
| 2 | full refused until `pilot_approved_at` | unit test + `startGenerationRun` re-check |
| 3 | kill mid-run → resume, zero duplicates | by construction: progress derived from DB each slice; unique `(puzzle_type, go_live_date)` + `content_hash`; **live-verify on the first prod pilot** |
| 4 | generated rows Draft/Unpublished, `public_id` NULL, `season_id` set | worker row literal + `test:generation-readonly` asserts no `public_id`/Published write |
| 5 | two overlapping seasons in two leagues → own theme rows | **verified live** (rolled back) |
| 6 | 31-min-stale heartbeat shows the stall banner | `isStalled` unit test + panel banner |
| 7 | locked season rejects direct SQL config update | **verified live** (rolled back), incl. child tables + bookkeeping exemption |
| 8 | approval assigns well-formed Public IDs | `fn_dc_approve_puzzles` + mint trigger (verified in C½; approve action passes season dates) |
| 9 | zero Airtable writes; corpus reads present | `npm run test:generation-readonly` (4 tests) |
| 10 | Logo Match rejected, never in the picker | validator `dead_game` + unit test; picker renders live catalog only |

## Runbook — Hot Summer Final Beta (the critical path)

Bank runs dry after **2026-08-14**; Hot Summer runs Aug 3 – Sep 4.

1. Deploy this PR (the cron + routes go live with it).
2. In the LO **season config editor**: give Hot Summer an active config —
   slate (7 live games), difficulty mix (100%), theme mix (100%), and set
   `playoff_starts_on` + `roster_freeze_on` on the season.
3. Season detail → **Generate pilot** (7 puzzles, lands on **2026-08-15** —
   the first date the C½ import doesn't already cover). Review the table.
4. **Approve pilot** → **Generate puzzles** (~147 puzzles for Aug 15–Sep 4;
   Aug 3–14 slots are already covered by the import and are skipped as
   covered). ≈ $1–2 model spend, ~30–40 min via cron, faster with Advance now.
5. Review drafts → **Approve puzzles** (assigns Public IDs; nightly
   `fn_dc_rotate_live_set` serves them once `DC_PUZZLE_SOURCE=supabase`).
6. **Lock season** when done.

⚠️ Requires the Vercel `ANTHROPIC_API_KEY` account to have credit (the crawl
fleet has twice stalled on a depleted balance).

## Known gaps / follow-ups

- **DEC-4 single league**: slot occupancy and `fn_dc_approve_puzzles` are
  league-blind (global type+date). Concurrent-league serving is the follow-on.
- **DEC-2 surplus** is validated-but-warned, not stored (global unique in the
  bank) — revisit with the multi-league bank.
- The 98 C½ import rows' theme link is no longer FK-enforced (season_id NULL
  under MATCH SIMPLE) — validated at import; static.
- The generic action-bar **Lock** button remains ungated by `generated_at`
  (pre-existing surface with other uses); the generation panel's Lock enforces
  the spec's gate.
- Acceptance 3 (kill/resume) and 8 (ID minting) get their live confirmation on
  the first real pilot — flagged to watch during the Hot Summer run.
- Seasons beyond **2027-12-13** exhaust the theme corpus — Phase A fails
  loudly; extending the corpus calendar is a future task (as is the
  **Sep 5 → Jan 6 season gap**, open item 2).
