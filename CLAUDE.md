@AGENTS.md

## Faraday Intelligence site canon (set 2026-06-19, engine-as-site — approved by Myke; FAR-119)

This repo **is the entire `faraday-intelligence.ai` site** — not just the Daily
Challenge. The domain `faraday-intelligence.ai` (+ `www`) lives on this Vercel
project (`v0-faraday-daily-challenge-n2u5`, `prj_A7MhvdAWivMLOccGMTp6AFYZQ1s1`).

Routes:
- `/` — storefront homepage, 8 storefronts (`src/app/page.tsx`)
- `/challenge` — Daily Challenge lobby; `/daily-challenge` rewrites to it (canonical DC URL)
- per-product stub pages (`/intelligent-alert`, `/live-agent`, `/briefing-library`,
  `/jurisdiction-watch`, `/signal-room`, `/thought-forge`, `/academy`)
- `/leaderboard` — scaffold (Preview; full build gated on FAR-64/71)
- `/api/ask` (server-side Anthropic), `/api/subscribe` (Beehiiv), `/api/lexicon` (Airtable)

Invariants:
- **No `basePath`** (the domain root is served here). Don't re-add it.
- `faradaydailychallenge.com` (+ `www`) **301** → `faraday-intelligence.ai/daily-challenge`
  via the host-conditioned edge redirect in `vercel.json` (a real 301 — Next
  `redirects()` only emit 307/308).
- Production deployment URL must stay public (Deployment Protection = *Only Preview
  Deployments*) so the custom domains serve.
- Env required: `ANTHROPIC_API_KEY`, `BEEHIIV_API_KEY`, `BEEHIIV_PUB_ID`, `AIRTABLE_API_KEY`.
- Per-product token meters are **DRAFT (FAR-46)** — do not publish meter values.
  IDF copy is count-agnostic (Nine Core Domains OK; total count unpublished).
- The brand repo `Faraday-intelligence` is **retired/dormant** (no production
  domain). Do not build new surfaces there. This supersedes the earlier
  basePath+proxy arrangement (FAR-63) and reverses Decision Log D2.

## Daily Todo Digest — faraday-todo-daily (AUTO-050, CC-13, added 2026-06-24)

Edge function `supabase/functions/faraday-todo-daily/index.ts` fires daily at **05:00 CT**
(DST-safe: pg_cron fires at both 10:00 UTC and 11:00 UTC; function guards on
`America/Chicago` hour 5). Sends "Myke's Faraday Todo List" to mykemiller@gmail.com.

**Data pulled (read-only):**
- **Jira:** open FAR issues + 24h transitions (REST v3, cloud `2cdbb127-783f-4329-bec5-26223393fcfe`)
- **GitHub:** commits + open/merged PRs in last 24h across 6 repos (`GITHUB_READ_PAT`)
- **Engine health:** artifact count + stale-automation check from `automation_health_log`

**Snapshot + diff:** writes to `register_daily_snapshot` (unique on `snapshot_date` CT date).
Diffs status changes vs yesterday's `jira_open` snapshot column. `email_sent=true` gates
idempotency — the second cron fire at 11:00 UTC is a no-op if the first succeeded.

**Email transport:** Resend (`RESEND_API_KEY`), from `challenge@faraday-intelligence.ai`.
Failure sends a short "digest failed" notice and writes a health-log row — never fails silent.

**Secrets required (set in Supabase before go-live):**
- `JIRA_API_TOKEN` — Atlassian API token for mykemiller@gmail.com
- `JIRA_USER_EMAIL` — defaults to `mykemiller@gmail.com` if not set
- `GITHUB_READ_PAT` — GitHub PAT with read access to all 6 repos
- `RESEND_API_KEY` — already provisioned

**pg_cron jobs:** `faraday-todo-daily-1000utc` (`0 10 * * *`) + `faraday-todo-daily-1100utc`
(`0 11 * * *`) — both active in `cron.job`. Migration:
`supabase/migrations/20260624000001_register_daily_snapshot.sql`.

**Airtable:** AUTO-050 registered in Automation Registry (`appxfti7VuoHYUeu6 / tbl1ef6FgxUc3Uevg`,
record `recvgnvCL3etK0Vs4`). **Pending Myke approval before production deployment.**

**Tests:** `supabase/functions/faraday-todo-daily/faraday-todo-daily.test.ts`

## Daily Challenge rotation cron (AUTO-128, fixed 2026-06-22)

