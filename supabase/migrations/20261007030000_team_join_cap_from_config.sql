-- CC-DC-TEAM-CAP-FROM-CONFIG-1.0 — team_join reads the cap from the season's
-- config instead of hardcoding 5, and refuses a join into a full team.
--
-- ⚠️ NOT APPLIED by the PR that introduced it. Apply AFTER the app merges.
--    Deploy order is app-first and safe: until this runs, `team_join` still
--    allows 5 for RPC callers (the `/team-action` edge function), while
--    `/api/teams` — the path every first-party surface uses — already honours
--    the config. Applying this first would be safe too; it is only ordered
--    second so the two never disagree in the direction of being MORE strict
--    than the UI says.
--
-- WHAT CHANGES, and nothing else:
--   1. the constant `5` becomes `coalesce(<the season's effective
--      max_teams_per_subscriber>, 5)`;
--   2. a new `max_team_size` check, counting DISTINCT subscribers in the
--      season (CC-LO-TEAM-COUNTS-1.0 — never count(*), the table is
--      season-keyed and one person can own several rows);
--   3. the 'group limit reached' message gains the season's number.
--
-- WHAT DOES NOT CHANGE: the signature `(p_email citext, p_code citext)`, the
-- return type `teams`, LANGUAGE plpgsql, SECURITY INVOKER (the deployed
-- function is NOT security definer), `SET search_path TO 'public'`, volatility,
-- owner and grants. `CREATE OR REPLACE` preserves the ACL
-- ({=X/postgres,postgres,anon,authenticated,service_role}); the gate at the
-- bottom asserts every one of those facts rather than trusting this note.
--
-- ⚠️ The 'group limit reached' TOKEN must survive verbatim: the `team-action`
-- edge function classifies RPC failures with
-- `/invalid team code|...|group limit reached|.../i` and anything unmatched
-- becomes a 500. The new text appends to that token, it does not replace it.
-- (`team_full` is NOT in that regex, so an RPC-path team_full surfaces as a
-- 500 through the edge function — the same pre-existing gap `roster_frozen`
-- and the TWC01 window codes already have. Out of scope here; fix in the edge
-- function, which this migration cannot deploy.)
--
-- DEPLOYED BODY THIS IS BASED ON — `select pg_get_functiondef('public.team_join'::regproc)`,
-- read from ycadmmngkdhvpcsrcuaq at 2026-10-06 17:46 CT:
--
--   CREATE OR REPLACE FUNCTION public.team_join(p_email citext, p_code citext)
--    RETURNS teams
--    LANGUAGE plpgsql
--    SET search_path TO 'public'
--   AS $function$
--   DECLARE
--     v_sub uuid;
--     v_season uuid;
--     v_team public.teams;
--     v_count int;
--     v_block text;
--   BEGIN
--     SELECT id INTO v_sub FROM public.dc_subscribers WHERE email = p_email;
--     IF v_sub IS NULL THEN RAISE EXCEPTION 'subscriber not found'; END IF;
--     SELECT * INTO v_team FROM public.teams WHERE code = p_code;
--     IF NOT FOUND THEN RAISE EXCEPTION 'invalid team code'; END IF;
--     -- CC-LO-CONCURRENT-SEASONS-1.0: the joiner's season, not "the" active one.
--     v_season := public.fn_season_for_subscriber(v_sub);
--     IF v_season IS NULL THEN RAISE EXCEPTION 'no active season'; END IF;
--
--     SELECT count(*)::int INTO v_count FROM public.team_memberships
--      WHERE subscriber_id = v_sub AND season_id = v_season;
--
--     -- v_count = 0 is a FIRST join; the predicate applies allow_late_join to it and
--     -- exempts it from the windows and the switch flag.
--     v_block := public.fn_season_roster_move_block(v_season, v_count = 0);
--     IF v_block = 'roster_frozen' THEN
--       RAISE EXCEPTION 'roster_frozen: Rosters are frozen for the playoffs.'
--         USING ERRCODE = 'FRZ01';
--     ELSIF v_block IS NOT NULL THEN
--       RAISE EXCEPTION '%: Roster changes are closed for this season.', v_block
--         USING ERRCODE = 'TWC01';
--     END IF;
--
--     IF v_count >= 5 THEN RAISE EXCEPTION 'group limit reached'; END IF;
--     INSERT INTO public.team_memberships (subscriber_id, team_id, season_id, pending)
--     VALUES (v_sub, v_team.id, v_season, false)
--     ON CONFLICT DO NOTHING;
--     RETURN v_team;
--   END $function$
--
-- If `pg_get_functiondef` no longer matches the block above, the deployed body
-- has DRIFTED since this migration was written. STOP: do not apply it — it
-- would silently revert whatever landed in between. Re-derive it from the
-- then-current body instead.
--
-- ROLLBACK: re-run the body quoted above verbatim (strip the leading `-- `).
-- It is a pure `CREATE OR REPLACE`, so the revert needs no other statement:
-- the owner, the grants and the search_path setting are unaffected either way.
-- Nothing in this migration writes a row, drops a column or changes a type, so
-- there is no data to restore.

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
  v_block text;
  v_cap int;
  v_max_size int;
  v_members int;
