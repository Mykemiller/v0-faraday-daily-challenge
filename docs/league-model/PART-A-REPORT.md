# CC-LEAGUE-MODEL-1.0 — Part A run report (2026-08-01)

Core league/conference/season schema. Migration
`20260801000001_league_model_part_a_seasons_join_leagues.sql` — **APPLIED to
prod 2026-08-01** (Myke-approved via the Phase-0 gate). Down-migration:
`part-a-down.sql` (proven in `BEGIN..ROLLBACK` against prod).

## Phase 0 findings that changed the plan

The spec's DDL could not run as written: **`leagues`, `conferences`, and
`season_games` already existed in prod**, created outside VCS (no repo
migration), with different schemas and live data:

- `leagues` — 3 rows: `DELOITTE`, `DELOITTE-2026` (both named "Deloitte",
  `league_type='corporate'`), `INDEPENDENT` (`'public'`). Keyed by `code`,
  not `slug`; carries `owner_email`, `join_policy`, `join_token`, caps.
- `conferences` — 3 rows, one `GENERAL` per league; `UNIQUE(league_id, code)`
  already present. **Live-bound**: the League Office season-scope feature
  (PR #120) reads both tables via `loadScopeOptions`, and
  `season_scopes.scope_ref_id` stores their ids.
- `season_games` — the live **Game Library** assignment table
  (`season_config_id` + `game_id`, 28 rows, `trg_season_games_assignable`,
  guarded by `npm run test:advisory-only`). A DIFFERENT table than the
  spec's `season_games`.
- `teams` already carries nullable `league_id` / `conference_id` FKs, all 7
  teams populated.

## Approved decisions (Myke, 2026-08-01)

- **Option 1 — adopt & extend** the existing tables. `code` plays the spec's
  `slug` role. No table is dropped or recreated.
- **D1** — the 5 existing seasons adopt the existing **INDEPENDENT** league.
  No new `faraday-daily-challenge` league row.
- **D2** — one app-code touch allowed: `createSeason` (season-write.ts) now
  resolves the INDEPENDENT league by code and writes `league_id` (the column
  is NOT NULL; without this every LO season creation would 500).
- The spec's `season_games` is **not created** — per-season game slates are
  already covered by `season_config` + `season_games` + `season_difficulty_mix`.

## What the migration did

1. `conference_type` enum (`public|org|private`) + `conferences.type`
   (default `'public'`) + `conferences.org_domain`.
2. New `team_conference_memberships (team_id, conference_id, season_id)`
   — RLS enabled, zero policies (deny-all, service-role only), index on
   `season_id`. Part B populates it.
3. `seasons.league_id` (NOT NULL after backfill to INDEPENDENT; NOT NULL is
   load-bearing for the exclusion constraint — NULL never conflicts with
   NULL), `playoff_starts_on`, `roster_freeze_on`.
4. Overlap constraint rescoped: `seasons_no_overlap` (global) →
   `seasons_no_overlap_per_league` (`league_id with =` + daterange `&&`).
5. CHECKs: `seasons_playoff_window`, `seasons_freeze_order`,
   `seasons_freeze_not_too_early` (freeze ≥ starts_on + quarter-length).
6. In-migration verification gate (5 seasons / 0 null league / 3 conferences).

## Acceptance — all verified live 2026-08-01

1. **5/5 seasons** carry `league_id` = INDEPENDENT, none NULL.
2. Overlapping Season 2 **in the same league → rejected** (exclusion_violation).
3. The **identical range in the DELOITTE league → accepted** (insert succeeded,
   rolled back). This is the point of the change.
4. `roster_freeze_on = starts_on + 2` on Season 2 → **rejected**
   (check_violation; Season 2 spans 22 days, minimum is starts_on + 5).
5. Existing reads unbroken: active-season singleton query,
   `fn_leaderboard_season`, `team_leaderboard`, `team_get_my_teams` all green.
   The `seasons_no_overlap` error-mapping regex in season-write.ts is a prefix
   match, so the renamed constraint still maps.
6. Down-migration run in `BEGIN..ROLLBACK` against prod: restores the original
   shape exactly (0 new columns, global overlap constraint back, table gone).

**Security advisor delta: exactly +1** — the intended `rls_enabled_no_policy`
INFO on `team_conference_memberships` (baseline 394 → 395, nothing else added
or removed). The pre-existing `rls_disabled_in_public` ERRORs on
`leagues`/`conferences` predate this work and were left as found.

## Flagged for later parts (not defects)

- Every "THE active season" singleton (7 app routes, 3 edge fns, 8 DB fns —
  enumerated in the Phase-0 report in the PR description) becomes "active
  season FOR a league" once a second league runs a season. Nothing breaks
  today because only INDEPENDENT has seasons.
- `fn_leaderboard_rollover` resolves season by date containment `LIMIT 1` —
  breaks hardest under concurrent per-league seasons.
- The wizard's overlap pre-check is still global (correct while it only
  creates INDEPENDENT seasons; league-scope it when a league picker exists).
- The two-Deloitte question now exists at the LEAGUE level too (Part B Q1).
