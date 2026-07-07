-- CC-INGEST-STATE-INCENTIVE-API-1.0 — jurisdiction resolution (I4) + INC-01..05 write (I3)
-- Set-based & idempotent. County-name resolution reuses the com_fb place/county pattern.
-- Writes JPAS attribute rows only (never JPS/JDS). SRC (0.85) fixed. source='state_disclosure',
-- source_level='primary' — Good Jobs First (when built) must DEFER where a 'primary' INC row exists.

create or replace function public.fn_state_incentives_resolve_and_score(p_state_abbr text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resolved int;
  v_juris    int;
begin
  set local statement_timeout = '180s';

  -- 1. Resolve county-grain disclosures -> jurisdiction_id (state-scoped, name-normalized).
  --    County set (a few dozen rows) is materialized once so the planner hash-joins it
  --    against the disclosures instead of regex-scanning all jurisdictions per row.
  with cty as (
    select id, lower(regexp_replace(name, '\s+county$', '', 'i')) as nname
      from public.jurisdictions
     where is_active and level = 'county' and state_abbr = p_state_abbr
  )
  update public.state_incentive_disclosures d
     set jurisdiction_id   = cty.id,
         resolution_method = 'county_name',
         resolution_status = 'resolved',
         candidate_count   = 1,
         updated_at        = now()
    from cty
   where d.state_abbr = p_state_abbr
     and d.jurisdiction_id is null
     and d.county_name is not null
     and cty.nname = lower(regexp_replace(d.county_name, '\s+county$', '', 'i'));
  get diagnostics v_resolved = row_count;

  -- Anything still unmatched stays explicitly 'unresolved' (documented gap, never silent).
  update public.state_incentive_disclosures d
     set resolution_status = 'unresolved', updated_at = now()
   where d.state_abbr = p_state_abbr
     and d.jurisdiction_id is null
     and d.resolution_status <> 'unresolved';

  -- 2. Aggregate resolved disclosures per jurisdiction and write INC-01..05.
  with agg as (
    select jurisdiction_id,
           count(*)                                                                    as cnt,
           array_agg(distinct incentive_type) filter (where incentive_type is not null) as types,
           sum(award_value_usd)                                                         as total_val,
           max(award_value_usd)                                                         as max_val,
           max(term_years)                                                              as max_term,
           min(term_start)                                                              as earliest,
           max(term_end)                                                                as latest,
           array_agg(distinct program_name)     filter (where program_name is not null)     as programs,
           array_agg(distinct statute_citation) filter (where statute_citation is not null) as statutes
      from public.state_incentive_disclosures
     where state_abbr = p_state_abbr
       and jurisdiction_id is not null
     group by jurisdiction_id
  ),
  rows as (
    select jurisdiction_id, 'INC-01' as code,
           jsonb_build_object('present',true,'disclosure_count',cnt,'state',p_state_abbr,
                              'via','CC-INGEST-STATE-INCENTIVE-API-1.0') as val
      from agg
    union all
    select jurisdiction_id, 'INC-02',
           jsonb_build_object('types',to_jsonb(coalesce(types,'{}')),'disclosure_count',cnt) from agg
    union all
    select jurisdiction_id, 'INC-03',
           jsonb_build_object('total_award_usd',total_val,'max_award_usd',max_val,
                              'currency','USD','record_count',cnt) from agg
    union all
    select jurisdiction_id, 'INC-04',
           jsonb_build_object('max_term_years',max_term,'earliest_start',earliest,'latest_end',latest) from agg
    union all
    select jurisdiction_id, 'INC-05',
           jsonb_build_object('programs',to_jsonb(coalesce(programs,'{}')),
                              'statutes',to_jsonb(coalesce(statutes,'{}'))) from agg
  )
  insert into public.jpas_attributes
      (jurisdiction_id, tier_code, attribute_code, value,
       confidence_tier, confidence_multiplier, source, source_level, captured_at)
  select jurisdiction_id, 'INC', code, val,
         'SRC', 0.85, 'state_disclosure', 'primary', now()
    from rows
  on conflict (jurisdiction_id, attribute_code, source) do update
     set value                 = excluded.value,
         tier_code             = excluded.tier_code,
         confidence_tier       = excluded.confidence_tier,
         confidence_multiplier = excluded.confidence_multiplier,
         source_level          = excluded.source_level,
         captured_at           = excluded.captured_at;

  select count(distinct jurisdiction_id) into v_juris
    from public.state_incentive_disclosures
   where state_abbr = p_state_abbr and jurisdiction_id is not null;

  return jsonb_build_object('state', p_state_abbr,
                            'newly_resolved', v_resolved,
                            'jurisdictions_written', v_juris);
end
$$;

comment on function public.fn_state_incentives_resolve_and_score(text) is
  'CC-INGEST-STATE-INCENTIVE-API-1.0: resolve state_incentive_disclosures to jurisdictions and upsert INC-01..05 at SRC. Idempotent. GJF defers to source_level=primary rows.';

revoke all on function public.fn_state_incentives_resolve_and_score(text) from public, anon, authenticated;
