# Faraday Tokenomics Scoreboard — ingestion + time-series + API layer

Backend behind the Tokenomics Scoreboard front end. Follows the existing Faraday
source-poller conventions (Supabase `ycadmmngkdhvpcsrcuaq`; Next `/api/cron`
poller; content-hash idempotency; `automation_health_log`; pure module + tests).

> **GOVERNANCE — nothing is promoted in this change.** Code + an **un-applied**
> migration + a **proposed** AUTO id only. Do NOT apply schema, deploy, seed prod,
> assign the AUTO id, or ship any third-party index value with
> `display_allowed=true` without Myke's explicit sign-off. Promotion is a
> separate, gated step (checklist at the bottom).

## What shipped (this branch)

| Piece | Path |
| --- | --- |
| Append-only time-series migration (**UN-APPLIED**) | `supabase/migrations/20260727000001_tokenomics_scoreboard.sql` |
| Pure core (types, roster, metric/hash, series, snapshot, fusion, display gate) | `src/lib/tokenomics/*.ts` |
| Per-source adapters (kind-dispatch) | `src/lib/tokenomics/adapters/*.ts` |
| Server DB helper (service-role PostgREST) | `src/lib/tokenomics/db.ts` |
| Snapshot API | `src/app/api/scoreboard/snapshot/route.ts` |
| Series API | `src/app/api/scoreboard/series/route.ts` |
| Per-subscriber pick persistence | `src/app/api/scoreboard/pick/route.ts` |
| Cron poller | `src/app/api/cron/tokenomics-ingest/route.ts` |
| Tests (real captured rows) | `src/lib/tokenomics/**/*.test.ts` (`npm test`, 29 green) |

## Data model — append-only time series

`tokenomics_metrics` is **append-only**. A value is **never** updated in place —
a changed reading inserts a new dated vintage. 7/30/90-day % change and realized
volatility are **derived at read time** (`series.ts`), never stored stale.

Columns: `metric_id` (stable slug, e.g. `gpu.h100.ondemand.aws.us-east-1`) ·
`category` (A token / B gpu / C futures / D demand-context) · `subject` ·
`provider` · `region` · `sku` · `pricing_mode` (ondemand/reserved/committed/
spot/list) · `value` · `unit` · `as_of` · `ingested_at` · `source` ·
`source_tier` (1/2/3) · `source_url` · `confidence` (verified/as-reported/
unverified) · `display_allowed` · `why_note` (fusion) · `content_hash` · `meta`
(quality_adj, tps, status, volume, attribution, citations).

**Idempotency.** Unique index `(metric_id, as_of, source, content_hash)`. The
`content_hash` (sha256 over the semantic figure) is part of the key, so an
unchanged re-fetch collides → `ON CONFLICT DO NOTHING` (no-op); any changed field
→ a new hash → a new vintage. `why_note`/`ingested_at` are excluded from the hash
so derived narrative never churns a vintage.

## Metric groups A/B/C/D (reused verbatim — no new model)

- **A — token/inference pricing.** Frontier vendor pages (OpenAI/Anthropic/Google/
  xAI, T1, 403-prone → headless/semi-manual with as-of); commodity via
  aipricing.guru JSON + UsagePricing (T3); constructed indices Tokenix/ACPI (T1),
  TPI (T2), Ornn/OTPI, Silicon Data SDLLMTK (**ingest-only**,
  `display_allowed=false`); quality-adjusted via Epoch AI + Artificial Analysis (T1).
- **B — GPU rental.** AWS P5/P5e/P5en/P6/P6e, Azure ND H100/H200/GB200 v5/v6, GCP
  A3/A4/A4X (on-demand + reserved/CUD/Savings + spot, per region). Neoclouds =
  the `NEOCLOUD_ROSTER` pool. Reference indices Silicon Data / Ornn OCPI (T1,
  **ingest-only**).
- **C — futures.** Status + (once live) price/volume for CME×Silicon Data,
  ICE×Ornn, ICE×NATIVX/COIL, SHFE. **Status always; a price ONLY once an
  instrument actually trades.** Never render a price for a non-tradeable instrument.
- **D — demand-side context + FUSION** (the differentiator, **wired first**).
  Training-vs-inference mix, hyperscaler token-volume, power-demand forecasts
  (IEA/Goldman/MS). **Fusion join:** per region, join power price `$/kWh` +
  interconnection-queue depth / time-to-power from Faraday's own grid plane
  (DC Hub / grid tables) onto region-keyed GPU rows, and generate a `why_note`
  when a price move coincides with a grid signal (`fusion.ts`).

## Cadence

| Group | Cadence |
| --- | --- |
| A tokens (vendor + commodity) | near-daily snapshot |
| A/B constructed indices | publisher cadence |
| B GPU on-demand | daily |
| B GPU reserved/committed | weekly |
| C futures | event + monthly |
| D demand context | quarterly (mix ~yearly) |

Each cron run writes one `automation_health_log` row (`auto_id`, `crawler_id`,
found/new/duped, success, errors, notes).

## Dedup — on the figure, not the row

Several sources can report the **same** figure — that is **one canonical reading
with multiple citations**, not multiple rows. `dedupeByFigure()` (`metric.ts`)
groups by the source-independent figure key `(metric_id, as_of, value, unit,
pricing_mode)`, keeps the highest-tier / highest-confidence source as canonical,
and stashes the rest as `meta.citations`.

## Zero-fabrication

- Unverifiable / snippet-sourced → `confidence='unverified'`, surfaced as such,
  never laundered to `verified`.
