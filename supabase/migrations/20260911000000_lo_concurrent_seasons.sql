-- CC-LO-CONCURRENT-SEASONS-1.0 · Phase A — the database half of "seasons are
-- independent and may overlap" (Step 2 of CC-LO-SEASONS-OVERLAP-1.0).
--
-- Design: docs/lo-concurrent-seasons/README.md (D1–D9 locked by Myke, 2026-09-10).
-- Pre-change bodies of every function replaced here are captured verbatim in
-- docs/lo-concurrent-seasons/rollback-pre-phase-a.sql.
--
-- What this file does
--   §1  fn_season_scope_is_platform(season)       — D4 helper: "whole platform" scope?
--   §2  fn_default_season()                        — D4: the platform-scoped active season
--   §3  fn_season_for_subscriber(subscriber)       — D1/D3/D5: THE season resolver
--       fn_season_for_subscriber_row(subscriber)   — same, returning the seasons row
--   §4  fn_leaderboard_rollover                    — snapshot + precompute EVERY season
--                                                    containing the day (was LIMIT 1)
--   §5  team_leaderboard(NULL)                     — NULL branch = fn_default_season()
--   §6  dc_puzzle_bank_staging uniqueness          — D2/D6: (season_id, puzzle_type,
--                                                    go_live_date) NULLS NOT DISTINCT
--   §7  fn_dc_approve_season_puzzles(season, dates, actor) — per-season approve (new
--       NAME, not an overload — see the PWR-01 overload trap)
--   §8  fn_dc_rotate_live_set                      — adds a per_season report
--   §9  team_create / team_join / team_leave / team_get_my_teams /
--       fn_group_member_emails                     — the email-keyed RPCs the edge
--                                                    functions call resolve the caller's season
--
-- Behaviour on today's data (one platform-scoped active season) is identical
-- for every caller; the functions only diverge once two seasons are active.
-- Requires PostgreSQL 15+ for UNIQUE NULLS NOT DISTINCT (prod is 17.6).

begin;

-- ── §1 platform-scope predicate (D4) ─────────────────────────────────────────
-- Mirrors fn_season_scope_resolve: no include rows ⇒ whole platform; a
-- non-excluded `platform` row ⇒ whole platform. Anything else is a carve-out.
create or replace function public.fn_season_scope_is_platform(p_season_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
           select 1 from public.season_scopes ss
            where ss.season_id = p_season_id and not ss.is_excluded)
      or exists (
           select 1 from public.season_scopes ss
            where ss.season_id = p_season_id and not ss.is_excluded
              and ss.scope_type = 'platform');
$$;
comment on function public.fn_season_scope_is_platform(uuid) is
  'CC-LO-CONCURRENT-SEASONS-1.0 D4: true when the season''s saved scope resolves to the whole platform (no include rows, or a platform include). Carve-outs (league/conference includes) are false.';

-- ── §2 the default season (D4) ───────────────────────────────────────────────
-- Anonymous callers and subscribers on no in-scope team land here. Same
-- predicate the old readers used (status = 'active', latest start) plus the
-- platform-scope filter; ties broken by id so two seasons starting the same
-- day cannot flip between calls.
create or replace function public.fn_default_season()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
    from public.seasons s
   where s.status = 'active'
     and public.fn_season_scope_is_platform(s.id)
   order by s.starts_on desc, s.id
   limit 1;
$$;
comment on function public.fn_default_season() is
  'CC-LO-CONCURRENT-SEASONS-1.0 D4: the platform-scoped active season (latest start, id tie-break), or NULL when no active season is platform-scoped. The season anonymous and team-less callers see.';

