-- CC-INGEST-TOKENOMICS-SCOREBOARD-1.0  (Faraday Tokenomics Scoreboard back end)  — AUTO-191 (PROPOSED)
-- ============================================================================================
-- GOVERNANCE: This migration is DELIVERED UN-APPLIED. Do NOT apply to prod until Myke signs off.
--   No schema apply, no deploy, no prod seed in the authoring CC. Promotion is a separate gate.
--   The AUTO id below is PROPOSED (AUTO-191) and must be reserved in the Airtable Automation
--   Registry (appxfti7VuoHYUeu6 / tbl1ef6FgxUc3Uevg) before go-live. In-repo AUTO ceiling was
--   AUTO-178; memory shows AUTO-184 (FEMA) and AUTO-190 (EIA, provisional) reserved in sibling
--   repos, so 191 is the next safe integer — VERIFY against the live registry before locking.
-- ============================================================================================
-- Reuses the Tokenomics Scoreboard metric groups verbatim:
--   A = token/inference pricing · B = gpu rental · C = futures market · D = demand-context+fusion.
-- Append-only time series: a value is NEVER updated in place. A corrected/changed reading for the
-- same as_of is a NEW vintage row (distinct content_hash). Deltas (7/30/90d %) and realized
-- volatility are DERIVED AT READ TIME (fn_tokenomics_series / the Next API), never stored stale.
-- Display gate: third-party indices are INGEST-ONLY (display_allowed=false); the snapshot API
-- returns their existence + as-of + source + a "licensed source — display pending" placeholder,
-- never the value, until the per-source gate is flipped at subscriber launch + licensing sign-off.

------------------------------------------------------------------------------
-- 1. Append-only metric time series
------------------------------------------------------------------------------
create table if not exists public.tokenomics_metrics (
  id            uuid primary key default gen_random_uuid(),
  metric_id     text        not null,                 -- stable slug, e.g. gpu.h100.ondemand.aws.us-east-1
  category      char(1)     not null,                 -- A|B|C|D
  subject       text,                                 -- model / gpu_class / instrument / context subject
  provider      text,                                 -- vendor / cloud / venue / neocloud
  region        text,                                 -- cloud region or geography key
  sku           text,                                 -- instance / gpu sku
  pricing_mode  text,                                 -- ondemand|reserved|committed|spot|list (nullable for indices/context)
  value         numeric,                              -- nullable: status-only (futures) or gated indices carry null value
  unit          text        not null,                 -- $/M-in, $/M-out, $/GPU-hr, index-level, tokens/sec, $/kWh, status, ...
  as_of         date        not null,                 -- the reading's own effective date
  ingested_at   timestamptz not null default now(),
  source        text        not null,                 -- source_key (see tokenomics_source_registry)
  source_tier   smallint    not null,                 -- 1|2|3
  source_url    text,
  confidence    text        not null default 'as-reported', -- verified|as-reported|unverified
  display_allowed boolean   not null default true,    -- false for licensed third-party indices (ingest-only)
  why_note      text,                                 -- fusion annotation (nullable)
  content_hash  text        not null,
  constraint tokenomics_metrics_category_ck
    check (category in ('A','B','C','D')),
  constraint tokenomics_metrics_pricing_mode_ck
    check (pricing_mode is null or pricing_mode in ('ondemand','reserved','committed','spot','list')),
  constraint tokenomics_metrics_confidence_ck
    check (confidence in ('verified','as-reported','unverified')),
  constraint tokenomics_metrics_source_tier_ck
    check (source_tier between 1 and 3),
  -- Idempotency + vintaging: identical replay of a reading is a no-op (same content_hash);
  -- a changed value for the same (metric_id, as_of, source) has a new content_hash => a new
  -- vintage row. Read layer selects the freshest vintage per (metric_id, as_of, source).
  constraint tokenomics_metrics_vintage_key
    unique (metric_id, as_of, source, content_hash)
);

create index if not exists tm_metric_asof_idx  on public.tokenomics_metrics (metric_id, as_of desc);
create index if not exists tm_category_idx      on public.tokenomics_metrics (category);
create index if not exists tm_region_idx        on public.tokenomics_metrics (region);
create index if not exists tm_provider_idx      on public.tokenomics_metrics (provider);
create index if not exists tm_ingested_idx      on public.tokenomics_metrics (ingested_at desc);

