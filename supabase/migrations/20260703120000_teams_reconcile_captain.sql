-- Teams reconciliation, step 1 of 2 (additive) — FAR Teams/MW/Captain session, 2026-07-03.
--
-- Two parallel membership models existed:
--   A) teams + team_members       (email-keyed, no season scoping, MW-era)
--   B) teams + team_memberships   (subscriber_id + season_id — Leaderboard V2 / FAR-221)
-- This migration makes B canonical WITHOUT dropping anything yet:
--   1. teams.captain_id (MVP Team Captain — the future trade-approval hook).
--      Backfilled from team_members.role='creator', falling back to
--      teams.created_by_email. Creating flows set it going forward.
--   2. team_members rows are copied into team_memberships for the ACTIVE season
--      (email → dc_subscribers.id; skips rows that already exist).
--   3. Legacy pending=true rows are healed to false (Free Agency deferral retired).
--   4. teams.season is DEPRECATED (nullable + comment): membership season scoping
--      lives on team_memberships.season_id; the text column only records a
--      founding-era label and holds inconsistent formats ("Summer 2026" vs
--      "Season 1 — Power Crunch").
--   5. dc_completions.mw_earned gets DEFAULT 0 so the MW-free complete-puzzle
--      deploy can insert during the window before step 2 drops the column.
--
-- Destructive changes (drop team_members + MW columns, RPC rewrites) are in
-- 20260703120001_retire_mw_and_team_members.sql — apply only AFTER the MW-free
-- edge functions (complete-puzzle, verify-otp, verify-magic-link,
-- create-subscriber) are deployed.

-- 1) Team Captain ------------------------------------------------------------
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS captain_id uuid REFERENCES public.dc_subscribers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.teams.captain_id IS
  'Team Captain (MVP 2026-07-03): the subscriber who created the team, auto-set on creation. Future trade-approval workflows hook into this. NULL = needs manual resolution.';

-- Backfill 1: the old team_members creator role is the strongest record.
UPDATE public.teams t
   SET captain_id = s.id
  FROM public.team_members m
  JOIN public.dc_subscribers s ON s.email = m.member_email
 WHERE m.team_id = t.id
   AND m.role = 'creator'
   AND t.captain_id IS NULL;

-- Backfill 2: teams with no creator row on record fall back to the team's own
-- created_by_email (still "on record", not a guess). Anything unresolved stays
-- NULL and is flagged in the session report.
UPDATE public.teams t
   SET captain_id = s.id
  FROM public.dc_subscribers s
 WHERE s.email = t.created_by_email
   AND t.captain_id IS NULL;

-- 2) Migrate team_members → team_memberships (active season) -----------------
WITH active AS (
  SELECT id FROM public.seasons WHERE status = 'active'
  ORDER BY starts_on DESC LIMIT 1
)
INSERT INTO public.team_memberships (subscriber_id, team_id, season_id, pending, created_at)
SELECT s.id, m.team_id, a.id, false, m.joined_at
  FROM public.team_members m
  JOIN public.dc_subscribers s ON s.email = m.member_email
 CROSS JOIN active a
 WHERE NOT EXISTS (
         SELECT 1 FROM public.team_memberships x
          WHERE x.subscriber_id = s.id
            AND x.team_id = m.team_id
            AND x.season_id = a.id
       );

-- 3) Heal lingering pending=true rows (Free Agency deferral is retired).
-- Guard the (subscriber, team, season, pending) unique key: if a false twin
-- already exists, delete the pending row instead of flipping it.
DELETE FROM public.team_memberships p
 WHERE p.pending = true
   AND EXISTS (SELECT 1 FROM public.team_memberships f
                WHERE f.subscriber_id = p.subscriber_id
                  AND f.team_id = p.team_id
                  AND f.season_id = p.season_id
                  AND f.pending = false);
UPDATE public.team_memberships SET pending = false WHERE pending = true;

-- 4) Deprecate teams.season (kept as historical founding-era label only).
ALTER TABLE public.teams ALTER COLUMN season DROP NOT NULL;
COMMENT ON COLUMN public.teams.season IS
  'DEPRECATED 2026-07-03: founding-era text label only (inconsistent formats). Season scoping lives on team_memberships.season_id. Do not filter or join on this.';

-- 5) Soften mw_earned for the deploy window (dropped in step 2).
ALTER TABLE public.dc_completions ALTER COLUMN mw_earned SET DEFAULT 0;
