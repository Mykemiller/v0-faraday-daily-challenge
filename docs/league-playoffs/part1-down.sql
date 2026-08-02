-- Down-migration for 20260802120000_league_playoffs_part1_roster_freeze.sql
-- CC-LEAGUE-PLAYOFFS-1.0
--
-- Restores the three team_* RPCs to their EXACT pre-migration bodies (captured
-- verbatim from pg_get_functiondef against prod on 2026-08-02, before any change
-- was applied) and drops the freeze helper.
--
-- Reverting the database alone leaves the app-side route guards in place. Those
-- fail safe — they read `seasons.roster_freeze_on` directly and would still
-- block player roster writes after the freeze date. To fully revert, roll back
-- the app deploy too, or clear `roster_freeze_on` on the affected season.
--
-- Proven in BEGIN … ROLLBACK against prod alongside the up-migration.

begin;

drop function if exists public.fn_season_roster_frozen(uuid);

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
  SELECT count(*)::int INTO v_count FROM public.team_memberships
   WHERE subscriber_id = v_sub AND season_id = v_season;
  IF v_count >= 5 THEN RAISE EXCEPTION 'group limit reached'; END IF;
  INSERT INTO public.team_memberships (subscriber_id, team_id, season_id, pending)
  VALUES (v_sub, v_team.id, v_season, false)
  ON CONFLICT DO NOTHING;
  RETURN v_team;
END $function$;

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

commit;
