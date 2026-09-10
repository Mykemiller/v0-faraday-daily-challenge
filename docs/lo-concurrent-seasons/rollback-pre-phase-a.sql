-- CC-LO-CONCURRENT-SEASONS-1.0 — pre-Phase-A bodies, captured from prod
-- ycadmmngkdhvpcsrcuaq via pg_get_functiondef on 2026-09-10, BEFORE migration
-- 20260911000000_lo_concurrent_seasons.sql. Run this file to restore them, then
-- the DROP / constraint lines in that migration's trailing rollback comment.

CREATE OR REPLACE FUNCTION public.fn_leaderboard_rollover(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (p_now AT TIME ZONE 'America/Chicago')::date;
  v_yesterday date := (p_now AT TIME ZONE 'America/Chicago')::date - 1;
  v_active uuid;
  v_season RECORD;
  v_champion uuid;
BEGIN
  INSERT INTO public.dc_rank_snapshots (snapshot_day, scope, period, subscriber_id, rank)
  SELECT v_yesterday, 'global', 'daily', subscriber_id, rank::int
  FROM public.fn_leaderboard_daily(v_yesterday, 1000000)
  ON CONFLICT (snapshot_day, scope, period, subscriber_id) DO UPDATE SET rank = EXCLUDED.rank;

  SELECT id INTO v_active FROM public.seasons
   WHERE v_yesterday BETWEEN starts_on AND ends_on ORDER BY starts_on DESC LIMIT 1;
  IF v_active IS NOT NULL THEN
    INSERT INTO public.dc_rank_snapshots (snapshot_day, scope, period, subscriber_id, rank)
    SELECT v_yesterday, 'global', 'season', subscriber_id, rank::int
    FROM public.fn_leaderboard_season(v_active, 1000000)
    ON CONFLICT (snapshot_day, scope, period, subscriber_id) DO UPDATE SET rank = EXCLUDED.rank;
  END IF;

  UPDATE public.seasons SET status = 'active'
   WHERE status = 'upcoming' AND starts_on <= v_today AND ends_on >= v_today;

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

  SELECT id INTO v_active FROM public.seasons
   WHERE status = 'active' AND v_today BETWEEN starts_on AND ends_on ORDER BY starts_on DESC LIMIT 1;
  IF v_active IS NOT NULL THEN
    DELETE FROM public.dc_season_state WHERE season_id = v_active;
    INSERT INTO public.dc_season_state (season_id, subscriber_id, completed_signals, dropped_signals)
    WITH win AS (SELECT starts_on, ends_on FROM public.seasons WHERE id = v_active),
    per_day AS (
      SELECT c.subscriber_id, c.puzzle_date, SUM(c.score)::bigint AS day_signals
      FROM public.dc_completions c, win
      WHERE c.puzzle_date BETWEEN win.starts_on AND win.ends_on AND c.puzzle_date < v_today
      GROUP BY c.subscriber_id, c.puzzle_date),
    ranked AS (
      SELECT subscriber_id, day_signals,
        ROW_NUMBER() OVER (PARTITION BY subscriber_id ORDER BY day_signals ASC) AS lo_rank,
        COUNT(*) OVER (PARTITION BY subscriber_id) AS n_days
      FROM per_day)
    SELECT v_active, subscriber_id,
      COALESCE(SUM(day_signals), 0)::bigint,
      COALESCE(SUM(day_signals) FILTER (WHERE n_days > 2 AND lo_rank <= 2), 0)::bigint
    FROM ranked GROUP BY subscriber_id;
  END IF;

  RETURN jsonb_build_object('today', v_today, 'snapshotted', v_yesterday, 'active_season', v_active);
END $function$;

CREATE OR REPLACE FUNCTION public.team_leaderboard(p_season text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(rank integer, team_id uuid, code citext, name text, members integer, score bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH season AS (
    SELECT id FROM public.seasons
    WHERE CASE WHEN p_season IS NULL THEN status = 'active'
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

CREATE OR REPLACE FUNCTION public.fn_dc_rotate_live_set(p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_promoted_ids   text[] := '{}';
  v_promoted_types text[] := '{}';
  v_retired_ids    text[] := '{}';
  v_live_types     text[] := '{}';
  v_missing_types  text[] := '{}';
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

  return jsonb_build_object(
    'promoted',      coalesce(array_length(v_promoted_ids, 1), 0),
    'retired',       coalesce(array_length(v_retired_ids, 1), 0),
    'promoted_ids',  to_jsonb(v_promoted_ids),
    'retired_ids',   to_jsonb(v_retired_ids),
    'live_types',    to_jsonb(v_live_types),
    'missing_types', to_jsonb(v_missing_types)
  );
end
$function$;

comment on function public.fn_dc_approve_puzzles(date[], text) is
  'Actor recorded by fn_dc_approve_puzzles (D4) — Draft rows reach Published ONLY through that RPC.';

-- §9 pre-change bodies (email-keyed RPCs), captured 2026-09-10.
CREATE OR REPLACE FUNCTION public.fn_group_member_emails(p_group uuid)
 RETURNS TABLE(member_email citext)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH active AS (
    SELECT id FROM public.seasons WHERE status = 'active'
    ORDER BY starts_on DESC LIMIT 1
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

CREATE OR REPLACE FUNCTION public.team_get_my_teams(p_email citext)
 RETURNS TABLE(team_id uuid, code citext, name text, conference_code text, conference_name text, role text, members integer, joined_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH active AS (
    SELECT id FROM public.seasons WHERE status = 'active'
    ORDER BY starts_on DESC LIMIT 1
  ), me AS (
    SELECT id FROM public.dc_subscribers WHERE email = p_email
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

-- team_create / team_join / team_leave: identical to the §9 bodies in
-- 20260911000000_lo_concurrent_seasons.sql except that each resolved the season as
--   SELECT id INTO v_season FROM public.seasons WHERE status = 'active'
--    ORDER BY starts_on DESC LIMIT 1;
-- (team_create: `SELECT * INTO v_season …`). Restore by re-substituting that
-- statement for the fn_season_for_subscriber(v_sub) line in each.