-- ── §3 THE season resolver (D1 / D3 / D5) ────────────────────────────────────
-- A subscriber is "in" season S iff they hold a confirmed, un-left membership
-- for S on a team S's scope resolves to (D5 — the exact predicate
-- team_leaderboard uses, so the board and the lobby can never disagree).
-- Among several such seasons a carve-out beats the platform season (D3), then
-- latest start, then id. No membership ⇒ the default season (D4).
create or replace function public.fn_season_for_subscriber(p_subscriber_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with member as (
    select s.id, s.starts_on, public.fn_season_scope_is_platform(s.id) as is_platform
      from public.seasons s
     where p_subscriber_id is not null
       and s.status = 'active'
       and exists (
         select 1
           from public.team_memberships tm
          where tm.subscriber_id = p_subscriber_id
            and tm.season_id = s.id
            and tm.pending = false
            and tm.left_at is null
            and tm.team_id in (select t.team_id from public.fn_season_scope_teams(s.id) t))
  )
  select coalesce(
    (select m.id from member m order by m.is_platform asc, m.starts_on desc, m.id limit 1),
    public.fn_default_season());
$$;
comment on function public.fn_season_for_subscriber(uuid) is
  'CC-LO-CONCURRENT-SEASONS-1.0 D1: THE season for a subscriber. Confirmed in-scope membership wins (carve-out over platform, then latest start — D3/D5); otherwise fn_default_season() (D4). NULL subscriber = default season. Every runtime reader goes through this; never pick a season by status=active LIMIT 1 again.';

create or replace function public.fn_season_for_subscriber_row(p_subscriber_id uuid)
returns setof public.seasons
language sql
stable
security definer
set search_path = public
as $$
  select s.* from public.seasons s where s.id = public.fn_season_for_subscriber(p_subscriber_id);
$$;
comment on function public.fn_season_for_subscriber_row(uuid) is
  'CC-LO-CONCURRENT-SEASONS-1.0: fn_season_for_subscriber() joined back to seasons so a route makes one RPC. Zero rows when no season resolves.';

-- ── §4 rollover: every season containing the day, not the latest one ────────
-- Same signature ⇒ a true CREATE OR REPLACE, not a second overload.
create or replace function public.fn_leaderboard_rollover(p_now timestamp with time zone default now())
returns jsonb
language plpgsql
set search_path = public
as $function$
DECLARE
  v_today date := (p_now AT TIME ZONE 'America/Chicago')::date;
  v_yesterday date := (p_now AT TIME ZONE 'America/Chicago')::date - 1;
  v_season RECORD;
  v_champion uuid;
  v_snapshotted uuid[] := '{}';
  v_precomputed uuid[] := '{}';
BEGIN
  -- 1) SNAPSHOT yesterday's global ranks (daily + season) -> movement arrows.
  INSERT INTO public.dc_rank_snapshots (snapshot_day, scope, period, subscriber_id, rank)
  SELECT v_yesterday, 'global', 'daily', subscriber_id, rank::int
  FROM public.fn_leaderboard_daily(v_yesterday, 1000000)
  ON CONFLICT (snapshot_day, scope, period, subscriber_id) DO UPDATE SET rank = EXCLUDED.rank;

  -- CC-LO-CONCURRENT-SEASONS-1.0: every season that contained yesterday, not
  -- the most recently started one.
  FOR v_season IN
    SELECT id FROM public.seasons
     WHERE v_yesterday BETWEEN starts_on AND ends_on
     ORDER BY starts_on, id
  LOOP
    INSERT INTO public.dc_rank_snapshots (snapshot_day, scope, period, subscriber_id, rank)
    SELECT v_yesterday, 'global', 'season', subscriber_id, rank::int
    FROM public.fn_leaderboard_season(v_season.id, 1000000)
    ON CONFLICT (snapshot_day, scope, period, subscriber_id) DO UPDATE SET rank = EXCLUDED.rank;
    v_snapshotted := v_snapshotted || v_season.id;
  END LOOP;

  -- 2) FLIP: upcoming -> active when it has begun.
  UPDATE public.seasons SET status = 'active'
   WHERE status = 'upcoming' AND starts_on <= v_today AND ends_on >= v_today;

  -- 3) CLOSE finished seasons: crown champion (rank 1; tie -> earliest final-day
  --    completion) + archive final standings, then flip to closed.
  FOR v_season IN SELECT * FROM public.seasons WHERE status = 'active' AND ends_on < v_today LOOP
    INSERT INTO public.season_results (season_id, subscriber_id, final_rank, final_signals, is_champion)
    SELECT v_season.id, subscriber_id, rank::int, signals::int, false
    FROM public.fn_leaderboard_season(v_season.id, 1000000)
    ON CONFLICT (season_id, subscriber_id)
    DO UPDATE SET final_rank = EXCLUDED.final_rank, final_signals = EXCLUDED.final_signals;

    SELECT sr.subscriber_id INTO v_champion
    FROM public.season_results sr
    WHERE sr.season_id = v_season.id AND sr.final_rank = 1
    ORDER BY (SELECT min(c.completed_at) FROM public.dc_completions c
              WHERE c.subscriber_id = sr.subscriber_id AND c.puzzle_date = v_season.ends_on) ASC NULLS LAST
    LIMIT 1;
    UPDATE public.season_results SET is_champion = (subscriber_id = v_champion)
     WHERE season_id = v_season.id;

    UPDATE public.seasons SET status = 'closed' WHERE id = v_season.id;
  END LOOP;

  -- 4) Recompute §5.6 precompute for EVERY active season over COMPLETED days (< today).
  FOR v_season IN
    SELECT id, starts_on, ends_on FROM public.seasons
     WHERE status = 'active' AND v_today BETWEEN starts_on AND ends_on
     ORDER BY starts_on, id
  LOOP
    DELETE FROM public.dc_season_state WHERE season_id = v_season.id;
    INSERT INTO public.dc_season_state (season_id, subscriber_id, completed_signals, dropped_signals)
    WITH per_day AS (
      SELECT c.subscriber_id, c.puzzle_date, SUM(c.score)::bigint AS day_signals
      FROM public.dc_completions c
      WHERE c.puzzle_date BETWEEN v_season.starts_on AND v_season.ends_on AND c.puzzle_date < v_today
      GROUP BY c.subscriber_id, c.puzzle_date),
    ranked AS (
      SELECT subscriber_id, day_signals,
        ROW_NUMBER() OVER (PARTITION BY subscriber_id ORDER BY day_signals ASC) AS lo_rank,
        COUNT(*) OVER (PARTITION BY subscriber_id) AS n_days
      FROM per_day)
    SELECT v_season.id, subscriber_id,
      COALESCE(SUM(day_signals), 0)::bigint,
      COALESCE(SUM(day_signals) FILTER (WHERE n_days > 2 AND lo_rank <= 2), 0)::bigint
    FROM ranked GROUP BY subscriber_id;
    v_precomputed := v_precomputed || v_season.id;
  END LOOP;

  -- `active_season` kept for log readers; it is now the DEFAULT season (D4).
  RETURN jsonb_build_object(
    'today', v_today,
    'snapshotted', v_yesterday,
    'active_season', public.fn_default_season(),
    'seasons_snapshotted', to_jsonb(v_snapshotted),
    'seasons_precomputed', to_jsonb(v_precomputed));
