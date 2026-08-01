-- CC-ARTIFACT-VECTOR-REPOINT-1.2
-- Remediates the live v1.0 repoint of public.match_artifacts (version
-- 20260801084322) — two defects plus the citability contract:
--
--   Defect A (fabrication risk): the title fallback chain synthesized a
--   "title" from left(chunk_text,120) or source_url. 89% of the corpus is
--   Google News RSS stubs with no envelope title, so the title column was
--   mostly relabelled body text. A Faraday's Take citation must anchor to a
--   factual headline: the chain is now title -> headline -> NULL, and
--   chunk_text remains available as its own honestly-labelled column.
--
--   Defect B (post-filter recall collapse): similarity_threshold and
--   published_since were applied AFTER the top-4N chunk over-fetch, so
--   filtered queries starved (published_since=2026-07-25 for 10 artifacts
--   returned 2 against 5,071 eligible). Both filters (and the new
--   citable_only) now live INSIDE the candidate CTE, constraining the vector
--   scan itself. pgvector 0.8.0's hnsw.iterative_scan=relaxed_order makes
--   this a supported filtered-ANN query: the HNSW scan keeps drawing
--   candidates until the LIMIT is genuinely satisfied (bounded by
--   hnsw.max_scan_tuples, default 20,000) instead of truncating at ef_search.
--
--   Citability contract: an artifact is citable iff source_url is present
--   and not a news.google.com/rss redirect stub AND signal_envelope title
--   AND source (publisher) are non-empty. citable_only defaults TRUE (only
--   citable artifacts returned); citable_only=false returns everything with
--   an honest is_citable flag per row. Verified against live data
--   2026-08-01: 13,117 citable artifacts (13,276 have titles; the source +
--   URL conditions trim 159); 13,116 of them are chunked and therefore
--   vector-searchable. The only non-Google anomalous URL shape found is 31
--   scheme-relative "//www.rtoinsider.com/..." rows (no scheme, otherwise
--   real publisher URLs) — treated as citable; no gmail:/other non-http
--   schemes exist in artifacts.source_url.
--
-- Return signature is additive only: is_citable boolean APPENDED after
-- chunk_text; the callable signature gains trailing citable_only boolean
-- DEFAULT true, so existing 4-arg call sites keep working (and now get the
-- citable-only default deliberately — Faraday's Take must anchor to a
-- factual citation when it reaches a user surface).
--
-- The 4x over-fetch multiplier is retained (correct for dedupe: max 3
-- chunks/artifact, only 434 multi-chunk artifacts). artifacts.embedding and
-- artifacts_embedding_hnsw remain untouched.
--
-- APPLIED to prod 2026-08-01 as version 20260801091150 via the Supabase MCP
-- apply_migration path; this file is the VCS record.

-- Force-load pgvector in this session so hnsw.* are registered USERSET GUCs;
-- without this the SET clauses below fail as unrecognized placeholders.
select '[1]'::vector <=> '[1]'::vector;

drop function public.match_artifacts(vector, integer, double precision, timestamptz);

create function public.match_artifacts(
  query_embedding vector,
  match_count integer default 8,
  similarity_threshold double precision default 0.35,
  published_since timestamptz default null,
  citable_only boolean default true
)
returns table(
  artifact_id uuid,
  title text,
  summary text,
  source text,
  source_url text,
  published_at timestamptz,
  ifs_domains text[],
  similarity double precision,
  chunk_text text,
  is_citable boolean
)
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
set hnsw.ef_search to '200'
set hnsw.iterative_scan to 'relaxed_order'
as $$
  with candidates as (
    -- All row-level filters live HERE, inside the vector scan, so the HNSW
    -- iterative scan keeps drawing neighbors until 4x the artifact budget
    -- genuinely qualifies (Defect B fix). The distance filter is evaluated
    -- at the index scan node; the artifacts join (published_at, citability)
    -- prunes via PK lookups as the scan streams.
    select c.artifact_id,
           c.chunk_text,
           1 - (c.embedding <=> query_embedding) as similarity
    from public.artifact_chunks c
    join public.artifacts a on a.artifact_id = c.artifact_id
    where (1 - (c.embedding <=> query_embedding)) >= similarity_threshold
      and (published_since is null or a.published_at >= published_since)
      and (not citable_only or (
            a.source_url is not null and a.source_url <> ''
            and a.source_url not like '%news.google.com/rss%'
            and coalesce(a.signal_envelope->>'title', '') <> ''
            and coalesce(a.signal_envelope->>'source', '') <> ''))
    order by c.embedding <=> query_embedding
    limit least(greatest(match_count, 1), 50) * 4
  ),
  best as (
    select distinct on (cand.artifact_id)
           cand.artifact_id, cand.chunk_text, cand.similarity
    from candidates cand
    order by cand.artifact_id, cand.similarity desc
  )
  select b.artifact_id,
         -- Defect A fix: title -> headline -> NULL. NEVER chunk_text or
         -- source_url — a title invented from body text is not a citation.
         coalesce(
           nullif(a.signal_envelope->>'title', ''),
           nullif(a.signal_envelope->>'headline', '')
         ) as title,
         a.signal_envelope->>'summary' as summary,
         a.signal_envelope->>'source' as source,
         a.source_url,
         a.published_at,
         a.ifs_domains,
         b.similarity,
         b.chunk_text,
         (a.source_url is not null and a.source_url <> ''
          and a.source_url not like '%news.google.com/rss%'
          and coalesce(a.signal_envelope->>'title', '') <> ''
          and coalesce(a.signal_envelope->>'source', '') <> '') as is_citable
  from best b
  join public.artifacts a on a.artifact_id = b.artifact_id
  order by b.similarity desc
  limit least(greatest(match_count, 1), 50);
$$;

-- Restore the pre-existing grant posture: service-role only.
revoke execute on function public.match_artifacts(vector, integer, double precision, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.match_artifacts(vector, integer, double precision, timestamptz, boolean) to service_role;
