-- FAR-253 / Stream A — schedule the post-crawl zero-artifact health-check.
--
-- Fires daily at 08:00 UTC, one hour after `faraday-crawl-daily` (07:00 UTC).
-- The edge fn `faraday-crawl-healthcheck` alerts Myke (Resend email) if the
-- artifacts table received 0 new rows in the trailing 2h window; otherwise it is
-- a silent no-op.
--
-- Auth: the function is verify_jwt=false and accepts the internal CRON_TOKEN
-- (same Bearer used by faraday-crawl-daily / enrich-artifacts-drain). Using the
-- CRON_TOKEN — not a JWT — avoids the gateway 401 that bit faraday-crawl v2.
--
-- Idempotent: unschedule any prior job of the same name before re-scheduling so
-- re-applying this migration never stacks duplicate cron rows.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'faraday-crawl-healthcheck-0800utc') then
    perform cron.unschedule('faraday-crawl-healthcheck-0800utc');
  end if;
end $$;

select cron.schedule(
  'faraday-crawl-healthcheck-0800utc',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/faraday-crawl-healthcheck',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer fcron_9mK3pX7qR2vN8wYz4tB6sL1dH5jG0aE'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
