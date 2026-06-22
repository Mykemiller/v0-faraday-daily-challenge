-- Leaderboard V2 §7.3 (review #2): multi-membership + transactional leave.
DROP FUNCTION IF EXISTS public.team_create(citext, text, citext);
DROP FUNCTION IF EXISTS public.team_leave(citext);

-- create a group with an optional type + parent company (validated by the trigger).
CREATE OR REPLACE FUNCTION public.team_create(
  p_email citext, p_name text, p_code citext DEFAULT NULL,
  p_group_type group_type DEFAULT 'custom', p_parent_code citext DEFAULT NULL
) RETURNS public.teams
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_season text := public.current_season();
  v_code citext := coalesce(p_code, (public.slugify_team(p_name) || '-' || extract(year from now())::text)::citext);
  v_parent_id uuid := NULL;
  v_team public.teams;
BEGIN
  IF p_email IS NULL OR p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'email and name are required';
  END IF;
  -- multi-membership: no "already on a team" check (review #2 / §7.3).
  IF p_parent_code IS NOT NULL THEN
    SELECT id INTO v_parent_id FROM public.teams WHERE code = p_parent_code;
    IF v_parent_id IS NULL THEN RAISE EXCEPTION 'invalid parent code'; END IF;
  END IF;
  INSERT INTO public.teams (code, name, season, created_by_email, group_type, parent_id)
  VALUES (v_code, p_name, v_season, p_email, coalesce(p_group_type, 'custom'), v_parent_id)
  RETURNING * INTO v_team;   -- enforce_group_hierarchy trigger validates parent rules
  INSERT INTO public.team_members (team_id, member_email, role)
  VALUES (v_team.id, p_email, 'creator');
  RETURN v_team;
END $$;

-- join a group; multi-membership; PK guards same-group dupes; soft cap 20.
-- Joining a team does NOT auto-join its company (§7.3).
CREATE OR REPLACE FUNCTION public.team_join(p_email citext, p_code citext)
RETURNS public.teams
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_team public.teams; v_count int;
BEGIN
  SELECT * INTO v_team FROM public.teams WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid team code'; END IF;
  SELECT count(*)::int INTO v_count FROM public.team_members WHERE member_email = p_email;
  IF v_count >= 20 THEN RAISE EXCEPTION 'group limit reached'; END IF;
  INSERT INTO public.team_members (team_id, member_email, role)
  VALUES (v_team.id, p_email, 'member')
  ON CONFLICT (team_id, member_email) DO NOTHING;
  RETURN v_team;
END $$;

-- leave a specific group (by code), transactionally (review #2):
--   last member        -> delete the group (but NOT a company that still has child teams)
--   creator leaves      -> transfer 'creator' to the oldest remaining member
--   company creator     -> never cascades to / breaks child teams
CREATE OR REPLACE FUNCTION public.team_leave(p_email citext, p_code citext)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_team public.teams;
  v_role text;
  v_remaining int;
  v_has_children boolean;
  v_new_creator citext;
BEGIN
  SELECT * INTO v_team FROM public.teams WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid team code'; END IF;
  SELECT role INTO v_role FROM public.team_members WHERE team_id = v_team.id AND member_email = p_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'not a member of this group'; END IF;

  SELECT count(*)::int INTO v_remaining
    FROM public.team_members WHERE team_id = v_team.id AND member_email <> p_email;

  DELETE FROM public.team_members WHERE team_id = v_team.id AND member_email = p_email;

  IF v_remaining = 0 THEN
    SELECT EXISTS(SELECT 1 FROM public.teams WHERE parent_id = v_team.id) INTO v_has_children;
    IF v_team.group_type = 'company' AND v_has_children THEN
      NULL;  -- keep the company so its child teams aren't orphaned/broken
    ELSE
      DELETE FROM public.teams WHERE id = v_team.id;
    END IF;
  ELSIF v_role = 'creator' THEN
    SELECT member_email INTO v_new_creator FROM public.team_members
      WHERE team_id = v_team.id ORDER BY joined_at ASC, member_email ASC LIMIT 1;
    UPDATE public.team_members SET role = 'creator'
      WHERE team_id = v_team.id AND member_email = v_new_creator;
  END IF;
  RETURN true;
END $$;

-- setof the caller's groups, incl. group_type + parent for the scope selector.
CREATE OR REPLACE FUNCTION public.team_get_my_teams(p_email citext)
RETURNS TABLE(team_id uuid, code citext, name text, group_type group_type, parent_id uuid,
              parent_code citext, role text, my_mw int, mw_total int, members int, joined_at timestamptz)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT t.id, t.code, t.name, t.group_type, t.parent_id,
         (SELECT code FROM public.teams pc WHERE pc.id = t.parent_id) AS parent_code,
         m.role, m.my_mw, t.mw_total,
         (SELECT count(*)::int FROM public.team_members tm WHERE tm.team_id = t.id) AS members,
         m.joined_at
  FROM public.team_members m JOIN public.teams t ON t.id = m.team_id
  WHERE m.member_email = p_email
  ORDER BY t.group_type, t.name;
$$;

-- rollback:
--   DROP FUNCTION IF EXISTS public.team_get_my_teams(citext);
--   DROP FUNCTION IF EXISTS public.team_leave(citext, citext);
--   DROP FUNCTION IF EXISTS public.team_create(citext, text, citext, group_type, citext);
--   recreate the original team_create(citext,text,citext) / team_leave(citext) / team_join from teams_v1_rpcs.