The Daily Challenge serves the Airtable **Puzzle Bank** (`src/lib/airtable-puzzle-bank.js`):
base `appxfti7VuoHYUeu6`, table `tbliJaRmctbIWJC43` ("Faraday Puzzle Bank").
`/api/challenge/today` reads `Published = "Live"`; `/api/cron/rotate` rotates the
serve set nightly at midnight America/Chicago.

**Root cause of the recurring 500 (fixed):** the helper read the Airtable key from
`FARADAY_AIRTABLE_API_KEY`, but the June-19 engine-as-site migration (FAR-119)
standardized Airtable creds under **`AIRTABLE_API_KEY`** (see `/api/lexicon`), which
is what production provisions. The key was therefore unset for the Puzzle Bank, so
every read *and* write threw — the consumer masked it (catch → empty `{}` → mock
fallback, 200) while the rotator surfaced it as a 500 at the promote step. The
helper now reads `AIRTABLE_API_KEY` first, with `FARADAY_AIRTABLE_API_KEY` (and
`AIRTABLE_BASE_ID` / `AIRTABLE_TABLE_ID`) as legacy fallbacks. **`AIRTABLE_API_KEY`
must have write access to the Puzzle Bank** (it is the same Airtable PAT used by
the lexicon route; ensure its scope includes write, not just read).

**Hardened rotate contract** (`/api/cron/rotate` + `rotateLiveSet`):
- **Promote:** `Published = "Published"` AND `Go Live Date = today` (Chicago) → `Live`.
- **Retire:** `Published = "Live"` AND `Go Live Date < today` (strictly before, day-
  granular `DATETIME_DIFF`) → `Retired`. Never touches today's or a future-dated row.
- **Idempotent:** both filters are self-correcting — a re-run finds nothing to
  promote (already `Live`) or retire (prior set already `Retired`); never double-promotes.
  The 06:00-UTC safety re-run after the 05:00-UTC run is a safe no-op.
- **Guard:** runs only at hour 0 in America/Chicago (DST-aware via `Intl`), unless
  `?force=1`. `CRON_SECRET` (Bearer) enforced when set; `?force=1` still requires it.
- **Logging:** failures log structured JSON (`step` = promote/retire, `recordIds`,
  upstream `error`/`cause`) via `RotationError` — not a truncated message.
- Promote runs before retire so a mid-run failure never leaves zero `Live` rows.

**Puzzle Bank field / option IDs** (stable across renames — use these):
- `Published` (singleSelect) field `fldLzhFxNWLnvJlvW`: `Published`=`seljRJZrs4HBwJrtU`,
  `Live`=`selNKyT2AewWpWJA9`, `Retired`=`selakY5RgVqZW1DSL`, `Unpublished`=`sel3PyzvmWXbN3HCv`.
- `Go Live Date` field `fldemR86qFJXwJe6g`; `Puzzle Type` field `fldQ6d9fdAdE4bqkT`;
  `Puzzle Name` field `fld1Et18F9muU7nWl`; `Puzzle Content` (JSON) field `fldBNhNWxcig4j4D8`;
  `Status` field `fld7qyUy5UP7EoUVu` (`Approved`=`sellYe934cbLkfCDw`).
- 7 puzzle types: Rackl, Signal Drop, The Stack, Circuit, The Brief, Dark Fiber, Frequency.
- June 14–19 sets were skipped during the outage and stay `Published` (never shown) — accepted; do not backfill.

## Faraday crawl pipeline (ingest path invariants, set 2026-06-23)

### Parser hardening — `faraday-crawl` edge function
Root cause of 2026-06-23 crash: single Anthropic call for all automations hit
`MAX_TOKENS=8000` and truncated JSON at position 26257, zeroing the whole run.

**Pattern (apply to any LLM gather step):**
1. **Batch-chunk the input** so no single call can truncate at `max_tokens`.
   `BATCH_SIZE=3` automations per call; concurrent via `Promise.allSettled`.
