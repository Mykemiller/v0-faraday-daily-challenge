# League Office — live-schema verification findings (Tier 1)

Scope of this pass: the **read-only Tier 1 screens** of the Commissioner Console
at `/league-office`, wired to the live engine schema on Supabase project
`ycadmmngkdhvpcsrcuaq`. Verified against `information_schema` on 2026-07-04.

Every data-bound region in the design was checked against the live schema (which
the design doc warned "runs ahead of docs" — it does; see mismatches). No mock
data ships: screens render real, currently-sparse data with explicit empty
states.

## Confirmed `[table.column]` wirings (exist + used)

| Screen | Table.columns confirmed live |
|---|---|
| Dashboard | `dc_subscribers.active`, `dc_daily_attempts.(subscriber_id,play_date)`, `team_memberships.pending`, `dc_daily_page_content.puzzle_date`, `score_events.(subscriber_id,game_id,points,played_at)` |
| Subscribers dir | `dc_subscribers.(id,email,handle,active,play_streak,full_set_streak,last_seen_at,created_at)`, `team_memberships.subscriber_id` |
| Subscriber detail | `dc_daily_attempts.(game_type,play_date,score,result)`, `team_memberships.(team_id,pending)`, `dc_badges.(badge_key,earned_at)`, `teams.(name,group_type,captain_id)` |
| Teams dir + detail | `teams.(id,name,group_type,parent_id,captain_id)`, `team_memberships.(team_id,subscriber_id,pending)` |
| Leagues & Conferences | `teams.group_type='company'` + `teams.parent_id` hierarchy (NO new tables — as specified) |
| Seasons list + detail | `seasons.(id,slug,name,starts_on,ends_on,status,locked_at,free_agency_start,free_agency_notice_start)`, `dc_rank_snapshots.(scope,snapshot_day,subscriber_id,rank)`, `dc_season_state.(season_id,subscriber_id)` |
| Puzzle & Hint | `dc_daily_page_content.(puzzle_date,domain_code,synced_at)`, `faraday_domains.(domain_code,domain_num,domain_name,emoji,active)` |

`game_type` values in `dc_daily_attempts` exactly match the 7 locked game names
(Rackl, Circuit, Dark Fiber, Frequency, The Stack, Signal Drop, The Brief) — the
play-history matrix keys off them directly.

## Mismatches vs the design doc / README (flagged, not silently resolved)

1. **`season_state` → actually `dc_season_state`.** The README §3 names
   `season_state`; the live table is `dc_season_state` (columns:
   `season_id, subscriber_id, completed_signals, dropped_signals, updated_at`).
   Wired to the live name.
2. **`notification_preferences` is a COLUMN, not a table.** It lives on
   `dc_subscribers.notification_preferences` (jsonb). Not used by Tier 1
   (Announcements is Tier 2) but confirmed present for that follow-on.
3. **`teams.season` is a legacy free-text column** (e.g. `"Season 1"`), distinct
   from the `seasons` table + `team_memberships.season_id` (uuid FK). The
   canonical season scoping is the uuid path; the text column is not used.
4. **Repo helper files named in the README don't exist yet:**
   `src/lib/day-content.ts`, `src/lib/notification-preferences.ts`,
   `src/lib/supabase-admin.ts` are absent. Tier 1 didn't need them; the
   service-role pattern was cloned from the existing `src/app/api/account/route.ts`
   instead. Flag for the Tier 2 puzzle/announcement work.

## The README's biggest risk — RESOLVED

The README §3 said: *"If the live schema still only has email-keyed `team_members`,
STOP and flag."* It does **not**. `team_members` is **absent**; `team_memberships`
is live and canonical — `(id, subscriber_id, team_id, season_id, pending, created_at)`,
subscriber-id-keyed, season-scoped, with the pending state. Team screens wire
straight through.

## Net-new tables

- **`lo_audit_log`** — migration authored at
  `supabase/migrations/20260704000001_lo_audit_log.sql` (additive, reversible,
  RLS deny-all / service-role-only). **NOT applied to live** — Tier 1 is
  read-only and doesn't depend on it; apply at promotion (Myke's gate). It exists
  now so Tier 2 write-actions have their audit sink ready.
- `lo_disputes`, `lo_announcements`, `lo_staff`, `lo_trades`, `lo_fa_moves` —
  **not created** (their screens are Tier 2/3, out of this pass).

## Data-scale note (not a blocker)

Live data is small: 10 subscribers, 6 teams, 22 memberships, 1 season
("Season 1 — Power Crunch", active), 83 attempts, 87 rank snapshots, 1 cached
puzzle day. Screens render this real data with empty/sparse states; they will
look sparse until real volume lands. Counts and joins are currently computed by
loading small tables whole and aggregating in the reader — correct at this scale;
move to PostgREST `count` headers / RPCs before growth scale.

## Things deferred to later tiers (surfaced, not silently dropped)

- **Admin-corrected score cells** (the gold-bordered treatment in the play
  matrix) need a "corrected" marker — there is no such flag on
  `dc_daily_attempts` today. Deferred with the Tier 2 score-correction write path.
- **Write-actions** (Pause / Correct score / Reassign captain / Approve-Deny
  membership / Resync puzzles) are rendered **disabled** in Tier 1; they belong to
  Tier 2 and each will flow through ConfirmModal → required reason → `lo_audit_log`.
- **Standings** read `dc_rank_snapshots` at `scope='global'`; a per-season scope
  column/filter may be needed once seasons overlap.
