-- League Playoffs — Part 1: roster freeze enforcement
-- CC-LEAGUE-PLAYOFFS-1.0 · claude/league-playoffs-implementation-b78mg6
--
-- Makes `seasons.roster_freeze_on` load-bearing. Until now it was metadata plus
-- a pre-generation checklist item (generation-logic.ts condition 2) — a full DB
-- sweep found zero functions, views, triggers or crons reading it, and players
-- could change teams freely right through the playoffs.
--
-- ADDITIVE + REVERSIBLE. Adds one function and rewrites three existing ones to
-- add a single guard each; no schema, no data, no RLS, no grant changes. The
-- pre-change bodies are captured verbatim in
-- docs/league-playoffs/part1-down.sql.
--
-- ── Why the guard lives in the RPCs and NOT in a table trigger ───────────────
-- A BEFORE trigger on team_memberships would be the obvious central choke point,
-- and it is the wrong tool here: the League Office `membership.add` /
-- `membership.move` actions write team_memberships DIRECTLY over service-role
-- PostgREST, so a trigger would freeze the commissioner out of their own
-- override. The commissioner is deliberately ABOVE the freeze — that is the
-- whole point of an override — so the guard sits on the player-facing paths:
--   * these three RPCs (the edge-function `team-action` path), and
--   * the four player routes (/api/teams create · join_by_token · upsert, and
--     /api/leaderboard/team/[teamId] leave), which bypass the RPCs entirely and
--     write team_memberships over PostgREST themselves.
-- Staff writes touch neither, so the exemption falls out by construction rather
-- than needing a carve-out anyone could later "tighten" by mistake.
-- Do NOT consolidate this into a trigger.

begin;

