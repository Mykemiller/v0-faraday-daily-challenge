-- CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 (AUTO-191 proposed) — cadence scheduling.
-- ============================================================================================
-- DELIVERED UN-APPLIED. Do NOT run until Myke signs off (promotion is a separate gate) AND the
-- edge function `ingest-tokenomics` has been deployed. Bearer is the project's PUBLIC anon key
-- (satisfies the apikey gateway; data access inside the function uses the service role). Mirrors
-- schedule_state_incentives_ny_weekly / schedule_faraday_daily_ops.
-- ============================================================================================
--
-- CADENCE (per Tokenomics Scoreboard groups):
--   * FUSION FIRST + daily live pull — group A commodity feed (aipricing.guru), group B GPU
--     on-demand + reserved/spot (Azure Retail Prices, keyless), group C futures STATUS, and the
--     region-keyed grid fusion. Idempotent (content_hash) — a re-run only writes changed readings.
--     Reserved/committed prices arrive in the same daily Azure call (the API returns Reservation
--     rows), so a separate weekly job is unnecessary; the daily run subsumes it.
--   * MANUAL-CAPTURE sources (403-prone frontier vendor pages, licensed third-party indices,
--     quarterly/yearly demand forecasts, hyperscaler disclosures) are NOT scheduled here — they are
--     POSTed to the function with a {captures:[...]} body by the desktop agent / operator on their
--     own cadence (near-daily for vendors; publisher cadence for indices; quarterly for demand).
--     Every such capture still writes an automation_health_log row.

select cron.schedule(
  'ingest-tokenomics-daily',
  '15 9 * * *',  -- 09:15 UTC daily
  $job$
  select net.http_post(
    url := 'https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/ingest-tokenomics',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljYWRtbW5na2RodnBjc3JjdWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NzYzMDIsImV4cCI6MjA5MTA1MjMwMn0.SOc6LZRpB-GIFe0-pZuW8K4nNIx6Ssl30yFv89HR0DE'
    ),
    body := jsonb_build_object('run_fusion', true)
  );
  $job$
);

-- To pause/remove after applying:  select cron.unschedule('ingest-tokenomics-daily');