2. **Strip fences before parse** — `extractAndParse()` removes ` ```json ` fences
   and trims whitespace before `JSON.parse`.
3. **Salvage on parse failure** — scan truncated output for complete `{...}` objects
   that contain `auto_id`, `source_url`, and `title`. Log raw excerpt to health log.
4. **Per-automation try/catch isolation** — one failing batch logs `success=false`
   for its automations only; the rest of the fleet still writes artifacts.

`extractAndParse` is exported for unit tests. Tests: `faraday-crawl.test.ts`.

### Email ingestion — `ingest-email` edge function
Payload contract (POST body):
```
{ "secret": "<ingest_config.secret>",  // body field, not Authorization header
  "from":   "<original sender email>",
  "subject": "...", "text": "...", "html": "...",
  "received_at": "<ISO-8601>",
  "message_id": "<gmail msg id>",       // used as content_hash basis + source_url
  "urls": ["https://..."] }
```
Auth: `secret` compared constant-time against `ingest_config` (id=1).
Allowlist: `from` (after stripping display name, lowercasing) must equal
`mykemiller@gmail.com`. Rejected senders → 403; bad secret → 401; no artifact written.

Dedup: `content_hash = sha256(message_id)` if present, else `sha256(subject+"\n"+text)`.
`source_url = "gmail:<message_id>"`. Idempotent — replaying the same message_id
does not double-insert (`ON CONFLICT content_hash DO NOTHING`).

Governance (approved by Myke 2026-06-23):
- `source_type = "email"` — migration `20260623000001_add_source_type_email.sql`
  (`ALTER TYPE source_type_enum ADD VALUE IF NOT EXISTS 'email'`).
- `auto_id = "AUTO-049"` — registered in Airtable Automation Registry.
  `crawler_id = "ingest-email_v1.0"` (stable).

Tests: `ingest-email.test.ts` (unit tests for `safeEqual`, `normalizeEmail`, `sha256Hex`,
allowlist logic).

### Automation Registry (Airtable `appxfti7VuoHYUeu6` / `tbl1ef6FgxUc3Uevg`)
As of 2026-06-23: 46 active automations. `faraday-crawl` edge function covers 27
web-search-eligible automations (AUTO-001, 011–014, 016–017, 023–024, 027–034,
036–038, 040–041, 043–047). MCP-dependent automations (LinkedIn AUTO-002/015,
CB Insights AUTO-019, Morningstar AUTO-020, DC Hub AUTO-022, SEC EDGAR AUTO-042)
still require the full desktop-agent run.
Locked ranges: AUTO-027–032 (Intelligence Crawl), AUTO-121–127 (Daily Challenge),
AUTO-128 (reserved: rotation/JPS). Do not reassign these IDs.
AUTO-040 in the registry = "arXiv Pre-Publication Feed" (academic). The orchestrator
wrapper that previously logged as AUTO-040 on failure has been removed; failures
now log per-automation with their correct IDs.

## Daily Challenge cosmetic buff (readability · handle · account · switcher)

- **`muted` token** is **`#9A938C`** (was `#6B6560`, failed AA at 3.3:1 — now
  6.3:1 on `bg #0D110E`). `dim #2A2520` is **decorative only** (dividers, dots,
  drag handles, placeholders — never readable text). Type-scale floor across the
  games + homepage: nothing readable below **11px**; primary prompts ≥16px;
  options/tiles/terms ≥13px; explanations ≥12px. Two token systems: the in-game
  JS object `C` in `src/components/DailyChallenge.jsx`, and the homepage Tailwind
  `@theme` tokens in `src/app/globals.css`.
- **Contrast gate:** `npm run test:contrast` (`scripts/contrast-check.mjs`)
  asserts every readable pairing clears WCAG AA. Run after touching colors/sizes.
- **Handle:** canonical `dc_subscribers.handle` (already existed) is mirrored
  client-side at `/auth` (verify-magic-link returns it) under `HANDLE_STORAGE_KEY`
  and rendered on every puzzle (in-game header) + lobby, with an email-local-part
  fallback. `get-subscriber-state` does NOT carry it (kept no-deploy).
- **Account / settings:** route `/account` (`src/app/account/page.tsx`). Team &
  company are the Leaderboard V2 typed-group hierarchy (`teams.group_type` +
  `parent_id`); editing reuses the existing `team-action` edge function (no new
  function). "Leave the game" = **soft opt-out** (`dc_subscribers.active=false`,
  no hard delete) via the Next route `src/app/api/account/route.ts`.
- **`active` column:** `supabase/migrations/20260622160000_add_subscriber_active.sql`
  (additive, reversible — apply at promotion). Opt-out is enforced **client-side**
  this pass (stops streak accrual, hides from the in-app team board via
  `OPTED_OUT_STORAGE_KEY`). Full exclusion from the locked Leaderboard V2 ranking
  RPCs is a **deferred follow-on** (needs a ranking-RPC deploy — out of the
  no-deploy boundary).