- A 403'd page yields "not published," not a guess (frontier vendor pages are
  headless/semi-manual with an explicit as-of).
- A non-tradeable future never carries a value (`value=null`, status only).
- The fusion `why_note` fires only when a **real** price move meets a **real**
  grid constraint, and is worded as correlation, not confirmed causation.
- The live vendor fetch is **deploy-gated** (`gatherRawSources()` returns `[]`
  until wired) — the poller no-ops honestly rather than seeding placeholder data.

## Editorial gate (FAR-56)

Tiering and frontier-vs-commodity calls route through the FAR-56 editorial gate.
`source_tier` + `is_third_party_index` live in `tokenomics_source_registry` (and
mirrored in `display-gate.ts` `SOURCE_REGISTRY`) — the single place an editor
adjusts a source's tier/cadence/gate.

## Display gate — third-party indices are INGEST-ONLY

Locked scope #2: internal/design stage, no subscribers yet. Third-party index
values (Ornn/OCPI, Tokenix/ACPI, TPI, Epoch/AA where index-typed, Silicon Data)
are ingested for internal tracking but **`display_allowed=false` globally**.

- `stampDisplayGate()` forces `display_allowed=false` for any source flagged
  `is_third_party_index` at ingest — a gated value can never slip in open.
- The snapshot/series APIs **omit the value** for gated rows: they return
  existence + `as_of` + `source` + a `"licensed source — display pending"`
  placeholder (`value: null`, empty spark, null deltas).
- The gate flips on **later, per source**, at subscriber launch + licensing
  sign-off. **Flag for legal before any value ships.** Never return a third-party
  index value with `display_allowed=true` without Myke's explicit sign-off.

## Roster config — the subscriber-pickable 5th column (locked scope #1)

`NEOCLOUD_ROSTER` (`roster.ts`), ranked/selected via SemiAnalysis ClusterMAX +
Silicon Data coverage:

- **Fixed (4, always rendered):** CoreWeave, Lambda, Nebius, Crusoe.
- **Candidate pool (the pickable 5th):** Together AI (**default**), Voltage Park,
  FluidStack, Nscale, Vast.ai, DataCrunch.

We **ingest the 4 fixed + the full candidate pool** so any pick already has data.
The snapshot API returns the 4 fixed + the full candidate pool; the front end
renders 4 fixed + the subscriber's chosen 5th. The pick persists per subscriber in
`dc_subscribers.scoreboard_prefs` (jsonb) via `/api/scoreboard/pick` (mirrors the
`/api/account` token/service-role pattern). An invalid pick falls back to the
default.

## API contract

- `GET /api/scoreboard/snapshot?region=…&pick5=<provider>` → typed
  `scoreboard_snapshot` (`indices`, `tokens`, `gpus`, `neocloud_roster`, `fusion`,
  `futures`, `footnotes`; every element carries `as_of`, `source`, `tier`,
  `confidence`/`display_allowed` for stale/unverified/gated badging). Gated index
  values are null + placeholder.
- `GET /api/scoreboard/series?metric_id=…&window=7d|30d|90d|1y|all` → history +
  read-time deltas + realized volatility (gated metrics return null values +
  placeholder note).
- `GET|POST /api/scoreboard/pick` → per-subscriber 5th-column persistence.

## Proposed AUTO id + registry row (NOT assigned)

Per this repo's canon, `AUTO-178` = crawl healthcheck and the Wave-3 note records
**next free = `AUTO-183`** (AUTO-179–182 are proposed placeholders for displaced
D-scaffolds). This poller proposes:

| Field | Value |
| --- | --- |
| **AUTO id** | `AUTO-183` *(PROPOSED — pending Myke's Registry grant)* |
| **Name** | Tokenomics Scoreboard Ingest |
| **Crawler ID** | `tokenomics-ingest_v1.0` |
| **Status** | Designed (flip to Active at promotion) |
| **Cadence** | Daily (per-group sub-cadence above) |
| **Function** | `/api/cron/tokenomics-ingest` |
| **Domain** | Tokenomics / market-price intelligence |
| **Notes** | Append-only tokenomics time series; content-hash idempotent; display-gated third-party indices |

The cron stamps `auto_id='AUTO-183'` on its health rows. If a collision surfaces
at grant time, repoint the constant in the route and this row together.

## Env required (set in Vercel before promotion)

- `SUPABASE_SERVICE_ROLE_KEY` — reads/writes `tokenomics_metrics`, reads
  `dc_subscribers`/`dc_sessions`, writes `automation_health_log`.
- `CRON_SECRET` — Bearer auth for the poller.
- Vendor keys at promotion: AWS/Azure/GCP catalog API creds; index licensing keys
  (only when a gate flips).

## Promotion checklist (separate, gated — do each with Myke's sign-off)

1. Apply `20260727000001_tokenomics_scoreboard.sql` (`supabase db push`).
2. Confirm RLS deny-all posture (service role bypasses); advisor shows only the
   intended `rls_enabled_no_policy` INFO on the new tables.
3. Seed `tokenomics_source_registry` from `SOURCE_REGISTRY`.
4. Grant/assign **AUTO-183** in the Airtable Automation Registry; flip Designed→Active.
5. Wire `gatherRawSources()` to live fetchers; wire `readGridSignal()` to the grid
   plane. Run once with `?force`-equivalent, verify a healthy `automation_health_log`
   row + idempotent re-run (0 new).
6. Add the poller to `vercel.json` cron + a pg_cron `net.http_post` job.
7. **Legal sign-off per third-party index** before flipping any source's
   `display_allowed` TRUE. Until then the snapshot ships placeholders only.
