-- Schedule the daily ops email (health check + 24h digest) via pg_cron.
-- Invokes the faraday-daily-ops edge function daily at 13:00 UTC.
-- The bearer below is the project's PUBLIC anon key (RLS-governed, also shipped
-- to browsers) — it only satisfies the function's verify_jwt gate; all data
-- access inside the function uses the service role.
select cron.schedule(
  'faraday-daily-ops',
  '0 13 * * *',
  $job$
  select net.http_post(
    url := 'https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/faraday-daily-ops',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljYWRtbW5na2RodnBjc3JjdWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NzYzMDIsImV4cCI6MjA5MTA1MjMwMn0.SOc6LZRpB-GIFe0-pZuW8K4nNIx6Ssl30yFv89HR0DE'
    )
  );
  $job$
);