-- ── The freeze predicate ─────────────────────────────────────────────────────
-- SECURITY DEFINER on purpose: `seasons` is RLS-on with ZERO policies, so an
-- invoker-rights read returns no row for any non-service role and the guard
-- would fail OPEN (no row → "not frozen" → the write proceeds). A guard must
-- fail CLOSED, so this reads the season with definer rights and returns a plain
-- boolean. The only thing it exposes is whether a season's roster is frozen —
-- already player-facing copy.
--
-- Honours `seasons.tz` (per-season IANA zone) rather than hardcoding Central:
-- the freeze flips at local midnight for that season. An unrecognised zone falls
-- back to America/Chicago, matching the app-side seasonToday() helper.
create or replace function public.fn_season_roster_frozen(p_season_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_freeze date;
  v_tz     text;
  v_today  date;
begin
  if p_season_id is null then
    return false;                      -- no season → nothing to freeze
  end if;

  select roster_freeze_on, tz into v_freeze, v_tz
    from public.seasons where id = p_season_id;

  if v_freeze is null then
    return false;                      -- season configures no freeze
  end if;

  begin
    v_today := (now() at time zone coalesce(v_tz, 'America/Chicago'))::date;
  exception when others then
    v_today := (now() at time zone 'America/Chicago')::date;
  end;

  return v_today >= v_freeze;          -- frozen ON the date, and onward
end $function$;

comment on function public.fn_season_roster_frozen(uuid) is
  'True once the season has reached seasons.roster_freeze_on (in the season''s own tz). '
  'The player-facing roster gate. SECURITY DEFINER so it fails closed under the '
  'deny-all RLS on seasons. League Office membership.* actions deliberately do NOT '
  'consult it — the commissioner is above the freeze.';

-- service_role ONLY — deliberately narrower than the team_* RPCs' grants
-- (those still carry a legacy grant to PUBLIC/anon/authenticated).
--
-- Verified against prod before choosing this: `seasons` and `dc_subscribers` are
-- both RLS-on with zero policies, so anon/authenticated SELECT 0 rows from each.
-- All three RPCs look the subscriber up FIRST and raise 'subscriber not found'
-- before ever reaching the freeze check, so a non-service caller can never
-- execute this function — the grant would be dead weight that costs two real
-- advisor findings (anon_/authenticated_security_definer_function_executable).
-- Every real caller (the /api/teams route, the team-action edge function) holds
-- the service key.
-- ⚠️ anon and authenticated must be revoked BY NAME. Supabase ships
-- ALTER DEFAULT PRIVILEGES that grant EXECUTE on every new public function to
-- PUBLIC, anon, authenticated, postgres and service_role at CREATE time, so
-- `revoke ... from public` alone leaves the two role grants intact (verified
-- against prod — the gate below caught exactly this).
revoke all on function public.fn_season_roster_frozen(uuid) from public, anon, authenticated;
grant execute on function public.fn_season_roster_frozen(uuid) to service_role;

-- ── team_join ────────────────────────────────────────────────────────────────
-- Unchanged from the pre-migration body except the freeze guard marked below.
create or replace function public.team_join(p_email citext, p_code citext)
returns teams
language plpgsql
set search_path to 'public'
as $function$
DECLARE
  v_sub uuid;
  v_season uuid;
  v_team public.teams;
  v_count int;
BEGIN
  SELECT id INTO v_sub FROM public.dc_subscribers WHERE email = p_email;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'subscriber not found'; END IF;
  SELECT * INTO v_team FROM public.teams WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid team code'; END IF;
  SELECT id INTO v_season FROM public.seasons WHERE status = 'active'
   ORDER BY starts_on DESC LIMIT 1;
  IF v_season IS NULL THEN RAISE EXCEPTION 'no active season'; END IF;

  -- ► Playoff roster freeze (CC-LEAGUE-PLAYOFFS-1.0).
  IF public.fn_season_roster_frozen(v_season) THEN
    RAISE EXCEPTION 'roster_frozen: Rosters are frozen for the playoffs.'
      USING ERRCODE = 'FRZ01';
  END IF;

  SELECT count(*)::int INTO v_count FROM public.team_memberships
   WHERE subscriber_id = v_sub AND season_id = v_season;
  IF v_count >= 5 THEN RAISE EXCEPTION 'group limit reached'; END IF;
  INSERT INTO public.team_memberships (subscriber_id, team_id, season_id, pending)
  VALUES (v_sub, v_team.id, v_season, false)
  ON CONFLICT DO NOTHING;
  RETURN v_team;
END $function$;

-- ── team_leave ───────────────────────────────────────────────────────────────
-- Leaving is a roster change too — without this a frozen player could still
-- walk off a team mid-playoffs and strand the bracket.
--
-- The guard is skipped when v_season is NULL. That is not a hole: the existing
-- body already treats a NULL active season as "delete the membership for any
-- season", and with no season there is no freeze date to honour. Behaviour for
-- that case is unchanged.
create or replace function public.team_leave(p_email citext, p_code citext)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
DECLARE
  v_sub uuid;
  v_season uuid;
  v_team public.teams;
  v_remaining int;
  v_new_captain uuid;
BEGIN
  SELECT id INTO v_sub FROM public.dc_subscribers WHERE email = p_email;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'subscriber not found'; END IF;
  SELECT * INTO v_team FROM public.teams WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid team code'; END IF;
  SELECT id INTO v_season FROM public.seasons WHERE status = 'active'
   ORDER BY starts_on DESC LIMIT 1;

  -- ► Playoff roster freeze (CC-LEAGUE-PLAYOFFS-1.0).
  IF v_season IS NOT NULL AND public.fn_season_roster_frozen(v_season) THEN
    RAISE EXCEPTION 'roster_frozen: Rosters are frozen for the playoffs.'
      USING ERRCODE = 'FRZ01';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.team_memberships
                  WHERE subscriber_id = v_sub AND team_id = v_team.id
                    AND (v_season IS NULL OR season_id = v_season)) THEN
    RAISE EXCEPTION 'not a member of this group';
  END IF;

  DELETE FROM public.team_memberships
   WHERE subscriber_id = v_sub AND team_id = v_team.id
     AND (v_season IS NULL OR season_id = v_season);

  SELECT count(*)::int INTO v_remaining
    FROM public.team_memberships WHERE team_id = v_team.id;

  IF v_remaining = 0 THEN
    -- Durable-team model: no company/children special case — an empty team is
    -- deleted (its team_conference_memberships cascade with it).
    DELETE FROM public.teams WHERE id = v_team.id;
  ELSIF v_team.captain_id = v_sub THEN
    SELECT subscriber_id INTO v_new_captain FROM public.team_memberships
     WHERE team_id = v_team.id ORDER BY created_at ASC, subscriber_id ASC LIMIT 1;
    UPDATE public.teams SET captain_id = v_new_captain WHERE id = v_team.id;
  END IF;
  RETURN true;
END $function$;

