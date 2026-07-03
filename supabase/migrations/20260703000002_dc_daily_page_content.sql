-- dc_daily_page_content: one row per Daily Challenge day (FAR-287) backing the
-- Hints Today / About Today's Challenge / Answers Today pages. Populated by the
-- idempotent /api/cron/sync-day-content job from the Airtable Puzzle Bank; the
-- pages read ONLY this table (never Airtable from the client/request path).
--
-- puzzles jsonb shape (one entry per live puzzle type, up to 7):
--   [{ puzzle_type, public_id, puzzle_name, topic, hints: [h1,h2,h3],
--      answer, answer_explanation, domain_code, academy }]
-- about_content jsonb: day-level framing blob (headline/intro/games/topics/
-- domain_code) — same for every visitor, no personalization, NO live stats
-- (completion % / avg hints are always computed at request time, never stored).

CREATE TABLE IF NOT EXISTS public.dc_daily_page_content (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  puzzle_date       date NOT NULL UNIQUE,  -- CT calendar date, matching AUTO-128
  domain_code       text,                  -- IDF domain (e.g. 'D2'); NULL until FAR-178 populates Domain in the bank
  about_content     jsonb NOT NULL DEFAULT '{}'::jsonb,
  puzzles           jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  generator_version text,
  synced_at         timestamptz NOT NULL DEFAULT now()
);

-- Service-role only — NOT public-read, deliberately diverging from
-- library_catalog_cache: puzzles jsonb carries answers + explanations, so an
-- anon-key SELECT policy would hand out ungated answers straight off PostgREST.
-- The completion/rollover answer gate lives in /api/challenge/answers, which
-- reads with the service role (same posture as dc_completions/dc_daily_attempts).
ALTER TABLE public.dc_daily_page_content ENABLE ROW LEVEL SECURITY;

-- rollback:
--   DROP TABLE IF EXISTS public.dc_daily_page_content;
