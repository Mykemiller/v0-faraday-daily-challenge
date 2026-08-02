# CC-EDGAR-CIK-INGEST-1.0

Resolves Faraday companies to SEC CIKs and ingests filing history from the
EDGAR submissions API. Run 2026-08-02 against `ycadmmngkdhvpcsrcuaq`.

## Applied (already live in the database)

Applied via named migrations, recorded in `supabase_migrations.schema_migrations`.
Additive only — no writes to `public.companies`.

| version | name | what it does |
|---|---|---|
| 20260802032519 | `cc_edgar_cik_0001_identity_and_filings_schema` | `sec_cik_ticker`, `company_cik`, `sec_filings` |
| 20260802032547 | `cc_edgar_cik_0002_citability_predicate_and_name_norm` | `fn_artifact_is_citable`, `fn_sec_name_norm`, `fn_sec_name_core` |
| 20260802033255 | `cc_edgar_cik_0003_submissions_fetch_helper` | `fn_sec_submissions_fetch` |
| 20260802033541 | `cc_edgar_cik_0004_identity_upsert_rpc` | `fn_sec_cik_ticker_upsert` |
| 20260802033839 | `cc_edgar_cik_0005_candidate_holding_table` | `company_cik_candidate` (held, never auto-promoted) |
| 20260802034036 | `cc_edgar_cik_0006_filing_ingest_function` | `fn_sec_ingest_filings` |
| 20260802034108 | `cc_edgar_cik_0007_filing_ingest_fix_counts` | honest `filings_seen` accounting |
| 20260802034222 | `cc_edgar_cik_0008_fix_index_fallback_url` | canonical index URL for pre-2001 filings |

Edge function: `ingest-sec-cik-identity` (v4, `verify_jwt = true`).

To export the SQL locally:

```bash
supabase db dump --schema public -f /tmp/faraday_public.sql
```

## Awaiting Myke — drafted, NOT applied

| file | gate |
|---|---|
| `20260802000001_cc_edgar_cik_ownership_backfill_DRAFT.sql` | writes to `public.companies` (§6 STOP) |
| `20260802000002_cc_edgar_fts_citability_remedy_DRAFT.sql` | reconfigures the live FTS lane (§6 STOP) |

## Access constraints found (do not "fix" these by declaring a User-Agent)

* `data.sec.gov` — reachable from Postgres. This is what filing ingest uses.
* `www.sec.gov` — **hard-403 from every Supabase egress** (Postgres *and* edge),
  under every User-Agent tried, with body `Request Rate Threshold Exceeded`.
* SEC rejects a declaring User-Agent from these egresses with
  `Undeclared Automated Tool` and accepts the pgsql-http default. This inverts
  the assumption in ticket §6; it is verified twice, independently.
* Consequence: the identity file (`www.sec.gov/files/company_tickers.json`)
  cannot be fetched server-side. It is POSTed to `ingest-sec-cik-identity` by a
  client that can reach `www.sec.gov`. Filing ingest is unaffected.