END $function$;

-- ── §5 team_leaderboard(NULL) = the default season ───────────────────────────
create or replace function public.team_leaderboard(p_season text default null::text, p_limit integer default 20)
returns table(rank integer, team_id uuid, code citext, name text, members integer, score bigint)
language sql
stable
set search_path = public
as $function$
  WITH season AS (
    SELECT id FROM public.seasons
    WHERE CASE WHEN p_season IS NULL THEN id = public.fn_default_season()
               ELSE name = p_season OR slug::text = p_season END
    ORDER BY starts_on DESC LIMIT 1
  ),
  scoped AS (
    SELECT t.id, t.code, t.name,
           count(DISTINCT tm.subscriber_id)::int AS members,
           public.team_total_score(t.id, s.id) AS score
    FROM season s
    JOIN public.team_memberships tm ON tm.season_id = s.id AND tm.pending = false
    JOIN public.teams t ON t.id = tm.team_id
    WHERE t.id IN (SELECT team_id FROM public.fn_season_scope_teams(s.id))
    GROUP BY t.id, t.code, t.name, s.id
  )
  SELECT row_number() OVER (ORDER BY score DESC, members DESC, name ASC)::int AS rank,
         id AS team_id, code, name, members, score
  FROM scoped
  ORDER BY score DESC, members DESC, name ASC
  LIMIT p_limit;
$function$;

-- ── §6 bank uniqueness: one row per (season, type, date) — D2 / D6 ───────────
-- Gate: the old constraint is strictly tighter, so this cannot find anything;
-- it is here so a database that never had the old constraint is refused.
do $$
declare n int;
begin
  select count(*) into n from (
    select 1 from public.dc_puzzle_bank_staging
     group by season_id, puzzle_type, go_live_date having count(*) > 1) d;
  if n <> 0 then
    raise exception 'gate: % (season_id, puzzle_type, go_live_date) groups already collide', n;
  end if;
end $$;

alter table public.dc_puzzle_bank_staging
  drop constraint if exists dc_puzzle_bank_staging_type_date_uniq;
alter table public.dc_puzzle_bank_staging
  add constraint dc_staging_season_type_date_uniq
  unique nulls not distinct (season_id, puzzle_type, go_live_date);
comment on constraint dc_staging_season_type_date_uniq on public.dc_puzzle_bank_staging is
  'CC-LO-CONCURRENT-SEASONS-1.0 D2/D6: one puzzle per (season, type, date). NULLS NOT DISTINCT keeps the season-less (platform) rows to one per type per date as before.';
