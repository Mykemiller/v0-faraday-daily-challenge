@AGENTS.md

## Daily Challenge header — icon-dropdown nav (feature/header-icon-nav)

The masthead in `src/components/DailyChallenge.jsx` uses an **icon-dropdown** nav:
wordmark ("Faraday" / "DAILY CHALLENGE") flush left (no BrandMark tile; clickable
→ lobby), the ambient status (handle + Today's/Season Total Score, hidden ≤430px)
and **five right-aligned icon triggers** — **All Games (grid) · Help & Feedback (?)
· Compete (trophy) · Account (gear) · More Faraday (hamburger)** — each opening a
click-toggle dropdown (design-review menu structure, 2026-07-02):

- **All Games** = the 7 games in lobby-grid order (`GAME_CONFIGS` in-app;
  `DC_GAMES` in SiteHeaderNav → `/challenge?game=<type>` deep-links; keep in sync).
- **Help & Feedback** = Hints / Tips and Tricks / Questions / Glossary / Report a
  Bug / Feedback — all stubs served by the single dynamic route `/help/[topic]`.
- **Compete** = Leaderboard — Today / Leaderboard — Season (both `/leaderboard`;
  no today-only view yet) / Teams (`/leaderboard?view=teams` deep-link) / Free
  Agency (`/free-agency` stub, "Trade window: TBD").
- **More Faraday** = About (`/about` stub) / Who is Faraday (`/who-is-faraday`
  stub) / Share / Invite (`/share` stub) / Notifications (`/notifications` stub) /
  Faraday Merchandise (`/merch` stub) / **Faraday Academy — disabled/grayed, no
  link (reserved for a later phase, do NOT wire)** / Terms-Privacy (`/legal` stub).
  Other Faraday products (Jurisdiction Watch, Signal Room, …) deliberately NOT in
  this menu. No "Sign Up" in the gear menu by design.
- Stub pages share `src/components/DcStubPage.tsx` (DC masthead + "Coming soon"
  chip). Repoint menu items in the two build*Menus helpers when real pages exist.

- **Edit the dropdown text/links in ONE place:** the `buildHeaderMenus()` helper
  (just above the `DailyChallenge` component). Each item is `{label, onClick}` /
  `{label, href}` / `{label, current}` / `{label, disabled:true}` / `{divider:true}`.
  The Account menu is auth-conditional (`email` present → Account / Settings /
  Sign Out; else → Sign In; Settings opens the same Account screen today).
- **Behavior** lives in `HeaderIconNav` (single-open `open` state, click-outside +
  `Escape` close, caret flip). Icons are inline SVG (`NavGlyph`, stroke 1.8, no
  icon lib). Styling is `.dc-*` classes in the injected `<style>` block (built from
  the `C` tokens; respects `prefers-reduced-motion`).
- The old `NavPill` letter nav (D·L·A) was replaced; `NavPill` remains defined but
  unused. Streak-flame / MW chip / LIVE pulse were already gone; their orphaned CSS
  (`@keyframes pulse`, the `.fdc-mw, .fdc-live` media rule) was also removed in this
  pass (Myke-confirmed "retire live/mw/streak flame").
- Placeholder links to flag: Leaderboard Today/Season both →/leaderboard (no
  time-range views yet); every `/help/*`, `/about`, `/who-is-faraday`, `/share`,
  `/notifications`, `/merch`, `/free-agency`, `/legal` link lands on a stub.
  Repoint in `buildHeaderMenus` / `buildSiteMenus` when real pages exist.
- **Standalone Next routes** (`/account`, and next `/leaderboard`) use the twin
  component `src/components/SiteHeaderNav.tsx` — same icon-dropdown look/behavior
  but **href-based** nav (no in-app screen state). Edit its dropdown text/links in
  `buildSiteMenus()`. It injects the shared `.dc-*` styles once per document
  (`id="dc-sitenav-styles"`). `/account` adopted it (feature/account-header-teams);
  `/leaderboard` is still on the older D·L·A `NavLetter` nav — swap next.

## Teams — Free Agency "pending" retired (feature/account-header-teams)

Players join **up to 5 teams, effective immediately** — the Free Agency deferral
(`pending`) is gone. `/api/teams` writes memberships `pending=false` on join/create
and **heals any lingering `pending=true` rows** for the subscriber/season on every
upsert; `/account` also self-heals a legacy pending membership on load (one-shot).
At the cap the picker shows "Max teams reached, leave a team to join a new team."
The `team_memberships.pending` column is retained (always written `false`) — the
leaderboard season query still filters `pending=eq.false`, so immediate joins now
count in standings. **Both account surfaces are aligned** (feature/account-inapp-align):
the standalone `/account` page and the in-app account screen inside
`DailyChallenge.jsx` (`screen="account"`) now share identical team behavior —
immediate joins, no `pending` badge, `canEditTeams = session && !isLocked`, and the
same max-teams copy. The Free-Agency deferral / notice copy was removed from both.

## Daily Challenge notification settings (claude/daily-challenge-notifications, 2026-07-03)

Subscriber-facing alert preferences at **`/account/notifications`** ("Daily Challenge
Alerts"), light-cream theme matching `/account` (same Card/SL styling; new light
`Toggle` switch + SMS/Email `ChannelChip` components local to the page).

- **Data:** `dc_subscribers.notification_preferences` (jsonb, nullable — migration
  `20260703000001…`, **not yet applied to prod**; apply at promotion). NULL = defaults.
  Shape: `{master_enabled, categories.{reminder_to_play|streak_at_risk|
  teammate_completed|leaderboard_movement}.{enabled, channels.{sms,email}}}` —
  the four category keys are a **fixed contract**; do not rename.
- **Single source of truth:** `src/lib/notification-preferences.ts` — defaults,
  `normalizeNotificationPreferences()` (coerces NULL/partial/junk to full shape),
  and **`shouldSendNotification(prefs, category, channel)`** — THE send gate.
  No sender for these four alert types exists yet (the OTP/ops mailers are
  unrelated); any future cron/worker/edge sender MUST call the gate before each
  send. Master off silences everything; per-category settings persist underneath.
- **API:** `/api/account` GET now returns `notification_preferences` (normalized);
  POST `action:"update-notifications"` + `preferences` (normalized server-side
  before PATCH). Same token/service-role pattern as the other account actions.
- **Save behavior:** auto-save per toggle (optimistic, revert on failure) — same
  immediate-save pattern as the /account team picker. Master-off dims + disables
  the category list without discarding values.
- **Nav:** "Notifications" added to the gear (Account) menu directly after
  Settings in BOTH `buildSiteMenus` and `buildHeaderMenus`; the More Faraday
  "Notifications" entries repointed `/notifications` → `/account/notifications`;
  the old `/notifications` stub is now a redirect (kept so old links never 404).

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

> **AUTO-050 collision resolved 2026-06-25 (FAR-204, Myke-approved):** the Daily Faraday
> Todo Digest **keeps AUTO-050**; the duplicate *PUC & Utility Rate Case Monitor* (Designed)
> was moved off it to **AUTO-177**. No code/redeploy change to this function.

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

**Airtable:** **AUTO-050** registered in Automation Registry (`appxfti7VuoHYUeu6 / tbl1ef6FgxUc3Uevg`,
record `recvgnvCL3etK0Vs4`, Status=Active).

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

### Crawl health-check alert — `faraday-crawl-healthcheck` (AUTO-178, FAR-253 / Stream A, 2026-06-26)
Post-crawl zero-artifact monitor. pg_cron `faraday-crawl-healthcheck-0800utc`
(`0 8 * * *`) fires 1h after the 07:00 `faraday-crawl-daily` run. If the
`artifacts` table got **0 new rows in the trailing 2h** (`CRAWL_HEALTHCHECK_WINDOW_HOURS`,
default 2), it emails Myke via Resend (`ops@faraday-intelligence.ai`); otherwise a
silent no-op. The alert body lists the most recent `automation_health_log` failure
reasons so the cause is visible without log-diving. Auth: `verify_jwt=false` +
`fcron_…` CRON_TOKEN (a JWT would 401 the cron — the faraday-crawl v2 trap).
Counts on `artifact_id` (the artifacts PK is `artifact_id`, not `id`).
Tests: `faraday-crawl-healthcheck.test.ts`. Distinct from `faraday-daily-ops`
(13:00, 36h digest) and `faraday-watchdog` (6h, 36h auto-recovery actuator).

> **2026-06-26 incident note:** the 06-23 JSON-truncation bug was already fixed
> (FAR-188) and healthy through 06-24 (296 new artifacts). The stall since 06-25
> is a **depleted `ANTHROPIC_API_KEY` credit balance** (Anthropic 400 across
> faraday-crawl + scorer/idf-entities/two-analyst) — a billing issue, not code.
> Top up credits to restore artifact flow; this health-check would have paged on
> the morning of 06-25.

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

**Coverage state (post FAR-200 + FAR-202 activation, 2026-06-24):** 61 Dedicated-Active ·
3 Dedicated-Designed · 21 Broad-only · 31 Whitespace. The 10 Tier-1 dedicated crawlers
**AUTO-060–069** (D1.4/.5/.7/.8, D2.5/.6/.7/.8/.10, D10.4) **and the 50 Tier-2 D11–D23
crawlers AUTO-070–119 are now Active** (FAR-202): query sets authored in
`coverage-bridge.ts` `TIER2_ACTIVATION`, merged into the live fleet (`faraday-crawl` v6,
87 automations), Registry flipped Designed→Active. AUTO-118→D17.2, AUTO-119→D17.1.

- **Coverage Matrix** (single source of truth): `scripts/idf4-coverage-matrix.mjs`
  → `docs/idf4-coverage/coverage-matrix.{md,csv}` (116 rows; asserts per-Domain
  counts match canon). Mirrored to Notion `38889a0c-1680-81d5-83e8-d02f1cc3b12a`.
- **Tier-1 activation:** `faraday-crawl` edge fn **v3** (`verify_jwt:false`) merges
  `TIER1_ACTIVATION` (AUTO-060–069, in `coverage-bridge.ts`) into `AUTOMATIONS` via
  `mergeApproved`. Two health-log dry runs, 0 failures, 80 artifacts all unique
  `content_hash` (idempotent). **`verify_jwt` was true — the daily cron sends the
  CRON_TOKEN (not a JWT), so the gateway was 401-ing it; v3 sets `verify_jwt:false`
  (custom CRON_TOKEN/service-key auth in the body) which fixes the cron too.**
- **Scaffold (inert):** `coverage-bridge.ts` `WHITESPACE_SCAFFOLDS` — 39 routines
  on real ids **AUTO-137→175** (placeholders retired), `Designed` in the Registry,
  not yet built. Tests: `coverage-bridge.test.ts`.
- **Plan / findings:** `docs/idf4-coverage/deployment-and-source-fit.md`,
  `docs/idf4-coverage/data-integrity-findings.md`.

**AUTO-ID range:** next free ID is **`AUTO-178`** (NOT AUTO-134 — 134/135/136 are
Active engine fns). Block **`AUTO-137 → AUTO-175`** granted (2026-06-24) and
registered Designed; **`AUTO-176`** = the reassigned *Community Opposition &
Moratorium Tracker* (moved off the AUTO-049 collision); **`AUTO-177`** = the reassigned
*PUC & Utility Rate Case Monitor* (Designed; moved off the AUTO-050 collision so the
Daily Faraday Todo Digest keeps **AUTO-050**, FAR-204). AUTO-055 = Lexicon-Powered Puzzle
Draft Agent (unchanged).

**Data-integrity resolutions (2026-06-24, all applied):**
- **AUTO-049 collision** — Designed *Community Opposition & Moratorium Tracker*
  reassigned to **AUTO-176**; AUTO-049 stays Email Ingestion (Active).
- **AUTO-028/029 vs Industry Conferences** — the 6 "primary target" annotations in
  `tblb1S5IKFBPEmUJL` repointed to the new D8.2 routine **AUTO-168**.
- **Stale 3.x tags** fixed in the operational source (`index.ts` AUTOMATIONS):
  AUTO-028→D12, 029→D13, 030→D14, 031→D11, 032→D17. (The Airtable `IFS Domains`
  cell is generated `aiText`/cosmetic — not the routing source; left to regenerate.)
- **IDF registry staleness (still flagged — separate gate, FAR-205):** Airtable
  Sub-Domain Registry (`tbla7rtRY9AaeoWhu`) = 59 "Coming Soon" rows w/o stable D#.#
  IDs; Supabase `faraday_domains`=16, `faraday_subdomains`=4 (need 23/116). Not
  backfilled.

**Governance:** all of the above was **explicitly approved by Myke (2026-06-24)** —
ID block, AUTO-049 reassignment, stale-tag fix, conference repoint, and full Tier-1
activation (deploy + dry-run + flip). No `source_type` enum was added; the 39
whitespace routines remain Designed pending per-routine build.

## Daily Challenge win-screen daily total + persistence (FAR-211 + FAR-207, shipped 2026-06-24)

**FAR-211 (Display):** `ScoreCard` now renders `score/dayTotal` on every win screen.
`/dayTotal` uses sage `#8CA68A` at 22px/500-weight, subordinate to the 48px gold score.
Label beneath reads "this game / today · {puzzleType}". First game of the day shows
`N/N`; each subsequent game shows `thisGame/cumulativeToday`. All 7 puzzle types share
the change via the single `ScoreCard` component.

**FAR-207 (Persistence):** Three-layer accumulation:
1. **Seed on load** — `subscriber-state` already returns `todayCompletions` (from
   `dc_completions`). The hydration effect now sums those scores and seeds `lastDailyTotal`.
   Returning authenticated subscribers load with their correct running total, not zero.
2. **In-session optimistic total** — `onGameComplete` updates `lastDailyTotal` immediately
   (pre-server-response) for both authenticated (via `todayCompletions` sum) and anonymous
   (simple `t + score` increment) players.
3. **Authoritative server write** — `/api/score` POST upserts `leaderboard_daily` and locks
   `dc_daily_attempts`; the response `runningDailyTotal` reconciles the optimistic value.

**Schema (applied 2026-06-24):**
- `dc_daily_attempts` — one-attempt-per-day idempotency gate; UNIQUE on
  `(subscriber_id, game_type, play_date)`. Migration: `20260624000001_dc_daily_attempts.sql`.
- `leaderboard_daily` — running daily score aggregate; PRIMARY KEY `(subscriber_id, play_date)`.
  Migration: `20260624000002_leaderboard_daily.sql`.
- Both have RLS enabled (service-role-only write path via `/api/score`).

**Identity / isolation:** daily totals are keyed to `dc_subscribers.id` (UUID, stable across
handle edits); no player's total can leak into another's session.

## [2026-06-24] Daily Challenge Go-Live UI Polish

- Added AccountPage screen (screen="account") with handle, streak, MW, tier, game history, sign out
- Added ComingSoonModal triggered by all 7 product links (lobby bottom section)
- Added Signal Room and Thought Forge to Coming Soon product list
- Removed: LIVE pulse indicator, Faraday Tip of the Day block, Academy nav button, @handle label (standalone chip replaced by clickable handle chip linking to Account)
- Account link placed in header top-left (⚙ Account), visible on lobby + all game screens
- Branch: feature/go-live-ui-polish | PR: https://github.com/Mykemiller/v0-faraday-daily-challenge/pull/38

## [2026-06-24] Fix: Rackl solved-group item mismatch
- Bug: solved group banners displayed g.items from static PUZZLE_DATA instead of tiles state
- Fix: derive solvedItems from tiles array filtered by groupIdx
- File: faraday-daily-challenge.jsx — GameRackl, solved groups render block (~line 409)
- Branch: fix/rackl-solved-group-items | PR: https://github.com/Mykemiller/v0-faraday-daily-challenge/pull/39

## Daily Results State
- Key: `faraday_daily_{YYYY-MM-DD}` in localStorage
- Shape: `{ [gameType: string]: { score: number, completedAt: number, puzzleSnapshot: object } }`
- One entry per game per calendar day. Never overwrite an existing entry.
- Profile key: `faraday_profile` → `{ handle, name, email, favoriteTeams: string[] }`
- todayScore is always derived: Object.values(dailyResults).reduce((s,r) => s + r.score, 0)

## Live Agent — RAG-backed subscriber Q&A (CC-06 / FAR-29, set 2026-06-23)

Retrieval-grounded Q&A over the live `artifacts` corpus (Supabase
`ycadmmngkdhvpcsrcuaq`, 2,937+ artifacts and growing). **Built here, not in the
retired `Faraday-intelligence` repo** (CC-06 named that repo, but it's
dormant/no-domain per FAR-119; the Live Agent surface already lives here, so this
is its home — confirmed with Myke). Supersedes the ungrounded `/api/ask` teaser
for the `/live-agent` product (that homepage widget is unchanged).

**Hard requirement — no confabulation.** Every answer is grounded in retrieved
artifacts and cites them; the agent declines ("I don't have that in the corpus
yet.") when retrieval lacks coverage (the ZutaCore principle — prefer "not in
corpus" over a guess). Enforced twice: a retrieval gate (`decideGrounding`) before
the model is ever called, and a strict system prompt that forbids outside
knowledge and requires `[n]` citations.

**Retrieval — two paths, one corpus, one shape** (`src/lib/live-agent.ts`):
- **Semantic** — `artifacts.embedding` (pgvector `vector(1024)`, HNSW cosine) via
  `match_artifacts()`. Query embeddings from **Voyage** `voyage-3.5` (1024-dim;
  `VOYAGE_API_KEY`). Backfill: `supabase/functions/embed-artifacts` (idempotent,
  resumable — only embeds rows where `embedding IS NULL`; run on a cron until
  `done`).
- **Lexical** — `search_artifacts_text()` (weighted `tsvector` over
  title/summary/raw_content). The always-on fallback — needs **no embedding
  provider**, so the surface works before the corpus is embedded. The route
  prefers semantic and falls back to lexical when there's no Voyage key, the embed
  call fails, or semantic returns nothing.
  - **Recall:** an **OR-of-lexemes** tsquery (each query lexeme quoted, joined by
    `|`), NOT `websearch_to_tsquery`/`plainto_tsquery` — those AND every term, so a
    conversational question needs all its words in one artifact and recall
    collapses to ~0 (this was a real bug the eval caught).
  - **No-confab gate = `coverage`, not rank.** Each row returns
    `coverage` = (# distinct query lexemes the doc contains) / (# query lexemes).
    Coverage is **query-length invariant** where `ts_rank_cd` is not — a 1-word
    in-corpus query and a 5-word off-topic query can tie on rank but never on
    coverage. `decideGrounding` refuses below **`COVERAGE_FLOOR = 0.34`**.
    Calibrated on the live corpus: in-corpus (incl. 1-word) cover ≥0.60; off-topic
    cover ≤0.33 (they snag ≤1 incidental lexeme, e.g. "chocolate chip cookies" →
    "chip"). **Retrieval-mode eval: 18/18 = 100%** (12 in-corpus grounded, 6
    out-of-corpus refused).

**Generation:** `claude-opus-4-8`, adaptive thinking, `max_tokens` 1024, no
sampling params (removed on 4.8). Frozen system prompt (caches cleanly); corpus
context is appended in the user turn only.

**Entitlement + token meter** (migration `…180100_live_agent_entitlements.sql`):
Live Agent costs **1 token per answered question**. The debit is the ONLY
financial guard — **atomic, server-side** (`live_agent_debit()` RPC), idempotent
by `request_id` (a transient 502 can be retried with the same id without
double-charging). Tiers/grants live in the **`live_agent_plan` table** (provisional;
`free`=not entitled, `member`=50, `pro`=200/month, no rollover) — NOT hardcoded in
code. **Refused/un-answered questions are free** (gate runs before the debit).
Per FAR-46 (DRAFT meters): the UI never publishes balances/prices — it shows only
"Grounded · N sources" or "Not in corpus", and server-returned gate messages.

**Surface:** `/api/live-agent` (Next route, mirrors `/api/account`'s service-role
pattern) + `src/components/LiveAgent.tsx` (client widget, reads the `dc_session`
token) + `/live-agent` page (upgraded from stub → live).

**Migrations (ADDITIVE + reversible):**
`20260623180000_live_agent_rag.sql` (embedding column + HNSW + `fts` + retrieval
RPCs, `SET search_path`, service-role-only grants),
`20260623180100_live_agent_entitlements.sql` (plan/ledger/usage + `live_agent_debit`,
RLS-on/deny-all). **Applied to `ycadmmngkdhvpcsrcuaq` (Myke-approved)** and
validated live: retrieval eval 18/18; `live_agent_debit` exercised end-to-end
(charge → idempotent duplicate → second charge → free-tier `not_entitled`), test
rows cleaned up. Security advisor: no new WARN/ERROR (the 3 `rls_enabled_no_policy`
INFOs on the `live_agent_*` tables are the intended deny-all posture — service role
bypasses RLS). **No prod app/edge-function deploy** in this PR.

**Required env (Vercel, before promotion):** `SUPABASE_SERVICE_ROLE_KEY`
(corpus + RPCs), `ANTHROPIC_API_KEY` (generation; already provisioned),
`VOYAGE_API_KEY` (optional — enables semantic; lexical works without it).

**Eval + tests:** `eval/live-agent-eval.jsonl` (12 in-corpus → grounded+cited,
6 out-of-corpus → refuse) scored by `scripts/live-agent-eval.mjs` (FULL mode hits
the route; RETRIEVAL mode checks the gate via the FTS RPC — no token spend).
Pure-logic unit tests: `src/lib/live-agent.test.ts`,
`supabase/functions/embed-artifacts/embed-artifacts.test.ts` (`deno test`).
