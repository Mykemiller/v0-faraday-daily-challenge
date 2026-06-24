# FAR-189 — Crawler Fleet Reconciliation (8 → 27 automations)

**Date:** 2026-06-24
**Sources reconciled:**
1. Operational fleet — `supabase/functions/faraday-crawl/index.ts` (`BASE_AUTOMATIONS`)
   merged with `coverage-bridge.ts` (`TIER1_ACTIVATION`) via `mergeApproved`.
2. Airtable Automation Registry — base `appxfti7VuoHYUeu6`, table `tbl1ef6FgxUc3Uevg`
   (field `AUTO ID` = `fldUqqRnGeOQzyr7j`, `Status` = `fldk6NPtWxxhcH5Qi`).
3. pg_cron — Supabase project `ycadmmngkdhvpcsrcuaq`, `cron.job`.

## Architecture note (why "cron active?" is one row, not 27)

The 27 web-search-eligible automations do **not** each own a pg_cron job. They are
all executed inside the **single** `faraday-crawl` edge function, which is driven by
one cron job — `faraday-crawl-daily` (`0 7 * * *`, active). "Cron active" below
therefore means "covered by the active `faraday-crawl-daily` job + present in the
function's `AUTOMATIONS` list." Per-automation health is logged to
`automation_health_log` on every run (the authoritative health source — pg_cron
"succeeded" only means the `net.http_post` was queued).

## Reconciliation table — 27 web-search-eligible automations

| AUTO-ID | In fleet (`index.ts`)? | Airtable registered? | Airtable Status | Driven by `faraday-crawl-daily`? |
|---|---|---|---|---|
| AUTO-001 | ✅ | ✅ | Active | ✅ |
| AUTO-011 | ✅ | ✅ | Active | ✅ |
| AUTO-012 | ✅ | ✅ | Active | ✅ |
| AUTO-013 | ✅ | ✅ | Active | ✅ |
| AUTO-014 | ✅ | ✅ | Active | ✅ |
| AUTO-016 | ✅ | ✅ | Active | ✅ |
| AUTO-017 | ✅ | ✅ | Active | ✅ |
| AUTO-023 | ✅ | ✅ | Active | ✅ |
| AUTO-024 | ✅ | ✅ | Active | ✅ |
| AUTO-027 | ✅ | ✅ | Active | ✅ |
| AUTO-028 | ✅ | ✅ | Active | ✅ |
| AUTO-029 | ✅ | ✅ | Active | ✅ |
| AUTO-030 | ✅ | ✅ | Active | ✅ |
| AUTO-031 | ✅ | ✅ | Active | ✅ |
| AUTO-032 | ✅ | ✅ | Active | ✅ |
| AUTO-033 | ✅ | ✅ | Active | ✅ |
| AUTO-034 | ✅ | ✅ | Active | ✅ |
| AUTO-036 | ✅ | ✅ | Active | ✅ |
| AUTO-037 | ✅ | ✅ | Active | ✅ |
| AUTO-038 | ✅ | ✅ | Active | ✅ |
| AUTO-040 | ✅ | ✅ | Active | ✅ |
| AUTO-041 | ✅ | ✅ | Active | ✅ |
| AUTO-043 | ✅ | ✅ | Active | ✅ |
| AUTO-044 | ✅ | ✅ | Active | ✅ |
| AUTO-045 | ✅ | ✅ | Active | ✅ |
| AUTO-046 | ✅ | ✅ | Active | ✅ |
| AUTO-047 | ✅ | ✅ | Active | ✅ |

**27 / 27 reconciled — no gaps, no missing AUTO-IDs, no new IDs required.**

## Tier-1 IDF 4.0 dedicated crawlers (also live in the fleet, FAR-200)

These 10 are merged into `AUTOMATIONS` via `TIER1_ACTIVATION` and registered Active:

| AUTO-ID | In fleet? | Airtable Status | Driven by cron? |
|---|---|---|---|
| AUTO-060 | ✅ | Active | ✅ |
| AUTO-061 | ✅ | Active | ✅ |
| AUTO-062 | ✅ | Active | ✅ |
| AUTO-063 | ✅ | Active | ✅ |
| AUTO-064 | ✅ | Active | ✅ |
| AUTO-065 | ✅ | Active | ✅ |
| AUTO-066 | ✅ | Active | ✅ |
| AUTO-067 | ✅ | Active | ✅ |
| AUTO-068 | ✅ | Active | ✅ |
| AUTO-069 | ✅ | Active | ✅ |

**Live fleet total: 37 automations (27 backbone + 10 Tier-1), all Active + cron-driven.**

## Excluded by design (MCP / desktop-agent dependent — NOT web-search-eligible)

These are registered in Airtable but intentionally **not** in `faraday-crawl`
(they require the full desktop-agent run, not the edge function): LinkedIn
(AUTO-002, AUTO-015), CB Insights (AUTO-019), Morningstar (AUTO-020), DC Hub
(AUTO-022), SEC EDGAR (AUTO-042). Not a gap.

## pg_cron snapshot (relevant jobs)

| jobname | schedule (UTC) | active | drives |
|---|---|---|---|
| `faraday-crawl-daily` | `0 7 * * *` | ✅ | all 37 crawl automations |
| `enrich-artifacts-drain` | `*/30 * * * *` | ✅ | enrich pipeline (downstream) |

No cron schedule values were changed (per task boundary).

## Result

**Fully reconciled. Zero mismatches between the operational fleet, the Airtable
Automation Registry, and pg_cron.** No mismatch rows were written to
`automation_health_log` because there are none to report. No new AUTO-IDs were
assigned (next free remains AUTO-177 per the IDF coverage canon; AUTO-134 is an
Active engine fn, not free).
