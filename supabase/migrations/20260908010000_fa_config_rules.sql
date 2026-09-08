-- League Office config flags become load-bearing (CC-LO-FA-CONFIG-1.0).
--
-- `allow_free_agency`, `allow_late_join`, `allow_mid_season_team_switch` and
-- `season_config.roster_lock_on` have existed since the config console shipped
-- and gated NOTHING — zero reads outside the League Office editor. This wires
-- them to the roster path, matching canMoveRoster() in
-- src/lib/league-playoffs/phase.ts. Two implementations of ONE rule; change
-- both together.
--
-- PRECEDENCE, strictest first (order is the whole contract):
--   1. seasons.roster_freeze_on        playoff freeze, absolute
--   2. season_config.roster_lock_on    config lock, absolute
--   3. first join?  → allow_late_join decides, and nothing else applies
--   4. allow_mid_season_team_switch    hard off-switch for moves
--   5. the trading windows             (free agency per allow_free_agency)
--
-- Null-permissive throughout: a NULL flag means "not configured" and never
-- blocks. Five of six live seasons have NO effective config (their only version
-- is a draft, which v_season_effective_config deliberately excludes), so they
-- stay ungated — `testing` among them, active with 18 memberships.

begin;

-- ── the default was never a decision ─────────────────────────────────────────
-- `allow_mid_season_team_switch` has defaulted to FALSE since the table was
-- created, and all 7 config rows hold exactly that default — nobody ever set
-- it. Wiring it literally would make the trading windows decorative: a season
-- could declare windows and still permit no trading. Flipped to true and
-- backfilled (Myke, 2026-09-08); a commissioner now turns it OFF deliberately.

alter table public.season_config
  alter column allow_mid_season_team_switch set default true;

-- LOCKED SEASONS ARE EXCLUDED. `fn_season_config_locked_guard` freezes config
-- for any season with `locked_at` set, and it correctly rejected the first
-- attempt at this backfill (55P03). Only `hot-summer-final-beta` is locked; it
-- is CLOSED and has no effective config (v1 expired 2026-09-05, v2 is a draft),
-- so leaving it false changes no behaviour. Reaching around a deliberate lock to
-- rewrite frozen history would be worse than the inconsistency.
update public.season_config c
   set allow_mid_season_team_switch = true
  from public.seasons s
 where s.id = c.season_id
   and c.allow_mid_season_team_switch = false
   and s.locked_at is null;

-- ── the predicate ────────────────────────────────────────────────────────────
-- Returns NULL when the write may proceed, else the wire error code. Returning
-- the code (not a boolean) keeps the reason intact for the caller, exactly as
-- the TS guard does.

create or replace function public.fn_season_roster_move_block(
  p_season_id     uuid,
  p_is_first_join boolean default false
)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_s        public.seasons;
  v_cfg      record;
  v_today    date;
  v_deadline date;
  v_open     boolean;
begin
  if p_season_id is null then
    return null;
  end if;

  select * into v_s from public.seasons where id = p_season_id;
  if not found then
    return null;
  end if;

  begin
    v_today := (now() at time zone coalesce(v_s.tz, 'America/Chicago'))::date;
  exception when others then
    v_today := (now() at time zone 'America/Chicago')::date;
  end;

  -- 1. Playoff freeze — absolute, and free agency must not thaw it.
  if public.fn_season_roster_frozen(p_season_id) then
    return 'roster_frozen';
  end if;

  -- The config in force RIGHT NOW. No row = nothing configured = permissive.
  select allow_free_agency, allow_late_join, allow_mid_season_team_switch,
         roster_lock_on, registration_closes_on
    into v_cfg
    from public.v_season_effective_config
   where season_id = p_season_id;

  -- 2. Config-level lock — absolute, one version down from the freeze.
  if v_cfg.roster_lock_on is not null and v_today >= v_cfg.roster_lock_on then
    return 'roster_locked';
  end if;

  -- 3. A first join answers to allow_late_join alone. Deliberately NOT subject
  --    to the windows or the switch flag: joining your first team is
  --    onboarding, not trading.
  if coalesce(p_is_first_join, false) then
    if v_cfg.allow_late_join is distinct from false then
      return null;
    end if;
    v_deadline := coalesce(v_cfg.registration_closes_on, v_s.starts_on);
    if v_deadline is not null and v_today > v_deadline then
      return 'late_join_closed';
    end if;
    return null;
  end if;

  -- 4. Hard off-switch for moves, independent of any window.
  if v_cfg.allow_mid_season_team_switch is distinct from true
     and v_cfg.allow_mid_season_team_switch is not null then
    return 'switching_disabled';
  end if;

  -- 5. The windows. A season declaring none is not using the feature.
  if v_s.trading_open_starts_on is null and v_s.trading_close_starts_on is null then
    return null;
  end if;

  v_open :=
       (v_s.trading_open_starts_on  is not null
        and v_today between v_s.trading_open_starts_on  and v_s.trading_open_ends_on)
    or (v_s.trading_close_starts_on is not null
        and v_today between v_s.trading_close_starts_on and v_s.trading_close_ends_on)
    or (v_cfg.allow_free_agency is distinct from false
        and v_s.free_agency_start is not null
        and v_today between v_s.free_agency_start and v_s.ends_on);

  return case when v_open then null else 'trading_window_closed' end;
end $$;

comment on function public.fn_season_roster_move_block(uuid, boolean) is
  'NULL when a roster write may proceed, else the wire error code. Mirrors canMoveRoster() in src/lib/league-playoffs/phase.ts - change both together.';

-- ── callers ──────────────────────────────────────────────────────────────────
-- team_join / team_leave now consult the full chain instead of the two
-- standalone predicates. The SQLSTATEs stay as they were so existing clients
-- (isDbRosterFrozenError / isDbMoveWindowError) keep matching.

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
  v_block text;
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

  IF v_count >= 5 THEN RAISE EXCEPTION 'group limit reached'; END IF;
  INSERT INTO public.team_memberships (subscriber_id, team_id, season_id, pending)
  VALUES (v_sub, v_team.id, v_season, false)
  ON CONFLICT DO NOTHING;
  RETURN v_team;
END $$;

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
  v_block text;
BEGIN
  SELECT id INTO v_sub FROM public.dc_subscribers WHERE email = p_email;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'subscriber not found'; END IF;
  SELECT * INTO v_team FROM public.teams WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid team code'; END IF;
  SELECT id INTO v_season FROM public.seasons WHERE status = 'active'
   ORDER BY starts_on DESC LIMIT 1;

  -- Leaving is NEVER a first join, so no exemption applies.
  IF v_season IS NOT NULL THEN
    v_block := public.fn_season_roster_move_block(v_season, false);
    IF v_block = 'roster_frozen' THEN
      RAISE EXCEPTION 'roster_frozen: Rosters are frozen for the playoffs.'
        USING ERRCODE = 'FRZ01';
    ELSIF v_block IS NOT NULL THEN
      RAISE EXCEPTION '%: Roster changes are closed for this season.', v_block
        USING ERRCODE = 'TWC01';
    END IF;
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
