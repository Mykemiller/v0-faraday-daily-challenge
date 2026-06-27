-- AgendaWatch National Replication — CC Prompt 6
-- Three new tables (entities / documents / signals) + idf_signals corpus table.
-- Also adds JPS dimension columns and last_scored_at to jurisdictions so the
-- jps-updater can write dimension scores back after signal aggregation.

-- ── JPS dimension columns on jurisdictions ───────────────────────────────────
ALTER TABLE jurisdictions
  ADD COLUMN IF NOT EXISTS dim_regulatory  numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dim_permitting  numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dim_power       numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dim_opposition  numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dim_incentives  numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_scored_at  timestamptz  DEFAULT NULL;

-- ── IDF signals table (classifier training / continuous-learning corpus) ──────
CREATE TABLE IF NOT EXISTS idf_signals (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type            text NOT NULL,
  source_id              uuid NOT NULL,
  raw_text               text NOT NULL,
  signal_type            text,
  jps_dimension          text,
  sentiment_score        numeric(4,3),
  classifier_confidence  numeric(4,3),
  state_fips             text,
  county_fips5           text,
  meeting_date           date,
  entity_name            text,
  ingested_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idf_signals_source_type
  ON idf_signals(source_type);
CREATE INDEX IF NOT EXISTS idx_idf_signals_state_fips
  ON idf_signals(state_fips, county_fips5);
CREATE INDEX IF NOT EXISTS idx_idf_signals_jps_dim
  ON idf_signals(jps_dimension, ingested_at DESC);

-- ── Registry of all government entities being monitored ──────────────────────
CREATE TABLE IF NOT EXISTS agenda_watch_entities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id   uuid REFERENCES jurisdictions(id),
  entity_name       text NOT NULL,
  entity_type       text NOT NULL
    CHECK (entity_type IN (
      'county','city','town','township','school_district',
      'special_district','planning_commission','utility_board'
    )),
  state_fips        text NOT NULL,
  county_fips5      text,
  cms_platform      text,
  base_url          text NOT NULL UNIQUE,
  agenda_url        text,
  minutes_url       text,
  api_client_id     text,
  last_crawled_at   timestamptz,
  last_doc_found_at timestamptz,
  crawl_status      text DEFAULT 'pending'
    CHECK (crawl_status IN ('pending','active','error','paused')),
  error_count       integer DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aw_jurisdiction
  ON agenda_watch_entities(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_aw_state
  ON agenda_watch_entities(state_fips);
CREATE INDEX IF NOT EXISTS idx_aw_cms
  ON agenda_watch_entities(cms_platform);
CREATE INDEX IF NOT EXISTS idx_aw_crawl_status
  ON agenda_watch_entities(crawl_status, last_crawled_at);

-- ── Individual meeting documents (agendas and minutes) ───────────────────────
CREATE TABLE IF NOT EXISTS agenda_watch_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES agenda_watch_entities(id),
  jurisdiction_id   uuid REFERENCES jurisdictions(id),
  doc_type          text NOT NULL
    CHECK (doc_type IN ('agenda','minutes','packet')),
  meeting_date      date,
  meeting_body      text,
  source_url        text NOT NULL,
  raw_text          text,
  page_count        integer,
  word_count        integer,
  extraction_method text,
  crawled_at        timestamptz DEFAULT now(),
  UNIQUE(entity_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_awd_entity
  ON agenda_watch_documents(entity_id, meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_awd_jurisdiction
  ON agenda_watch_documents(jurisdiction_id, meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_awd_date
  ON agenda_watch_documents(meeting_date DESC);

-- ── Extracted signals (JPS dimension scoring + IDF classifier feed) ───────────
CREATE TABLE IF NOT EXISTS agenda_watch_signals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       uuid NOT NULL REFERENCES agenda_watch_documents(id),
  jurisdiction_id   uuid NOT NULL REFERENCES jurisdictions(id),
  signal_type       text NOT NULL
    CHECK (signal_type IN (
      'data_center_vote',
      'zoning_change',
      'moratorium',
      'opposition_testimony',
      'support_testimony',
      'incentive_approval',
      'incentive_denial',
      'utility_discussion',
      'permit_discussion',
      'general_sentiment'
    )),
  signal_text       text NOT NULL,
  sentiment_score   numeric(4,3),
  confidence        numeric(4,3),
  jps_dimension     text
    CHECK (jps_dimension IN (
      'dim_regulatory','dim_permitting','dim_power',
      'dim_opposition','dim_incentives'
    )),
  extracted_at      timestamptz DEFAULT now(),
  idf_ingested      boolean DEFAULT false,
  idf_ingested_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_aws_jurisdiction
  ON agenda_watch_signals(jurisdiction_id, extracted_at DESC);
CREATE INDEX IF NOT EXISTS idx_aws_signal_type
  ON agenda_watch_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_aws_idf
  ON agenda_watch_signals(idf_ingested)
  WHERE idf_ingested = false;
CREATE INDEX IF NOT EXISTS idx_aws_jps_dim
  ON agenda_watch_signals(jps_dimension, jurisdiction_id);
