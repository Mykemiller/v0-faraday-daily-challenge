# CC-INGEST-TOKENOMICS-SCOREBOARD-1.0 — Tokenomics Scoreboard back end

Ingestion + append-only time-series + API layer behind the Faraday Tokenomics Scoreboard front end.
Metric groups **A/B/C/D are reused verbatim** from the Scoreboard model (no new model invented).

> **GOVERNANCE — this CC delivers code + an UN-APPLIED migration + a PROPOSED AUTO id only.**
> No schema apply, no deploy, no prod seed, no AUTO assignment, and **no third-party index value
> returned with `display_allowed=true`** without Myke's explicit sign-off. Promotion is a separate,
> gated step (see *Promotion* below).

## What's here

| Piece | Path |
|---|---|
| Un-applied schema migration | `supabase/migrations/20260727000001_tokenomics_scoreboard.sql` |
| Un-applied cadence schedule | `supabase/migrations/20260727000002_schedule_tokenomics.sql` |
| Ingest orchestrator (edge fn) | `supabase/functions/ingest-tokenomics/index.ts` |
| Pure helpers · roster · adapters · fusion | `metrics.ts` · `roster.ts` · `adapters.ts` · `fusion.ts` |
| Edge fn tests (deno) | `ingest-tokenomics.test.ts` |
| Read layer (types/series/snapshot/roster/fusion) | `src/lib/tokenomics/*.ts` |
| Read layer tests (deno) | `src/lib/tokenomics/tokenomics.test.ts` |
| API routes | `src/app/api/scoreboard/{snapshot,series,prefs}/route.ts` |
| Proposed AUTO registry row | `AUTO-191.proposed.json` |

## Data model — append-only time series

`tokenomics_metrics` is **append-only**: a value is never `UPDATE`d in place. A corrected/changed
reading for the same `as_of` is a **new vintage row** (distinct `content_hash`). Deltas (7/30/90-day
% change) and realized volatility are **derived at read time** (`fn_tokenomics_series` in SQL,
`src/lib/tokenomics/series.ts` in the API), never stored stale.

Columns: `metric_id` (stable slug, e.g. `gpu.h100.ondemand.aws.us-east-1`) · `category` (A/B/C/D) ·
`subject` · `provider` · `region` · `sku` · `pricing_mode` (ondemand/reserved/committed/spot/list) ·
`value` · `unit` · `as_of` · `ingested_at` · `source` · `source_tier` (1/2/3) · `source_url` ·
`confidence` (verified/as-reported/unverified) · `display_allowed` · `why_note` (fusion) ·
`content_hash`.

## Dedup / idempotency (dedup on the FIGURE, not the row)

- **Content hash** basis = `metric_id | as_of | source | value | unit | pricing_mode | confidence |
  display_allowed`. A re-fetch that only re-times or re-links the same reading is a **no-op**; a
  changed value is a **new vintage**.
- A single run may see one canonical figure via multiple citations — `dedupeByHash` collapses those
  before insert. Upsert is `on_conflict (metric_id, as_of, source, content_hash) ignore-duplicates`.

## Cadence

- **Daily (scheduled cron)** — group A commodity feed (aipricing.guru), group B GPU on-demand +
  reserved + spot (Azure Retail Prices, keyless), group C futures **status**, and the **grid fusion**
  (wired first). All idempotent.
- **Manual-capture (POSTed, not scheduled)** — 403-prone frontier vendor pages (OpenAI/Anthropic/
  Google/xAI), quality/throughput publishers (Epoch AI, Artificial Analysis), the licensed
  third-party indices, and quarterly/yearly demand forecasts + hyperscaler disclosures. The desktop
  agent / operator POSTs `{captures:[{source, payload}]}` on the source's own cadence. Each capture
  still writes a health-log row.
- **AWS / GCP / neoclouds** ship as `pending_source_confirmation` adapters (parsers written +
  tested; endpoint/field-map or key not yet confirmed). They log an explicit `no_data_this_run`
  health row — never a guess — until wired.

## Zero-fabrication

A 403'd / empty / unpublished source yields **nothing** ("not published"), never a guessed value.
Snippet-/unverifiable-sourced readings carry `confidence='unverified'` and are surfaced as such,
never laundered clean. Futures store **status** (`unit='status'`, `value=null`); a **price is written
only once an instrument actually trades**. Fusion preserves `null` grid figures (the gap is
explicit); `time_to_power` is a study-phase **proxy**, flagged as such, not a fabricated lead time.

## Editorial gate (FAR-56)

Tiering and frontier-vs-commodity calls route through the FAR-56 editorial gate. `source_tier` and
`confidence` on each row are the machine-readable outcome of that gate; the `tokenomics_source_registry`
holds the canonical tier/cadence/attribution per source.

