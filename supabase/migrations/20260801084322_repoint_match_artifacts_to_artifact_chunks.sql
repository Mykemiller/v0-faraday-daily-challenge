-- CC-ARTIFACT-VECTOR-REPOINT-1.0
-- Repoint public.match_artifacts from artifacts.embedding (0 of 275,393 rows
-- populated — every call returned zero rows) to artifact_chunks.embedding
-- (117,117 rows, 100% populated, text-embedding-3-small vector(1536), HNSW
-- indexed by idx_chunks_embedding).
--
-- APPLIED to prod 2026-08-01 as version 20260801084322 via the Supabase MCP
-- apply_migration path; this file is the VCS record.
--
-- Contract changes: return column `chunk_text` APPENDED (additive only; the
-- existing 8 columns keep their names, types, and order). Callable signature
-- unchanged. At most one row per artifact_id (best-scoring chunk). Title is
-- never NULL: signal_envelope title -> headline -> chunk_text prefix ->
-- source_url (only 4.8% of artifacts carry an envelope title; headline is the
-- LinkedIn-post variant; chunk_text and source_url are non-null for every
-- chunk-covered artifact, so the chain always terminates).
--
-- Coverage caveat: chunks cover 116,465 artifacts (~42% of the corpus); the
-- remaining ~159k are enrich_status='skipped' and were never chunked/embedded.
-- This migration makes vector retrieval WORK, not COMPLETE.
--
-- artifacts.embedding + artifacts_embedding_hnsw are deliberately left in
-- place, untouched — their disposition is a separate decision (Myke's call).
--
-- ⚠️ Caller note: the query vector must be 1536-dim (text-embedding-3-small).
-- src/lib/live-agent.ts embeds queries with Voyage voyage-3.5 (1024-dim) —
-- that path now raises a dimension-mismatch error instead of silently
-- returning zero rows. It is inert while VOYAGE_API_KEY is unset (route falls
-- back to lexical), but the embed model must be reconciled before enabling it.
--
-- DROP + CREATE (not CREATE OR REPLACE) because the return type gains a
-- column; grants are re-established below to the pre-existing posture
-- (EXECUTE revoked from PUBLIC, service-role only).

-- Force-load pgvector in this session so hnsw.ef_search is a registered
-- USERSET GUC; without this the SET clause below is an unrecognized
-- placeholder and fails with "permission denied to set parameter".
select '[1]'::vector <=> '[1]'::vector;

drop function public.match_artifacts(vector, integer, double precision, timestamptz);

create function public.match_artifacts(
  query_embedding vector,
  match_count integer default 8,
  similarity_threshold double precision default 0.35,
  published_since timestamptz default null
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
  chunk_text text
)
language sql
stable
security invoker
set search_path to 'public', 'pg_catalog'
-- The candidate over-fetch below asks the HNSW index for up to 200 rows;
-- the default hnsw.ef_search (40) would silently truncate that.
set hnsw.ef_search to '200'
as $$
  with candidates as (
    -- Over-fetch nearest chunks (4x the clamped artifact budget, max 200)
    -- BEFORE collapsing to one row per artifact: deduping after the final
    -- LIMIT would silently under-return artifacts. Only 434 of 116,465
    -- covered artifacts have >1 chunk (max 3), so 4x is generous headroom.
    select c.artifact_id,
           c.chunk_text,
           1 - (c.embedding <=> query_embedding) as similarity
    from public.artifact_chunks c
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
         coalesce(
           nullif(a.signal_envelope->>'title', ''),
           nullif(a.signal_envelope->>'headline', ''),
           nullif(left(b.chunk_text, 120), ''),
           a.source_url
         ) as title,
         a.signal_envelope->>'summary' as summary,
         a.signal_envelope->>'source' as source,
         a.source_url,
         a.published_at,
         a.ifs_domains,
         b.similarity,
         b.chunk_text
  from best b
  join public.artifacts a on a.artifact_id = b.artifact_id
  where b.similarity >= similarity_threshold
    and (published_since is null or a.published_at >= published_since)
  order by b.similarity desc
  limit least(greatest(match_count, 1), 50);
$$;

-- Restore the pre-existing grant posture: service-role only.
revoke execute on function public.match_artifacts(vector, integer, double precision, timestamptz) from public, anon, authenticated;
grant execute on function public.match_artifacts(vector, integer, double precision, timestamptz) to service_role;