-- ── team_create ──────────────────────────────────────────────────────────────
-- Creating a team self-joins the creator, so it is a roster change and is frozen
-- alongside join/leave. Otherwise a frozen player could simply found a new team.
create or replace function public.team_create(
  p_email citext,
  p_name text,
  p_code citext default null::citext,
  p_group_type group_type default 'custom'::group_type,
  p_parent_code citext default null::citext
)
returns teams
language plpgsql
set search_path to 'public'
as $function$
DECLARE
  v_sub uuid;
  v_season public.seasons;
  v_code citext := coalesce(p_code, (public.slugify_team(p_name) || '-' || extract(year from now())::text)::citext);
  v_team public.teams;
  v_league uuid;
  v_conf uuid;
BEGIN
  -- p_group_type / p_parent_code retained for wire compatibility, IGNORED:
  -- the company/parent hierarchy is retired (Part B) — org structure lives in
  -- conferences + team_conference_memberships now.
  IF p_email IS NULL OR p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'email and name are required';
  END IF;
  SELECT id INTO v_sub FROM public.dc_subscribers WHERE email = p_email;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'subscriber not found'; END IF;
  SELECT * INTO v_season FROM public.seasons WHERE status = 'active'
   ORDER BY starts_on DESC LIMIT 1;
  IF v_season.id IS NULL THEN RAISE EXCEPTION 'no active season'; END IF;

  -- ► Playoff roster freeze (CC-LEAGUE-PLAYOFFS-1.0).
  IF public.fn_season_roster_frozen(v_season.id) THEN
    RAISE EXCEPTION 'roster_frozen: Rosters are frozen for the playoffs.'
      USING ERRCODE = 'FRZ01';
  END IF;

  SELECT l.id, c.id INTO v_league, v_conf
    FROM public.leagues l JOIN public.conferences c ON c.league_id = l.id
   WHERE l.code = 'INDEPENDENT' AND c.code = 'GENERAL';
  INSERT INTO public.teams (code, name, created_by_email, captain_id, league_id, conference_id)
  VALUES (v_code, p_name, p_email, v_sub, v_league, v_conf)
  RETURNING * INTO v_team;
  INSERT INTO public.team_memberships (subscriber_id, team_id, season_id, pending)
  VALUES (v_sub, v_team.id, v_season.id, false)
  ON CONFLICT DO NOTHING;
  RETURN v_team;
END $function$;

-- ── verification gate ────────────────────────────────────────────────────────
-- Raises (and rolls the whole migration back) if the shipped state is not what
-- this file intends.
do $gate$
declare
  v_frozen boolean;
  v_hot uuid;
begin
  -- The helper exists, is SECURITY DEFINER, and pins its search_path.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_season_roster_frozen'
      and p.prosecdef
      and 'search_path=public' = any(p.proconfig)
  ) then
    raise exception 'gate: fn_season_roster_frozen missing, not SECURITY DEFINER, or search_path unpinned';
  end if;

  -- All three RPCs now reference the guard.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('team_join','team_leave','team_create')
         and pg_get_functiondef(p.oid) like '%fn_season_roster_frozen%') <> 3 then
    raise exception 'gate: expected all 3 team_* RPCs to call fn_season_roster_frozen';
  end if;

  -- A NULL season is never frozen (team_leave depends on this).
  if public.fn_season_roster_frozen(null) then
    raise exception 'gate: a null season must not report frozen';
  end if;

  -- The grant stays service_role-only: anon/authenticated EXECUTE would add two
  -- security-definer advisor findings for a path that cannot be reached.
  if exists (
    select 1 from information_schema.routine_privileges
     where specific_schema = 'public'
       and routine_name = 'fn_season_roster_frozen'
       and grantee in ('anon','authenticated','PUBLIC')
  ) then
    raise exception 'gate: fn_season_roster_frozen must not be executable by anon/authenticated/PUBLIC';
  end if;

  -- A season with no freeze date is never frozen — every season except Hot
  -- Summer, so this migration must ship inert for them.
  if exists (
    select 1 from public.seasons
     where roster_freeze_on is null and public.fn_season_roster_frozen(id)
  ) then
    raise exception 'gate: a season with no roster_freeze_on must not report frozen';
  end if;

  -- Hot summer Final Beta freezes 2026-08-17; assert the predicate agrees with
  -- the column rather than trusting the clock.
  select id into v_hot from public.seasons where roster_freeze_on is not null
   order by starts_on limit 1;
  if v_hot is not null then
    select public.fn_season_roster_frozen(v_hot) into v_frozen;
    if v_frozen <> ((now() at time zone 'America/Chicago')::date
                    >= (select roster_freeze_on from public.seasons where id = v_hot)) then
      raise exception 'gate: freeze predicate disagrees with roster_freeze_on';
    end if;
  end if;
end $gate$;

commit;
