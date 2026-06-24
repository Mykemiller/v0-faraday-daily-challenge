-- AUTO-050: register_daily_snapshot — daily state snapshot for faraday-todo-daily.
-- One row per CT calendar-day. Stores Jira + GitHub state so we can diff vs
-- yesterday and track whether the digest email was sent.
--
-- pg_cron jobs: fire at 10:00 UTC (= 05:00 CDT) and 11:00 UTC (= 05:00 CST)
-- so 5 AM CT is hit regardless of Daylight Saving. The function itself guards
-- on the America/Chicago hour, so the second fire is a cheap idempotent no-op.

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.register_daily_snapshot (
  id              BIGSERIAL PRIMARY KEY,
  snapshot_date   DATE        NOT NULL,
  jira_open       JSONB       NOT NULL DEFAULT '[]',
  jira_transitions JSONB      NOT NULL DEFAULT '[]',
  github_commits  JSONB       NOT NULL DEFAULT '[]',
  github_prs      JSONB       NOT NULL DEFAULT '[]',
  email_sent      BOOLEAN     NOT NULL DEFAULT false,
  email_sent_at   TIMESTAMPTZ,
  email_error     TEXT,
  run_started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT register_daily_snapshot_date_unique UNIQUE (snapshot_date)
);

-- RLS: service role only (cron job + server-side reads)
ALTER TABLE public.register_daily_snapshot ENABLE ROW LEVEL SECURITY;

-- No public-facing policies — the function runs with service role key.
-- Explicitly deny anon/authenticated to make intent clear.
CREATE POLICY "no_anon_access" ON public.register_daily_snapshot
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false);

COMMENT ON TABLE public.register_daily_snapshot IS
  'AUTO-050: daily snapshot of Jira + GitHub state for the faraday-todo-daily digest. One row per CT calendar-day. Unique on snapshot_date; email_sent=true gates idempotency.';

-- ─── pg_cron jobs ─────────────────────────────────────────────────────────────
-- 10:00 UTC = 05:00 America/Chicago during CDT (UTC−5, Mar–Nov)
-- 11:00 UTC = 05:00 America/Chicago during CST (UTC−6, Nov–Mar)
-- Both jobs fire every day; the function's DST guard ensures exactly one proceeds.

-- pg_cron jobs were applied directly to ycadmmngkdhvpcsrcuaq via the Supabase MCP tool
-- using the shared CRON_SECRET value (set as a Supabase secret, not committed).
-- Reproduced here for documentation; substitute <CRON_SECRET> before running on a fresh DB:
--
-- SELECT cron.schedule('faraday-todo-daily-1000utc', '0 10 * * *', $$
--   SELECT net.http_post(
--     url              := 'https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/faraday-todo-daily',
--     headers          := jsonb_build_object('Content-Type','application/json',
--                          'Authorization','Bearer <CRON_SECRET>'),
--     body := '{}'::jsonb, timeout_milliseconds := 120000);
-- $$);
-- SELECT cron.schedule('faraday-todo-daily-1100utc', '0 11 * * *', $$
--   SELECT net.http_post(
--     url              := 'https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/faraday-todo-daily',
--     headers          := jsonb_build_object('Content-Type','application/json',
--                          'Authorization','Bearer <CRON_SECRET>'),
--     body := '{}'::jsonb, timeout_milliseconds := 120000);
-- $$);

-- rollback:
--   DROP TABLE IF EXISTS public.register_daily_snapshot;
--   SELECT cron.unschedule('faraday-todo-daily-1000utc');
--   SELECT cron.unschedule('faraday-todo-daily-1100utc');
