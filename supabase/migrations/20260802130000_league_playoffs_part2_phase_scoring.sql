-- League Playoffs — Part 2: phase-windowed scoring
-- CC-LEAGUE-PLAYOFFS-1.0 · claude/league-playoffs-implementation-b78mg6
--
-- Adds read paths that score ONLY the playoff window (playoff_starts_on →
-- ends_on, inclusive) or ONLY the regular season (starts_on → playoff_starts_on
-- − 1), alongside the existing whole-season behaviour.
--
-- ADDITIVE ONLY. Four NEW functions; the three live leaderboard RPCs
-- (global_leaderboard, team_leaderboard_season, team_total_score) are NOT
-- touched — same names, same signatures, same results. That is the invariant
-- this phase is built around: the regular-season path must not move.
--
-- Down-migration: docs/league-playoffs/part2-down.sql (drops the four; nothing
-- to restore, since nothing existing was modified).
--
-- ── One window definition, mirrored in two places ───────────────────────────
-- fn_season_phase_window() below and phaseWindow() in
-- src/lib/league-playoffs/phase.ts implement the SAME rules and must stay in
-- sync. The TS copy drives UI state (countdowns, tab enablement); the SQL copy
-- drives what actually gets summed. `npm run test:playoffs` pins the TS side,
-- and this migration's gate pins the SQL side against the same fixtures.
--
-- Returning ZERO ROWS is meaningful and load-bearing: it means "this phase does
-- not exist for this season" (e.g. a playoff window on a season with no
-- playoff_starts_on). A caller must NEVER widen that to the full season — doing
-- so would report regular-season points as playoff points.

begin;

-- ── The window ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER for the same reason as Part 1's freeze predicate: `seasons`
-- is RLS-on with zero policies, so an invoker-rights read sees nothing.
create or replace function public.fn_season_phase_window(
  p_season_id uuid,
  p_phase text default 'full'
)
returns table(from_on date, to_on date)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_s public.seasons;
  v_from date;
  v_to   date;
begin
  if p_phase is null or p_phase not in ('full', 'regular', 'playoff') then
    raise exception 'invalid phase %; expected full | regular | playoff', p_phase
      using errcode = '22023';
  end if;

  select * into v_s from public.seasons where id = p_season_id;
  if not found or v_s.starts_on is null or v_s.ends_on is null
     or v_s.ends_on < v_s.starts_on then
    return;                              -- unusable season → no window
  end if;

  if p_phase = 'full' then
    v_from := v_s.starts_on;
    v_to   := v_s.ends_on;

  elsif p_phase = 'playoff' then
    if v_s.playoff_starts_on is null then
      return;                            -- season runs no playoffs → no window
    end if;
    -- Clamp into the season. seasons_playoff_window already enforces this, but
    -- the column is nullable and this function is callable with any season row.
    v_from := greatest(v_s.playoff_starts_on, v_s.starts_on);
    v_to   := v_s.ends_on;
    if v_from > v_to then return; end if; -- playoff date past the season end

  else -- regular
    v_from := v_s.starts_on;
    if v_s.playoff_starts_on is null then
      v_to := v_s.ends_on;               -- no playoffs → the regular season IS the season
    else
      v_to := least(v_s.playoff_starts_on - 1, v_s.ends_on);
    end if;
    if v_to < v_from then return; end if; -- playoffs open on day one → no regular season
  end if;

  from_on := v_from;
  to_on   := v_to;
  return next;
end $function$;

comment on function public.fn_season_phase_window(uuid, text) is
  'Inclusive [from_on, to_on] date window that attributes score_events for a '
  'season phase: full = starts_on..ends_on (the legacy whole-season behaviour), '
  'regular = starts_on..playoff_starts_on-1, playoff = playoff_starts_on..ends_on. '
  'ZERO ROWS means the phase does not exist for that season — never widen it to '
  'the full season. Mirrors phaseWindow() in src/lib/league-playoffs/phase.ts.';

-- ── Phase-windowed siblings of the three live leaderboard RPCs ──────────────
-- Each is a copy of its original with the single date predicate
--   se.played_at::date BETWEEN sn.starts_on AND sn.ends_on
-- replaced by a join against the phase window. Everything else — the ranking
-- expression, the tiebreak on MIN(played_at), the active/pending filters, the
-- handle fallback, the return columns — is byte-for-byte the original.

