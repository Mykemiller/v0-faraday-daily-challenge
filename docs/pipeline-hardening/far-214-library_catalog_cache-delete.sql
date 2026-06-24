-- ============================================================================
-- FAR-214 — Reconcile library_catalog_cache  (BLOCKED: Myke runs this)
-- ----------------------------------------------------------------------------
-- The 59 sub-domain placeholder briefings were set to "Draft" in Airtable. A
-- CHECK constraint on library_catalog_cache.status allows only
-- ('Available','Coming Soon'), so "Draft" rows cannot be stored — they must be
-- removed from the cache. These rows are the "Coming Soon" entries that carry a
-- non-empty subdomains[] array (the sub-domain placeholders).
--
-- *** DO NOT RUN. Output only. Myke runs this after review. ***
--
-- Verified against live project ycadmmngkdhvpcsrcuaq (2026-06-24):
--   total rows           = 416
--   status='Coming Soon' = 416
--   target (this DELETE) =  59   <-- matches the FAR-214 expectation
--
-- Pre-flight (run first to confirm the count is still 59):
--   SELECT count(*) FROM public.library_catalog_cache
--    WHERE status = 'Coming Soon' AND array_length(subdomains, 1) > 0;
-- ============================================================================

DELETE FROM public.library_catalog_cache
WHERE status = 'Coming Soon'
  AND array_length(subdomains, 1) > 0;

-- Post-check (expect 0):
--   SELECT count(*) FROM public.library_catalog_cache
--    WHERE status = 'Coming Soon' AND array_length(subdomains, 1) > 0;
