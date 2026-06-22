-- Leaderboard V2 §5.5 (review #1): additive read-through cache with live fallback.
-- Correctness is independent of the cache — wiping it changes performance, not
-- results (see fn_leaderboard_daily_cached, which mirrors the oracle's tie-break).
CREATE TABLE IF NOT EXISTS public.dc_period_aggregates (
  subscriber_id uuid REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  period text NOT NULL,            -- 'daily' (season ranking uses the oracle / §5.6 precompute, not a naive sum)
  period_key text NOT NULL,        -- daily: 'YYYY-MM-DD' (Central)
  signals bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, period, period_key)
);
ALTER TABLE public.dc_period_aggregates ENABLE ROW LEVEL SECURITY;

-- AFTER INSERT on dc_completions: add mw_earned to the player's daily bucket.
-- Season buckets are intentionally NOT maintained here: the season ranking drops
-- the 2 lowest days, which a running sum cannot represent (that lives in §5.6
-- dc_season_state + the fn_leaderboard_season oracle).
CREATE OR REPLACE FUNCTION public.fn_dc_completion_cache_upsert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.dc_period_aggregates (subscriber_id, period, period_key, signals, updated_at)
  VALUES (NEW.subscriber_id, 'daily', to_char(NEW.puzzle_date, 'YYYY-MM-DD'), NEW.mw_earned, now())
  ON CONFLICT (subscriber_id, period, period_key)
  DO UPDATE SET signals = public.dc_period_aggregates.signals + EXCLUDED.signals, updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dc_completion_cache ON public.dc_completions;
CREATE TRIGGER trg_dc_completion_cache
  AFTER INSERT ON public.dc_completions
  FOR EACH ROW EXECUTE FUNCTION public.fn_dc_completion_cache_upsert();

-- Cached daily board — identical shape + tie-break to fn_leaderboard_daily, but
-- sourced from the pre-aggregated cache (no GROUP BY over dc_completions).
CREATE OR REPLACE FUNCTION public.fn_leaderboard_daily_cached(p_day date, p_limit int DEFAULT 50)
RETURNS TABLE (rank bigint, subscriber_id uuid, signals bigint, play_streak int, full_set_streak int)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT RANK() OVER (ORDER BY a.signals DESC, s.full_set_streak DESC, s.play_streak DESC),
         a.subscriber_id, a.signals, s.play_streak, s.full_set_streak
  FROM public.dc_period_aggregates a
  JOIN public.dc_subscribers s ON s.id = a.subscriber_id
  WHERE a.period = 'daily' AND a.period_key = to_char(p_day, 'YYYY-MM-DD')
  ORDER BY a.signals DESC, s.full_set_streak DESC, s.play_streak DESC
  LIMIT p_limit;
$$;

-- Rebuild a day's daily cache from the oracle source (dc_completions). Used by
-- the read path to backfill on a cache miss; idempotent.
CREATE OR REPLACE FUNCTION public.fn_backfill_daily_cache(p_day date) RETURNS void
LANGUAGE sql VOLATILE
SET search_path = public
AS $$
  INSERT INTO public.dc_period_aggregates (subscriber_id, period, period_key, signals, updated_at)
  SELECT c.subscriber_id, 'daily', to_char(p_day, 'YYYY-MM-DD'), SUM(c.mw_earned)::bigint, now()
  FROM public.dc_completions c WHERE c.puzzle_date = p_day GROUP BY c.subscriber_id
  ON CONFLICT (subscriber_id, period, period_key)
  DO UPDATE SET signals = EXCLUDED.signals, updated_at = now();
$$;

-- rollback:
--   DROP FUNCTION IF EXISTS public.fn_backfill_daily_cache(date);
--   DROP FUNCTION IF EXISTS public.fn_leaderboard_daily_cached(date, int);
--   DROP TRIGGER IF EXISTS trg_dc_completion_cache ON public.dc_completions;
--   DROP FUNCTION IF EXISTS public.fn_dc_completion_cache_upsert();
--   DROP TABLE IF EXISTS public.dc_period_aggregates;
