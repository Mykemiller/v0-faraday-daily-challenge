-- leaderboard_daily: per-subscriber running daily score aggregate (go-live closeout).
-- Keyed by subscriber_id (UUID, stable) + play_date (CT). Upserted on each game
-- completion via /api/score. score = sum of individual game scores (not MW).
-- Used for win-screen "this-game/running-daily-total" display and daily standings.
-- Preferred over handle-keying: UUID key is stable across handle edits (FAR-73).

CREATE TABLE IF NOT EXISTS public.leaderboard_daily (
  subscriber_id   uuid NOT NULL REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  play_date       date NOT NULL,
  score           bigint NOT NULL DEFAULT 0,
  games_played    int    NOT NULL DEFAULT 0,
  streak          int    NOT NULL DEFAULT 0,
  total_time_secs int    NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leaderboard_daily_pk PRIMARY KEY (subscriber_id, play_date)
);

-- Service-role only — no direct client access.
ALTER TABLE public.leaderboard_daily ENABLE ROW LEVEL SECURITY;

-- rollback:
--   DROP TABLE IF EXISTS public.leaderboard_daily;
