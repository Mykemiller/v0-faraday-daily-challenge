-- dc_daily_attempts: one-attempt-per-day enforcement gate (go-live closeout, FAR-187).
-- Locks on completion (win or lose). Starting then abandoning does NOT insert here —
-- the game-switcher confirm-before-discard covers abandonment. Second attempt for the
-- same (subscriber, game_type, play_date) returns the existing result idempotently.
-- play_date is in America/Chicago (CT), matching the AUTO-128 rotation boundary.

CREATE TABLE IF NOT EXISTS public.dc_daily_attempts (
  id            bigserial PRIMARY KEY,
  subscriber_id uuid NOT NULL REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  game_type     text NOT NULL,
  play_date     date NOT NULL,  -- CT calendar date
  result        text NOT NULL CHECK (result IN ('win', 'lose')),
  score         int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dc_daily_attempts_unique UNIQUE (subscriber_id, game_type, play_date)
);

-- Service-role only — no client reads or writes.
ALTER TABLE public.dc_daily_attempts ENABLE ROW LEVEL SECURITY;

-- rollback:
--   DROP TABLE IF EXISTS public.dc_daily_attempts;