comment on table public.tokenomics_metrics is
  'CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 (AUTO-191 proposed): append-only tokenomics time series. Never UPDATE a value; a changed reading is a new vintage row. Deltas/volatility derived at read time. display_allowed=false rows (licensed third-party indices) are ingest-only — the snapshot API returns existence/as-of/source only, never the value, until the per-source gate is flipped.';

------------------------------------------------------------------------------
-- 2. Source registry — the display gate lives here (config, not code), so a licensed
--    third-party source can be flipped display_allowed=true per-source at launch without
--    a redeploy. Ingest defaults each row's display_allowed from this table.
------------------------------------------------------------------------------
create table if not exists public.tokenomics_source_registry (
  source_key      text primary key,      -- matches tokenomics_metrics.source
  label           text not null,
  category        char(1) not null,      -- A|B|C|D
  tier            smallint not null,     -- 1|2|3
  cadence         text not null,         -- e.g. 'daily','weekly','quarterly','event'
  is_third_party_index boolean not null default false,
  licensed        boolean not null default false,   -- legal sign-off recorded
  display_allowed boolean not null default true,    -- the gate; false for un-cleared licensed indices
  attribution     text,                  -- required attribution string when displayed
  source_url      text,
  notes           text,
  updated_at      timestamptz not null default now(),
  constraint tsr_category_ck check (category in ('A','B','C','D')),
  constraint tsr_tier_ck check (tier between 1 and 3),
  -- A third-party index may only be displayed once it is licensed (legal gate is structural).
  constraint tsr_index_display_requires_license
    check (not (is_third_party_index and display_allowed and not licensed))
);

comment on table public.tokenomics_source_registry is
  'CC-INGEST-TOKENOMICS-SCOREBOARD-1.0: per-source display gate + attribution. is_third_party_index rows ship display_allowed=false (ingest-only) until licensing sign-off; the CHECK forbids displaying an unlicensed index. Flip display_allowed per source at subscriber launch.';

-- Seed the source registry (config/reference data — runs only when Myke applies this migration).
-- Third-party constructed indices (Ornn/OCPI, Tokenix/ACPI, TPI, Epoch/AA, Silicon Data) ship
-- display_allowed=false. Everything else displays by default.
insert into public.tokenomics_source_registry
  (source_key, label, category, tier, cadence, is_third_party_index, licensed, display_allowed, attribution, source_url, notes)
