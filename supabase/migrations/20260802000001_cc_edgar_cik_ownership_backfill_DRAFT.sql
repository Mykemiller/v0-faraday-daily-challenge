-- CC-EDGAR-CIK-INGEST-1.0 — §5.3 ownership_public_private backfill
--
-- ############################################################
-- ##  DRAFTED, NOT APPLIED. Myke applies this one.           ##
-- ##  Ticket §6: "STOP before any write to public.companies" ##
-- ############################################################
--
-- Evidence model
-- --------------
-- A confident CIK match is positive evidence of SEC registrant status: the
-- company files with the SEC, therefore it is publicly reporting. The converse
-- does NOT hold — absence of a CIK match is not evidence of private status. It
-- may be a name-matching failure, a foreign private issuer with no US listing,
-- or a subsidiary that files under a parent. So this migration only ever writes
-- 'Public', and only where a CIK actually resolved.
--
-- Scope, measured 2026-08-02:
--   77 companies in public.company_cik (all confidence='high')
--   25 have ownership_public_private IS NULL  -> set to 'Public'
--   52 already 'Public'/'public'              -> no-op
--    0 conflicts (no resolved company is currently marked Private/Sovereign/etc.)
--
-- The WHERE clause is deliberately restricted to IS NULL so this can never
-- overwrite a human judgement, even if the resolved set changes before it runs.

begin;

update public.companies c
set ownership_public_private = 'Public',
    updated_at = now()
from public.company_cik cc
where cc.company_uid = c.company_uid
  and cc.confidence = 'high'
  and c.ownership_public_private is null;

-- Expected: UPDATE 25 (as of 2026-08-02).
--
-- NOT included, deliberately:
--   * public.company_cik_candidate rows (478 held). Suffix-stripped name
--     equality produced real false positives — Compass Datacenters vs
--     "Compass, Inc.", Tiny Corp vs "Tiny Ltd.", Vertex Holdings vs
--     "Vertex, Inc." — so those must be dispositioned by a human before any
--     ownership claim is written from them.
--   * Any inference of 'Private' from a non-match. See evidence model above.

commit;
