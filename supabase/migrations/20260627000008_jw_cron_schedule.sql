-- JW Data Acquisition Automations — Steps 8 + 9 (FAR-JW-008/009)
-- Full cron schedule:
--   jw-daily-crawl-health-check  0 6 * * *   daily 06:00 UTC
--   jw-weekly-jps-refresh        0 2 * * 0   Sunday 02:00 UTC  (migration 000005)
--   jw-weekly-jds-normalize      0 3 * * 0   Sunday 03:00 UTC  (migration 000006)
--   jw-airtable-sync             0 3 * * 1   Monday 03:00 UTC
--   jw-dc-registry-ingest        0 0 * * 6   Saturday 00:00 UTC
--
-- The JPS and JDS jobs are registered in their own migrations (000005, 000006).
-- This migration adds the health-check, airtable-sync, and dc-registry-ingest.
--
-- jw-airtable-sync and jw-dc-registry-ingest call the Vercel API via
-- net.http_post.  Auth uses JW_CRON_TOKEN, which must be set as an env var in
-- Vercel and matches the value checked in the Next.js cron routes.

-- ── daily crawl health check ─────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'jw-daily-crawl-health-check') then
    perform cron.unschedule('jw-daily-crawl-health-check');
  end if;
end $$;

select cron.schedule(
  'jw-daily-crawl-health-check',
  '0 6 * * *',
  $$
  DO $$
  DECLARE
    artifact_count  INT;
    jds_stale_count INT;
  BEGIN
    -- Low artifact volume: fewer than 50 in the last 24 hours
    SELECT COUNT(*) INTO artifact_count
    FROM artifacts
    WHERE created_at > NOW() - INTERVAL '24 hours';

    IF artifact_count < 50 THEN
      INSERT INTO crawl_health_alerts (alert_type, message, triggered_at)
      VALUES (
        'low_artifacts',
        'Fewer than 50 artifacts ingested in last 24 hours: ' || artifact_count,
        NOW()
      );
    END IF;

    -- Stale JDS: no jds_updated_at in > 8 days means the weekly refresh missed
    SELECT COUNT(*) INTO jds_stale_count
    FROM jurisdictions
    WHERE is_active = true
      AND jds_updated_at < NOW() - INTERVAL '8 days';

    IF jds_stale_count > 0 THEN
      INSERT INTO crawl_health_alerts (alert_type, message, triggered_at)
      VALUES (
        'stale_jds',
        jds_stale_count || ' jurisdictions have stale JDS data (>8 days)',
        NOW()
      );
    END IF;
  END $$;
  $$
);

-- ── airtable → supabase sync ─────────────────────────────────────────────────
-- Calls the Next.js cron route /api/cron/jw-airtable-sync on the Vercel
-- deployment.  Token: JW_CRON_TOKEN (set in Vercel env).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'jw-airtable-sync') then
    perform cron.unschedule('jw-airtable-sync');
  end if;
end $$;

select cron.schedule(
  'jw-airtable-sync',
  '0 3 * * 1',
  $$
  select net.http_post(
    url     := 'https://faraday-intelligence.ai/api/cron/jw-airtable-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.jw_cron_token', true)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- ── DC registry ingest ────────────────────────────────────────────────────────
-- Calls the Next.js cron route /api/cron/jw-dc-registry-ingest.
-- Runs Saturday midnight so that Sunday's JDS normalization sees fresh data.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'jw-dc-registry-ingest') then
    perform cron.unschedule('jw-dc-registry-ingest');
  end if;
end $$;

select cron.schedule(
  'jw-dc-registry-ingest',
  '0 0 * * 6',
  $$
  select net.http_post(
    url     := 'https://faraday-intelligence.ai/api/cron/jw-dc-registry-ingest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.jw_cron_token', true)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
