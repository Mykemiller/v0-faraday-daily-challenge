-- ============================================================================
-- FAR-190 — source_type_enum migration  (BLOCKED: awaiting Myke approval)
-- ----------------------------------------------------------------------------
-- Adds the 'email' value to public.source_type_enum so the ingest-email Edge
-- Function can write artifacts with source_type = 'email'.
--
-- *** DO NOT RUN WITHOUT MYKE'S EXPLICIT APPROVAL. ***  Myke runs this.
--
-- Idempotent + additive only (safe on live data): ADD VALUE IF NOT EXISTS is a
-- no-op if the label already exists, so re-running cannot error or duplicate.
--
-- NOTE (verified 2026-06-24 against the live DB): the 'email' label is ALREADY
-- present in source_type_enum on project ycadmmngkdhvpcsrcuaq (added by the
-- committed migrations 20260623000001 / 20260623220703). This file is the
-- canonical approval artifact for FAR-190; on the live project it is a no-op.
-- Apply only if promoting source_type_enum to an environment that lacks 'email'.
-- ============================================================================

ALTER TYPE public.source_type_enum ADD VALUE IF NOT EXISTS 'email';

-- Verify after running:
--   SELECT enumlabel FROM pg_enum e
--     JOIN pg_type t ON e.enumtypid = t.oid
--    WHERE t.typname = 'source_type_enum'
--    ORDER BY e.enumsortorder;
-- Expect 'email' present in the result set.
