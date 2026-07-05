-- ============================================================================
-- add_ifs_subdomains_to_artifacts — IDF 4.0 sub-domain tagging layer (Wave 0)
-- FAR-319 sub-domain coverage push.
--
-- ADDITIVE + REVERSIBLE. Submitted as a PR — do NOT apply without Myke sign-off.
--
-- Adds `artifacts.ifs_subdomains text[]` carrying canonical D#.# codes,
-- validated against `faraday_subdomains.subdomain_code` (the 116-row IDF 4.0
-- registry) by a BEFORE trigger. Validation FILTERS invalid codes rather than
-- rejecting the row: the crawl ingest path writes artifacts in chunks of 10,
-- and a raised exception would fail nine good rows for one bad tag. Precision
-- is still guaranteed at the column level — an invalid code can never land —
-- and every strip is surfaced as a Postgres WARNING for log review.
--
-- Deploy ordering (documented for the promotion runbook):
--   1. Apply this migration.
--   2. Deploy the faraday-crawl edge function that writes ifs_subdomains
--      (supabase/functions/faraday-crawl, crawler_version 1.2). Deploying the
--      function first would fail every artifact upsert with PGRST204
--      (unknown column).
--   3. Run scripts/idf4-subdomain-backfill.mjs (dry-run first, then --write
--      after Myke approves the sample).
-- ============================================================================

ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS ifs_subdomains text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.artifacts.ifs_subdomains IS
  'IDF 4.0 sub-domain codes (D#.#), validated against faraday_subdomains.subdomain_code by trg_artifacts_validate_ifs_subdomains. Domain-level codes stay in ifs_domains.';

-- Coverage queries filter/aggregate on membership — GIN over the array.
CREATE INDEX IF NOT EXISTS idx_artifacts_ifs_subdomains
  ON public.artifacts USING gin (ifs_subdomains);

-- Validation: keep only well-formed D#.# codes that exist in the registry.
CREATE OR REPLACE FUNCTION public.artifacts_validate_ifs_subdomains()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cleaned  text[];
  stripped text[];
BEGIN
  IF NEW.ifs_subdomains IS NULL OR array_length(NEW.ifs_subdomains, 1) IS NULL THEN
    NEW.ifs_subdomains := '{}'::text[];
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT c ORDER BY c), '{}'::text[])
    INTO cleaned
  FROM unnest(NEW.ifs_subdomains) AS c
  WHERE c ~ '^D[0-9]+\.[0-9]+$'
    AND EXISTS (SELECT 1 FROM public.faraday_subdomains fs
                WHERE fs.subdomain_code = c);

  SELECT array_agg(DISTINCT x)
    INTO stripped
  FROM unnest(NEW.ifs_subdomains) AS x
  WHERE NOT (x = ANY (cleaned));

  IF stripped IS NOT NULL THEN
    RAISE WARNING 'artifacts.ifs_subdomains: stripped invalid codes % (artifact %)',
      stripped, NEW.artifact_id;
  END IF;

  NEW.ifs_subdomains := cleaned;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_artifacts_validate_ifs_subdomains ON public.artifacts;
CREATE TRIGGER trg_artifacts_validate_ifs_subdomains
  BEFORE INSERT OR UPDATE OF ifs_subdomains ON public.artifacts
  FOR EACH ROW EXECUTE FUNCTION public.artifacts_validate_ifs_subdomains();

-- ── Rollback (reversible) ───────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_artifacts_validate_ifs_subdomains ON public.artifacts;
-- DROP FUNCTION IF EXISTS public.artifacts_validate_ifs_subdomains();
-- DROP INDEX IF EXISTS public.idx_artifacts_ifs_subdomains;
-- ALTER TABLE public.artifacts DROP COLUMN IF EXISTS ifs_subdomains;
