-- JW Inference Engine weekly cron — fires Sunday 04:00 UTC.
-- Runs after JPS refresh (02:00 UTC) and JDS normalize (03:00 UTC).
-- Requires pg_net extension and PIPELINE_SECRET set in app.pipeline_secret.
-- Add PIPELINE_SECRET to Vercel env vars before enabling.

SELECT cron.schedule(
  'jw-weekly-inference-engine',
  '0 4 * * 0',
  $$
  SELECT net.http_post(
    url     := 'https://faraday-intelligence.ai/api/pipelines/inference',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.pipeline_secret')
               ),
    body    := '{"trigger":"weekly_cron"}'::jsonb
  );
  $$
);
