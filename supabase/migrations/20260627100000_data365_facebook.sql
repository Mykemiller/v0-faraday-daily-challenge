-- Data365 Facebook Public Group Intelligence
-- Populates dim_opposition scores for counties via social sentiment monitoring.
-- IDF integration: signals tagged source_type='data365_facebook' in idf_signals.

-- ── jurisdictions: add community opposition dimension ─────────────────────────
ALTER TABLE jurisdictions
  ADD COLUMN IF NOT EXISTS dim_opposition numeric(4,2) DEFAULT NULL;

COMMENT ON COLUMN jurisdictions.dim_opposition IS
  'Community opposition score 0–5 derived from Data365 Facebook signals. '
  '0 = strong support, 2.5 = neutral, 5 = strong opposition. NULL = unscored.';

CREATE INDEX IF NOT EXISTS idx_jurisdictions_dim_opposition
  ON jurisdictions(dim_opposition DESC NULLS LAST);

-- ── idf_signals ───────────────────────────────────────────────────────────────
-- Aggregated IDF social signals from all source types (starting with data365_facebook).
CREATE TABLE IF NOT EXISTS idf_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type     text NOT NULL,          -- e.g. 'data365_facebook'
  source_id       uuid,                   -- FK to source record (e.g. data365_opposition_signals.id)
  raw_text        text,
  signal_type     text NOT NULL
    CHECK (signal_type IN ('community_opposition','community_support','community_neutral')),
  jps_dimension   text NOT NULL,          -- e.g. 'dim_opposition'
  sentiment_score numeric(4,3),           -- -1.0 to +1.0
  county_fips5    text,                   -- ISO-code / FIPS-5 for counties
  signal_date     date NOT NULL,
  ingested_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idf_signals_source
  ON idf_signals(source_type, signal_date DESC);
CREATE INDEX IF NOT EXISTS idx_idf_signals_county
  ON idf_signals(county_fips5, signal_date DESC);
CREATE INDEX IF NOT EXISTS idx_idf_signals_dimension
  ON idf_signals(jps_dimension, signal_date DESC);

ALTER TABLE idf_signals ENABLE ROW LEVEL SECURITY;

-- ── data365_group_registry ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data365_group_registry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id uuid REFERENCES jurisdictions(id),
  group_id        text NOT NULL UNIQUE,   -- Facebook group ID
  group_name      text NOT NULL,
  group_url       text,
  members_count   integer,
  discovery_keywords text[],
  group_theme     text NOT NULL
    CHECK (group_theme IN (
      'opposition',   -- anti-data center / anti-development
      'support',      -- pro-development / economic development
      'general',      -- general community group (monitor for data center mentions)
      'government',   -- local government community page
      'business'      -- local business association
    )),
  state_fips      text,
  county_fips5    text,
  is_active       boolean DEFAULT true,
  last_fetched_at timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_d365_jurisdiction
  ON data365_group_registry(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_d365_county
  ON data365_group_registry(county_fips5);
CREATE INDEX IF NOT EXISTS idx_d365_active
  ON data365_group_registry(is_active, last_fetched_at);

ALTER TABLE data365_group_registry ENABLE ROW LEVEL SECURITY;

-- ── data365_posts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data365_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        text NOT NULL REFERENCES data365_group_registry(group_id),
  jurisdiction_id uuid REFERENCES jurisdictions(id),
  fb_post_id      text NOT NULL UNIQUE,
  post_text       text,
  post_url        text,
  posted_at       timestamptz,
  likes_count     integer DEFAULT 0,
  comments_count  integer DEFAULT 0,
  shares_count    integer DEFAULT 0,
  engagement_score numeric(8,2),          -- likes + (comments×2) + (shares×3)
  is_dc_relevant  boolean DEFAULT false,
  sentiment_score numeric(4,3),           -- -1.0 to +1.0
  fetched_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_d365_posts_group
  ON data365_posts(group_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_d365_posts_jurisdiction
  ON data365_posts(jurisdiction_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_d365_posts_relevant
  ON data365_posts(is_dc_relevant, posted_at DESC);

ALTER TABLE data365_posts ENABLE ROW LEVEL SECURITY;

-- ── data365_opposition_signals ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data365_opposition_signals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id     uuid NOT NULL REFERENCES jurisdictions(id),
  signal_date         date NOT NULL,
  post_count          integer DEFAULT 0,
  avg_sentiment       numeric(4,3),
  weighted_sentiment  numeric(4,3),       -- engagement-weighted sentiment
  opposition_posts    integer DEFAULT 0,
  support_posts       integer DEFAULT 0,
  neutral_posts       integer DEFAULT 0,
  top_post_url        text,
  top_post_engagement integer,
  idf_ingested        boolean DEFAULT false,
  computed_at         timestamptz DEFAULT now(),
  UNIQUE(jurisdiction_id, signal_date)
);

CREATE INDEX IF NOT EXISTS idx_d365_opp_jurisdiction
  ON data365_opposition_signals(jurisdiction_id, signal_date DESC);
CREATE INDEX IF NOT EXISTS idx_d365_opp_idf
  ON data365_opposition_signals(idf_ingested) WHERE idf_ingested = false;

ALTER TABLE data365_opposition_signals ENABLE ROW LEVEL SECURITY;