BEGIN
  SELECT id INTO v_sub FROM public.dc_subscribers WHERE email = p_email;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'subscriber not found'; END IF;
  SELECT * INTO v_team FROM public.teams WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid team code'; END IF;
  -- CC-LO-CONCURRENT-SEASONS-1.0: the joiner's season, not "the" active one.
  v_season := public.fn_season_for_subscriber(v_sub);
  IF v_season IS NULL THEN RAISE EXCEPTION 'no active season'; END IF;

  SELECT count(*)::int INTO v_count FROM public.team_memberships
   WHERE subscriber_id = v_sub AND season_id = v_season;

  -- v_count = 0 is a FIRST join; the predicate applies allow_late_join to it and
  -- exempts it from the windows and the switch flag.
  v_block := public.fn_season_roster_move_block(v_season, v_count = 0);
  IF v_block = 'roster_frozen' THEN
    RAISE EXCEPTION 'roster_frozen: Rosters are frozen for the playoffs.'
      USING ERRCODE = 'FRZ01';
  ELSIF v_block IS NOT NULL THEN
    RAISE EXCEPTION '%: Roster changes are closed for this season.', v_block
      USING ERRCODE = 'TWC01';
  END IF;

  -- CC-DC-TEAM-CAP-FROM-CONFIG-1.0: the cap is the season's, not a constant.
  -- v_season_effective_config is the ONE authority on which version is in
  -- force (state active|scheduled, inside its effective dates) — reading
  -- season_config directly here would pick a draft or a superseded version and
  -- disagree with /api/teams. A season with no effective config yields NULLs,
  -- and the coalesce restores the historical 5: this must fail OPEN, never
  -- lock a season's players out because a config was not written.
  SELECT c.max_teams_per_subscriber, c.max_team_size
    INTO v_cap, v_max_size
    FROM public.v_season_effective_config c
   WHERE c.season_id = v_season;
  v_cap := coalesce(v_cap, 5);
  IF v_cap < 1 THEN v_cap := 5; END IF;

  -- Grandfathered (D5): a player already over a LOWERED cap keeps every
  -- membership — nothing is removed here or anywhere — but may not add one.
  -- `>=` is what makes that true, and it is the deployed comparison unchanged.
  --
  -- The 'group limit reached' token is load-bearing: the team-action edge
  -- function matches on it to return 400 instead of 500.
  IF v_count >= v_cap THEN
    RAISE EXCEPTION 'group limit reached: This season allows % % — leave one to join another.',
      v_cap, CASE WHEN v_cap = 1 THEN 'team' ELSE 'teams' END;
  END IF;

  -- CC-DC-TEAM-CAP-FROM-CONFIG-1.0: max_team_size. NULL = unlimited.
  -- COUNT(DISTINCT subscriber_id), season-scoped, confirmed only, departed
  -- members excluded — identical to memberCountsPath/tallyMemberCounts on the
  -- app side (CC-LO-TEAM-COUNTS-1.0). count(*) here would report a season
  -- artifact, not a headcount, and would shut teams the moment they had held
  -- enough rows across seasons.
  IF v_max_size IS NOT NULL AND v_max_size >= 1 THEN
    SELECT count(DISTINCT tm.subscriber_id)::int INTO v_members
      FROM public.team_memberships tm
     WHERE tm.team_id = v_team.id
       AND tm.season_id = v_season
       AND tm.pending = false
       AND tm.left_at IS NULL;
    -- A member re-running the join must not be told the team is full by their
    -- own row; the insert below is ON CONFLICT DO NOTHING and idempotent.
    IF v_members >= v_max_size AND NOT EXISTS (
      SELECT 1 FROM public.team_memberships tm
       WHERE tm.subscriber_id = v_sub AND tm.team_id = v_team.id
         AND tm.season_id = v_season AND tm.left_at IS NULL
    ) THEN
      RAISE EXCEPTION 'team_full: This team is full — it holds the maximum of % % for this season.',
        v_max_size, CASE WHEN v_max_size = 1 THEN 'player' ELSE 'players' END
        USING ERRCODE = 'TMF01';
    END IF;
  END IF;

  INSERT INTO public.team_memberships (subscriber_id, team_id, season_id, pending)
  VALUES (v_sub, v_team.id, v_season, false)
  ON CONFLICT DO NOTHING;
  RETURN v_team;
