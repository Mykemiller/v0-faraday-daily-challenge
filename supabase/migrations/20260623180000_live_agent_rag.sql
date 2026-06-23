-- CC-06 / FAR-29 — Live Agent: retrieval-grounded subscriber Q&A over the
-- artifact corpus. ADDITIVE + reversible. Two retrieval paths share one corpus:
--   1. Semantic — `artifacts.embedding` (pgvector) ranked by cosine distance.
--   2. Lexical  — Postgres full-text over title + summary + raw_content.
-- The Live Agent uses semantic when embeddings are present (Voyage backfill), and
-- transparently falls back to lexical otherwise, so the surface works before the
-- corpus is fully embedded. `pgvector` (extension `vector`) is already installed.
--
-- Reverse:
--   DROP FUNCTION IF EXISTS public.search_artifacts_text(text, int, timestamptz);
--   DROP FUNCTION IF EXISTS public.match_artifacts(vector, int, float, timestamptz);
--   DROP INDEX  IF EXISTS public.artifacts_embedding_hnsw;
--   DROP INDEX  IF EXISTS public.artifacts_fts_gin;
--   ALTER TABLE public.artifacts DROP COLUMN IF EXISTS embedding;

-- ── Semantic: embedding column + ANN index ──────────────────────────────────
-- voyage-3.5 emits 1024-dim vectors; keep the dimension in sync with the
-- embed-artifacts edge function (EMBED_DIM). HNSW gives good recall at this
-- corpus size with no list-tuning. cosine ops match the function's distance.
ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

CREATE INDEX IF NOT EXISTS artifacts_embedding_hnsw
  ON public.artifacts USING hnsw (embedding vector_cosine_ops);

-- ── Lexical: a generated tsvector + GIN index for the no-embeddings path ─────
-- Weighted: title (A) > summary (B) > raw_content (C). signal_envelope carries
-- the human-facing title/summary; raw_content is the crawled body.
ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(signal_envelope->>'title', '')),   'A') ||
    setweight(to_tsvector('english', coalesce(signal_envelope->>'summary', '')), 'B') ||
    setweight(to_tsvector('english', coalesce(raw_content, '')),                 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS artifacts_fts_gin
  ON public.artifacts USING gin (fts);

-- ── match_artifacts: semantic retrieval ─────────────────────────────────────
-- Returns the nearest artifacts to a query embedding whose cosine SIMILARITY
-- clears `similarity_threshold` (0..1). Similarity = 1 - cosine_distance.
-- The no-confabulation guard lives in the caller: an empty result (nothing above
-- threshold) means "not in corpus" → refuse. Weights/scores of the JPS model are
-- never touched here; only the public signal_envelope fields are returned.
CREATE OR REPLACE FUNCTION public.match_artifacts(
  query_embedding      vector(1024),
  match_count          int        DEFAULT 8,
  similarity_threshold float      DEFAULT 0.35,
  published_since      timestamptz DEFAULT NULL
)
RETURNS TABLE (
  artifact_id  uuid,
  title        text,
  summary      text,
  source       text,
  source_url   text,
  published_at timestamptz,
  ifs_domains  text[],
  similarity   float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    a.artifact_id,
    a.signal_envelope->>'title'   AS title,
    a.signal_envelope->>'summary' AS summary,
    a.signal_envelope->>'source'  AS source,
    a.source_url,
    a.published_at,
    a.ifs_domains,
    1 - (a.embedding <=> query_embedding) AS similarity
  FROM public.artifacts a
  WHERE a.embedding IS NOT NULL
    AND (published_since IS NULL OR a.published_at >= published_since)
    AND (1 - (a.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY a.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 50);
$$;

-- ── search_artifacts_text: lexical retrieval (no embeddings required) ────────
-- websearch_to_tsquery parses natural queries ("power AND grid", quoted phrases).
-- ts_rank_cd weights by the A/B/C field weighting above. Same shape as
-- match_artifacts so the caller treats the two paths interchangeably; `rank` is
-- a ts_rank score (not a 0..1 similarity) — the caller normalizes for display.
CREATE OR REPLACE FUNCTION public.search_artifacts_text(
  query_text     text,
  match_count    int         DEFAULT 8,
  published_since timestamptz DEFAULT NULL
)
RETURNS TABLE (
  artifact_id  uuid,
  title        text,
  summary      text,
  source       text,
  source_url   text,
  published_at timestamptz,
  ifs_domains  text[],
  rank         float
)
LANGUAGE sql STABLE
AS $$
  WITH q AS (SELECT websearch_to_tsquery('english', coalesce(query_text, '')) AS tsq)
  SELECT
    a.artifact_id,
    a.signal_envelope->>'title'   AS title,
    a.signal_envelope->>'summary' AS summary,
    a.signal_envelope->>'source'  AS source,
    a.source_url,
    a.published_at,
    a.ifs_domains,
    ts_rank_cd(a.fts, q.tsq) AS rank
  FROM public.artifacts a, q
  WHERE q.tsq @@ a.fts
    AND (published_since IS NULL OR a.published_at >= published_since)
  ORDER BY rank DESC
  LIMIT LEAST(GREATEST(match_count, 1), 50);
$$;

-- Service-role only (called from the server via the service key). Lock down the
-- anon/authenticated roles so the corpus is never queried directly from a client.
REVOKE ALL ON FUNCTION public.match_artifacts(vector, int, float, timestamptz) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.search_artifacts_text(text, int, timestamptz)     FROM anon, authenticated;
