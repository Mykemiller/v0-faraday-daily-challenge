-- Leaderboard V2 §8: the daily rollover. Idempotent + DST-safe (calendar-date key).
-- Order: snapshot yesterday's ranks -> flip season status -> crown champion +
-- archive final standings -> recompute the §5.6 season-state precompute.
CREATE OR REPLACE FUNCTION public.fn_leaderboard_rollover(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
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
      SELECT c.subscriber_id, c.puzzle_date, SUM(c.mw_earned)::bigint AS day_signals
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
END $$;

-- rollback: DROP FUNCTION IF EXISTS public.fn_leaderboard_rollover(timestamptz);
