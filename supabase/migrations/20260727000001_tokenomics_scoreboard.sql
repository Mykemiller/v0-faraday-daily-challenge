-- Faraday Tokenomics Scoreboard — ingestion + time-series data plane.
--
-- ⚠️ UN-APPLIED. Do NOT `supabase db push` this without Myke's explicit
-- promotion sign-off. Promotion is a separate, gated step (see
-- docs/tokenomics-scoreboard/README.md). This file is additive + reversible.
--
-- Design canon (locked scope):
--   • tokenomics_metrics is APPEND-ONLY. A value is NEVER updated in place — a
--     changed reading inserts a new dated vintage. 7/30/90-day % change and
--     realized volatility are DERIVED AT READ TIME (never stored stale).
--   • Idempotency key = (metric_id, as_of, source, content_hash). An unchanged
--     re-fetch collides on content_hash → ON CONFLICT DO NOTHING (no-op). A
--     changed figure produces a new content_hash → a new vintage row.
--   • Third-party constructed indices (Ornn/OCPI, Tokenix/ACPI, TPI, Epoch/AA,
--     Silicon Data) are INGEST-ONLY: display_allowed defaults FALSE and the
--     snapshot API omits their VALUES until per-source licensing sign-off.
--   • RLS deny-all / service-role-only (NOT public-read): rows carry licensed,
--     display-gated values, so an anon-key SELECT would leak them via PostgREST.
--     Every read goes through the service-role API, which applies the gate.

-- ─── 1. Append-only time series ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tokenomics_metrics (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id      text        NOT NULL,          -- stable slug, e.g. gpu.h100.ondemand.aws.us-east-1
  category       text        NOT NULL
    CHECK (category IN ('A', 'B', 'C', 'D')),   -- A token · B gpu · C futures · D demand-context
  subject        text,                          -- model / gpu class / instrument / metric subject
  provider       text,                          -- vendor / venue / publisher
  region         text,                          -- cloud region or grid region (fusion join key)
  sku            text,                          -- instance type / product sku
  pricing_mode   text
    CHECK (pricing_mode IN ('ondemand', 'reserved', 'committed', 'spot', 'list')),
  value          numeric,                        -- NULL for status-only rows (e.g. non-tradeable futures)
  unit           text,                           -- $/M-in, $/M-out, $/GPU-hr, index-level, tokens/sec, $/kWh …
  as_of          timestamptz NOT NULL,           -- vendor's as-of for THIS reading
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  source         text        NOT NULL,           -- canonical source slug
  source_tier    smallint    NOT NULL DEFAULT 3
    CHECK (source_tier IN (1, 2, 3)),
  source_url     text,
  confidence     text        NOT NULL DEFAULT 'as-reported'
    CHECK (confidence IN ('verified', 'as-reported', 'unverified')),
  display_allowed boolean    NOT NULL DEFAULT true,  -- FALSE for licensed third-party indices
  why_note       text,                            -- fusion-generated narrative (D)
  content_hash   text        NOT NULL,            -- sha256 over the semantic figure
  meta           jsonb       NOT NULL DEFAULT '{}'::jsonb  -- secondary fields: quality_adj, tps, status, volume, attribution, citations
);

-- Idempotency: an identical re-fetch is a no-op; any changed field in the hash
-- (incl. a restated value at the same as_of) is a new vintage.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tokenomics_metrics_vintage
  ON tokenomics_metrics (metric_id, as_of, source, content_hash);

-- Read-time series scan: latest vintage per as_of, ordered for deltas/vol.
CREATE INDEX IF NOT EXISTS idx_tokenomics_metrics_series
  ON tokenomics_metrics (metric_id, as_of DESC, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_tokenomics_metrics_category
  ON tokenomics_metrics (category, as_of DESC);
CREATE INDEX IF NOT EXISTS idx_tokenomics_metrics_region
  ON tokenomics_metrics (region, as_of DESC) WHERE region IS NOT NULL;

COMMENT ON TABLE  tokenomics_metrics IS
  'Append-only tokenomics time series (FAR Tokenomics Scoreboard). Never UPDATE a value; insert a new dated vintage. Deltas/volatility derived at read time.';
COMMENT ON COLUMN tokenomics_metrics.display_allowed IS
  'FALSE = licensed third-party index; snapshot API returns existence/as-of/source but NULLs the value until licensing sign-off.';
COMMENT ON COLUMN tokenomics_metrics.content_hash IS
  'sha256 of the canonical semantic figure. Part of the unique key so an unchanged re-fetch is a no-op and a changed reading is a new vintage.';

ALTER TABLE tokenomics_metrics ENABLE ROW LEVEL SECURITY;
-- No policies = deny-all to anon/authenticated. Service role bypasses RLS.

-- ─── 2. Source registry (drives tier + the per-source display gate) ──────────
-- One row per canonical source slug. display_allowed here is the GLOBAL default
-- the gate flips (per source) at subscriber launch + legal sign-off. Ingest
-- always stamps the row-level display_allowed from this registry.
CREATE TABLE IF NOT EXISTS tokenomics_source_registry (
  source          text        PRIMARY KEY,       -- canonical slug, matches tokenomics_metrics.source
  label           text        NOT NULL,          -- human display label
  category        text        NOT NULL
    CHECK (category IN ('A', 'B', 'C', 'D')),
  source_tier     smallint    NOT NULL
    CHECK (source_tier IN (1, 2, 3)),
  kind            text        NOT NULL,           -- adapter dispatch key (aipricing_guru | cloud_gpu | neocloud | index | futures | fusion)
  cadence         text        NOT NULL,           -- near-daily | daily | weekly | quarterly | yearly | event | monthly
  is_third_party_index boolean NOT NULL DEFAULT false,
  display_allowed boolean     NOT NULL DEFAULT true,   -- GLOBAL gate; third-party indices ship FALSE
  license_note    text,                            -- licensing status; must clear legal before a gated value ships
  attribution     text,                            -- required attribution string (e.g. CC-BY, licensor credit)
  home_url        text,
  crawlable       text,                            -- api | rendered | semi-manual | press
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tokenomics_source_registry IS
  'Source-of-truth for tier, cadence, and the per-source display gate. Flip display_allowed TRUE only after licensing sign-off + legal review.';

ALTER TABLE tokenomics_source_registry ENABLE ROW LEVEL SECURITY;

-- ─── 3. Per-subscriber scoreboard preferences (the pickable 5th column) ──────
-- Additive, nullable. NULL → defaults (candidate-pool default = Together AI).
-- Shape: { "pick5": "<provider slug>", "region": "<region>", "updated_at": "<iso>" }
ALTER TABLE dc_subscribers
  ADD COLUMN IF NOT EXISTS scoreboard_prefs jsonb;

COMMENT ON COLUMN dc_subscribers.scoreboard_prefs IS
  'Tokenomics Scoreboard per-subscriber prefs (pickable 5th neocloud column + region). NULL = defaults.';
