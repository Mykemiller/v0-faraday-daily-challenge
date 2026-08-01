# CC-LEAGUE-MODEL-1.0 — Part C run report (2026-08-01)

Scoring attribution moves from the stored `score_events.season_id` column to
**read-time derivation**: a score event counts in every season whose date range
contains `played_at::date`, and in a team via `team_memberships` for that
season. Migration
`20260801000004_league_model_part_c_score_attribution_derived.sql` —
**APPLIED to prod 2026-08-01** after a full transactional dry run; the
in-migration gate re-proves the zero-diff on every apply.

## Phase-0 answers (approved by Myke, 2026-08-01)

- **Q1 — hints-used per play = `dc_completions.hints_used`** (smallint,
  non-null; written at game completion via `/api/score` → `complete-puzzle`
  since 2026-07-03; 27/142 completions carry >0). The tiebreak is
  implementable. Clarified for the record: the League Office season config
  stores hint *policy* (`hints_enabled`/`max_hints_per_game`/
  `hint_penalty_pct`, advisory per Game Library D4) — never per-play usage.
  Pre-2026-07-03 completions all read 0 (nothing reported the count before
  FAR-287), so the rollup is meaningful from that date forward.
- **Q2 — readers of `score_events.season_id`:** the pre-existing
  `season_scores`/`team_scores` views (replaced in place — same column
  names/order, so `CREATE OR REPLACE` was exact), the RPCs
  `global_leaderboard` / `team_leaderboard_season` / `team_total_score`
  (rewritten, signatures kept → `/api/leaderboard/season` and
  `/api/leaderboard/team/[teamId]` needed zero changes; `p_season_id` now
  selects the season whose date window attributes rows), and one app read
  (the LO reset-preview count in data.ts → repointed to `legacy_season_id`).
- **Q3 —** nothing else live. Flag: repo-only migration
  `20260728000001_lo_reset_season_scoring.sql` was **never applied to prod**
  (its RPC is absent from pg_proc) and references the old column name —
  rewrite before ever applying it. No cron/job touches score_events.
- **Q4 —** confirmed: `dc_completions.puzzle_date` and
  `leaderboard_daily.play_date` are the only date keys; neither table has a
  season_id, and none was added (guardrail).
- **C1 —** `legacy_season_id` (renamed, audit-preserved, never dropped) also
  **dropped NOT NULL** so the writer can stop sending it.
- **C2 —** `/api/score` now writes score_events **unconditionally** (the old
  code skipped the write when no active season resolved; a play outside any
  season window now simply counts toward no season).

## What changed

- `score_events.season_id` → **`legacy_season_id`** (nullable; audit only).
- `season_scores` / `team_scores` replaced with date+membership derivation;
  new **`team_daily_scores`** (team, season, play_date, points, hints_used)
  with the hints rollup from `dc_completions.hints_used` in its own CTE so
  the two row grains never fan out.
- 3 RPCs rewritten to the same derivation (+ `SET search_path` hardening on
  all three, which they previously lacked as SECURITY DEFINER functions).
- `score_events_played_at_idx` on `played_at`.
- `/api/score`: no season id in the payload, unconditional write.
- data.ts reset preview: `legacy_season_id=eq.` (display-only count).

## Acceptance — verified live 2026-08-01

1. **FULL DIFF old vs new `season_scores`: ZERO differing rows.** All 14
   subscriber×season rows identical to the pre-migration snapshot; also
   proven per-row over all 219 score_events during Phase 0 (stored vs UTC
   date containment vs America/Chicago containment — 0/0/0 differences; the
   seasons are contiguous and no play ever straddled a boundary). The
   in-migration gate re-asserts new-vs-legacy equality on both views.
2. **team_scores totals exactly match pre-migration** — all 12 team×season
   rows byte-identical to the snapshot.
3. **A subscriber on 3 teams contributes full points to all 3** — ipadfun
   holds 3 active-season memberships (DELOITTE-2026, HCI, LONELY-HEART);
   his 1650 S2 points are fully contained in all three team totals
   (verified in the dry run).
4. **Two overlapping seasons in different leagues, independent totals over
   the same rows** — a test season in the DELOITTE-2026 league covering
   Season 2's exact range derived the identical 10644 total across the same
   score_events rows, independently (inserted + rolled back).
5. **team_daily_scores**: 84 rows, one per (team, season, date) — 84
   distinct keys — with points and hints populated (22 rows carry >0 hints).
6. **No write path references `legacy_season_id`** — `/api/score` is the
   only score_events writer and sends no season id; repo grep shows the name
   only in the read-only preview count and comments.

## Notes / caveats

- The spec's `played_at::date` is a UTC date; a Chicago-evening play near a
  season boundary would land on the next UTC day. On all existing data this
  changes nothing (0-diff under both interpretations); flagged in case a
  future boundary dispute arises.
- `season_scores`/`team_scores` keep their pre-existing view security
  posture (owner views over service-role-only tables; no grants changed).