- **Required env (set in Vercel before promotion):** `SUPABASE_SERVICE_ROLE_KEY`
  (server-only) so `/api/account` can read/write `dc_subscribers.active`; without
  it the route returns 500 "Account service not configured".
- **Game switcher:** `GameSwitcher` in `DailyChallenge.jsx` reuses the locked neon
  icons from `src/components/GameIcon.jsx` (ported from
  `design-reference/faraday-daily-challenge-lobby.html`). Switching mid-puzzle
  confirms before discarding. Do not recreate the icons.
- **Untouched:** scoring (`calcScore`, streak/MW), puzzle content, locked brand
  palette + type families. No Vercel/Supabase prod deploy in this change.

## IDF 4.0 data-source coverage bridge (FAR-199, set 2026-06-23)

Coverage of the IDF 4.0 canon (23 Domains / **116 Sub-Domains**, Notion
`37189a0c-1680-8199-bca1-cf304a45bbde`) by the **running** Automation Registry
(Airtable `appxfti7VuoHYUeu6` / `tbl1ef6FgxUc3Uevg`). A `Designed` or `Broad-only`
crawler is **not** coverage.

**Verified coverage today (four-value verdict):** 1 Dedicated-Active · 63
Dedicated-Designed (dormant) · 21 Broad-only · 31 Whitespace. The entire
AUTO-060→119 dedicated sub-domain set is `Designed`/dormant — **none is Active**.

- **Coverage Matrix** (single source of truth): `scripts/idf4-coverage-matrix.mjs`
  → `docs/idf4-coverage/coverage-matrix.{md,csv}` (116 rows; asserts per-Domain
  counts match canon). Mirrored to Notion `38889a0c-1680-81d5-83e8-d02f1cc3b12a`.
- **Scaffold (inert):** `supabase/functions/faraday-crawl/coverage-bridge.ts` —
  `TIER1_ACTIVATION` (the 10 dormant dedicated crawlers AUTO-060–069, query sets
  authored) + `WHITESPACE_SCAFFOLDS` (39 new routines, **placeholder** ids
  `AUTO-NEW-01..39`) + `SOURCE_FIT_REPOINTS` + `mergeApproved()`. **Nothing is
  imported by `index.ts`** — deploying this branch changes zero runtime behaviour.
  Tests: `coverage-bridge.test.ts` (shape, id uniqueness, staggered cadences,
  `mergeApproved` idempotency guard).
- **Plan / findings:** `docs/idf4-coverage/deployment-and-source-fit.md`,
  `docs/idf4-coverage/data-integrity-findings.md`.

**AUTO-ID range — CORRECTION (do not repeat the stale value):** the next free ID is
**`AUTO-137`**, NOT AUTO-134. `AUTO-134/135/136` are already **Active** (engine
functions: `engine-idf-entities` / `engine-prognostications` / `engine-two-analyst`).
The 39 scaffolds **request** the contiguous block **`AUTO-137 → AUTO-175`** —
**not self-assigned**; left placeholder pending Myke.

**Open data-integrity flags (proposals — Active rows not overwritten):**
- **AUTO-049 double-assigned** — Active *Email Ingestion* (correct, governance-approved)
  vs Designed *Community Opposition & Moratorium Tracker* (reassign the Designed one).
- **AUTO-028/029** semantic collision vs the **Industry Conferences** table
  (`tblb1S5IKFBPEmUJL`) "AUTO-028/029 primary target" annotations → repoint to the
  new D8.2 conference routine.
- **Stale 3.x tags** on Active crawlers: AUTO-028→D12, AUTO-029→D13, AUTO-030→D14,
  AUTO-031→D11, AUTO-032→D17 (`IFS Domains` is a generated `aiText` field — fix the
  generation source, not just the cell).
- **IDF registry staleness (flag only — separate gate):** Airtable Sub-Domain
  Registry (`tbla7rtRY9AaeoWhu`) = 59 "Coming Soon" rows w/o stable D#.# Number IDs
  (manual-UI-value caveat); Supabase `faraday_domains`=16, `faraday_subdomains`=4
  (need 23/116). Do **not** backfill here.

**Governance:** branch + PR only; no Active flip; no AUTO-ID self-assign; no
`source_type` enum add; no Active-crawler re-route — all human-gated (Myke).
