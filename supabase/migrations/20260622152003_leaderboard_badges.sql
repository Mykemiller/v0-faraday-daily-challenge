-- Leaderboard V2 follow-up (FAR-70): streak + perfect-day badges.
CREATE TABLE IF NOT EXISTS public.dc_badges (
  subscriber_id uuid REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  badge_key text NOT NULL,              -- week_warrior | fortnight | signal_constant | perfect_day
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, badge_key)  -- earned once, idempotent
);
ALTER TABLE public.dc_badges ENABLE ROW LEVEL SECURITY;

-- Award badges idempotently. Streak badges from play_streak; perfect_day when the
-- player completes the full Core-4 set in a day (complete-puzzle's fullSetJustCompleted).
CREATE OR REPLACE FUNCTION public.fn_assign_badges(p_subscriber uuid, p_play_streak int, p_full_set boolean)
RETURNS void
LANGUAGE plpgsql VOLATILE
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.dc_badges (subscriber_id, badge_key)
  SELECT p_subscriber, b.k FROM (VALUES ('week_warrior', 7), ('fortnight', 14), ('signal_constant', 30)) AS b(k, t)
  WHERE p_play_streak >= b.t
  ON CONFLICT (subscriber_id, badge_key) DO NOTHING;

  IF p_full_set THEN
    INSERT INTO public.dc_badges (subscriber_id, badge_key) VALUES (p_subscriber, 'perfect_day')
    ON CONFLICT (subscriber_id, badge_key) DO NOTHING;
  END IF;
END $$;

-- Backfill from existing streak state so the live board shows badges immediately.
INSERT INTO public.dc_badges (subscriber_id, badge_key)
SELECT id, 'week_warrior'    FROM public.dc_subscribers WHERE play_streak >= 7
UNION ALL SELECT id, 'fortnight'       FROM public.dc_subscribers WHERE play_streak >= 14
UNION ALL SELECT id, 'signal_constant' FROM public.dc_subscribers WHERE play_streak >= 30
UNION ALL SELECT id, 'perfect_day'     FROM public.dc_subscribers WHERE full_set_streak > 0
ON CONFLICT (subscriber_id, badge_key) DO NOTHING;

-- rollback:
--   DROP FUNCTION IF EXISTS public.fn_assign_badges(uuid, int, boolean);
--   DROP TABLE IF EXISTS public.dc_badges;
