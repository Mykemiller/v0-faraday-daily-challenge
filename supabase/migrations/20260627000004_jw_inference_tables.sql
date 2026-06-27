-- JW Inference Engine: supporting tables for county-level scoring.
-- Depends on: 20260627000001 (confidence columns on jurisdictions)

-- Census Bureau ACS 5-year county demographics (loaded once, refreshed annually)
CREATE TABLE IF NOT EXISTS census_county_demographics (
  fips5             text PRIMARY KEY,
  state_fips        text NOT NULL,
  population        integer,
  median_hh_income  integer,
  housing_units     integer,
  commuters         integer,
  pop_density       numeric(10,2),
  rural_urban_code  smallint,      -- ERS RUCC: 1 (most urban) to 9 (most rural)
  partisan_lean     numeric(5,2),  -- R-D margin; positive = R-lean, negative = D-lean
  loaded_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_census_state ON census_county_demographics(state_fips);

-- Maps counties to their serving utility / RTO
CREATE TABLE IF NOT EXISTS county_utility_map (
  fips5             text NOT NULL,
  utility_name      text NOT NULL,
  rto_iso           text,
  utility_type      text
    CHECK (utility_type IN ('investor_owned','municipal','cooperative','federal')),
  is_primary        boolean DEFAULT true,
  PRIMARY KEY (fips5, utility_name)
);

CREATE INDEX IF NOT EXISTS idx_utility_map_rto ON county_utility_map(rto_iso);

-- Interconnection queue snapshots per RTO (updated weekly from public sources)
CREATE TABLE IF NOT EXISTS utility_queue_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rto_iso           text NOT NULL,
  snapshot_date     date NOT NULL,
  queue_mw_total    numeric(12,1),
  queue_mw_approved numeric(12,1),
  queue_mw_pending  numeric(12,1),
  queue_count_total integer,
  avg_wait_months   numeric(5,1),
  source_url        text,
  UNIQUE(rto_iso, snapshot_date)
);

-- County-level power availability derived from RTO queue data
CREATE TABLE IF NOT EXISTS county_power_availability (
  fips5                   text PRIMARY KEY,
  rto_iso                 text,
  utility_name            text,
  queue_wait_months       numeric(5,1),
  available_capacity_mw   numeric(10,1),
  renewable_pct           numeric(5,2),
  transmission_constraint text
    CHECK (transmission_constraint IN ('none','moderate','severe','critical')),
  grid_access_score       numeric(5,2),
  power_tier              text
    CHECK (power_tier IN ('Constrained','Tight','Adequate','Available','Abundant')),
  source                  text,
  updated_at              timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_county_power_rto  ON county_power_availability(rto_iso);
CREATE INDEX IF NOT EXISTS idx_county_power_tier ON county_power_availability(power_tier);