values
  -- A) token / inference pricing
  ('vendor_openai',      'OpenAI list pricing',              'A', 1, 'daily',    false, false, true,  null, 'https://openai.com/api/pricing/',        '403-prone; rendered/semi-manual capture with as-of.'),
  ('vendor_anthropic',   'Anthropic list pricing',           'A', 1, 'daily',    false, false, true,  null, 'https://www.anthropic.com/pricing',      '403-prone; rendered/semi-manual capture with as-of.'),
  ('vendor_google',      'Google (Gemini) list pricing',     'A', 1, 'daily',    false, false, true,  null, 'https://ai.google.dev/pricing',          '403-prone; rendered/semi-manual capture with as-of.'),
  ('vendor_xai',         'xAI (Grok) list pricing',          'A', 1, 'daily',    false, false, true,  null, 'https://x.ai/api',                       '403-prone; rendered/semi-manual capture with as-of.'),
  ('aipricing_guru',     'aipricing.guru commodity feed',    'A', 3, 'daily',    false, false, true,  'aipricing.guru', 'https://aipricing.guru/api/pricing.json', 'Commodity cross-vendor JSON API.'),
  ('epoch_ai',           'Epoch AI capability index',        'A', 1, 'publisher',false, false, true,  'Epoch AI', 'https://epoch.ai/',                'Price-per-capability (quality-adjusted).'),
  ('artificial_analysis','Artificial Analysis throughput',   'A', 1, 'publisher',false, false, true,  'Artificial Analysis', 'https://artificialanalysis.ai/', 'Throughput (tokens/sec) + quality.'),
  ('idx_tokenix_acpi',   'Tokenix / ACPI index',             'A', 1, 'publisher',true,  false, false, 'Tokenix', null,                             'INGEST-ONLY. Licensed constructed index — display pending.'),
  ('idx_tpi',            'TPI token price index',            'A', 2, 'publisher',true,  false, false, 'TPI',     null,                             'INGEST-ONLY. Licensed constructed index — display pending.'),
  ('idx_ornn_otpi',      'Ornn OTPI token index',            'A', 1, 'publisher',true,  false, false, 'Ornn',    null,                             'INGEST-ONLY. Licensed constructed index — display pending.'),
  ('idx_silicon_sdlltk', 'Silicon Data SDLLMTK',             'A', 1, 'publisher',true,  false, false, 'Silicon Data', null,                        'INGEST-ONLY. Licensed constructed index — display pending.'),
  -- B) gpu rental
  ('cloud_aws',          'AWS EC2 GPU (Price List API)',     'B', 1, 'daily',    false, false, true,  null, 'https://aws.amazon.com/ec2/pricing/',    'P5/P5e/P5en/P6/P6e; on-demand + Savings Plans + Spot + Capacity Blocks.'),
  ('cloud_azure',        'Azure GPU (Retail Prices API)',    'B', 1, 'daily',    false, false, true,  null, 'https://prices.azure.com/',              'ND H100 v5 / ND H200 v5 / ND GB200 v6; PAYG + reserved + spot.'),
  ('cloud_gcp',          'GCP GPU (Cloud Billing Catalog)',  'B', 1, 'daily',    false, false, true,  null, 'https://cloud.google.com/products/calculator', 'A3/A3U/A4/A4X; on-demand + CUDs + spot.'),
  ('neocloud',           'Neocloud roster adapters',         'B', 2, 'daily',    false, false, true,  null, null,                                     'Per-provider on-demand $/GPU-hr; see NEOCLOUD_ROSTER config.'),
  ('idx_silicon_gpu',    'Silicon Data GPU index',           'B', 1, 'publisher',true,  false, false, 'Silicon Data', null,                        'INGEST-ONLY. Licensed constructed index — display pending.'),
  ('idx_ornn_ocpi',      'Ornn OCPI compute index',          'B', 1, 'publisher',true,  false, false, 'Ornn',    null,                             'INGEST-ONLY. Licensed constructed index — display pending.'),
  -- C) futures market (status; price only once an instrument trades)
  ('futures_cme',        'CME x Silicon Data',               'C', 2, 'event',    false, false, true,  'CME',  null,                                'Status + (once live) price/volume.'),
  ('futures_ice_ornn',   'ICE x Ornn',                       'C', 2, 'event',    false, false, true,  'ICE',  null,                                'Status + (once live) price/volume.'),
  ('futures_ice_nativx', 'ICE x NATIVX / COIL',              'C', 2, 'event',    false, false, true,  'ICE',  null,                                'Status + (once live) price/volume.'),
  ('futures_shfe',       'SHFE',                             'C', 2, 'event',    false, false, true,  'SHFE', null,                                'Status + (once live) price/volume.'),
  -- D) demand-side context + fusion (Faraday plane)
  ('demand_iea',         'IEA power-demand forecast',        'D', 1, 'quarterly',false, false, true,  'IEA',  'https://www.iea.org/',                  'DC/AI power-demand forecast.'),
  ('demand_goldman',     'Goldman Sachs power forecast',     'D', 1, 'quarterly',false, false, true,  'Goldman Sachs', null,                        'DC/AI power-demand forecast.'),
  ('demand_morganstanley','Morgan Stanley power forecast',   'D', 1, 'quarterly',false, false, true,  'Morgan Stanley', null,                       'DC/AI power-demand forecast.'),
  ('demand_mix',         'Training-vs-inference mix',        'D', 2, 'yearly',   false, false, true,  null,   null,                                  'Compute-mix disclosure.'),
  ('demand_hyperscaler', 'Hyperscaler token-volume',        'D', 2, 'quarterly',false, false, true,  null,   null,                                  'Disclosed token volumes.'),
  ('fusion_faraday',     'Faraday grid fusion',              'D', 1, 'daily',    false, false, true,  'Faraday Intelligence', null,                  'Region-keyed power price + interconnection queue join (fn_scoreboard_fusion).')
on conflict (source_key) do update set
  label = excluded.label, category = excluded.category, tier = excluded.tier, cadence = excluded.cadence,
  is_third_party_index = excluded.is_third_party_index, attribution = excluded.attribution,
  source_url = excluded.source_url, notes = excluded.notes, updated_at = now();
  -- NB: display_allowed / licensed are NOT overwritten on conflict — a gate flip done by Myke
  -- (or legal) survives a re-run of this seed.

------------------------------------------------------------------------------
-- 3. Per-subscriber scoreboard preferences (the pickable 5th column). Additive + reversible.
--    Mirrors the existing dc_subscribers.notification_preferences jsonb convention.
------------------------------------------------------------------------------
alter table public.dc_subscribers
  add column if not exists scoreboard_prefs jsonb not null default '{}'::jsonb;

