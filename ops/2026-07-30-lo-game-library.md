# CC-LO-GAME-LIBRARY-1.0 — what shipped, 2026-07-30

League Office gained `/league-office/game-library`: a managed, extensible game catalog
with lifecycle control and season-assignment configuration.

Phase 0 investigation: [`docs/lo-game-library/PHASE-0-FINDINGS.md`](../docs/lo-game-library/PHASE-0-FINDINGS.md).
Invariants: the Game Library section at the top of `CLAUDE.md`.

---

## Shipped

**Migration `20260730000002_game_library_lifecycle.sql` — APPLIED to prod.**
New enum `game_lifecycle_state`; `game_catalog` gained `lifecycle_state`, `runtime_key`,
`public_id_prefix`, `idea_source`, `notes`; the 7 existing games backfilled to `live` with
`runtime_key = display_name` and the verified public-ID prefixes; partial unique index on
`runtime_key`; CHECK that `live` implies a runtime key; trigger
`trg_season_games_assignable` (D9); index `season_games(season_config_id, is_enabled)`.

**Migration `20260730000003_game_library_backlog_seed.sql` — APPLIED to prod.**
The 11 Notion backlog concepts as `new_idea` / `is_active=false` / `runtime_key=null` /
`sort_order` 1000–1100, with icon concept and source carried in `metadata`. Idempotent
(`on conflict (game_key) do nothing`).

**Read screens.** Status board (18 games: name, category, lifecycle badge, derived season
count + names, puzzle-bank depth, launched, sort), lifecycle summary strip with filter
chips, per-game detail drawer (all catalog fields, season assignments, audit trail), and a
games × seasons matrix with closed/locked seasons visually locked.

**Audited writes.** `game.create`, `game.lifecycle_change`, `game.update`, `game.reorder`,
`game.season_assign`, `game.season_unassign`, plus `season.config_version_created` — all
through the existing `executeAction` funnel, `domain='game_library'`, mandatory reason,
populated `before`/`after`.

**Tests.** `npm run test:game-library` (26) · `npm run test:advisory-only` (6).
`npm run build` green; `tsc --noEmit` clean on the new files.

---

## Acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | `game_catalog` = 18 (7 live / 11 new_idea); `season_games` = 28 | ✅ verified live |
| 2 | Page renders board, strip, drawer, matrix; staff-gated | ✅ verified |
| 3 | Transitions work, reject illegally server-side, require a reason, write audit | ✅ 26 unit tests + wired |
| 4 | A `new_idea` assignment is rejected **by the trigger** | ✅ verified in-database |
| 5 | Editing the active season creates a new version; prior superseded | ✅ verified via RPC harness |
| 6 | `/api/challenge/today` unchanged before/after a slate toggle | ✅ 6 tests |
| 7 | `CLAUDE.md` + ops note updated | ✅ this file |

AC4 and AC5 were exercised against the live database inside `BEGIN … ROLLBACK` — **0 test
rows persisted**; counts re-verified at 18 / 28 / 4 configs / 1 active afterwards.

---

## Deferred, and why

- **Season enforcement (D4).** The slate is advisory: serving selects on
  `published='Live'` and never reads season config. Enforcement is gated behind the
  `DC_PUZZLE_SOURCE` cutover. Note the ticket described that cutover as future work — it
  in fact **merged as PR #115 on 2026-07-29** and is one env-var flip away, so this is
  nearer than the ticket implies.
- **`games_per_day` coupling (found during build, not specified).** Every config ships
  `games_per_day = 7` against exactly 7 enabled games, so **any unassign trips the
  `games_per_day_exceeds_slate` validator and cannot be promoted.** The write path
  validates before promoting, discards the orphan clone and reports the real finding —
  but in practice **removing a game from a season today requires first lowering
  `games_per_day` in the season config editor.** Automating that here was deliberately
  rejected: it would change how many games a season serves as a side effect of a slate
  toggle. Worth deciding whether the Game Library should offer a combined "remove game and
  lower games_per_day" action.
- **RLS (D10).** `game_catalog`, `season_games`, `season_config`, `season_difficulty_mix`
  have RLS **disabled**. Untouched per D10. Every read is service-role (verified, 5 call
  sites), so enabling deny-all would be safe today — **logged here as a separate security
  item**, not actioned.
- **`short_code` vs Public ID prefix (D8).** Left unreconciled by decision. Both are
  stored side by side; the drawer warns when they differ.
- **Mobile layout.** The League Office console is desktop-first and overflows horizontally
  below ~900px — pre-existing (the Dashboard uses a hard `repeat(5, 1fr)` KPI grid). The
  new board scrolls inside its own container so it does not make this worse, but a
  console-wide mobile pass is out of scope.
- **Pre-existing broken test script (not introduced here, not fixed here):**
  `npm run test:puzzle-bank` passes `--experimental-default-type=module`, which **Node 24
  rejects** (`node: bad option`). The same flag appears in `test:signal-drop`. One-word fix
  (drop the flag, the files are already `.mjs`-compatible), but it belongs to whoever owns
  those suites.

## Not touched

`/api/challenge/today`, the rotator, `dc_puzzle_bank_staging`, `dc_daily_page_content`,
Airtable, the FAR-287 backfill path, RLS on any table, `game_key`/`display_name` on the 7
live rows, and `season_games` rows for closed or superseded seasons.
