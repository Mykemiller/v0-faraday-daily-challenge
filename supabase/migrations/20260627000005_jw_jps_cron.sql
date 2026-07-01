-- JW Data Acquisition Automations — Step 2 (FAR-JW-002)
-- Weekly JPS confidence recalculation via pg_cron.
--
-- Fires every Sunday at 02:00 UTC, after the Saturday DC registry ingest.
-- Recalculates confidence_score from dimension coverage + recency + diversity,
-- then maps to confidence_tier.  Touches only is_active = true jurisdictions.
--
-- Confidence formula:
--   Coverage  (40%) — fraction of 5 JPS dimensions that have a non-null score
--   Recency   (35%) — full credit when last_scored_date > 30 days ago
--   Diversity (25%) — step function on how many dimensions are populated
--
-- Idempotent: unschedule any prior job of the same name first.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'jw-weekly-jps-refresh') then
    perform cron.unschedule('jw-weekly-jps-refresh');
  end if;
end $$;

select cron.schedule(
  'jw-weekly-jps-refresh',
  '0 2 * * 0',
  $$
  UPDATE jurisdictions SET
    confidence_score = CASE
      WHEN last_scored_date IS NULL THEN 5.0
      WHEN last_scored_date > NOW() - INTERVAL '30 days' THEN
        -- Coverage (40%): fraction of 5 JPS dimensions populated
        (
          (COALESCE((
            CASE WHEN dim_regulatory  IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN dim_permitting  IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN dim_power       IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN dim_opposition  IS NOT NULL THEN 1 ELSE 0 END +
            CASE WHEN dim_incentives  IS NOT NULL THEN 1 ELSE 0 END
          ), 0)::numeric / 5) * 40
        )
        -- Recency (35%): full credit for recently-scored jurisdictions
        + (100 * 0.35)
        -- Diversity (25%): step function on dimension count
        + (CASE
             WHEN (CASE WHEN dim_regulatory  IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN dim_permitting  IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN dim_power       IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN dim_opposition  IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN dim_incentives  IS NOT NULL THEN 1 ELSE 0 END) >= 4 THEN 100
             WHEN (CASE WHEN dim_regulatory  IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN dim_permitting  IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN dim_power       IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN dim_opposition  IS NOT NULL THEN 1 ELSE 0 END +
                   CASE WHEN dim_incentives  IS NOT NULL THEN 1 ELSE 0 END) >= 2 THEN 60
             ELSE 30
           END * 0.25)
      ELSE 20.0
    END,
    confidence_tier = CASE
      WHEN confidence_score >= 80 THEN 'verified'
      WHEN confidence_score >= 60 THEN 'estimated'
      WHEN confidence_score >= 40 THEN 'inferred'
      ELSE 'unscored'
    END,
    confidence_updated_at = NOW()
  WHERE is_active = true;
  $$
);