comment on column public.dc_subscribers.scoreboard_prefs is
  'CC-INGEST-TOKENOMICS-SCOREBOARD-1.0: per-subscriber scoreboard settings, e.g. {"pick5":"together_ai","region":"us-east-1"}. pick5 must be a member of NEOCLOUD_ROSTER.candidates (validated in the /api/scoreboard/prefs route).';

------------------------------------------------------------------------------
-- 4. Read-time series RPC — 7/30/90d % change + realized volatility, derived, never stored.
--    Returns the freshest vintage per as_of within the window for one metric_id (canonical
--    reading = latest ingested_at for a given as_of), plus the derived stats.
------------------------------------------------------------------------------
create or replace function public.fn_tokenomics_series(p_metric_id text, p_window_days int default 90)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with canon as (
    -- one canonical reading per as_of (latest-ingested vintage wins)
    select distinct on (as_of)
           as_of, value, unit, source, source_tier, confidence, display_allowed, ingested_at
      from public.tokenomics_metrics
     where metric_id = p_metric_id
       and as_of >= (current_date - (greatest(p_window_days,1) || ' days')::interval)
       and value is not null
     order by as_of, ingested_at desc
  ),
  ordered as (
    select as_of, value from canon order by as_of
  ),
  latest as (select value, as_of from ordered order by as_of desc limit 1),
  -- % change vs the closest reading at/just before each lookback horizon
  chg as (
    select
      (select value from latest) as cur,
      (select value from ordered where as_of <= current_date - 7  order by as_of desc limit 1) as v7,
      (select value from ordered where as_of <= current_date - 30 order by as_of desc limit 1) as v30,
      (select value from ordered where as_of <= current_date - 90 order by as_of desc limit 1) as v90
  ),
  -- realized volatility: stddev of daily log returns over the window, annualized (*sqrt(365))
  rets as (
    select ln(value / nullif(lag(value) over (order by as_of),0)) as r
      from ordered
  ),
  vol as (select stddev_samp(r) as sd from rets where r is not null)
  select jsonb_build_object(
    'metric_id', p_metric_id,
    'window_days', p_window_days,
    'points', coalesce((select jsonb_agg(jsonb_build_object('as_of',as_of,'value',value) order by as_of) from ordered), '[]'::jsonb),
    'latest', (select jsonb_build_object('as_of',as_of,'value',value) from latest),
    'delta_7d',  (select case when v7  is not null and v7 <>0  then round(((cur-v7)/v7)*100,2)   end from chg),
    'delta_30d', (select case when v30 is not null and v30<>0  then round(((cur-v30)/v30)*100,2) end from chg),
    'delta_90d', (select case when v90 is not null and v90<>0  then round(((cur-v90)/v90)*100,2) end from chg),
    'realized_vol', (select round((sd * sqrt(365))::numeric, 4) from vol),
    'n', (select count(*) from ordered)
  );
$$;

comment on function public.fn_tokenomics_series(text,int) is
  'CC-INGEST-TOKENOMICS-SCOREBOARD-1.0: read-time sparkline + 7/30/90d %% change + annualized realized volatility for one metric_id. Canonical reading per as_of = latest-ingested vintage. Deltas never stored.';

------------------------------------------------------------------------------
-- 5. Read-time latest-per-metric snapshot RPC. Returns the freshest canonical reading for every
--    metric in a category (optionally region-filtered), with 7/30d deltas. Value is nulled and a
--    placeholder set when display_allowed=false (the display gate is enforced in SQL too, so a
--    licensed index value can never leak even if a caller forgets).
------------------------------------------------------------------------------
create or replace function public.fn_tokenomics_snapshot_rows(p_category text default null, p_region text default null)
returns table (
  metric_id text, category char(1), subject text, provider text, region text, sku text,
  pricing_mode text, value numeric, unit text, as_of date, source text, source_tier smallint,
  confidence text, display_allowed boolean, why_note text, delta_7d numeric, delta_30d numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (metric_id)
           metric_id, category, subject, provider, region, sku, pricing_mode, value, unit,
           as_of, source, source_tier, confidence, display_allowed, why_note
      from public.tokenomics_metrics m
     where (p_category is null or category = p_category)
       and (p_region is null or region is null or region = p_region)
     order by metric_id, as_of desc, ingested_at desc
  )
  select l.metric_id, l.category, l.subject, l.provider, l.region, l.sku, l.pricing_mode,
         -- SQL-side display gate: never emit a value for a gated row
         case when l.display_allowed then l.value else null end as value,
         l.unit, l.as_of, l.source, l.source_tier, l.confidence, l.display_allowed, l.why_note,
         (fn_tokenomics_series(l.metric_id, 7)  ->> 'delta_7d')::numeric  as delta_7d,
         (fn_tokenomics_series(l.metric_id, 30) ->> 'delta_30d')::numeric as delta_30d
    from latest l;