create or replace function public.global_leaderboard_phase(
  p_season_id uuid,
  p_phase text default 'full'
)
returns table(rank bigint, subscriber_id uuid, handle text, total_points bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT
    ROW_NUMBER() OVER (ORDER BY SUM(se.points) DESC, MIN(se.played_at)) AS rank,
    s.id AS subscriber_id,
    COALESCE(s.handle::text, split_part(s.email::text, '@', 1)) AS handle,
    SUM(se.points)::bigint AS total_points
  FROM public.fn_season_phase_window(p_season_id, p_phase) w
  JOIN public.score_events se ON se.played_at::date BETWEEN w.from_on AND w.to_on
  JOIN public.dc_subscribers s ON s.id = se.subscriber_id
  WHERE s.active = true
  GROUP BY s.id, s.handle, s.email
  ORDER BY total_points DESC, MIN(se.played_at);
$function$;

create or replace function public.team_leaderboard_phase(
  p_team_id uuid,
  p_season_id uuid,
  p_phase text default 'full'
)
returns table(rank bigint, subscriber_id uuid, handle text, total_points bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- Membership stays keyed to the SEASON (tm.season_id = p_season_id), not to
  -- the phase: a player is on the team for the whole season, and the phase only
  -- narrows which of their score_events count.
  SELECT
    ROW_NUMBER() OVER (ORDER BY SUM(se.points) DESC, MIN(se.played_at)) AS rank,
    s.id AS subscriber_id,
    COALESCE(s.handle::text, split_part(s.email::text, '@', 1)) AS handle,
    SUM(se.points)::bigint AS total_points
  FROM public.fn_season_phase_window(p_season_id, p_phase) w
  JOIN public.team_memberships tm ON tm.season_id = p_season_id
  JOIN public.dc_subscribers s ON s.id = tm.subscriber_id
  JOIN public.score_events se
    ON se.subscriber_id = tm.subscriber_id
    AND se.played_at::date BETWEEN w.from_on AND w.to_on
  WHERE tm.team_id = p_team_id
    AND tm.pending = false
    AND s.active = true
  GROUP BY s.id, s.handle, s.email
  ORDER BY total_points DESC, MIN(se.played_at);
$function$;

create or replace function public.team_total_score_phase(
  p_team_id uuid,
  p_season_id uuid,
  p_phase text default 'full'
)
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT COALESCE(SUM(se.points), 0)::bigint
  FROM public.fn_season_phase_window(p_season_id, p_phase) w
  JOIN public.team_memberships tm ON tm.season_id = p_season_id
  JOIN public.score_events se
    ON se.subscriber_id = tm.subscriber_id
    AND se.played_at::date BETWEEN w.from_on AND w.to_on
  WHERE tm.team_id = p_team_id
    AND tm.pending = false;
$function$;

-- ── Grants: service_role only ────────────────────────────────────────────────
-- Deliberately narrower than the three originals (which carry a legacy
-- anon/authenticated grant and each show up twice in the security advisor's
-- *_security_definer_function_executable findings). These four are brand new
-- with exactly two callers — /api/leaderboard/season and
-- /api/leaderboard/team/[teamId] — both of which hold the service key. Granting
-- anon/authenticated would add 8 advisor findings for callers that don't exist.
--
-- ⚠️ anon/authenticated must be revoked BY NAME: Supabase's ALTER DEFAULT
-- PRIVILEGES grants EXECUTE on every new public function to PUBLIC, anon,
-- authenticated, postgres and service_role at CREATE time, so `revoke … from
-- public` alone leaves the role grants intact (caught by the Part 1 gate).
revoke all on function public.fn_season_phase_window(uuid, text) from public, anon, authenticated;
revoke all on function public.global_leaderboard_phase(uuid, text) from public, anon, authenticated;
revoke all on function public.team_leaderboard_phase(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.team_total_score_phase(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.fn_season_phase_window(uuid, text) to service_role;
grant execute on function public.global_leaderboard_phase(uuid, text) to service_role;
grant execute on function public.team_leaderboard_phase(uuid, uuid, text) to service_role;
grant execute on function public.team_total_score_phase(uuid, uuid, text) to service_role;

-- ── verification gate ────────────────────────────────────────────────────────
-- Raises (rolling the migration back) if the shipped state is not what this file
-- intends. The load-bearing assertion is #3: phase='full' must be IDENTICAL to
-- the untouched originals, for every season and every team.
do $gate$
declare
  v_season   public.seasons;
  v_team     uuid;
  v_diff     bigint;
  v_w        record;
  v_expect_f date;
  v_expect_t date;
begin
  -- 1. The three ORIGINAL RPCs are untouched (still present, still SECURITY
  --    DEFINER, still their original argument lists).
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and (p.proname, pg_get_function_identity_arguments(p.oid)) in (
              ('global_leaderboard',      'p_season_id uuid'),
              ('team_leaderboard_season', 'p_team_id uuid, p_season_id uuid'),
              ('team_total_score',        'p_team_id uuid, p_season_id uuid'))) <> 3 then
    raise exception 'gate: an original leaderboard RPC changed signature or vanished';
  end if;

  -- 2. An invalid phase is rejected, not silently coerced.
  begin
    perform * from public.fn_season_phase_window(
      (select id from public.seasons limit 1), 'quarterfinals');
    raise exception 'gate: an invalid phase must raise';
  exception when sqlstate '22023' then null;
  end;

  -- 3. THE INVARIANT: phase='full' === the untouched originals, every season.
  for v_season in select * from public.seasons loop
    select count(*) into v_diff from (
      select subscriber_id, total_points from public.global_leaderboard(v_season.id)
      except all
      select subscriber_id, total_points from public.global_leaderboard_phase(v_season.id, 'full')
    ) d;
    if v_diff <> 0 then
      raise exception 'gate: global_leaderboard_phase(full) differs from global_leaderboard for season %', v_season.name;
    end if;

    for v_team in select distinct team_id from public.team_memberships where season_id = v_season.id loop
      select count(*) into v_diff from (
        select subscriber_id, total_points from public.team_leaderboard_season(v_team, v_season.id)
        except all
        select subscriber_id, total_points from public.team_leaderboard_phase(v_team, v_season.id, 'full')
      ) d;
      if v_diff <> 0 then
        raise exception 'gate: team_leaderboard_phase(full) differs for team % season %', v_team, v_season.name;
      end if;
      if public.team_total_score(v_team, v_season.id)
         <> public.team_total_score_phase(v_team, v_season.id, 'full') then
        raise exception 'gate: team_total_score_phase(full) differs for team % season %', v_team, v_season.name;
      end if;
    end loop;
  end loop;

  -- 4. Window boundaries agree with the columns, for every season.
  for v_season in select * from public.seasons loop
    -- full
    select * into v_w from public.fn_season_phase_window(v_season.id, 'full');
    if v_w.from_on <> v_season.starts_on or v_w.to_on <> v_season.ends_on then
      raise exception 'gate: full window wrong for %', v_season.name;
    end if;

    if v_season.playoff_starts_on is null then
      -- no playoffs: regular == full, playoff == no rows
      select * into v_w from public.fn_season_phase_window(v_season.id, 'regular');
      if v_w.from_on <> v_season.starts_on or v_w.to_on <> v_season.ends_on then
        raise exception 'gate: regular window must equal the season when no playoffs (%)', v_season.name;
      end if;
      if exists (select 1 from public.fn_season_phase_window(v_season.id, 'playoff')) then
        raise exception 'gate: a season with no playoff date must yield NO playoff window (%)', v_season.name;
      end if;
    else
      -- playoffs configured: the two windows must partition the season exactly
      v_expect_t := v_season.playoff_starts_on - 1;
      v_expect_f := v_season.playoff_starts_on;
      select * into v_w from public.fn_season_phase_window(v_season.id, 'regular');
      if v_w.from_on <> v_season.starts_on or v_w.to_on <> v_expect_t then
        raise exception 'gate: regular window wrong for %', v_season.name;
      end if;
      select * into v_w from public.fn_season_phase_window(v_season.id, 'playoff');
      if v_w.from_on <> v_expect_f or v_w.to_on <> v_season.ends_on then
        raise exception 'gate: playoff window wrong for %', v_season.name;
      end if;
    end if;
  end loop;

  -- 5. Grants stay service_role-only on all four.
  if exists (
    select 1 from information_schema.routine_privileges
     where specific_schema = 'public'
       and routine_name in ('fn_season_phase_window','global_leaderboard_phase',
                            'team_leaderboard_phase','team_total_score_phase')
       and grantee in ('anon','authenticated','PUBLIC')
  ) then
    raise exception 'gate: the phase functions must not be executable by anon/authenticated/PUBLIC';
  end if;
end $gate$;

commit;
