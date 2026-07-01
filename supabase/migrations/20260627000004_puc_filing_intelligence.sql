-- CC-09 / AUTO-177 — PUC Filing Intelligence
-- Creates puc_dockets, puc_filings, puc_signals, idf_signals tables
-- and extends source_type_enum with 'state_puc_filing'.

ALTER TYPE source_type_enum ADD VALUE IF NOT EXISTS 'state_puc_filing';

-- ── puc_dockets ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS puc_dockets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_fips      text NOT NULL,
  docket_number   text NOT NULL,
  docket_title    text,
  docket_type     text
    CHECK (docket_type IN (
      'rate_case','irp','interconnection','large_load_tariff',
      'environmental','merger_acquisition','renewable_project',
      'transmission','other'
    )),
  utility_name    text,
  filed_date      date,
  status          text DEFAULT 'open'
    CHECK (status IN ('open','closed','suspended')),
  dc_relevant     boolean DEFAULT false,
  jurisdiction_ids uuid[],
  last_updated    date,
  source_url      text NOT NULL,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(state_fips, docket_number)
);

CREATE INDEX IF NOT EXISTS idx_puc_state ON puc_dockets(state_fips, filed_date DESC);
CREATE INDEX IF NOT EXISTS idx_puc_type  ON puc_dockets(docket_type, state_fips);
CREATE INDEX IF NOT EXISTS idx_puc_dc    ON puc_dockets(dc_relevant, state_fips);

ALTER TABLE puc_dockets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON puc_dockets
  USING (auth.role() = 'service_role');

-- ── puc_filings ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS puc_filings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  docket_id       uuid NOT NULL REFERENCES puc_dockets(id),
  state_fips      text NOT NULL,
  filing_type     text,
  filing_party    text,
  filed_date      date,
  doc_title       text,
  source_url      text NOT NULL,
  raw_text        text,
  word_count      integer,
  dc_relevant     boolean DEFAULT false,
  crawled_at      timestamptz DEFAULT now(),
  UNIQUE(docket_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_puc_filings_docket
  ON puc_filings(docket_id, filed_date DESC);
CREATE INDEX IF NOT EXISTS idx_puc_filings_dc
  ON puc_filings(dc_relevant, filed_date DESC);

ALTER TABLE puc_filings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON puc_filings
  USING (auth.role() = 'service_role');

-- ── puc_signals ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS puc_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id       uuid NOT NULL REFERENCES puc_filings(id),
  state_fips      text NOT NULL,
  county_fips5    text,
  signal_type     text NOT NULL
    CHECK (signal_type IN (
      'capacity_constraint','capacity_expansion','rate_increase',
      'rate_decrease','dc_tariff','large_load_approval','irp_favorable',
      'irp_unfavorable','renewable_commitment','moratorium_power'
    )),
  signal_text     text NOT NULL,
  jps_dimension   text
    CHECK (jps_dimension IN ('dim_power','dim_incentives','dim_regulatory')),
  sentiment_score numeric(4,3),
  magnitude_mw    numeric(10,1),
  idf_ingested    boolean DEFAULT false,
  extracted_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_puc_signals_state
  ON puc_signals(state_fips, extracted_at DESC);
CREATE INDEX IF NOT EXISTS idx_puc_signals_idf
  ON puc_signals(idf_ingested) WHERE idf_ingested = false;

ALTER TABLE puc_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON puc_signals
  USING (auth.role() = 'service_role');

-- ── idf_signals ──────────────────────────────────────────────────────────────
-- Cross-source regulatory signal aggregation (IDF integration layer).
-- source_type is text so new source types don't require enum migrations.
CREATE TABLE IF NOT EXISTS idf_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type     text NOT NULL,
  source_id       uuid,
  raw_text        text NOT NULL,
  signal_type     text,
  jps_dimension   text
    CHECK (jps_dimension IN (
      'dim_power','dim_incentives','dim_regulatory',
      'dim_permitting','dim_opposition'
    )),
  sentiment_score numeric(4,3),
  state_fips      text,
  county_fips5    text,
  metadata        jsonb,
  ingested_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idf_signals_source_type
  ON idf_signals(source_type, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_idf_signals_state
  ON idf_signals(state_fips, jps_dimension);
CREATE INDEX IF NOT EXISTS idx_idf_signals_not_ingested
  ON idf_signals(source_type) WHERE source_id IS NULL;

ALTER TABLE idf_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON idf_signals
  USING (auth.role() = 'service_role');
