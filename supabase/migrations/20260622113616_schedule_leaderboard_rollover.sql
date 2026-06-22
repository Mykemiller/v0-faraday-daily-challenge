-- Leaderboard V2 §8: run the rollover at midnight America/Chicago. That instant is
-- 05:00 UTC (CDT) or 06:00 UTC (CST); schedule both and rely on idempotency so it
-- fires exactly once per real midnight regardless of DST.
SELECT cron.schedule('leaderboard-rollover-0500utc', '0 5 * * *', $$SELECT public.fn_leaderboard_rollover();$$);
SELECT cron.schedule('leaderboard-rollover-0600utc', '0 6 * * *', $$SELECT public.fn_leaderboard_rollover();$$);

-- rollback:
--   SELECT cron.unschedule('leaderboard-rollover-0500utc');
--   SELECT cron.unschedule('leaderboard-rollover-0600utc');
