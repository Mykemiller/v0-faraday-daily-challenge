# Pipeline Hardening (FAR-188 / 189 / 190 / 214)

Branch: `claude/pipeline-hardening-yttz9i` · Date: 2026-06-24

## FAR-188 — faraday-crawl gather-phase parser hardening
- Per-record `try/catch` isolation in the gather phase (`normalizeRecords`,
  exported from `supabase/functions/faraday-crawl/index.ts`). One malformed/hostile
  record is skipped and logged; the rest of the batch still produces artifacts.
- Chunked artifact insert (`ARTIFACT_CHUNK_SIZE = 10`, matches the Airtable
  10-record limit): a failing chunk is isolated and logged, remaining chunks land.
- **Parse errors → `automation_health_log`.** The live table has **no `status`
  column** (verified via `information_schema`), so a parse failure is recorded as a
  `success = false` row with a `parse_error:` notes prefix and an `errors` jsonb
  `{kind:"parse_error", reason, excerpt}`. Every row carries the `auto_id` FK.
- Tests: `faraday-crawl.test.ts` — 50-record batch with one throwing record still
  yields 49 artifacts + 1 parse_error; null/non-object records skipped (not fatal).

Sample `parse_error` health-log row:
```json
{
  "auto_id": "AUTO-001",
  "crawler_id": "AUTO-001_v1.0",
  "run_started_at": "2026-06-24T07:00:00.000Z",
  "run_completed_at": "2026-06-24T07:01:12.000Z",
  "artifacts_found": 0, "artifacts_new": 0, "artifacts_duped": 0,
  "success": false,
  "errors": [{ "kind": "parse_error", "reason": "boom-record", "excerpt": "{\"auto_id\":\"AUTO-001\",...}" }],
  "notes": "parse_error: boom-record"
}
```

## FAR-189 — Crawler fleet reconciliation (8 → 27)
- See `far-189-fleet-reconciliation.md`. **27 / 27 web-search automations + 10
  Tier-1 (AUTO-060–069) + AUTO-049 (email) are all registered Active in Airtable**
  (`tbl1ef6FgxUc3Uevg`) and driven by the single active `faraday-crawl-daily` cron.
  Zero mismatches → nothing written to `automation_health_log`. No new AUTO-IDs.

## FAR-190 — Email ingest hardening (BLOCKED)
- `ingest-email/index.ts`: sender allowlist (forward@ → `mykemiller@gmail.com`),
  `source_type = 'email'`, constant-time secret check, idempotent dedup, and health
  logging to `automation_health_log` on both success and failure. Helper functions
  exported so `ingest-email.test.ts` can import them.
- Migration SQL output (do **not** run without approval):
  `far-190-source_type_enum.sql`. **Note:** the `email` enum label is already live
  on the project; the file is the canonical approval artifact (no-op on prod).
- **Blocked on Myke:** (1) approve the `source_type_enum` migration, (2) approve
  the AUTO-049 Airtable registration (already present as Active — confirm).

## FAR-214 — Reconcile library_catalog_cache (BLOCKED, Myke runs)
- DELETE output: `far-214-library_catalog_cache-delete.sql`. Removes the **59**
  `status='Coming Soon' AND array_length(subdomains,1) > 0` rows (sub-domain
  placeholders now Draft in Airtable, blocked by the status CHECK constraint).
  Count verified = 59. **Not executed.**

## Open Myke actions
| # | Action | Ticket |
|---|---|---|
| a | Approve `source_type_enum` migration + run `far-190-source_type_enum.sql` (no-op on prod) | FAR-190 |
| b | Approve / confirm AUTO-049 Airtable registration (currently Active) | FAR-190 |
| c | Run `far-214-library_catalog_cache-delete.sql` (59 rows) | FAR-214 |
| d | Review + merge this PR | — |
