-- Free Agency ← trading windows (CC-LO-FA-WINDOWS-1.0).
--
-- Until now the two trading windows on `seasons` were stored and displayed but
-- gated nothing: `/free-agency` was a stub reading "Trade window: TBD", and
-- `api/teams` selected `free_agency_start` and never read it.
--
-- This is the DB half of the gate. The app half lives in
-- `src/lib/league-playoffs/phase.ts` (`canMoveRoster`) and must stay in step —
-- the two are separate implementations of ONE rule, exactly as the playoff
-- freeze already is (`fn_season_roster_frozen` + `rosterFreezeState`).
--
-- THE RULE (Myke, 2026-09-08):
--   A roster MOVE is legal only inside an open period: the opening trading
--   window, the closing trading window, or free agency (free_agency_start …
--   ends_on).
--   1. FAIL OPEN — a season with no stored windows is not gated at all. Every
--      season predating 2026-09-07 has NULLs, including `testing`, which is
--      ACTIVE today with 18 memberships. Those must keep working untouched.
--   2. A FIRST JOIN IS ALWAYS ALLOWED — holding no team this season, you may
--      join at any time. Onboarding is never blocked.
--   3. THE PLAYOFF FREEZE STILL WINS — checked first, and free agency does not
--      thaw a frozen roster.

begin;

-- ── the predicate ────────────────────────────────────────────────────────────

create or replace function public.fn_season_move_window_open(p_season_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_s      public.seasons;
  v_today  date;
begin
  if p_season_id is null then
    return true;                       -- no season = nothing to gate
  end if;

  select * into v_s from public.seasons where id = p_season_id;
  if not found then
    return true;
  end if;

  -- Rule 1: a season that declares no window is not using the feature.
  if v_s.trading_open_starts_on is null and v_s.trading_close_starts_on is null then
    return true;
  end if;

  -- Season-local "today", mirroring fn_season_roster_frozen exactly.
  begin
    v_today := (now() at time zone coalesce(v_s.tz, 'America/Chicago'))::date;
  exception when others then
    v_today := (now() at time zone 'America/Chicago')::date;
  end;

  return
       (v_s.trading_open_starts_on  is not null
        and v_today between v_s.trading_open_starts_on  and v_s.trading_open_ends_on)
    or (v_s.trading_close_starts_on is not null
        and v_today between v_s.trading_close_starts_on and v_s.trading_close_ends_on)
    -- Free agency: the generated start through the season end. Clamped to
    -- ends_on because a move after the season is over is meaningless — the
    -- season-detail timeline draws the FA band overhanging the end, but that is
    -- presentation, not permission.
    or (v_s.free_agency_start is not null
        and v_today between v_s.free_agency_start and v_s.ends_on);
end $$;

comment on function public.fn_season_move_window_open(uuid) is
  'True when a roster MOVE is permitted for this season today. Fails OPEN for seasons with no stored trading windows. Mirrors canMoveRoster() in src/lib/league-playoffs/phase.ts — change both together.';

-- ── team_join: gate MOVES, exempt a first join ───────────────────────────────
-- Rebuilt verbatim from the live definition with the window check added; the
-- freeze check and every other line are unchanged.

create or replace function public.team_join(p_email citext, p_code citext)
returns teams
language plpgsql
set search_path to 'public'
as $$
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

  -- ► Playoff roster freeze (CC-LEAGUE-PLAYOFFS-1.0). Checked FIRST — it is
  --   absolute, and an open free-agency period must not thaw it.
  IF public.fn_season_roster_frozen(v_season) THEN
    RAISE EXCEPTION 'roster_frozen: Rosters are frozen for the playoffs.'
      USING ERRCODE = 'FRZ01';
  END IF;

  SELECT count(*)::int INTO v_count FROM public.team_memberships
   WHERE subscriber_id = v_sub AND season_id = v_season;

  -- ► Trading windows (CC-LO-FA-WINDOWS-1.0). v_count = 0 is a FIRST join and
  --   is exempt; joining a second team is a move and needs an open window.
  IF v_count > 0 AND NOT public.fn_season_move_window_open(v_season) THEN
    RAISE EXCEPTION 'trading_window_closed: Rosters are locked outside the trading windows.'
      USING ERRCODE = 'TWC01';
  END IF;

  IF v_count >= 5 THEN RAISE EXCEPTION 'group limit reached'; END IF;
  INSERT INTO public.team_memberships (subscriber_id, team_id, season_id, pending)
  VALUES (v_sub, v_team.id, v_season, false)
  ON CONFLICT DO NOTHING;
  RETURN v_team;
END $$;

-- ── team_leave: leaving is always a move ─────────────────────────────────────

create or replace function public.team_leave(p_email citext, p_code citext)
returns boolean
language plpgsql
set search_path to 'public'
as $$
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

  -- ► Trading windows (CC-LO-FA-WINDOWS-1.0). Leaving is NEVER a first join,
  --   so there is no exemption here.
  IF v_season IS NOT NULL AND NOT public.fn_season_move_window_open(v_season) THEN
    RAISE EXCEPTION 'trading_window_closed: Rosters are locked outside the trading windows.'
      USING ERRCODE = 'TWC01';
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
    DELETE FROM public.teams WHERE id = v_team.id;
  ELSIF v_team.captain_id = v_sub THEN
    SELECT subscriber_id INTO v_new_captain FROM public.team_memberships
     WHERE team_id = v_team.id ORDER BY created_at ASC, subscriber_id ASC LIMIT 1;
    UPDATE public.teams SET captain_id = v_new_captain WHERE id = v_team.id;
  END IF;
  RETURN true;
END $$;

commit;
