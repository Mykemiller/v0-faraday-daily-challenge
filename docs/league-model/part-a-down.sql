-- CC-LEAGUE-MODEL-1.0 Part A — DOWN migration.
-- Reverts 20260801000001_league_model_part_a_seasons_join_leagues.sql.
-- Proven working 2026-08-01 inside BEGIN..ROLLBACK against prod: after
-- running, seasons carries none of the new columns, the original global
-- seasons_no_overlap exclusion is back, and team_conference_memberships is
-- gone. Does NOT touch the pre-existing leagues/conferences rows or the
-- Game Library's season_games (Part A never created those).

alter table public.seasons drop constraint seasons_freeze_not_too_early;
alter table public.seasons drop constraint seasons_freeze_order;
alter table public.seasons drop constraint seasons_playoff_window;
alter table public.seasons drop constraint seasons_no_overlap_per_league;
alter table public.seasons add constraint seasons_no_overlap
  exclude using gist (daterange(starts_on, ends_on, '[]') with &&);
alter table public.seasons drop column roster_freeze_on;
alter table public.seasons drop column playoff_starts_on;
alter table public.seasons drop column league_id;
drop table public.team_conference_memberships;
alter table public.conferences drop column org_domain;
alter table public.conferences drop column type;
drop type public.conference_type;
