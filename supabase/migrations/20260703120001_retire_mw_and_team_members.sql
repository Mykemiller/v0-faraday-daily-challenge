-- Teams reconciliation, step 2 of 2 (destructive) — FAR Teams/MW/Captain session, 2026-07-03.
--
-- PRE-REQ: 20260703120000_teams_reconcile_captain.sql applied AND the MW-free
-- edge functions deployed (complete-puzzle, verify-otp, verify-magic-link,
-- create-subscriber) — the old complete-puzzle wrote mw_earned/mw_balance and
-- the old verify-* selected mw_balance explicitly.
--
-- What this does:
--   A. Rewrites every team_* RPC over team_memberships (canonical membership)
--      + teams.captain_id — team_members is no longer read or written anywhere.
--   B. Rewrites every ranking/cache function that summed dc_completions.mw_earned
--      to sum dc_completions.score instead ("signals" = score from here on).
--      NOTE: this is a deliberate metric change — mw_earned held the retired MW
--      currency (flat 5/puzzle lately), which had silently become the ranking
--      input. Score is the intended metric (matches /api/leaderboard/* + score_events).
--   C. Drops the MW plumbing: the dc_completions→team MW trigger, table
--      team_members, and columns teams.mw_total, dc_subscribers.mw_balance,
--      dc_completions.mw_earned.

-- ── A1. Group member emails: derive from team_memberships (active season) ────
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
      OR (
        (SELECT group_type FROM public.teams WHERE id = p_group) = 'company'
        AND tm.team_id IN (SELECT ch.id FROM public.teams ch WHERE ch.parent_id = p_group)
      )
    );
$function$;

-- ── A2. team_create: membership row + captain, season from seasons table ─────
CREATE OR REPLACE FUNCTION public.team_create(p_email citext, p_name text, p_code citext DEFAULT NULL::citext, p_group_type group_type DEFAULT 'custom'::group_type, p_parent_code citext DEFAULT NULL::citext)
 RETURNS teams
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub uuid;
  v_season public.seasons;
  v_code citext := coalesce(p_code, (public.slugify_team(p_name) || '-' || extract(year from now())::text)::citext);
  v_parent_id uuid := NULL;
  v_team public.teams;
BEGIN
  IF p_email IS NULL OR p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'email and name are required';
  END IF;
  SELECT id INTO v_sub FROM public.dc_subscribers WHERE email = p_email;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'subscriber not found'; END IF;
  SELECT * INTO v_season FROM public.seasons WHERE status = 'active'
   ORDER BY starts_on DESC LIMIT 1;
  IF v_season.id IS NULL THEN RAISE EXCEPTION 'no active season'; END IF;
  IF p_parent_code IS NOT NULL THEN
    SELECT id INTO v_parent_id FROM public.teams WHERE code = p_parent_code;
    IF v_parent_id IS NULL THEN RAISE EXCEPTION 'invalid parent code'; END IF;
  END IF;
  -- teams.season is deprecated; still stamped with the founding season's name
  -- for continuity with rows written by /api/teams.
  INSERT INTO public.teams (code, name, season, created_by_email, group_type, parent_id, captain_id)
  VALUES (v_code, p_name, v_season.name, p_email, coalesce(p_group_type, 'custom'), v_parent_id, v_sub)
  RETURNING * INTO v_team;   -- enforce_group_hierarchy trigger validates parent rules
  INSERT INTO public.team_memberships (subscriber_id, team_id, season_id, pending)
  VALUES (v_sub, v_team.id, v_season.id, false)
  ON CONFLICT DO NOTHING;
  RETURN v_team;
END $function$;

-- ── A3. team_join: membership row, 5-team cap (canon, was 20) ────────────────
CREATE OR REPLACE FUNCTION public.team_join(p_email citext, p_code citext)
 RETURNS teams
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

-- ── A4. team_leave: membership delete + captain rollover / empty-team cleanup ─
CREATE OR REPLACE FUNCTION public.team_leave(p_email citext, p_code citext)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub uuid;
  v_season uuid;
  v_team public.teams;
  v_remaining int;
  v_has_children boolean;
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
    SELECT EXISTS(SELECT 1 FROM public.teams WHERE parent_id = v_team.id) INTO v_has_children;
    IF v_team.group_type = 'company' AND v_has_children THEN
      NULL;  -- keep the company so its child teams aren't orphaned/broken
    ELSE
      DELETE FROM public.teams WHERE id = v_team.id;  -- cascades memberships (none left)
    END IF;
  ELSIF v_team.captain_id = v_sub THEN
    -- Captain left: roll captaincy to the earliest remaining member.
    SELECT subscriber_id INTO v_new_captain FROM public.team_memberships
     WHERE team_id = v_team.id ORDER BY created_at ASC, subscriber_id ASC LIMIT 1;
    UPDATE public.teams SET captain_id = v_new_captain WHERE id = v_team.id;
  END IF;
  RETURN true;
END $function$;

-- ── A5. team_get_my_teams: over team_memberships; role derived from captain ──
-- Return type loses my_mw/mw_total → DROP + CREATE.
DROP FUNCTION IF EXISTS public.team_get_my_teams(citext);
CREATE FUNCTION public.team_get_my_teams(p_email citext)
 RETURNS TABLE(team_id uuid, code citext, name text, group_type group_type, parent_id uuid, parent_code citext, role text, members integer, joined_at timestamp with time zone)
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
  SELECT t.id, t.code, t.name, t.group_type, t.parent_id,
         (SELECT pc.code FROM public.teams pc WHERE pc.id = t.parent_id) AS parent_code,
         CASE WHEN t.captain_id = me.id THEN 'creator' ELSE 'member' END AS role,
         (SELECT count(*)::int FROM public.team_memberships x, active a2
           WHERE x.team_id = t.id AND x.season_id = a2.id AND x.pending = false) AS members,
         tm.created_at AS joined_at
  FROM me
  CROSS JOIN active a
  JOIN public.team_memberships tm ON tm.subscriber_id = me.id AND tm.season_id = a.id AND tm.pending = false
  JOIN public.teams t ON t.id = tm.team_id
  ORDER BY t.group_type, t.name;
$function$;

-- Legacy singular variant — no remaining caller; retire it.
DROP FUNCTION IF EXISTS public.team_get_my_team(citext);

-- ── A6. team_leaderboard: season score standings (was lifetime mw_total) ─────
-- Return column mw → score; membership + points now come from the SAME sources
-- as /api/leaderboard/season (team_memberships + score_events).
DROP FUNCTION IF EXISTS public.team_leaderboard(text, integer);
CREATE FUNCTION public.team_leaderboard(p_season text DEFAULT NULL::text, p_limit integer DEFAULT 20)
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
    GROUP BY t.id, t.code, t.name, s.id
  )
  SELECT row_number() OVER (ORDER BY score DESC, members DESC, name ASC)::int AS rank,
         id AS team_id, code, name, members, score
  FROM scoped
  ORDER BY score DESC, members DESC, name ASC
  LIMIT p_limit;
$function$;

-- ── B. Ranking/cache functions: mw_earned → score ────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_leaderboard_daily(p_day date, p_limit integer DEFAULT 50)
 RETURNS TABLE(rank bigint, subscriber_id uuid, signals bigint, play_streak integer, full_set_streak integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH day_totals AS (
    SELECT c.subscriber_id, SUM(c.score)::bigint AS signals
    FROM public.dc_completions c WHERE c.puzzle_date = p_day GROUP BY c.subscriber_id)
  SELECT RANK() OVER (ORDER BY d.signals DESC, s.full_set_streak DESC, s.play_streak DESC),
         d.subscriber_id, d.signals, s.play_streak, s.full_set_streak
  FROM day_totals d JOIN public.dc_subscribers s ON s.id = d.subscriber_id
  ORDER BY d.signals DESC, s.full_set_streak DESC, s.play_streak DESC
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.fn_leaderboard_season(p_season uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(rank bigint, subscriber_id uuid, signals bigint, days_played integer, play_streak integer, full_set_streak integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH s AS (SELECT starts_on, ends_on FROM public.seasons WHERE id = p_season),
  per_day AS (
    SELECT c.subscriber_id, c.puzzle_date, SUM(c.score)::bigint AS day_signals
    FROM public.dc_completions c, s
    WHERE c.puzzle_date BETWEEN s.starts_on AND s.ends_on
    GROUP BY c.subscriber_id, c.puzzle_date),
  ranked_days AS (
    SELECT subscriber_id, puzzle_date, day_signals,
           ROW_NUMBER() OVER (PARTITION BY subscriber_id ORDER BY day_signals ASC) AS lo_rank,
           COUNT(*) OVER (PARTITION BY subscriber_id) AS n_days
    FROM per_day),
  season_totals AS (
    SELECT subscriber_id,
           (SUM(day_signals) FILTER (WHERE n_days <= 2 OR lo_rank > 2))::bigint AS signals,  -- drop 2 lowest once >2 days
           MAX(n_days)::int AS days_played
    FROM ranked_days GROUP BY subscriber_id)
  SELECT RANK() OVER (ORDER BY t.signals DESC, sub.full_set_streak DESC, sub.play_streak DESC),
         t.subscriber_id, t.signals, t.days_played, sub.play_streak, sub.full_set_streak
  FROM season_totals t JOIN public.dc_subscribers sub ON sub.id = t.subscriber_id
  ORDER BY t.signals DESC, sub.full_set_streak DESC, sub.play_streak DESC
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.fn_player_rank_daily(p_day date, p_subscriber uuid)
 RETURNS TABLE(rank bigint, signals bigint, total_players bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH day_totals AS (
    SELECT c.subscriber_id, SUM(c.score)::bigint AS signals
    FROM public.dc_completions c WHERE c.puzzle_date = p_day GROUP BY c.subscriber_id),
  ranked AS (
    SELECT d.subscriber_id, d.signals,
           RANK() OVER (ORDER BY d.signals DESC, s.full_set_streak DESC, s.play_streak DESC) AS rnk
    FROM day_totals d JOIN public.dc_subscribers s ON s.id = d.subscriber_id)
  SELECT
    (SELECT rnk FROM ranked WHERE subscriber_id = p_subscriber),
    COALESCE((SELECT signals FROM ranked WHERE subscriber_id = p_subscriber), 0)::bigint,
    (SELECT COUNT(*) FROM day_totals)::bigint;
$function$;

CREATE OR REPLACE FUNCTION public.fn_player_rank_season(p_season uuid, p_subscriber uuid)
 RETURNS TABLE(rank bigint, signals bigint, total_players bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH s AS (SELECT starts_on, ends_on FROM public.seasons WHERE id = p_season),
  per_day AS (
    SELECT c.subscriber_id, c.puzzle_date, SUM(c.score)::bigint AS day_signals
    FROM public.dc_completions c, s
    WHERE c.puzzle_date BETWEEN s.starts_on AND s.ends_on
    GROUP BY c.subscriber_id, c.puzzle_date),
  ranked_days AS (
    SELECT subscriber_id, day_signals,
           ROW_NUMBER() OVER (PARTITION BY subscriber_id ORDER BY day_signals ASC) AS lo_rank,
           COUNT(*) OVER (PARTITION BY subscriber_id) AS n_days
    FROM per_day),
  season_totals AS (
    SELECT subscriber_id,
           (SUM(day_signals) FILTER (WHERE n_days <= 2 OR lo_rank > 2))::bigint AS signals
    FROM ranked_days GROUP BY subscriber_id),
  ranked AS (
    SELECT t.subscriber_id, t.signals,
           RANK() OVER (ORDER BY t.signals DESC, sub.full_set_streak DESC, sub.play_streak DESC) AS rnk
    FROM season_totals t JOIN public.dc_subscribers sub ON sub.id = t.subscriber_id)
  SELECT
    (SELECT rnk FROM ranked WHERE subscriber_id = p_subscriber),
    COALESCE((SELECT signals FROM ranked WHERE subscriber_id = p_subscriber), 0)::bigint,
    (SELECT COUNT(*) FROM season_totals)::bigint;
$function$;

CREATE OR REPLACE FUNCTION public.fn_dc_completion_cache_upsert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.dc_period_aggregates (subscriber_id, period, period_key, signals, updated_at)
  VALUES (NEW.subscriber_id, 'daily', to_char(NEW.puzzle_date, 'YYYY-MM-DD'), NEW.score, now())
  ON CONFLICT (subscriber_id, period, period_key)
  DO UPDATE SET signals = public.dc_period_aggregates.signals + EXCLUDED.signals, updated_at = now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_backfill_daily_cache(p_day date)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  INSERT INTO public.dc_period_aggregates (subscriber_id, period, period_key, signals, updated_at)
  SELECT c.subscriber_id, 'daily', to_char(p_day, 'YYYY-MM-DD'), SUM(c.score)::bigint, now()
  FROM public.dc_completions c WHERE c.puzzle_date = p_day GROUP BY c.subscriber_id
  ON CONFLICT (subscriber_id, period, period_key)
  DO UPDATE SET signals = EXCLUDED.signals, updated_at = now();
$function$;

CREATE OR REPLACE FUNCTION public.fn_group_member_board(p_group uuid, p_period text, p_day date, p_season uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(rank bigint, subscriber_id uuid, signals bigint, play_streak integer, full_set_streak integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH member_subs AS (
    SELECT s.id, s.play_streak, s.full_set_streak
    FROM public.fn_group_member_emails(p_group) g
    JOIN public.dc_subscribers s ON s.email = g.member_email
  ),
  win AS (SELECT starts_on, ends_on FROM public.seasons WHERE id = p_season),
  season_per_day AS (
    SELECT c.subscriber_id, c.puzzle_date, SUM(c.score)::bigint AS day_signals
    FROM public.dc_completions c, win
    WHERE p_period = 'season' AND c.puzzle_date BETWEEN win.starts_on AND win.ends_on
    GROUP BY c.subscriber_id, c.puzzle_date
  ),
  season_ranked AS (
    SELECT subscriber_id, day_signals,
      ROW_NUMBER() OVER (PARTITION BY subscriber_id ORDER BY day_signals ASC) AS lo_rank,
      COUNT(*) OVER (PARTITION BY subscriber_id) AS n_days
    FROM season_per_day
  ),
  season_tot AS (
    SELECT subscriber_id, (SUM(day_signals) FILTER (WHERE n_days <= 2 OR lo_rank > 2))::bigint AS signals
    FROM season_ranked GROUP BY subscriber_id
  ),
  daily_tot AS (
    SELECT c.subscriber_id, SUM(c.score)::bigint AS signals
    FROM public.dc_completions c
    WHERE p_period <> 'season' AND c.puzzle_date = p_day
    GROUP BY c.subscriber_id
  ),
  joined AS (
    SELECT ms.id AS subscriber_id, ms.play_streak, ms.full_set_streak,
      CASE WHEN p_period = 'season' THEN coalesce(st.signals, 0) ELSE coalesce(dt.signals, 0) END AS signals
    FROM member_subs ms
    LEFT JOIN season_tot st ON st.subscriber_id = ms.id
    LEFT JOIN daily_tot dt ON dt.subscriber_id = ms.id
  )
  SELECT RANK() OVER (ORDER BY signals DESC, full_set_streak DESC, play_streak DESC),
         subscriber_id, signals, play_streak, full_set_streak
  FROM joined
  ORDER BY signals DESC, full_set_streak DESC, play_streak DESC
  LIMIT p_limit;
$function$;

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
  -- 1) SNAPSHOT yesterday's global ranks (daily + season) -> movement arrows.
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

  -- 4) Recompute §5.6 precompute for the active season over COMPLETED days (< today).
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

-- ── C. Drop the MW plumbing ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_dc_completion_to_team_mw ON public.dc_completions;
DROP FUNCTION IF EXISTS public.dc_completion_to_team_mw();

DROP TABLE IF EXISTS public.team_members;

ALTER TABLE public.teams DROP COLUMN IF EXISTS mw_total;
ALTER TABLE public.dc_subscribers DROP COLUMN IF EXISTS mw_balance;
ALTER TABLE public.dc_completions DROP COLUMN IF EXISTS mw_earned;
