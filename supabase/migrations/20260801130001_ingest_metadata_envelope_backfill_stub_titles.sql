-- CC-INGEST-METADATA-EXTRACTION-1.0 — Part 2: Google-stub TITLES (optional)
--
-- ⚠️ STAGED, NOT APPLIED — and separately gated on Myke's §7 decision: "decide
-- whether stub titles are extracted in this pass". Strike this file from the
-- apply if the answer is no; Part 1 stands alone.
--
-- The 245k Google News stub rows carry a REAL headline in raw_content line 1
-- (Google's item title, format "headline - Publisher"). This backfills that
-- headline into the canonical `title` key, as-is:
--   * The trailing " - Publisher" suffix is KEPT — it is Google's own title
--     text. It is NEVER parsed into the `source` key (§5.2 forbids deriving a
--     publisher from the headline suffix). Stripping it risks truncating
--     legitimately hyphenated headlines; Myke can reverse this call.
--   * `source` and `summary` are NEVER written for stubs. Their source_name is
--     a search-query label, and their raw_content "summary" half is a junk
--     duplicate of the headline.
--   * Citability is unaffected BY CONSTRUCTION: every row this touches has a
--     news.google.com/rss source_url, which fails the predicate's URL
--     condition regardless of metadata. Verified in the gate below. Resolving
--     the redirect is CC-INGEST-STUB-RESOLUTION-1.0 (ticket B) — once that
--     ticket fixes source_url and recovers the real publisher, these titles
--     are already in place.
--
-- Runtime note: this rewrites ~245k jsonb values (~10k more per day of drift)
-- in one transaction — expect minutes, not seconds. Apply via the MCP
-- apply_migration path or psql with a generous statement_timeout; the 60s
-- interactive-tool window is NOT enough (measured 2026-08-01).
--
-- Proven in BEGIN..ROLLBACK against prod 2026-08-01 on a 40,000-row slice:
-- 40,000 titles written, 0 sources written, 0 rows became citable.
-- Idempotent (touched rows leave the WHERE clause). Down-migration:
-- docs/ingest-metadata-extraction/down.sql.

update public.artifacts a
set signal_envelope = a.signal_envelope || jsonb_strip_nulls(jsonb_build_object(
  'title',
    case when btrim(split_part(a.raw_content, E'\n', 1)) <> ''
          and length(btrim(split_part(a.raw_content, E'\n', 1))) <= 300
          and (position(E'\n' in a.raw_content) > 0 or length(a.raw_content) <= 200)
         then btrim(split_part(a.raw_content, E'\n', 1)) end
))
where a.signal_envelope->>'source_name' like 'Google News search:%'
  and coalesce(a.signal_envelope->>'title','') = '';

do $$
declare
  v_stub_source bigint;
  v_stub_citable bigint;
  v_titled bigint;
begin
  -- Stubs must never gain a publisher.
  select count(*) into v_stub_source from public.artifacts
   where signal_envelope->>'source_name' like 'Google News search:%'
     and coalesce(signal_envelope->>'source','') <> '';
  if v_stub_source <> 0 then
    raise exception 'GATE FAIL: % stub rows carry a source', v_stub_source;
  end if;

  -- Stubs must remain uncitable (URL condition holds for every stub row).
  select count(*) into v_stub_citable from public.artifacts
   where signal_envelope->>'source_name' like 'Google News search:%'
     and source_url is not null and source_url <> ''
     and source_url not like '%news.google.com/rss%'
     and coalesce(signal_envelope->>'title','') <> ''
     and coalesce(signal_envelope->>'source','') <> '';
  if v_stub_citable <> 0 then
    raise exception 'GATE FAIL: % stub rows became citable', v_stub_citable;
  end if;

  select count(*) into v_titled from public.artifacts
   where signal_envelope->>'source_name' like 'Google News search:%'
     and coalesce(signal_envelope->>'title','') <> '';
  raise notice 'CC-INGEST-METADATA Part 2 applied. Stub rows with titles: % (245,213 at staging on 2026-08-01 + drift). Citable pool unchanged by this part.', v_titled;
end $$;
