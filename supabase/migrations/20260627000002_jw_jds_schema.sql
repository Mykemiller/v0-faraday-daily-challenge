ALTER TABLE jurisdictions
  ADD COLUMN IF NOT EXISTS jds_raw        numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS jds_normalized numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS jds_tier       text         DEFAULT NULL
    CHECK (jds_tier IN ('Greenfield','Emerging','Active','Dense','Saturated')),
  ADD COLUMN IF NOT EXISTS jds_delta      numeric(4,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS jds_updated_at timestamptz  DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_jurisdictions_jds_tier
  ON jurisdictions(jds_tier);
CREATE INDEX IF NOT EXISTS idx_jurisdictions_jds_normalized
  ON jurisdictions(jds_normalized DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS jds_scores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id     uuid NOT NULL REFERENCES jurisdictions(id) ON DELETE CASCADE,
  scored_at           timestamptz NOT NULL DEFAULT now(),
  peer_group          text NOT NULL
    CHECK (peer_group IN ('county','metro','state','country')),

  -- Layer 1: Operational
  l1_facility_count   integer       DEFAULT 0,
  l1_mw_total         numeric(8,1)  DEFAULT NULL,

  -- Layer 2: Announced / Under Construction
  l2_facility_count   integer       DEFAULT 0,
  l2_mw_total         numeric(8,1)  DEFAULT NULL,

  -- Layer 3: Permitted / Not Yet Built
  l3_facility_count   integer       DEFAULT 0,
  l3_mw_total         numeric(8,1)  DEFAULT NULL,

  -- Layer 4: Hyperscaler Land Acquisitions
  l4_parcel_count     integer       DEFAULT 0,
  l4_acreage_total    numeric(10,2) DEFAULT NULL,

  -- Computed scores
  jds_raw             numeric(4,2)  DEFAULT NULL,
  jds_normalized      numeric(4,2)  DEFAULT NULL,
  jds_tier            text          DEFAULT NULL,
  jds_prior           numeric(4,2)  DEFAULT NULL,
  jds_delta           numeric(4,2)  DEFAULT NULL,

  -- Source attribution
  source_breakdown    jsonb         DEFAULT NULL,

  UNIQUE(jurisdiction_id, scored_at)
);

CREATE INDEX IF NOT EXISTS idx_jds_jurisdiction
  ON jds_scores(jurisdiction_id, scored_at DESC);
CREATE INDEX IF NOT EXISTS idx_jds_tier
  ON jds_scores(jds_tier);
CREATE INDEX IF NOT EXISTS idx_jds_scored_at
  ON jds_scores(scored_at DESC);
