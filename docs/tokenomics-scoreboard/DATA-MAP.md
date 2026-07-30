# Tokenomics Scoreboard — backend ↔ front-end wiring (DATA-MAP)

How the live Faraday backend (in `faraday-daily-challenge`) satisfies the front-end
`ScoreboardSnapshot` contract from `CC-PROMPT-tokenomics-scoreboard.md`
(design: claude.ai/design/p/9157d98b).

## The seam

The FE reads only `ScoreboardSnapshot` / `SubscriberPrefs`. The backend returns **exactly** that
shape — no client-side mapping. The contract lives in `src/lib/tokenomics/scoreboard-contract.ts`
(kept byte-aligned with the FE's `src/data/types.ts`). The transform that produces it from the
append-only `tokenomics_metrics` series is `src/lib/tokenomics/snapshot_v1.ts` (pure, unit-tested).

## Routes (real — swap the FE's guessed names for these)

| FE guessed (prompt §6) | Real backend route | Returns |
|---|---|---|
| `GET /api/v1/scoreboard/snapshot?region=` | **same** (also `/api/scoreboard/snapshot`) | `ScoreboardSnapshot` |
| `GET /api/v1/subscriber/prefs` | **same** (also `/api/scoreboard/prefs`) | `SubscriberPrefs` |
| `PATCH /api/v1/subscriber/prefs` | **same** | `SubscriberPrefs` |
| `GET /api/v1/scoreboard/stream` (SSE) | **not implemented** — poll on `cadenceSec` | — |

Bonus (not in the FE contract, available): `GET /api/scoreboard/series?metric_id=&window=` —
sparkline history + 7/30/90d % change + realized volatility for one `metric_id`.

## How to go live

1. Copy `httpAdapter.ts` (this folder) into the FE as `src/data/httpAdapter.ts`.
2. Set `VITE_USE_MOCK=false` and `VITE_API_BASE=https://faraday-intelligence.ai` (or the preview origin).
3. Ensure the signed-in `dc_session` token is in `localStorage` (the DC app already sets it at
   magic-link/OTP auth). The adapter sends it as `Authorization: Bearer`.
4. Apply the ingest migration + deploy per the ingest README. **Until then the snapshot returns a
   valid, all-`not_published` shape** (the backend degrades gracefully), so the FE renders live with
   empty states before data flows.

## Decisions the FE author asked to confirm

- **All regions vs one:** the snapshot carries `powerPrice` for **all** regions in `regions[]`, but
  the GPU/token tables and the fusion panel are for `selectedRegion`. **A region change refetches**
  (`?region=`). Provider pick is prefs-only, never refetches.
- **Route names:** resolved to `/api/v1/...` above (the FE's guesses are served verbatim).

## Contract mapping (backend → `ScoreboardSnapshot`)

| Field | Source in backend |
|---|---|
| `regions[].powerPrice` | `fn_scoreboard_fusion(state,iso)` per US region; non-US → `not_published` |
| `providers[]` | 3 hyperscalers (AWS/Azure/GCP) + `NEOCLOUD_ROSTER` (4 fixed + 6 candidate) |
| `gpuRows[].cells[provider]` | `tokenomics_metrics` `gpu.*` rows, region-bucketed; modes list→onDemand, committed→reserved |
| `tokenRows[]` | `token.*` rows grouped by vendor+model; tier frontier if vendor ∈ {openai,anthropic,google,xai} |
| `indexTiles[]` | Faraday-**constructed** baskets (token/gpu/quality); **fusion tile = `license_pending`** (locked scope) |
| `fusion` | `fn_scoreboard_fusion`: `powerPrice` ($/kWh), `queueDepthGw` (MW→GW), `impliedPowerSharePct` (constructed), `timeToPowerMonths` |
| `futures[]` | `futures.*` status rows; `announced-pending`→`pending` |
| `sources[]` | `tokenomics_source_registry`; `licenseStatus` from `is_third_party_index`/`display_allowed` |

## Gaps surfaced (zero fabrication — data absent, not faked)

1. **Non-US regions** (`eu-west-1`, `nordics-se`, `me-central-1`): Faraday's grid data is US-only
   (EIA utility territories + FERC queue). Their `powerPrice`/`fusion` are `not_published` until
   non-US grid sources are added. Footnote `f_nonus`.
2. **`timeToPowerMonths`**: no real lead-time column exists — Faraday exposes the deepest
   interconnection **study phase** (a label). Rendered `not_published`, not a fabricated month count.
   Footnote `f_ttp`. (The phase label is surfaced in `fusion.whyItMoved.body`.)
3. **`impliedPowerSharePct`**: derived (`provenance:"constructed"`) from an assumed GPU board draw
   (H100/H200 0.7 kW, B200 1.0, GB200 1.2 kW/GPU) × $/kWh ÷ on-demand $/GPU-hr. Footnote `f_power_share`.
   Confirm the draw constants with the desk.
4. **Index tiles** are Faraday-constructed baskets, not third-party indices (those stay ingest-only /
   `license_pending` per locked scope #2). If you want the tiles fed by a specific methodology,
   define it and swap the basket math in `snapshot_v1.ts`.
5. **`RegionId` remap**: ingested cloud-region strings (`eastus`, `southcentralus`, …) bucket into the
   FE's 6-value enum via `ingestRegionToId` in `scoreboard-contract.ts`. Extend that map for new regions.
