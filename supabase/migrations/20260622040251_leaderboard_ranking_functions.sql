-- Leaderboard V2 §5.4: rank from period-scoped dc_completions aggregates — the
-- root-cause fix for the empty board. "today" = (now() AT TIME ZONE Central)::date.
-- All STABLE, not SECURITY DEFINER; search_path pinned (§11). Tie-break order is
-- identical across board + player-rank fns so the pinned You-row rank matches.

CREATE OR REPLACE FUNCTION public.fn_leaderboard_daily(p_day date, p_limit int DEFAULT 50)
RETURNS TABLE (rank bigint, subscriber_id uuid, signals bigint, play_streak int, full_set_streak int)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH day_totals AS (
    SELECT c.subscriber_id, SUM(c.mw_earned)::bigint AS signals
    FROM public.dc_completions c WHERE c.puzzle_date = p_day GROUP BY c.subscriber_id)
  SELECT RANK() OVER (ORDER BY d.signals DESC, s.full_set_streak DESC, s.play_streak DESC),
         d.subscriber_id, d.signals, s.play_streak, s.full_set_streak
  FROM day_totals d JOIN public.dc_subscribers s ON s.id = d.subscriber_id
  ORDER BY d.signals DESC, s.full_set_streak DESC, s.play_streak DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.fn_leaderboard_season(p_season uuid, p_limit int DEFAULT 50)
RETURNS TABLE (rank bigint, subscriber_id uuid, signals bigint, days_played int, play_streak int, full_set_streak int)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH s AS (SELECT starts_on, ends_on FROM public.seasons WHERE id = p_season),
  per_day AS (
    SELECT c.subscriber_id, c.puzzle_date, SUM(c.mw_earned)::bigint AS day_signals
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
$$;

-- Un-limited player rank: returns exactly one row even outside the top N (and
-- even if the player hasn't scored in the period — rank NULL, signals 0). The
-- edge function derives percentile = 1 - (rank-1)/total_players, guarding N=0/1/2.
CREATE OR REPLACE FUNCTION public.fn_player_rank_daily(p_day date, p_subscriber uuid)
RETURNS TABLE (rank bigint, signals bigint, total_players bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH day_totals AS (
    SELECT c.subscriber_id, SUM(c.mw_earned)::bigint AS signals
    FROM public.dc_completions c WHERE c.puzzle_date = p_day GROUP BY c.subscriber_id),
  ranked AS (
    SELECT d.subscriber_id, d.signals,
           RANK() OVER (ORDER BY d.signals DESC, s.full_set_streak DESC, s.play_streak DESC) AS rnk
    FROM day_totals d JOIN public.dc_subscribers s ON s.id = d.subscriber_id)
  SELECT
    (SELECT rnk FROM ranked WHERE subscriber_id = p_subscriber),
    COALESCE((SELECT signals FROM ranked WHERE subscriber_id = p_subscriber), 0)::bigint,
    (SELECT COUNT(*) FROM day_totals)::bigint;
$$;

CREATE OR REPLACE FUNCTION public.fn_player_rank_season(p_season uuid, p_subscriber uuid)
RETURNS TABLE (rank bigint, signals bigint, total_players bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH s AS (SELECT starts_on, ends_on FROM public.seasons WHERE id = p_season),
  per_day AS (
    SELECT c.subscriber_id, c.puzzle_date, SUM(c.mw_earned)::bigint AS day_signals
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
$$;

-- rollback:
--   DROP FUNCTION IF EXISTS public.fn_player_rank_season(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.fn_player_rank_daily(date, uuid);
--   DROP FUNCTION IF EXISTS public.fn_leaderboard_season(uuid, int);
--   DROP FUNCTION IF EXISTS public.fn_leaderboard_daily(date, int);