comment on column public.dc_puzzle_bank_staging.season_id is
  'CC-LO-CONCURRENT-SEASONS-1.0 D6: NULL = a platform puzzle, served to anyone whose season has no row of this type on this date. Set = that season''s own puzzle, which beats the NULL row for its members. Read by the serve path since Phase B of that CC.';

-- ── §7 per-season approve (new NAME on purpose) ──────────────────────────────
-- fn_dc_approve_puzzles(dates, actor) approves every Unpublished row on the
-- dates regardless of season — correct for the season-less import path, wrong
-- for a season's own drafts once two seasons share dates. A distinct name, not
-- a defaulted third parameter: CREATE OR REPLACE with a new defaulted
-- parameter creates an OVERLOAD and every existing 2-arg call keeps hitting
-- the old body (the PWR-01 cron-244 trap).
create or replace function public.fn_dc_approve_season_puzzles(p_season_id uuid, p_dates date[], p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_ids        text[] := '{}';
  v_public_ids text[] := '{}';
begin
  if p_season_id is null then
    raise exception 'fn_dc_approve_season_puzzles: p_season_id is required';
  end if;
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'fn_dc_approve_season_puzzles: p_actor is required (audit trail)';
  end if;

  with approved as (
    update dc_puzzle_bank_staging
       set published   = 'Published',
           status      = 'Approved',
           approved_by = p_actor,
           approved_at = now()
     where season_id = p_season_id
       and go_live_date = any(p_dates)
       and published = 'Unpublished'
    returning id, public_id
  )
  select coalesce(array_agg(id::text), '{}'), coalesce(array_agg(public_id), '{}')
    into v_ids, v_public_ids
    from approved;

  return jsonb_build_object(
    'season_id',  p_season_id,
    'approved',   coalesce(array_length(v_ids, 1), 0),
    'ids',        to_jsonb(v_ids),
    'public_ids', to_jsonb(v_public_ids)
  );
end
$function$;
comment on function public.fn_dc_approve_season_puzzles(uuid, date[], text) is
  'CC-LO-CONCURRENT-SEASONS-1.0 §3.6: Unpublished→Published for ONE season''s rows on the given dates. The League Office approve actions call this; fn_dc_approve_puzzles(dates, actor) stays for the season-less import path only.';
comment on function public.fn_dc_approve_puzzles(date[], text) is
  'C½ D4: the season-LESS approve (every Unpublished row on the dates, any season). Since CC-LO-CONCURRENT-SEASONS-1.0 the League Office uses fn_dc_approve_season_puzzles(season, dates, actor); use this only for imported platform rows.';

revoke all on function public.fn_dc_approve_season_puzzles(uuid, date[], text) from public, anon, authenticated;
grant execute on function public.fn_dc_approve_season_puzzles(uuid, date[], text) to service_role;

-- ── §8 rotation report per season ────────────────────────────────────────────
-- Promote/retire are unchanged and were already multi-row safe. The top-level
-- live_types / missing_types keep their meaning (any Live row of the type
-- today, any season) so AUTO-128's log line reads as before; `per_season`
-- adds, for every active season, the types it serves (its own rows ∪ platform
-- rows — D6) and the live-catalog types it is missing.
create or replace function public.fn_dc_rotate_live_set(p_today date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_promoted_ids   text[] := '{}';
  v_promoted_types text[] := '{}';
  v_retired_ids    text[] := '{}';
  v_live_types     text[] := '{}';
  v_missing_types  text[] := '{}';
  v_per_season     jsonb  := '{}'::jsonb;
  v_s              record;
  v_s_live         text[];
  v_s_missing      text[];
begin
  with promoted as (
    update dc_puzzle_bank_staging
       set published = 'Live'
     where published = 'Published'
       and go_live_date = p_today
    returning id, game_id
  )
  select coalesce(array_agg(p.id::text), '{}'),
         coalesce(array_agg(g.runtime_key), '{}')
    into v_promoted_ids, v_promoted_types
    from promoted p
    join game_catalog g on g.id = p.game_id;

  with retired as (
    update dc_puzzle_bank_staging
       set published = 'Retired'
     where published = 'Live'
       and go_live_date < p_today
    returning id
  )
  select coalesce(array_agg(id::text), '{}')
    into v_retired_ids
    from retired;

  select coalesce(array_agg(distinct g.runtime_key), '{}')
    into v_live_types
    from dc_puzzle_bank_staging s
    join game_catalog g on g.id = s.game_id
   where s.published = 'Live'
     and s.go_live_date = p_today;

  select coalesce(array_agg(g.runtime_key order by g.lobby_sort_order, g.display_name), '{}')
    into v_missing_types
    from game_catalog g
   where g.lifecycle_state = 'live'
     and not (g.runtime_key = any(v_live_types));

  for v_s in select id, name from seasons where status = 'active' order by starts_on, id loop
    select coalesce(array_agg(distinct g.runtime_key), '{}')
      into v_s_live
      from dc_puzzle_bank_staging s
      join game_catalog g on g.id = s.game_id
     where s.published = 'Live'
       and s.go_live_date = p_today
       and (s.season_id = v_s.id or s.season_id is null);
    select coalesce(array_agg(g.runtime_key order by g.lobby_sort_order, g.display_name), '{}')
      into v_s_missing
      from game_catalog g
     where g.lifecycle_state = 'live'
       and not (g.runtime_key = any(v_s_live));
    v_per_season := v_per_season || jsonb_build_object(v_s.id::text, jsonb_build_object(
      'name', v_s.name, 'live_types', to_jsonb(v_s_live), 'missing_types', to_jsonb(v_s_missing)));
  end loop;

  return jsonb_build_object(
    'promoted',      coalesce(array_length(v_promoted_ids, 1), 0),
    'retired',       coalesce(array_length(v_retired_ids, 1), 0),
    'promoted_ids',  to_jsonb(v_promoted_ids),
    'retired_ids',   to_jsonb(v_retired_ids),
    'live_types',    to_jsonb(v_live_types),
    'missing_types', to_jsonb(v_missing_types),
    'per_season',    v_per_season
  );
end
$function$;

-- ── §9 the email-keyed team RPCs + group mailer resolve the CALLER's season ──
-- Found by scanning pg_proc for `status = 'active'` during the build: the
-- Supabase edge functions (team-action, get-leaderboard, get-team-leaderboard)
-- still call these, and each picked "the" active season by latest start.
-- p_email → dc_subscribers.id → fn_season_for_subscriber(). Bodies otherwise
-- verbatim. Same signatures ⇒ true replacements (overload trap check below).
create or replace function public.team_create(p_email citext, p_name text, p_code citext default null::citext, p_group_type group_type default 'custom'::group_type, p_parent_code citext default null::citext)
returns teams
language plpgsql
set search_path = public
as $function$
DECLARE
  v_sub uuid;
  v_season public.seasons;
  v_code citext := coalesce(p_code, (public.slugify_team(p_name) || '-' || extract(year from now())::text)::citext);
  v_team public.teams;
  v_league uuid;
  v_conf uuid;
BEGIN
  IF p_email IS NULL OR p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'email and name are required';
  END IF;
  SELECT id INTO v_sub FROM public.dc_subscribers WHERE email = p_email;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'subscriber not found'; END IF;
  -- CC-LO-CONCURRENT-SEASONS-1.0: the creator's season, not "the" active one.
  SELECT * INTO v_season FROM public.seasons WHERE id = public.fn_season_for_subscriber(v_sub);
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

create or replace function public.team_join(p_email citext, p_code citext)
returns teams
language plpgsql
set search_path = public
as $function$
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

  IF v_count >= 5 THEN RAISE EXCEPTION 'group limit reached'; END IF;
  INSERT INTO public.team_memberships (subscriber_id, team_id, season_id, pending)
  VALUES (v_sub, v_team.id, v_season, false)
  ON CONFLICT DO NOTHING;
  RETURN v_team;
END $function$;

create or replace function public.team_leave(p_email citext, p_code citext)
returns boolean
language plpgsql
set search_path = public
as $function$
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
  -- CC-LO-CONCURRENT-SEASONS-1.0: the leaver's season, not "the" active one.
  v_season := public.fn_season_for_subscriber(v_sub);

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
END $function$;

create or replace function public.team_get_my_teams(p_email citext)
returns table(team_id uuid, code citext, name text, conference_code text, conference_name text, role text, members integer, joined_at timestamp with time zone)
language sql
stable
set search_path = public
as $function$
  WITH me AS (
    SELECT id FROM public.dc_subscribers WHERE email = p_email
  ), active AS (
    -- CC-LO-CONCURRENT-SEASONS-1.0: this subscriber's season.
    SELECT public.fn_season_for_subscriber(me.id) AS id FROM me
  )
  SELECT t.id, t.code, t.name, c.code, c.name,
         CASE WHEN t.captain_id = me.id THEN 'creator' ELSE 'member' END AS role,
         (SELECT count(*)::int FROM public.team_memberships x, active a2
           WHERE x.team_id = t.id AND x.season_id = a2.id AND x.pending = false) AS members,
         tm.created_at AS joined_at
  FROM me
  CROSS JOIN active a
  JOIN public.team_memberships tm ON tm.subscriber_id = me.id AND tm.season_id = a.id AND tm.pending = false
  JOIN public.teams t ON t.id = tm.team_id
  LEFT JOIN public.conferences c ON c.id = t.conference_id
  ORDER BY t.name;
$function$;

-- The group mailer has no caller identity: a team/conference's members in the
-- DEFAULT season (D4). Called by get-team-leaderboard for the viewer's own
-- group, which that function resolved through team_get_my_teams — the same
-- season for platform members; a carve-out member's group mail is a known
-- limitation recorded in the CC (§2).
create or replace function public.fn_group_member_emails(p_group uuid)
returns table(member_email citext)
language sql
stable
set search_path = public
as $function$
  WITH active AS (
    SELECT public.fn_default_season() AS id
  )
  SELECT DISTINCT s.email::citext
  FROM public.team_memberships tm
  JOIN public.dc_subscribers s ON s.id = tm.subscriber_id
  CROSS JOIN active a
  WHERE tm.season_id = a.id
    AND tm.pending = false
    AND (
      tm.team_id = p_group
      OR tm.team_id IN (SELECT tcm.team_id FROM public.team_conference_memberships tcm
                        WHERE tcm.conference_id = p_group AND tcm.season_id = a.id)
    );
$function$;

-- ── grants for the new readers ───────────────────────────────────────────────
revoke all on function public.fn_season_scope_is_platform(uuid)   from public, anon, authenticated;
revoke all on function public.fn_default_season()                  from public, anon, authenticated;
revoke all on function public.fn_season_for_subscriber(uuid)       from public, anon, authenticated;
revoke all on function public.fn_season_for_subscriber_row(uuid)   from public, anon, authenticated;
grant execute on function public.fn_season_scope_is_platform(uuid) to service_role;
grant execute on function public.fn_default_season()                to service_role;
grant execute on function public.fn_season_for_subscriber(uuid)     to service_role;
grant execute on function public.fn_season_for_subscriber_row(uuid) to service_role;

-- ── verification gate ────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.dc_puzzle_bank_staging'::regclass
               and conname = 'dc_puzzle_bank_staging_type_date_uniq') then
    raise exception 'gate: old (puzzle_type, go_live_date) unique still present';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.dc_puzzle_bank_staging'::regclass
                   and conname = 'dc_staging_season_type_date_uniq') then
    raise exception 'gate: dc_staging_season_type_date_uniq missing';
  end if;
  -- Overload trap check: exactly one rollover / rotate / team_leaderboard / approve body each.
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fn_leaderboard_rollover') <> 1
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fn_dc_rotate_live_set') <> 1
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'team_leaderboard') <> 1
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fn_dc_approve_puzzles') <> 1
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('team_create','team_join','team_leave','team_get_my_teams','fn_group_member_emails')) <> 5 then
    raise exception 'gate: an overload was created instead of a replacement';
  end if;
  -- NULL subscriber must resolve exactly like the default season.
  if public.fn_season_for_subscriber(null) is distinct from public.fn_default_season() then
    raise exception 'gate: fn_season_for_subscriber(NULL) <> fn_default_season()';
  end if;
end $$;

commit;

-- rollback: docs/lo-concurrent-seasons/rollback-pre-phase-a.sql restores the four
-- replaced bodies verbatim; then
--   drop function public.fn_dc_approve_season_puzzles(uuid, date[], text);
--   drop function public.fn_season_for_subscriber_row(uuid);
--   drop function public.fn_season_for_subscriber(uuid);
--   drop function public.fn_default_season();
--   drop function public.fn_season_scope_is_platform(uuid);
--   alter table public.dc_puzzle_bank_staging drop constraint dc_staging_season_type_date_uniq;
--   alter table public.dc_puzzle_bank_staging add constraint dc_puzzle_bank_staging_type_date_uniq
--     unique (puzzle_type, go_live_date);   -- fails if a season has generated a date the
--                                           -- platform also holds — that is the point.
