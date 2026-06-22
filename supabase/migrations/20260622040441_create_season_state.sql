-- Leaderboard V2 §5.6 (review #4): precompute for the season drop-2 cushion.
-- faraday-daily-ops recomputes completed_signals/dropped_signals over COMPLETED
-- days once per rollover (Phase 4). Runtime season total =
--   completed_signals - dropped_signals + today_live_signals.
-- fn_leaderboard_season remains the audit oracle / backfill (asserted equal in tests).
CREATE TABLE IF NOT EXISTS public.dc_season_state (
  season_id uuid REFERENCES public.seasons(id) ON DELETE CASCADE,
  subscriber_id uuid REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  completed_signals bigint NOT NULL DEFAULT 0,  -- sum over completed days
  dropped_signals  bigint NOT NULL DEFAULT 0,   -- sum of the 2 lowest completed days
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, subscriber_id)
);
ALTER TABLE public.dc_season_state ENABLE ROW LEVEL SECURITY;

-- rollback:
--   DROP TABLE IF EXISTS public.dc_season_state;
