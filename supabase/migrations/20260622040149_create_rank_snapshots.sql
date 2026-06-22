-- Leaderboard V2 §5.3: daily rank snapshots drive the movement arrows
-- (movement = previous.rank - current.rank; positive = up; — when no prior).
CREATE TABLE IF NOT EXISTS public.dc_rank_snapshots (
  snapshot_day date NOT NULL,
  scope text NOT NULL,                 -- 'global' | team_id::text
  period text NOT NULL,                -- 'daily' | 'season'
  subscriber_id uuid REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  rank int NOT NULL,
  PRIMARY KEY (snapshot_day, scope, period, subscriber_id)
);

ALTER TABLE public.dc_rank_snapshots ENABLE ROW LEVEL SECURITY;

-- Period-scoped ranking reads dc_completions by date and by subscriber.
CREATE INDEX IF NOT EXISTS dc_completions_date_sub_idx ON public.dc_completions (puzzle_date, subscriber_id);
CREATE INDEX IF NOT EXISTS dc_completions_sub_date_idx ON public.dc_completions (subscriber_id, puzzle_date);

-- rollback:
--   DROP INDEX IF EXISTS public.dc_completions_sub_date_idx;
--   DROP INDEX IF EXISTS public.dc_completions_date_sub_idx;
--   DROP TABLE IF EXISTS public.dc_rank_snapshots;