## Display gate (third-party indices = ingest-only)

**Locked scope decision #2.** Third-party constructed indices (Tokenix/ACPI, TPI, Ornn OTPI/OCPI,
Silicon Data SDLLMTK / GPU index) are **ingested for internal tracking** but **`display_allowed=false`
globally**. The snapshot API returns their **existence + as-of + source + a
`"licensed source — display pending"` placeholder only — never the value**. The gate is enforced in
three places: the ingest adapter (`parseIndexCapture` hard-sets `display_allowed=false`), the SQL
read RPC (`fn_tokenomics_snapshot_rows` nulls the value), and the assembler (attaches the
placeholder). The gate is **config, not code** — flip `tokenomics_source_registry.display_allowed`
per source at subscriber launch **after licensing sign-off** (a CHECK forbids displaying an
unlicensed index). **Flag for legal before any index value ships.**

## Roster config (the pickable 5th column)

**Locked scope decision #1.** `NEOCLOUD_ROSTER = { fixed:[CoreWeave, Lambda, Nebius, Crusoe],
candidates:[Together AI (default), Voltage Park, Fluidstack, Nscale, Vast.ai, DataCrunch] }` — ranked
via SemiAnalysis ClusterMAX + Silicon Data coverage. We **ingest the full pool** so any subscriber
pick already has data. The snapshot returns the 4 fixed + the full candidate pool; the FE renders 4
fixed + the chosen 5th. The pick persists per subscriber in `dc_subscribers.scoreboard_prefs` jsonb
via `POST /api/scoreboard/prefs` (session-token → service-role, mirrors `/api/account`).
Canonical roster: `src/lib/tokenomics/roster.ts`; edge copy: `supabase/functions/.../roster.ts`
(kept in sync).

## Fusion join (wired first — the differentiator)

**Locked scope decision #3.** Per region, `fn_scoreboard_fusion(state_abbr, iso_rto)` joins the
region-keyed power price (`eia_utility_territories.avg_retail_price_cents_kwh`, sales-weighted, latest
report year → `$/kWh`) and interconnection-queue depth (`ferc_queue_county_rollup.total_queued_mw` /
`queue_entries`, with the deepest study phase as a `time_to_power` proxy) from Faraday's live grid
tables. Region→geography is resolved by `REGION_GRID_MAP` (cloud region → state + ISO). When a
region's GPU on-demand price move coincides with a grid signal, `fusionMetrics` generates a
`why_note`. The orchestrator runs fusion **before** the other adapters.

## API contract

- `GET /api/scoreboard/snapshot?region=&pick5=` → typed `scoreboard_snapshot` ({ as_of, region,
  indices, tokens, gpus, neocloud_roster, fusion, futures, footnotes }). Gated indices return
  `value:null` + placeholder. Every element carries `as_of/source/tier/confidence` for badging.
- `GET /api/scoreboard/series?metric_id=&window=` → sparkline points + 7/30/90d % change + realized
  volatility (derived). A gated metric returns the placeholder, no values.
- `GET|POST /api/scoreboard/prefs` → per-subscriber pick5 + region persistence.

## Secrets (set in Supabase before go-live)

`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (self-chain bearer), optional
`TOKENOMICS_INGEST_SECRET` (body secret gate). The Next API needs `SUPABASE_SERVICE_ROLE_KEY` in
Vercel.

## Tests

```bash
# edge function (pure modules + adapters + fusion)
deno test --allow-net supabase/functions/ingest-tokenomics/
# read layer (series + snapshot assembler + roster + fusion map)
deno test --unstable-sloppy-imports --allow-net src/lib/tokenomics/
```

All fixtures are captured-**shape** payloads used to pin parser/assembler behavior — they are test
inputs, not asserted market data.

## Promotion (gated — do NOT do any of this without Myke's sign-off)

1. Reserve **AUTO-191** (or the next free id) in the Airtable Automation Registry — see
   `AUTO-191.proposed.json`. Verify it doesn't collide (FEMA=184, EIA=190 in sibling repos).
2. Apply `20260727000001_tokenomics_scoreboard.sql` to `ycadmmngkdhvpcsrcuaq`; run `get_advisors`.
3. Deploy the `ingest-tokenomics` edge function (`verify_jwt:false`); set secrets.
4. Set `SUPABASE_SERVICE_ROLE_KEY` in Vercel for the API routes.
5. Apply `20260727000002_schedule_tokenomics.sql` (starts the daily cron).
6. **Legal:** before flipping any `tokenomics_source_registry.display_allowed=true` for a
   third-party index, obtain written licensing sign-off. Flip per source, one at a time.
