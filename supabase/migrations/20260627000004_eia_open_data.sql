-- EIA Open Data integration schema (FAR CC-7)
-- Adds dim_power to jurisdictions and creates four EIA data tables.

ALTER TABLE jurisdictions
  ADD COLUMN IF NOT EXISTS dim_power numeric(4,2) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_jurisdictions_dim_power
  ON jurisdictions(dim_power DESC NULLS LAST);

-- Annual state-level electricity generation, capacity, and derived scores
CREATE TABLE IF NOT EXISTS eia_state_electricity (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_fips             text NOT NULL,
  state_abbr             text NOT NULL,
  data_year              integer NOT NULL,

  -- Generation mix (MWh)
  total_generation_mwh   numeric(15,1),
  renewable_mwh          numeric(15,1),
  solar_mwh              numeric(15,1),
  wind_mwh               numeric(15,1),
  hydro_mwh              numeric(15,1),
  nuclear_mwh            numeric(15,1),
  natural_gas_mwh        numeric(15,1),
  coal_mwh               numeric(15,1),

  -- Capacity (MW)
  total_capacity_mw      numeric(12,1),
  renewable_capacity_mw  numeric(12,1),
  planned_additions_mw   numeric(12,1),
  planned_retirements_mw numeric(12,1),

  -- Derived metrics
  renewable_pct          numeric(5,2),
  capacity_headroom_mw   numeric(12,1),
  grid_health_score      numeric(5,2),   -- 0–100 composite for dim_power baseline

  fetched_at             timestamptz DEFAULT now(),
  UNIQUE(state_fips, data_year)
);

CREATE INDEX IF NOT EXISTS idx_eia_state
  ON eia_state_electricity(state_fips, data_year DESC);

-- Utility-level retail data from EIA Form 861
CREATE TABLE IF NOT EXISTS eia_utility_data (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utility_id       integer NOT NULL,
  utility_name     text NOT NULL,
  state_abbr       text NOT NULL,
  ownership_type   text,   -- investor_owned, municipal, cooperative, federal
  customers_count  integer,
  total_sales_mwh  numeric(15,1),
  revenue_thousand numeric(15,1),
  data_year        integer NOT NULL,
  fetched_at       timestamptz DEFAULT now(),
  UNIQUE(utility_id, data_year)
);

-- Planned generation capacity additions (forward-looking, next 3 years)
CREATE TABLE IF NOT EXISTS eia_capacity_additions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_fips             text NOT NULL,
  plant_name             text,
  fuel_type              text,
  nameplate_capacity_mw  numeric(10,1),
  planned_year           integer,
  status                 text,   -- 'planned','under_construction','cancelled'
  fetched_at             timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eia_cap_state
  ON eia_capacity_additions(state_fips, planned_year);

-- IDF signal log for EIA data (classifier training / dim_power narratives)
CREATE TABLE IF NOT EXISTS eia_idf_signals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_fips    text NOT NULL,
  signal_type   text NOT NULL,
  signal_text   text NOT NULL,
  jps_dimension text DEFAULT 'dim_power',
  data_year     integer,
  metric_name   text,
  metric_value  numeric,
  significance  text CHECK (significance IN ('high','medium','low')),
  ingested_at   timestamptz DEFAULT now()
);
