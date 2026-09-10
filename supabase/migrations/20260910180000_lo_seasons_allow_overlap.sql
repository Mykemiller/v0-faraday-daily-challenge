-- CC-LO-SEASONS-OVERLAP-1.0 · Seasons are independent and MAY overlap.
--
-- The League Office wizard refused any window that touched an existing season
-- ("Seasons cannot overlap — pick a window outside it"). That rule dates from
-- Leaderboard V2 §5.2, when there was exactly one platform-wide season at a
-- time. It no longer holds: a season is scoped by its own set of
-- include/exclude rules (season_scopes, CC-LO-SEASON-SCOPE-1.0), so two
-- seasons covering the same calendar days — a conference beta running inside
-- the platform season, a test season alongside a live one — is the intended
-- model, not a mistake.
--
-- This drops the calendar exclusion. Everything else on `seasons` stays:
--   • seasons_check            ends_on >= starts_on
--   • seasons_playoff_window / seasons_freeze_order / seasons_freeze_not_too_early
--   • seasons_trading_windows_in_season / seasons_trading_windows_disjoint
--   • seasons_slug_key         slug is still the unique handle
-- btree_gist stays installed; nothing else depends on it today but it is harmless.
--
-- KNOWN FOLLOW-UP (deliberately not in this file): fn_leaderboard_rollover,
-- the FA / roster-freeze gates and ~10 API routes resolve "the active season"
-- as `status = 'active' ORDER BY starts_on DESC LIMIT 1`. With overlapping
-- seasons that silently picks the most recently started one. Those readers
-- need to become scope-aware (per subscriber / per team) before two seasons
-- are run concurrently for the same teams. Tracked as Step 2.

begin;

alter table public.seasons drop constraint if exists seasons_no_overlap_per_league;
-- The pre-Part-A name, in case a non-prod database never ran Part A.
alter table public.seasons drop constraint if exists seasons_no_overlap;

comment on column public.seasons.starts_on is
  'Inclusive first day, in seasons.tz. Seasons are independent and may overlap other seasons (CC-LO-SEASONS-OVERLAP-1.0); which teams a season covers is decided by season_scopes, not by its dates.';

-- verification gate
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.seasons'::regclass
       and conname in ('seasons_no_overlap_per_league', 'seasons_no_overlap')
  ) then
    raise exception 'seasons overlap exclusion still present';
  end if;
end $$;

commit;

-- rollback (only valid while no two seasons in one league overlap):
--   alter table public.seasons add constraint seasons_no_overlap_per_league
--     exclude using gist (league_id with =, daterange(starts_on, ends_on, '[]') with &&);
