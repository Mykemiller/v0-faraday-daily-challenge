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

Governance pending (DO NOT deploy until approved by Myke):
- `source_type`: using `"web_news"` placeholder. Proposed migration:
  `ALTER TYPE source_type_enum ADD VALUE 'email';` → then change constant to `"email"`.
- `auto_id`: using `"AUTO-TBD"` placeholder. Proposed: **AUTO-049** (next free slot).
  Must be registered in Airtable Automation Registry (appxfti7VuoHYUeu6).
  `crawler_id` is stable now: `"ingest-email_v1.0"`.

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