END $function$;

-- ── Verification gate ───────────────────────────────────────────────────────
-- Everything this migration promised to keep identical is asserted, not
-- assumed. A failure here aborts the transaction and leaves the previous body
-- in place.
do $gate$
declare
  v_def text;
  v_football_cap int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'team_join'
     and pg_get_function_identity_arguments(p.oid) = 'p_email citext, p_code citext';
  if v_def is null then
    raise exception 'gate: team_join(citext,citext) is missing — the signature changed';
  end if;

  -- Invariants carried over from the deployed body.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'team_join'
       and (p.prosecdef                                   -- must stay INVOKER
            or not ('search_path=public' = any(p.proconfig))
            or p.provolatile <> 'v'
            or p.prorettype <> 'public.teams'::regtype)
  ) then
    raise exception 'gate: team_join changed SECURITY/search_path/volatility/return type';
  end if;

  -- The grants CREATE OR REPLACE is supposed to have preserved.
  if (select count(*) from information_schema.routine_privileges
       where specific_schema = 'public' and routine_name = 'team_join'
         and privilege_type = 'EXECUTE'
         and grantee in ('anon','authenticated','service_role','PUBLIC')) < 4 then
    raise exception 'gate: team_join lost an EXECUTE grant';
  end if;

  -- The two things this migration is FOR.
  if v_def not like '%v_season_effective_config%' then
    raise exception 'gate: team_join does not read the effective config';
  end if;
  if v_def like '%v_count >= 5%' then
    raise exception 'gate: the hardcoded 5-team cap is still in team_join';
  end if;
  if v_def not like '%count(DISTINCT tm.subscriber_id)%' then
    raise exception 'gate: the team-size check must count DISTINCT subscribers (CC-LO-TEAM-COUNTS-1.0)';
  end if;

  -- The token the team-action edge function matches on, so a cap rejection is
  -- still a 400 and not a 500.
  if v_def not like '%group limit reached%' then
    raise exception 'gate: the ''group limit reached'' token is load-bearing for team-action';
  end if;

  -- The guards this migration must not have disturbed.
  if v_def not like '%fn_season_roster_move_block%'
     or v_def not like '%FRZ01%' or v_def not like '%TWC01%' then
    raise exception 'gate: the roster-freeze / trading-window guards were dropped';
  end if;
  if v_def not like '%fn_season_for_subscriber(v_sub)%' then
    raise exception 'gate: CC-LO-CONCURRENT-SEASONS-1.0 — the joiner''s season resolver was dropped';
  end if;

  -- The live data this is supposed to start enforcing. Football Season
  -- (02701ead-a03e-4489-adb9-24d3c6787eec) had max_teams_per_subscriber = 3
  -- and 0 subscribers over it when this was written (2026-10-06 17:48 CT), so
  -- applying this migration must change nobody's standing.
  select max_teams_per_subscriber into v_football_cap
    from public.v_season_effective_config
   where season_id = '02701ead-a03e-4489-adb9-24d3c6787eec';
  if v_football_cap is distinct from 3 then
    raise warning 'gate: Football Season cap is now % (was 3 when this migration was written) — expected, but check the over-cap count', v_football_cap;
  end if;

  raise notice 'team_join now caps from season_config (CC-DC-TEAM-CAP-FROM-CONFIG-1.0)';
end
$gate$;
