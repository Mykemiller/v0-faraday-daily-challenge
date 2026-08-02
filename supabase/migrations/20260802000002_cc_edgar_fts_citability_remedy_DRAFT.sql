-- CC-EDGAR-CIK-INGEST-1.0 — §7.7 remedy for the FTS lane's citability gap
--
-- ##################################################################
-- ##  DRAFTED, NOT APPLIED.                                       ##
-- ##  Ticket §6: "STOP before modifying, disabling, or            ##
-- ##  reconfiguring feed:sec-edgar-full-text-search-api."         ##
-- ##################################################################
--
-- Diagnosis (measured 2026-08-02)
-- ------------------------------
-- feed:sec-edgar-full-text-search-api has produced 5,058 artifacts. Of those:
--
--   * 5,058 / 5,058 (100%) carry company, form, accession and cik in
--     artifacts.crawl_metadata.
--   *     0 / 5,058 (0%)   have signal_envelope->>'title'.
--   * 4,474 are enrich_status = 'complete'; only 86 sec.gov artifacts corpus-wide
--     have a title, against 98.5% for the rest of the corpus.
--
-- The citability predicate (public.fn_artifact_is_citable) reads
-- signal_envelope->>'title' and ->>'source'. The FTS ingester writes that same
-- information into crawl_metadata instead. So this is NOT an extractor failure
-- and NOT a crawler-depth problem — it is a field-mapping defect. The metadata
-- required for citation is already present and complete; it is in the wrong
-- JSONB column.
--
-- Second defect: every one of the 5,058 rows is the synthesised fallback stub
-- (avg 158 chars, min 132, max 231). The per-document fetch inside
-- fn_sec_edgar_fts_ingest has never once succeeded, because www.sec.gov
-- hard-403s Supabase Postgres egress ("Request Rate Threshold Exceeded"). The
-- exception handler swallows it silently, so the lane reports success while
-- landing zero filing text. The hourly retry loop is also plausibly part of what
-- keeps that egress IP on SEC's threshold list.

begin;

-- 1. Backfill citation metadata from where it already is.
update public.artifacts a
set signal_envelope = coalesce(a.signal_envelope, '{}'::jsonb) || jsonb_build_object(
      'title',  (a.crawl_metadata->>'company') || ' — ' || (a.crawl_metadata->>'form') ||
                ', filed ' || coalesce(to_char(a.published_at, 'YYYY-MM-DD'), 'n/d'),
      'source', 'U.S. Securities and Exchange Commission'
    )
where a.crawler_id = 'fn_sec_edgar_fts_ingest_v1.0'
  and coalesce(a.signal_envelope->>'title', '') = ''
  and coalesce(a.crawl_metadata->>'company', '') <> ''
  and coalesce(a.crawl_metadata->>'form', '') <> '';

-- Expected: ~5,058 rows, taking the sec.gov citable rate from 1.7% to ~100%.

-- 2. Stop the futile document fetch and write the envelope at ingest time.
--    Only the two changed behaviours are shown; see the live function body for
--    the rest. p_fetch_docs should default to FALSE until an egress that can
--    reach www.sec.gov exists (neither Postgres nor edge can today).
--
--    In the INSERT, add:
--        signal_envelope = jsonb_build_object(
--          'title',  v_company || ' — ' || v_form || ', filed ' || v_date,
--          'source', 'U.S. Securities and Exchange Commission')
--
--    And replace the silent `exception when others then null` around the doc
--    fetch with an error accumulator, so a 100%-failure fetch path can never
--    again report success.

commit;
