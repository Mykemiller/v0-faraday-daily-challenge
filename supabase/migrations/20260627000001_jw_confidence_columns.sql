ALTER TABLE jurisdictions
  ADD COLUMN IF NOT EXISTS confidence_score      numeric(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS confidence_tier       text         DEFAULT 'unscored'
    CHECK (confidence_tier IN ('verified','estimated','inferred','unscored')),
  ADD COLUMN IF NOT EXISTS confidence_breakdown  jsonb        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS coverage_score        numeric(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS recency_score         numeric(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS diversity_score       numeric(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS grid_access_score     numeric(5,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS confidence_updated_at timestamptz  DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_jurisdictions_confidence_tier
  ON jurisdictions(confidence_tier);
CREATE INDEX IF NOT EXISTS idx_jurisdictions_confidence_score
  ON jurisdictions(confidence_score DESC NULLS LAST);
