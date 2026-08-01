-- CC-LEAGUE-MODEL-1.0 Part A — core league/conference/season schema.
-- APPLIED to prod (ycadmmngkdhvpcsrcuaq) 2026-08-01 as
-- `league_model_part_a_seasons_join_leagues` after a full transactional dry
-- run; kept here for VCS parity. Down-migration:
-- docs/league-model/part-a-down.sql (proven in a BEGIN..ROLLBACK pass).
--
-- Option 1 (Myke-approved 2026-08-01): ADOPT & EXTEND the pre-existing
-- leagues/conferences tables (created outside VCS; live-bound by the League
-- Office season-scope feature) instead of creating the spec's new tables.
--   * leagues/conferences are NOT created here. `code` plays the spec's
--     `slug` role — conferences already carry UNIQUE(league_id, code).
--   * D1: no new 'faraday-daily-challenge' league — the 5 existing seasons
--     adopt the existing INDEPENDENT league.
--   * The spec's `season_games` is NOT created: that name belongs to the
--     live Game Library table (season_config_id + game_id, 28 rows), and
--     per-season game slates are already covered by season_config +
--     season_games + season_difficulty_mix.

create extension if not exists btree_gist;

create type public.conference_type as enum ('public','org','private');

alter table public.conferences
  add column type public.conference_type not null default 'public',
  add column org_domain text;

-- durable-team <-> conference <-> season membership (Part B populates this)
create table public.team_conference_memberships (
  team_id uuid not null references public.teams(id) on delete cascade,
  conference_id uuid not null references public.conferences(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, conference_id, season_id)
);
create index team_conference_memberships_season_idx
  on public.team_conference_memberships (season_id);
-- Deny-all posture (matches seasons + the dc_* convention): RLS on, zero
-- policies, service-role only. Never add an anon/authenticated policy.
alter table public.team_conference_memberships enable row level security;

alter table public.seasons add column league_id uuid references public.leagues(id);
update public.seasons
   set league_id = (select id from public.leagues where code = 'INDEPENDENT');
alter table public.seasons alter column league_id set not null;
-- NOT NULL IS LOAD-BEARING: in an exclusion constraint NULL never conflicts
-- with NULL, so a nullable league_id would silently permit overlapping seasons.

alter table public.seasons add column playoff_starts_on date;
alter table public.seasons add column roster_freeze_on date;

alter table public.seasons drop constraint seasons_no_overlap;
alter table public.seasons add constraint seasons_no_overlap_per_league
  exclude using gist (league_id with =,
                      daterange(starts_on, ends_on, '[]') with &&);

alter table public.seasons add constraint seasons_playoff_window check (
  playoff_starts_on is null
  or (playoff_starts_on > starts_on and playoff_starts_on <= ends_on));

alter table public.seasons add constraint seasons_freeze_order check (
  roster_freeze_on is null or playoff_starts_on is null
  or roster_freeze_on <= playoff_starts_on);

alter table public.seasons add constraint seasons_freeze_not_too_early check (
  roster_freeze_on is null
  or roster_freeze_on >= starts_on + ((ends_on - starts_on) / 4));

-- verification gate: raise (and roll the migration back) on unexpected counts
do $$
declare v_null int; v_total int; v_conf int;
begin
  select count(*) filter (where league_id is null), count(*) into v_null, v_total from public.seasons;
  select count(*) into v_conf from public.conferences;
  if v_total <> 5 or v_null <> 0 or v_conf <> 3 then
    raise exception 'Part A gate failed: seasons=% null_league=% conferences=% (expected 5/0/3)', v_total, v_null, v_conf;
  end if;
end $$;
