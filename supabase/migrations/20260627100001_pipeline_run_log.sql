-- Pipeline execution log and health alerts for the CC-10 automation layer.
-- Tracks every cron / manual run and surfaces stale-pipeline alerts.

CREATE TABLE IF NOT EXISTS pipeline_run_log (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_name       text        NOT NULL,
  trigger_type        text        NOT NULL
    CHECK (trigger_type IN ('cron', 'manual', 'webhook')),
  status              text        NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  duration_ms         integer,
  records_processed   integer     DEFAULT 0,
  records_failed      integer     DEFAULT 0,
  error_message       text,
  metadata            jsonb
);

CREATE INDEX IF NOT EXISTS idx_pipeline_log_name
  ON pipeline_run_log(pipeline_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_log_status
  ON pipeline_run_log(status, started_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_health_alerts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type    text        NOT NULL,
  pipeline_name text,
  message       text        NOT NULL,
  severity      text        NOT NULL
    CHECK (severity IN ('critical', 'warning', 'info')),
  resolved      boolean     DEFAULT false,
  triggered_at  timestamptz DEFAULT now(),
  resolved_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_health_alerts_unresolved
  ON pipeline_health_alerts(resolved, triggered_at DESC)
  WHERE resolved = false;

-- IDF signals table — structured signals from all four JW data feeds.
-- Source feeds: agenda_watch, puc, data365, eia.
-- Dedup key: (source_type, signal_key).
CREATE TABLE IF NOT EXISTS idf_signals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type     text        NOT NULL
    CHECK (source_type IN ('agenda_watch', 'puc', 'data365', 'eia')),
  jurisdiction_id uuid        REFERENCES jurisdictions(id) ON DELETE SET NULL,
  signal_key      text        NOT NULL,
  signal_type     text,
  title           text,
  content         text,
  metadata        jsonb,
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, signal_key)
);

CREATE INDEX IF NOT EXISTS idx_idf_signals_source
  ON idf_signals(source_type, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_idf_signals_jurisdiction
  ON idf_signals(jurisdiction_id, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_idf_signals_ingested
  ON idf_signals(ingested_at DESC);
