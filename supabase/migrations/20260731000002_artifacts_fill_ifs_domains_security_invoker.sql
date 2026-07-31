-- ============================================================================
-- 20260731000002_artifacts_fill_ifs_domains_security_invoker.sql
--
-- ✅ APPLIED to prod 2026-07-31, minutes after 20260731000001.
--
-- WHY: 20260731000001 declared artifacts_fill_ifs_domains_from_envelope() as
-- SECURITY DEFINER out of habit. It does not need to be. It is a BEFORE trigger
-- that only mutates NEW and reads no privileged object, so it requires no
-- elevated rights. SECURITY DEFINER also raised two advisor WARNs that this
-- workstream introduced:
--   anon_security_definer_function_executable
--   authenticated_security_definer_function_executable
--
-- Rewriting as SECURITY INVOKER is both more correct and quieter. Verified:
-- advisor findings went 396 -> 394, with zero remaining mentions of this
-- function and no change to the ERROR count. search_path stays pinned.
--
-- Behavior is byte-identical to 20260731000001 apart from the security clause;
-- the same verification gate re-runs here.
-- ============================================================================

create or replace function public.artifacts_fill_ifs_domains_from_envelope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_codes text[];
begin
  if new.ifs_domains is not null and cardinality(new.ifs_domains) > 0 then
    return new;
  end if;

  if new.signal_envelope is null
     or jsonb_typeof(new.signal_envelope -> 'idf_domains') is distinct from 'array'
     or jsonb_array_length(new.signal_envelope -> 'idf_domains') = 0 then
    return new;
  end if;

  select array_agg(distinct code order by code)
    into v_codes
  from jsonb_array_elements_text(new.signal_envelope -> 'idf_domains') as t(code)
  where code ~ '^D[0-9]+$';

  if v_codes is not null and cardinality(v_codes) > 0 then
    new.ifs_domains := v_codes;
  end if;

  return new;
end;
$$;

do $verify$
declare
  v_got text[];
begin
  begin
    insert into public.artifacts (
      crawler_id, auto_id, source_type, source_url, content_hash, raw_content, signal_envelope
    ) values (
      'migration-probe_v0', 'AUTO-000', 'web_news',
      'https://example.invalid/idf4-trigger-probe-2',
      'idf4-trigger-probe2-' || gen_random_uuid()::text,
      'probe',
      '{"idf_domains": ["D18", "D6", "not-a-code", "D7.1"]}'::jsonb
    ) returning ifs_domains into v_got;

    if v_got is distinct from array['D18', 'D6']::text[] then
      raise exception 'IDF4_VERIFY_FAILED: expected {D18,D6}, got %', coalesce(v_got::text,'NULL');
    end if;
    raise exception 'IDF4_PROBE_ROLLBACK';
  exception
    when others then
      if sqlerrm = 'IDF4_PROBE_ROLLBACK' then
        raise notice 'security invoker rewrite verified; probe discarded.';
      else raise;
      end if;
  end;
end
$verify$;
