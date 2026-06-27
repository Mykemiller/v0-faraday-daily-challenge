-- JW Data Acquisition Automations — Step 1 (FAR-JW-001)
-- crawl_errors table, crawl_health_alerts table, and JPS dimension columns
-- on jurisdictions needed by the confidence recalculation cron (STEP 2).

-- ── crawl_errors ─────────────────────────────────────────────────────────────
-- Structured parse-failure log for all crawl pipelines.  Complements the
-- automation_health_log (which is keyed to an AUTO-ID); crawl_errors captures
-- raw payload excerpts that could not be attributed to a known auto_id.
CREATE TABLE IF NOT EXISTS crawl_errors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id  text,
  raw_payload    text,
  error_message  text,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crawl_errors_automation
  ON crawl_errors(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crawl_errors_created
  ON crawl_errors(created_at DESC);

-- ── crawl_health_alerts ───────────────────────────────────────────────────────
-- Written by the daily pg_cron health check (STEP 8) when artifact volume or
-- JDS staleness thresholds are breached.  Distinct from the Resend-email-based
-- faraday-crawl-healthcheck (AUTO-178) which handles zero-artifact detection.
CREATE TABLE IF NOT EXISTS crawl_health_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type   text NOT NULL,
  message      text NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_crawl_health_alerts_type
  ON crawl_health_alerts(alert_type, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_crawl_health_alerts_unresolved
  ON crawl_health_alerts(triggered_at DESC) WHERE resolved_at IS NULL;

-- ── JPS dimension columns on jurisdictions ───────────────────────────────────
-- Five dimension scores (0.0–5.0 scale) used in the JPS confidence formula.
-- dim_opposition is also updated by the opposition signal pipeline.
ALTER TABLE jurisdictions
  ADD COLUMN IF NOT EXISTS dim_regulatory  numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dim_permitting  numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dim_power       numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dim_opposition  numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dim_incentives  numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_active       boolean      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS geo_key         text         DEFAULT NULL;

-- geo_key mirrors iso_code for pipelines that use FIPS/CBSA/ISO-3 identifiers.
-- Populated on insert/upsert by the Airtable sync and seeding scripts.
CREATE INDEX IF NOT EXISTS idx_jurisdictions_geo_key
  ON jurisdictions(geo_key) WHERE geo_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jurisdictions_is_active
  ON jurisdictions(is_active) WHERE is_active = true;
