-- CC-INGEST-METADATA-EXTRACTION-1.0 — Part 1: direct-publisher envelope backfill
--
-- ⚠️ STAGED, NOT APPLIED. Do not apply without Myke's explicit sign-off — this
-- mutates production rows in public.artifacts (§6 of the ticket). Evidence for
-- sign-off: docs/ingest-metadata-extraction/REPORT.md (200-row hand-checked
-- sample, measured precision, BEGIN..ROLLBACK dry-run results).
--
-- Canonical envelope contract (decided by this ticket; Myke to confirm):
--   `title`, `summary`, `source` are the canonical signal_envelope keys — the
--   keys the live match_artifacts v1.2 citability predicate already reads, and
--   the keys the 13k legacy (faraday-crawl) rows already carry. Current-gen
--   poller keys `source_name`, `source_key`, `license`, `license_status`,
--   `idf_domains`, `confidence_cap` are PRESERVED verbatim — this is additive
--   normalisation; no key is dropped, no existing non-empty value overwritten.
--
-- What this migration does — for the "direct publisher" channel only
-- (source_name present, NOT a Google News search label, no envelope title):
--   title   := first line of raw_content (the publisher's own headline; the
--              poller writes raw_content as `title\n\nsummary`). Rejected when
--              blank, when >300 chars (sanity cap), or when the row is an
--              unbroken body (no newline and >200 chars) — those rows keep no
--              title and STAY UNCITABLE by design (precision over yield).
--   summary := text after the first blank line, only when a title was
--              extracted and no summary already exists.
--   source  := signal_envelope->>'source_name' — a real publisher on every
--              row in this channel by definition of the WHERE clause.
--
-- What it deliberately does NOT do:
--   * Google News stub rows (source_name LIKE 'Google News search:%') are
--     untouched here — titles for them are Part 2 (20260801130001…), and a
--     publisher is NEVER written for them in any part: their source_name is
--     the crawler's search query, not a publication. Attribution manufactured
--     at scale is the exact failure the citation rule exists to prevent.
--   * The ~1.6k "bare" rows (no source_name, no title — LinkedIn posts, ISO
--     filings, note-style records) are untouched: the hand-checked sample put
--     first-line-as-title precision for that channel far below the 98% bar.
--   * Legacy rows (envelope title already present) are untouched — structurally
--     excluded by the WHERE clause; existing metadata is authoritative.
--   * match_artifacts is untouched: the canonical keys ARE the keys v1.2
--     already reads, so the predicate needs no change — the backfill alone
--     raises the citable pool 13,117 → ~28,280 (plus post-staging drift).
--
-- Idempotent: every touched row leaves the WHERE clause (title becomes
-- non-empty) or is guarded by COALESCE checks; re-running is a no-op for rows
-- already normalised. Safe to re-run as a sweep after the source-poller
-- write-path fix (follow-up ticket) deploys, to catch rows inserted between
-- staging and cutover.
--
-- Proven in BEGIN..ROLLBACK against prod 2026-08-01: 15,336 rows updated;
-- 15,163 titles; 14,054 new summaries; 15,336 sources; 15,163 newly citable;
-- 0 Google-label sources written; 0 stub-URL rows with a source.
-- Down-migration: docs/ingest-metadata-extraction/down.sql.

update public.artifacts a
set signal_envelope = a.signal_envelope || jsonb_strip_nulls(jsonb_build_object(
  'title',
    case when btrim(split_part(a.raw_content, E'\n', 1)) <> ''
          and length(btrim(split_part(a.raw_content, E'\n', 1))) <= 300
          and (position(E'\n' in a.raw_content) > 0 or length(a.raw_content) <= 200)
         then btrim(split_part(a.raw_content, E'\n', 1)) end,
  'summary',
    case when coalesce(a.signal_envelope->>'summary','') = ''
          and btrim(split_part(a.raw_content, E'\n', 1)) <> ''
          and length(btrim(split_part(a.raw_content, E'\n', 1))) <= 300
          and position(E'\n\n' in a.raw_content) > 0
         then nullif(btrim(substring(a.raw_content from position(E'\n\n' in a.raw_content) + 2)), '') end,
  'source',
    case when coalesce(a.signal_envelope->>'source','') = ''
         then a.signal_envelope->>'source_name' end
))
where coalesce(a.signal_envelope->>'source_name','') <> ''
  and a.signal_envelope->>'source_name' not like 'Google News search:%'
  and coalesce(a.signal_envelope->>'title','') = '';

-- Verification gates — invariant-based (the corpus grows ~10k rows/day, so
-- exact-count equality would rot between sign-off and apply). Any failure
-- raises and rolls the whole migration back.
do $$
declare
  v_google_source bigint;
  v_stub_url_source bigint;
  v_long_title bigint;
  v_remaining_gap bigint;
  v_citable bigint;
begin
  -- The hard rule of the ticket: no publisher value is ever a search label.
  select count(*) into v_google_source from public.artifacts
   where signal_envelope->>'source' like 'Google News search:%';
  if v_google_source <> 0 then
    raise exception 'GATE FAIL: % rows carry a Google search label as source', v_google_source;
  end if;

  -- No Google-stub-URL row may carry a publisher.
  select count(*) into v_stub_url_source from public.artifacts
   where source_url like '%news.google.com/rss%'
     and coalesce(signal_envelope->>'source','') <> '';
  if v_stub_url_source <> 0 then
    raise exception 'GATE FAIL: % stub-URL rows carry a source', v_stub_url_source;
  end if;

  -- No written title may exceed the 300-char sanity cap.
  select count(*) into v_long_title from public.artifacts
   where coalesce(signal_envelope->>'source_name','') <> ''
     and signal_envelope->>'source_name' not like 'Google News search:%'
     and length(signal_envelope->>'title') > 300;
  if v_long_title <> 0 then
    raise exception 'GATE FAIL: % over-length titles written', v_long_title;
  end if;

  -- Every remaining title gap in this channel must be an unbroken-body reject.
  select count(*) into v_remaining_gap from public.artifacts a
   where coalesce(a.signal_envelope->>'source_name','') <> ''
     and a.signal_envelope->>'source_name' not like 'Google News search:%'
     and coalesce(a.signal_envelope->>'title','') = ''
     and btrim(split_part(a.raw_content, E'\n', 1)) <> ''
     and length(btrim(split_part(a.raw_content, E'\n', 1))) <= 300
     and (position(E'\n' in a.raw_content) > 0 or length(a.raw_content) <= 200);
  if v_remaining_gap <> 0 then
    raise exception 'GATE FAIL: % extractable rows left without a title', v_remaining_gap;
  end if;

  select count(*) into v_citable from public.artifacts
   where source_url is not null and source_url <> ''
     and source_url not like '%news.google.com/rss%'
     and coalesce(signal_envelope->>'title','') <> ''
     and coalesce(signal_envelope->>'source','') <> '';
  raise notice 'CC-INGEST-METADATA Part 1 applied. Citable artifacts now: % (was 13,117 at staging on 2026-08-01; projected ~28,280 + drift)', v_citable;
end $$;

comment on column public.artifacts.signal_envelope is
  'Crawler metadata envelope. Canonical keys (CC-INGEST-METADATA-EXTRACTION-1.0): '
  'title (publisher''s own headline), summary, source (real publisher name — NEVER '
  'a search-query label). Poller provenance keys source_name/source_key/license/'
  'license_status/idf_domains/confidence_cap are preserved alongside. '
  'match_artifacts citability requires non-empty title AND source on a non-stub URL.';
