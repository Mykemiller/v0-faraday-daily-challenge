-- CC-INGEST-STATE-INCENTIVE-API-1.0 (AUTO-178) — weekly NY refresh.
-- Kicks off the self-chaining drain: the function processes one window then self-invokes the
-- next (fresh worker per hop) until NY's ~65k rows are exhausted. Idempotent (content_hash),
-- so a weekly re-run only writes changed/new disclosures and re-scores INC-01..05.
-- Bearer is the project's PUBLIC anon key (satisfies the apikey gateway; data access inside the
-- function uses the service role). Mirrors schedule_faraday_daily_ops.

select cron.schedule(
  'ingest-state-incentives-ny-weekly',
  '30 8 * * 0',  -- Sundays 08:30 UTC
  $job$
  select net.http_post(
    url := 'https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/ingest-state-incentives',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljYWRtbW5na2RodnBjc3JjdWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NzYzMDIsImV4cCI6MjA5MTA1MjMwMn0.SOc6LZRpB-GIFe0-pZuW8K4nNIx6Ssl30yFv89HR0DE'
    ),
    body := jsonb_build_object('states', array['NY'], 'chain', true, 'offset', 0, 'pages', 8)
  );
  $job$
);
