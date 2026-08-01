-- CC-LEAGUE-MODEL-1.0 Part C — scoring attribution: date + membership derived.
-- APPLIED to prod (ycadmmngkdhvpcsrcuaq) 2026-08-01 as
-- `league_model_part_c_score_attribution_derived` after a full transactional
-- dry run; kept here for VCS parity.
--
-- One score event counts in EVERY season whose date range contains it
-- (per-league concurrent seasons); a single stored season_id cannot express
-- that, so attribution moves to read time. DO NOT fan out writes.
--
-- ⚠️ The repo-only migration 20260728000001_lo_reset_season_scoring.sql (never
-- applied to prod — its RPC is absent from pg_proc) UPDATEs score_events by the
-- OLD column name; it must be rewritten against legacy_season_id if ever applied.

alter table public.score_events rename column season_id to legacy_season_id;
-- PRESERVED for audit. Never dropped in this ticket. NOT NULL removed (C1,
-- Myke-approved): /api/score no longer writes a season id — attribution is
-- derived at read time from played_at + memberships.
alter table public.score_events alter column legacy_season_id drop not null;

create or replace view public.season_scores as
select se.subscriber_id, s.id as season_id, sum(se.points) as total_points
from public.score_events se
join public.seasons s on se.played_at::date between s.starts_on and s.ends_on
group by se.subscriber_id, s.id;

create or replace view public.team_scores as
select tm.team_id, s.id as season_id, sum(se.points) as total_points
from public.score_events se
join public.seasons s on se.played_at::date between s.starts_on and s.ends_on
join public.team_memberships tm
  on tm.subscriber_id = se.subscriber_id and tm.season_id = s.id
where tm.pending = false
group by tm.team_id, s.id;

create view public.team_daily_scores as
with pts as (
  select tm.team_id, s.id as season_id, se.played_at::date as play_date,
         sum(se.points)::bigint as points
  from public.score_events se
  join public.seasons s on se.played_at::date between s.starts_on and s.ends_on
  join public.team_memberships tm
    on tm.subscriber_id = se.subscriber_id and tm.season_id = s.id
  where tm.pending = false
  group by tm.team_id, s.id, se.played_at::date
), hints as (
  -- Q1: hints-used per play lives in dc_completions.hints_used (populated at
  -- game completion since 2026-07-03). Aggregated at the same (team, season,
  -- day) grain in its own CTE so the two row grains never fan out.
  select tm.team_id, s.id as season_id, c.puzzle_date as play_date,
         sum(c.hints_used)::bigint as hints_used
  from public.dc_completions c
  join public.seasons s on c.puzzle_date between s.starts_on and s.ends_on
  join public.team_memberships tm
    on tm.subscriber_id = c.subscriber_id and tm.season_id = s.id
  where tm.pending = false
  group by tm.team_id, s.id, c.puzzle_date
)
select p.team_id, p.season_id, p.play_date, p.points,
       coalesce(h.hints_used, 0) as hints_used
from pts p
left join hints h
  on h.team_id = p.team_id and h.season_id = p.season_id and h.play_date = p.play_date;

create index if not exists score_events_played_at_idx on public.score_events (played_at);

-- The three season-filtered RPCs move to the same derivation. Signatures kept —
-- p_season_id now selects the season whose DATE WINDOW attributes the rows,
-- so /api/leaderboard/season and /api/leaderboard/team need zero code changes.

create or replace function public.global_leaderboard(p_season_id uuid)
returns table(rank bigint, subscriber_id uuid, handle text, total_points bigint)
language sql stable security definer set search_path to 'public'
as $fn$
  SELECT
    ROW_NUMBER() OVER (ORDER BY SUM(se.points) DESC, MIN(se.played_at)) AS rank,
    s.id AS subscriber_id,
    COALESCE(s.handle::text, split_part(s.email::text, '@', 1)) AS handle,
    SUM(se.points)::bigint AS total_points
  FROM public.seasons sn
  JOIN public.score_events se ON se.played_at::date BETWEEN sn.starts_on AND sn.ends_on
  JOIN public.dc_subscribers s ON s.id = se.subscriber_id
  WHERE sn.id = p_season_id
    AND s.active = true
  GROUP BY s.id, s.handle, s.email
  ORDER BY total_points DESC, MIN(se.played_at);
$fn$;

create or replace function public.team_leaderboard_season(p_team_id uuid, p_season_id uuid)
returns table(rank bigint, subscriber_id uuid, handle text, total_points bigint)
language sql stable security definer set search_path to 'public'
as $fn$
  SELECT
    ROW_NUMBER() OVER (ORDER BY SUM(se.points) DESC, MIN(se.played_at)) AS rank,
    s.id AS subscriber_id,
    COALESCE(s.handle::text, split_part(s.email::text, '@', 1)) AS handle,
    SUM(se.points)::bigint AS total_points
  FROM public.seasons sn
  JOIN public.team_memberships tm ON tm.season_id = sn.id
  JOIN public.dc_subscribers s ON s.id = tm.subscriber_id
  JOIN public.score_events se
    ON se.subscriber_id = tm.subscriber_id
    AND se.played_at::date BETWEEN sn.starts_on AND sn.ends_on
  WHERE sn.id = p_season_id
    AND tm.team_id = p_team_id
    AND tm.pending = false
    AND s.active = true
  GROUP BY s.id, s.handle, s.email
  ORDER BY total_points DESC, MIN(se.played_at);
$fn$;

create or replace function public.team_total_score(p_team_id uuid, p_season_id uuid)
returns bigint
language sql stable security definer set search_path to 'public'
as $fn$
  SELECT COALESCE(SUM(se.points), 0)::bigint
  FROM public.seasons sn
  JOIN public.team_memberships tm ON tm.season_id = sn.id
  JOIN public.score_events se
    ON se.subscriber_id = tm.subscriber_id
    AND se.played_at::date BETWEEN sn.starts_on AND sn.ends_on
  WHERE sn.id = p_season_id
    AND tm.team_id = p_team_id
    AND tm.pending = false;
$fn$;

-- verification gate: the derived views must EXACTLY reproduce the legacy
-- stored-season_id attribution (raises + rolls back on any differing row)
do $$
declare v_ss int; v_ts int;
begin
  select count(*) into v_ss from (
    (select subscriber_id, season_id, total_points from public.season_scores
     except
     select subscriber_id, legacy_season_id, sum(points)::bigint from public.score_events group by subscriber_id, legacy_season_id)
    union all
    (select subscriber_id, legacy_season_id, sum(points)::bigint from public.score_events group by subscriber_id, legacy_season_id
     except
     select subscriber_id, season_id, total_points from public.season_scores)
  ) d;
  select count(*) into v_ts from (
    (select team_id, season_id, total_points from public.team_scores
     except
     select tm.team_id, tm.season_id, sum(se.points)::bigint
       from public.score_events se join public.team_memberships tm
         on tm.subscriber_id=se.subscriber_id and tm.season_id=se.legacy_season_id
      where tm.pending=false group by tm.team_id, tm.season_id)
    union all
    (select tm.team_id, tm.season_id, sum(se.points)::bigint
       from public.score_events se join public.team_memberships tm
         on tm.subscriber_id=se.subscriber_id and tm.season_id=se.legacy_season_id
      where tm.pending=false group by tm.team_id, tm.season_id
     except
     select team_id, season_id, total_points from public.team_scores)
  ) d;
  if v_ss <> 0 or v_ts <> 0 then
    raise exception 'Part C gate failed: season_scores diff=% team_scores diff=%', v_ss, v_ts;
  end if;
end $$;
