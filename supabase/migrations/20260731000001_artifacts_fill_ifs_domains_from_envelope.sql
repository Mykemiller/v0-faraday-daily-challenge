-- ============================================================================
-- 20260731000001_artifacts_fill_ifs_domains_from_envelope.sql
--
-- CC-IDF4-SUBDOMAIN-COVERAGE-1.0 Phase 1, step 1 (forward fix).
--
-- ⚠️ PROPOSAL — NOT APPLIED. Requires Myke sign-off before apply_migration.
--
-- PROBLEM (Phase 0 finding, docs/idf4-coverage/PHASE-0-SUBDOMAIN-CLASSIFICATION.md):
--   `source-poller` writes each source's curated domain tags into
--   `artifacts.signal_envelope->'idf_domains'` but never into the
--   `artifacts.ifs_domains` column that every coverage query reads.
--   Result: 250,067 of 250,067 poller rows (94.6% of the whole corpus) carry
--   the tags in the same row yet report as untagged. Zero model spend to fix.
--
-- WHY A TRIGGER RATHER THAN AN EDGE-FUNCTION PATCH:
--   `source-poller`'s source is NOT checked into this repo, the Faraday engine
--   repo, or anywhere else — it exists only as a deployed Supabase function.
--   Patching it would mean deploying un-versioned code, which the governance
--   rule ("branch-and-PR only for any code change") forbids. A trigger is
--   in-repo, reviewable, and additionally covers every OTHER ingest path that
--   populates signal_envelope but forgets the column.
--   Vendoring source-poller into version control is filed as a separate item.
--
-- SAFETY PROPERTIES:
--   * NEVER overwrites an existing tag — fires only when ifs_domains is
--     NULL or empty. An explicitly-tagged row is left exactly as-is.
--   * Ignores anything that is not a non-empty jsonb array.
--   * Accepts only well-formed parent-domain codes (^D\d+$). Sub-domain codes
--     (D#.#) and free-text legacy tags are deliberately NOT written here —
--     sub-domain routing is splitIfsTags()' job, and mixing the two is the
--     exact defect this workstream exists to fix.
--   * Idempotent: re-running the migration replaces the function in place.
--   * Does NOT touch ifs_subdomains, so it never trips
--     trg_artifacts_validate_ifs_subdomains.
--
-- This migration is DDL only. It does not modify a single existing row —
-- the 250,067-row history backfill is deliberately a separate, batched,
-- dry-run-default script: scripts/idf4-propagate-poller-domains.mjs
-- ============================================================================

create or replace function public.artifacts_fill_ifs_domains_from_envelope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codes text[];
begin
  -- Only act when the column has no tags. Never clobber a real value.
  if new.ifs_domains is not null and cardinality(new.ifs_domains) > 0 then
    return new;
  end if;

  -- Only act when the envelope actually carries a non-empty array.
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

comment on function public.artifacts_fill_ifs_domains_from_envelope() is
  'CC-IDF4-SUBDOMAIN-COVERAGE-1.0: mirrors signal_envelope->idf_domains into the '
  'ifs_domains column when that column is empty. Never overwrites an existing tag. '
  'Parent-domain codes (D#) only — sub-domain routing belongs to splitIfsTags().';

drop trigger if exists trg_artifacts_fill_ifs_domains on public.artifacts;

create trigger trg_artifacts_fill_ifs_domains
  before insert or update on public.artifacts
  for each row
  execute function public.artifacts_fill_ifs_domains_from_envelope();

-- ---------------------------------------------------------------------------
-- Verification gate: assert the trigger actually normalizes, then roll the
-- probe row back. Raises and aborts the migration if the behavior is wrong.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_got text[];
begin
  insert into public.artifacts (
    crawler_id, auto_id, source_type, source_url, content_hash, raw_content,
    signal_envelope
  ) values (
    'migration-probe_v0', 'AUTO-000', 'web_news',
    'https://example.invalid/idf4-trigger-probe',
    'idf4-trigger-probe-' || gen_random_uuid()::text,
    'probe',
    '{"idf_domains": ["D18", "D6", "not-a-code", "D7.1"]}'::jsonb
  )
  returning ifs_domains into v_got;

  -- Expect the two well-formed parent codes, sorted; junk and the D#.#
  -- sub-domain code must both be rejected.
  if v_got is distinct from array['D18', 'D6']::text[] then
    raise exception
      'trg_artifacts_fill_ifs_domains verification FAILED: expected {D18,D6}, got %',
      coalesce(v_got::text, 'NULL');
  end if;

  raise notice 'trg_artifacts_fill_ifs_domains verified: % ', v_got;
  raise exception 'rollback probe row (expected)';
exception
  when others then
    if sqlerrm = 'rollback probe row (expected)' then
      raise notice 'IDF4 trigger verification passed; probe row discarded.';
    else
      raise;
    end if;
end
$verify$;