$$;

comment on function public.fn_tokenomics_snapshot_rows(text,text) is
  'CC-INGEST-TOKENOMICS-SCOREBOARD-1.0: freshest canonical reading per metric_id for a category/region, with 7/30d deltas. SQL-side display gate nulls value where display_allowed=false.';

------------------------------------------------------------------------------
-- 6. FUSION JOIN (wired first, not a stretch goal). Region -> geography is resolved by the caller
--    (fusion.ts REGION_GRID_MAP) into (state_abbr, iso_rto); this RPC returns the region-keyed
--    power price + interconnection-queue depth / time-to-power proxy from Faraday's live grid
--    tables. Zero fabrication: nulls where the grid data is absent, with an explicit as_of.
--      power_price_kwh          <- eia_utility_territories (sales-weighted avg, latest report_year)
--      interconnect_queue_depth <- ferc_queue_county_rollup (sum total_queued_mw / entries)
--      time_to_power            <- study-phase mix proxy (no true lead-time column; labeled proxy)
------------------------------------------------------------------------------
create or replace function public.fn_scoreboard_fusion(p_state_abbr text, p_iso_rto text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_price     numeric;
  v_price_yr  int;
  v_qmw       numeric;
  v_qentries  bigint;
  v_phase     text;
  v_qdate     date;
begin
  -- Sales-weighted average retail price ($/kWh) for the state, latest available report year.
  select round((sum(avg_retail_price_cents_kwh * nullif(sales_mwh,0))
                 / nullif(sum(nullif(sales_mwh,0)),0) / 100.0)::numeric, 5),
         max(report_year)
    into v_price, v_price_yr
    from public.eia_utility_territories
   where state = p_state_abbr
     and report_year = (select max(report_year) from public.eia_utility_territories where state = p_state_abbr);

  -- Interconnection queue depth for the state (optionally narrowed to an ISO/RTO).
  select sum(total_queued_mw), sum(queue_entries), max(latest_queue_date),
         (array_agg(highest_study_phase order by latest_queue_date desc nulls last))[1]
    into v_qmw, v_qentries, v_qdate, v_phase
    from public.ferc_queue_county_rollup
   where state_abbr = p_state_abbr
     and (p_iso_rto is null or iso_rto = p_iso_rto);

  return jsonb_build_object(
    'state_abbr', p_state_abbr,
    'iso_rto', p_iso_rto,
    'power_price_kwh', v_price,
    'power_price_as_of', v_price_yr,
    'power_price_source', 'eia_utility_territories',
    'interconnect_queue_depth_mw', v_qmw,
    'interconnect_queue_entries', v_qentries,
    'interconnect_queue_as_of', v_qdate,
    'interconnect_source', 'ferc_queue_county_rollup',
    -- proxy only: derived from the deepest-study-phase reached; there is no direct lead-time column
    'time_to_power', v_phase,
    'time_to_power_is_proxy', true
  );
end
$$;

comment on function public.fn_scoreboard_fusion(text,text) is
  'CC-INGEST-TOKENOMICS-SCOREBOARD-1.0: region-keyed grid fusion — sales-weighted $/kWh (eia_utility_territories) + interconnection queue depth (ferc_queue_county_rollup) for a state/ISO. time_to_power is a study-phase proxy (flagged), not a fabricated lead time.';

------------------------------------------------------------------------------
-- 7. Security posture: RLS on, deny-all (service role bypasses). All reads/writes go through the
--    service role (ingest edge fn + Next API), matching the live_agent_* / leaderboard_daily pattern.
------------------------------------------------------------------------------
alter table public.tokenomics_metrics          enable row level security;
alter table public.tokenomics_source_registry  enable row level security;

revoke all on function public.fn_tokenomics_series(text,int)            from public, anon, authenticated;
revoke all on function public.fn_tokenomics_snapshot_rows(text,text)    from public, anon, authenticated;
revoke all on function public.fn_scoreboard_fusion(text,text)           from public, anon, authenticated;

-- END CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 migration (UN-APPLIED).
