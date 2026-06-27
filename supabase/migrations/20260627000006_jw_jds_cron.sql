-- JW Data Acquisition Automations — Step 3 (FAR-JW-003)
-- Weekly JDS peer-normalization refresh via pg_cron.
--
-- Fires every Sunday at 03:00 UTC (one hour after jw-weekly-jps-refresh).
-- Because JDS uses peer-relative normalization a county's score is relative to
-- all other counties — this batch job must re-normalize the entire peer group
-- whenever any row's raw JDS changes.
--
-- Normalization formula: jds_normalized = (jds_raw / peer_group_max) × 10
-- Tier map: ≥8.0=Saturated, ≥6.0=Dense, ≥4.0=Active, ≥2.0=Emerging, else Greenfield
--
-- Steps:
--   A. Compute per-peer-group max from the most recent jds_scores record per jurisdiction
--   B. Normalize each jurisdiction's raw score against its peer-group max
--   C. Update jds_normalized + jds_tier on the latest jds_scores rows
--   D. Denormalize back to jurisdictions table for fast choropleth reads
--
-- Idempotent: unschedule any prior job of the same name first.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'jw-weekly-jds-normalize') then
    perform cron.unschedule('jw-weekly-jds-normalize');
  end if;
end $$;

select cron.schedule(
  'jw-weekly-jds-normalize',
  '0 3 * * 0',
  $$
  -- Step A: latest jds_scores record per jurisdiction + peer group max
  WITH latest_scores AS (
    SELECT DISTINCT ON (jurisdiction_id)
      jurisdiction_id, jds_raw, jds_prior, peer_group, scored_at,
      l1_facility_count, l2_facility_count, l3_facility_count, l4_parcel_count,
      l1_mw_total, l2_mw_total, l3_mw_total
    FROM jds_scores
    ORDER BY jurisdiction_id, scored_at DESC
  ),
  peer_maxes AS (
    SELECT peer_group, MAX(jds_raw) AS max_raw
    FROM latest_scores
    GROUP BY peer_group
  ),
  -- Step B: peer-normalized score
  normalized AS (
    SELECT
      ls.jurisdiction_id,
      ls.jds_raw,
      ls.jds_prior,
      ls.peer_group,
      ls.scored_at,
      CASE
        WHEN pm.max_raw = 0 OR pm.max_raw IS NULL THEN 0
        ELSE ROUND((ls.jds_raw / pm.max_raw * 10)::numeric, 2)
      END AS jds_normalized
    FROM latest_scores ls
    JOIN peer_maxes pm ON pm.peer_group = ls.peer_group
  )
  -- Step C: update jds_scores
  UPDATE jds_scores js SET
    jds_normalized = n.jds_normalized,
    jds_tier = CASE
      WHEN n.jds_normalized >= 8.0 THEN 'Saturated'
      WHEN n.jds_normalized >= 6.0 THEN 'Dense'
      WHEN n.jds_normalized >= 4.0 THEN 'Active'
      WHEN n.jds_normalized >= 2.0 THEN 'Emerging'
      ELSE 'Greenfield'
    END
  FROM normalized n
  WHERE js.jurisdiction_id = n.jurisdiction_id
    AND js.scored_at = (
      SELECT MAX(scored_at) FROM jds_scores
      WHERE jurisdiction_id = js.jurisdiction_id
    );

  -- Step D: denormalize to jurisdictions for fast reads
  UPDATE jurisdictions j SET
    jds_raw        = s.jds_raw,
    jds_normalized = s.jds_normalized,
    jds_tier       = s.jds_tier,
    jds_delta      = ROUND((s.jds_normalized - COALESCE(s.jds_prior, s.jds_normalized))::numeric, 2),
    jds_updated_at = s.scored_at
  FROM (
    SELECT DISTINCT ON (jurisdiction_id)
      jurisdiction_id, jds_raw, jds_normalized, jds_tier, jds_prior, scored_at
    FROM jds_scores
    ORDER BY jurisdiction_id, scored_at DESC
  ) s
  WHERE j.id = s.jurisdiction_id
    AND j.is_active = true;
  $$
);
