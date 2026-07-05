-- ============================================================================
-- subdomain-feed-coverage.sql — per-sub-domain live-feed status (FAR-319 Wave 0)
--
-- Rule: a sub-domain is "fed" iff ≥1 artifact is tagged to it in the trailing
-- 14 days. One row per faraday_subdomains row (116) — the shape the workbench
-- IDF health board consumes:
--   subdomain_code · domain_code · display_name · artifacts_14d ·
--   last_artifact_at · fed (boolean)
--
-- Read-only; no schema change. The tag source is BOTH columns:
--   • artifacts.ifs_subdomains  — the Wave-0 column (post-migration rows)
--   • D#.# codes inside artifacts.ifs_domains — the pre-Wave-0 convention the
--     Tier-1/Tier-2 dedicated crawlers used (historical rows, until the
--     backfill's Phase A normalizes them)
-- so the numbers are correct before, during, and after the backfill.
--
-- NOTE (pre-migration databases): if ifs_subdomains does not exist yet,
-- replace `a.ifs_domains || COALESCE(a.ifs_subdomains, '{}')` with
-- `a.ifs_domains` — the rest is unchanged. That variant produced the Wave-0
-- baseline of 60/116 fed (2026-07-05).
-- ============================================================================

WITH fed AS (
  SELECT sub.code,
         count(*)               AS artifacts_14d,
         max(a.discovered_at)   AS last_artifact_at
  FROM artifacts a
  CROSS JOIN LATERAL (
    SELECT DISTINCT t AS code
    FROM unnest(a.ifs_domains || COALESCE(a.ifs_subdomains, '{}')) AS t
    WHERE t ~ '^D[0-9]+\.[0-9]+$'
  ) sub
  WHERE a.discovered_at > now() - interval '14 days'
  GROUP BY sub.code
)
SELECT fs.subdomain_code,
       fs.domain_code,
       fs.display_name,
       COALESCE(f.artifacts_14d, 0)      AS artifacts_14d,
       f.last_artifact_at,
       COALESCE(f.artifacts_14d, 0) >= 1 AS fed
FROM faraday_subdomains fs
LEFT JOIN fed f ON f.code = fs.subdomain_code
ORDER BY split_part(substr(fs.subdomain_code, 2), '.', 1)::int,
         split_part(fs.subdomain_code, '.', 2)::int;

-- Headline number (X/116 fed):
-- WITH fed AS ( … same CTE … )
-- SELECT count(*) FILTER (WHERE f.code IS NOT NULL) AS fed,
--        count(*)                                   AS total
-- FROM faraday_subdomains fs
-- LEFT JOIN fed f ON f.code = fs.subdomain_code;
