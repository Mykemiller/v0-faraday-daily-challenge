-- CC-INGEST-STATE-INCENTIVE-API-1.0  (JPAS Tier T7 — Incentives, INC-01..05)
-- Investigation gate I1: no prior INC-01..05 table/registry rows; Good Jobs First absent.
-- Common intermediate schema (state_source_schema_version) accommodates per-state variance.
-- Write destination: JPAS attribute columns only. SRC (0.85) fixed. Content-hash idempotency.

------------------------------------------------------------------------------
-- 1. Primary-source disclosure store
------------------------------------------------------------------------------
create table if not exists public.state_incentive_disclosures (
  id                          uuid primary key default gen_random_uuid(),
  state_abbr                  char(2) not null,
  source_key                  text not null,                 -- e.g. 'ny_esd_dei'
  state_source_schema_version text not null default 'v1',
  source_record_id            text,                          -- native record id
  -- normalized common fields (I3 approved mapping) --------------------------
  recipient_name              text,
  project_name                text,
  project_address             text,
  parcel_id                   text,
  place_name                  text,
  county_name                 text,
  incentive_type              text,                          -- normalized bucket -> INC-02
  raw_incentive_type          text,                          -- as-published
  program_name                text,                          -- -> INC-05
  statute_citation            text,                          -- -> INC-05
  award_value_usd             numeric,                       -- -> INC-03
  term_start                  date,                          -- -> INC-04
  term_end                    date,                          -- -> INC-04
  term_years                  numeric,                       -- -> INC-04
  source_url                  text,
  raw                         jsonb,                         -- full source record
  -- jurisdiction resolution (I4: reuse com_fb place/county pattern) ---------
  jurisdiction_id             uuid references public.jurisdictions(id),
  resolution_method           text,                          -- county_name|place_match|geocode|unresolved
  resolution_status           text not null default 'unresolved', -- resolved|ambiguous|unresolved
  candidate_count             integer,
  -- idempotency + audit -----------------------------------------------------
  content_hash                text not null,
  ingested_at                 timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint state_incentive_disclosures_content_hash_key unique (content_hash)
);

create index if not exists sid_state_abbr_idx        on public.state_incentive_disclosures (state_abbr);
create index if not exists sid_jurisdiction_idx      on public.state_incentive_disclosures (jurisdiction_id);
create index if not exists sid_resolution_status_idx on public.state_incentive_disclosures (resolution_status);
create index if not exists sid_source_key_idx        on public.state_incentive_disclosures (source_key);

comment on table public.state_incentive_disclosures is
  'CC-INGEST-STATE-INCENTIVE-API-1.0: primary state-published economic incentive disclosures (TIF/abatement/credit/exemption). Primary source; Good Jobs First (when built) defers where a state_disclosure row exists for the same jurisdiction/attribute.';

------------------------------------------------------------------------------
-- 2. Register INC-01..05 (I1: previously unregistered). Owner = this prompt.
--    Weights sum to 8.0 of the 12.0 INC tier weight (per prompt). SRC tier.
------------------------------------------------------------------------------
insert into public.jpas_attribute_registry
  (attribute_code, attribute_name, tier_code, tier_name, tier_weight, attribute_weight,
   source_type, default_confidence_tier, populating_prompt, populated_by_prompt, is_active, notes)
values
  ('INC-01','Incentive present',           'INC','Incentives',12.0,1.0,'state_disclosure','SRC',
     'CC-INGEST-STATE-INCENTIVE-API-1.0','partial',true,
     'Any resolvable state-published incentive disclosure for the jurisdiction.'),
  ('INC-02','Incentive type(s)',           'INC','Incentives',12.0,1.5,'state_disclosure','SRC',
     'CC-INGEST-STATE-INCENTIVE-API-1.0','partial',true,
     'Normalized incentive types: abatement|tif|credit|exemption|grant|loan|pilot|other.'),
  ('INC-03','Incentive dollar value',      'INC','Incentives',12.0,2.5,'state_disclosure','SRC',
     'CC-INGEST-STATE-INCENTIVE-API-1.0','partial',true,
     'Award value / foregone revenue (total + max) from state disclosures.'),
  ('INC-04','Incentive term length',       'INC','Incentives',12.0,1.5,'state_disclosure','SRC',
     'CC-INGEST-STATE-INCENTIVE-API-1.0','partial',true,
     'Max term years / earliest start / latest end across disclosures.'),
  ('INC-05','Incentive program / authority','INC','Incentives',12.0,1.5,'state_disclosure','SRC',
     'CC-INGEST-STATE-INCENTIVE-API-1.0','partial',true,
     'Program names + statutory citations where published.')
on conflict (attribute_code) do update set
  attribute_name          = excluded.attribute_name,
  tier_code               = excluded.tier_code,
  tier_name               = excluded.tier_name,
  tier_weight             = excluded.tier_weight,
  attribute_weight        = excluded.attribute_weight,
  source_type             = excluded.source_type,
  default_confidence_tier = excluded.default_confidence_tier,
  populating_prompt       = excluded.populating_prompt,
  populated_by_prompt     = excluded.populated_by_prompt,
  is_active               = excluded.is_active,
  notes                   = excluded.notes;
