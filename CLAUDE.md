@AGENTS.md

## Messaging — captain broadcast + 1:1 DMs (CC-DC-MESSAGING-1.0, claude/dc-messaging-ad1e0b, 2026-07-31)

In-app messaging v1: captain → team broadcasts + open 1:1 DMs, with
block / report / mute. Migration `20260730000001_dc_messaging.sql`
(**APPLIED to prod 2026-07-29**, Myke-approved); authorization matrix
(18 cases) verified live against the branch preview with observed status
codes, fixtures cleaned to 0 rows.

- **Five tables, one conversation model.** `dc_conversations` has two
  CHECK-enforced shapes: `team_broadcast` keyed `(team_id, season_id)` (one
  channel per team per season, lazily created) and `direct` keyed by the
  ORDERED pair `(pair_low < pair_high)` — the partial unique index +
  `fn_dc_find_or_create_direct` RPC make find-or-create race-safe (verified:
  two concurrent first-sends → one conversation). `dc_messages` is
  append-only (soft delete via `deleted_at`; the API never SQL-DELETEs);
  `dc_message_blocks`, `dc_message_reports` complete the set. RLS deny-all,
  zero policies — NEVER add one (dc_sessions identity, no Supabase JWT).
- **`dc_conversation_members` is read/mute STATE ONLY — never the
  authorization source.** Authorization is derived per request in
  `authorizeConversation()` (`src/lib/messaging/server.ts`): direct → viewer
  is in the pair; broadcast → viewer has a non-pending `team_memberships`
  row for `(team_id, season_id)`. Denials collapse to 403 `not_permitted`
  (existence never leaks).
- **Captaincy is re-verified server-side on EVERY broadcast send/delete**
  (`teams.captain_id` re-fetched — captaincy rolls on leave; a cached value
  would be a security bug).
- **Blocks are stored one-way, enforced both ways** — either direction
  silences the pair (threads vanish from both inboxes, unreachable by id,
  sends → 403 `not_deliverable` with no block confirmation). Blocks do
  **NOT** suppress team broadcasts: blocking a teammate (even the captain)
  never cuts you off from team announcements.
- **Season lock deliberately does NOT block sending** — messaging is not a
  roster change. Do not "fix" this into a lock check (commented in the
  send path).
- **Rate limits** live in `src/lib/messaging/rules.ts` (pure, tested —
  `npm run test:messaging`): 10 broadcasts/team/24h (soft-deleting never
  refunds quota), 10 new DM threads/24h (counted against the OPENER),
  200 DMs/24h, 2000-char bodies. Enforced in `/api/messages` POST.
- **DM reach is OPEN to all players**; block is currently the only reach
  control. `/api/messages/directory` (handle prefix search, handle-only
  output) is therefore effectively a player directory for any signed-in
  user — accepted v1 trade-off, commented in the route. **Recommended
  fast-follow: a "who can message me" setting.**
- **Reports snapshot `body_snapshot` at report time** and survive message
  deletion; queue = `/league-office/reports` (the Rail's "Disputes & Flags"
  item, now live) + `/api/league-office/reports` (requireStaff; status
  triage only, deliberately not the Tier-2 audited-action funnel).
  Reporters only ever get `{ok:true}` — moderation state is never revealed.
- **`notification-preferences.ts` intentionally NOT extended** — v1 is
  in-app only. `direct_message` and `team_broadcast` are the RESERVED
  category ids for phase-2 email/SMS delivery.
- **Surfaces:** `/messages` inbox (two-pane ≥900px), `TeamBroadcastPanel`
  on the team page, gold unread dot + "Messages (n)" in the
  `SiteHeaderNav` gear menu (badge fetched via `?scope=unread` on
  /messages, /leaderboard, and the team page only — bounded round-trips).
  **Open follow-up:** mirroring the badge into `DailyChallenge.jsx`'s
  `buildHeaderMenus` (file contended by FAR-394/FAR-395 — deliberately
  untouched this pass).
- **PostgREST gotcha (real bug caught live):** `dc_messages` has TWO FKs to
  `dc_subscribers` (`author_id`, `deleted_by`) — embeds must hint
  `dc_subscribers!dc_messages_author_id_fkey(...)` or every thread read
  silently returns empty.
## League Office Game Library (CC-LO-GAME-LIBRARY-1.0, 2026-07-30)

`/league-office/game-library` — the extensible game catalog: status board, lifecycle
control, and which games are configured for which season. Ops note:
**`ops/2026-07-30-lo-game-library.md`**; Phase 0 investigation:
`docs/lo-game-library/PHASE-0-FINDINGS.md`.

- **⚠️ LIFECYCLE ≠ SEASON ASSIGNMENT (D1) — do not collapse them.** `game_catalog.
  lifecycle_state` (enum `game_lifecycle_state`: `new_idea → in_test → live → retired`)
  is **ONE state per game**. "Assigned to a season" is a **many-to-many relationship** in
  `season_games`, always **derived** for display, never stored as a state. All 7 live
  games are simultaneously Live *and* assigned to 4 seasons — a single-state model
  cannot represent that. Allowed transitions (server-enforced in `checkTransition`):
  `new_idea→in_test`, `in_test→live|new_idea`, `live→retired`, `retired→live`. There is
  deliberately **no `new_idea→live`**. Every transition requires a reason.
- **⚠️ THE SEASON SLATE IS ADVISORY (D4) — it does NOT gate serving.**
  `/api/challenge/today` selects on publish state alone (`published='Live'`) and keys
  games by the free-text name; it never reads `season_config`/`season_games`. Toggling a
  game here changes what the console *says*, not what subscribers get. Enforcement is a
  later phase behind the `DC_PUZZLE_SOURCE` cutover (CC-DC-SUPABASE-SERVING-1.0, PR #115
  — merged, flag unset in prod). **`npm run test:advisory-only` (6) is the guard**: it
  asserts the served set is identical before/after a slate toggle AND that no serving
  module mentions `season_games`/`season_config`/`game_catalog`. If you deliberately wire
  enforcement, update D4, the page copy and these docs in the same change — do not just
  delete the test.
- **⚠️ `short_code` and the Public ID prefix are TWO LIVE SYSTEMS (D8) — never derive one
  from the other.** `game_catalog.short_code` = RKL/SGD/STK/CIR/DKF/FRQ/BRF;
  `game_catalog.public_id_prefix` = RACK/SGNL/STAK/CIRC/FIBR/FREQ/BRIF, matching the
  `public_id` values `trg_dc_assign_public_id` mints. **Share links in the wild use the
  prefix.** Both are stored; neither is computed.
- **`runtime_key` is the join key the runtime actually uses (D3).** The serving path keys
  games by display name as free text (`dc_completions.puzzle_type`,
  `dc_daily_attempts.game_type`, `dc_solve_time_bands.game_type`,
  `dc_puzzle_bank_staging.puzzle_type`), while `game_key` is a snake_case slug **nothing
  joins on**. `runtime_key` names that orphan join so it is testable. Unique (partial
  index); a CHECK requires it for `live`. **`game_key` is never editable; `runtime_key`
  freezes once live** — both enforced by the `sanitizeCatalogPatch` whitelist and again in
  `updateGame`.
- **Editing a season's slate reuses the PR #120 state machine (D5).** `draft`/`scheduled`
  are written in place; **`active` is cloned + promoted** (`season_config_clone` → edit the
  draft → `season_config_promote`), which yields v+1 active with the prior version
  superseded. **Do NOT insert a second row already in state `active`** — that trips
  `season_config_one_active_uq` (recorded as "defect 3" for migration 20260730000001).
  `closed`/`superseded`/`cancelled`/locked seasons are refused.
- **⚠️ Every config ships `games_per_day = 7` against exactly 7 enabled games, so ANY
  unassign trips the `games_per_day_exceeds_slate` validator** and blocks promotion. The
  write path validates *before* promoting, discards the orphan clone, and reports the real
  finding. Lowering `games_per_day` belongs to the **season config editor** — this surface
  deliberately does not rewrite it as a side effect of a slate toggle.
- **D9 is a database trigger, not UI validation:** `trg_season_games_assignable` rejects
  assigning any game whose lifecycle is not `live`/`in_test`. It fires on INSERT and on
  UPDATE **only when `game_id` changes**, so retiring a game does not brick edits to its
  existing rows. Because `saveConfigBundle` replaces a slate by DELETE + INSERT, retiring
  an assigned game would make that slate unsaveable — so `checkTransition` refuses to
  retire while assignments exist and tells staff to unassign first.
- **Writes** go through the existing Tier 2 funnel: `executeAction` cases `game.create`,
  `game.lifecycle_change`, `game.update`, `game.reorder`, `game.season_assign`,
  `game.season_unassign` → `game-library-write.ts`, one `lo_audit_log` row each
  (`domain='game_library'`, populated `before`/`after`). A versioned assignment also writes
  `season.config_version_created` (target_type `season_config`). **`season_config_promote`
  self-logs — do not double-log it.**
- **Migrations `20260730000002` (lifecycle + trigger) and `20260730000003` (11-concept
  backlog seed) — APPLIED to prod 2026-07-30 (Myke-approved).** Both carry in-migration
  verification gates that raise and roll back on an unexpected count. Catalog is now **18
  rows: 7 `live` + 11 `new_idea`**; `season_games` unchanged at **28**. Seeded concepts are
  `is_active=false` so `loadGameCatalog()`'s default filter keeps them out of the season
  slate editor. `category` gained a new value **`spatial`** (Grid Lock, Mesh) — there is no
  CHECK constraint on `category`, so nothing needed extending.
- **RLS untouched (D10).** `game_catalog`, `season_games`, `season_config`,
  `season_difficulty_mix` all have **RLS disabled**; every read is server-side service-role
  (5 call sites, no anon/authenticated path). Logged as a separate security item — do not
  enable RLS as a side effect of this surface.
- Tests: `npm run test:game-library` (26) · `npm run test:advisory-only` (6).
  `npm run build` green.

## League Office season configuration (CC-LO-SEASON-CONFIG-1.0, PR #120, 2026-07-30)

Commissioner-facing season config: create a season end-to-end without SQL, edit a
versioned **effective-dated** config, schedule a change for a future date, and read a
diffable version history. Full runbook: **`docs/lo-season-config/README.md`**.

- **Routes:** `/league-office/seasons` (index + scope/slate/version columns + row menu)
  · `/seasons/new` (4-step wizard — **nothing is written until step 4 submits**) ·
  `/seasons/[id]` (version timeline · effective-now · two-version diff · action bar) ·
  `/seasons/[id]/config/[configId]` (the editor, sections A–I). **11 `/api/lo/*` routes**,
  each independently re-verifying staff; every mutation writes ONE `lo_audit_log` row
  (`domain='seasons'`) with a mandatory reason. `season_config_promote` self-logs — do
  NOT double-log it.
- **⚠️ Migration `20260730000001_season_config_effective_dating_fix.sql` — APPLIED to
  prod 2026-07-30 (Myke-approved).** It repairs **four defects in the already-applied
  season_config_* functions**, found by exercising the real RPCs: (1) `promote()` ALWAYS
  threw — `set state = case … end` yields `text` and Postgres won't implicitly cast to
  the `season_config_state` enum (`42804`); (2) scheduling superseded the incumbent
  immediately, leaving the season with **no config in force** until the effective date;
  (3) `apply_due()` demoted + promoted in ONE statement via data-modifying CTEs, tripping
  `season_config_one_active_uq` (`23505`); (4) superseding at the same instant a version
  took effect violated `effective_to > effective_from`. **Defects 1 and 2 masked each
  other** — nothing could ever be promoted, so the scheduling path was never reached.
  Also hardened: two overdue scheduled versions → **latest wins**, older superseded.
  **Do NOT "simplify" `apply_due()` back into a single statement** — that is defect 3.
- **Editing rule (enforced at the API, not just the UI):** `draft`/`scheduled` are
  writable; **`active` is READ-ONLY and cloning is the only path** — that is what makes
  the version history trustworthy. A locked season (`seasons.locked_at`) rejects every
  config mutation with `423`. `sanitizeConfigPatch` is whitelist-only, so a client can
  never promote itself by PATCHing `state`.
- **Optimistic concurrency is a FINGERPRINT, not `updated_at`** — that column does not
  exist on `season_config`, and the child rows (games, mixes) carry no timestamps at all,
  so a row-timestamp guard could not detect a slate edit even in principle. The editor
  round-trips a hash over the config **and** its children; a concurrent write moves it →
  `409` + reload prompt.
- **Cross-season copy is NOT `season_config_clone()`.** That RPC resolves its source from
  its own `p_season_id` and writes back into the **same** season — aiming it at a source
  season would add a stray draft there and return an id for the wrong season. Same-season
  versioning still uses the RPC. The source pick also cannot be a PostgREST `order`:
  sorting by the enum puts `draft` **first** and would copy a stale draft over the live
  config (use `pickFocusConfig`).
- **Catalog-driven slate:** rendered from `game_catalog` merged with `season_games`, so
  an 8th puzzle type appears with **zero code change**. Theme hierarchy comes from live
  `dc_daily_theme` — public labels only, never D-codes.
- **Cron** `/api/cron/season-config-apply` hourly at **:05** → `season_config_apply_due()`.
  An audit row is written ONLY when something actually flipped.
- **Verified:** 17-assertion harness (promote-now · schedule · incumbent stays live during
  the wait · cron flip · exactly-one-active · idempotent re-run · validation refusal ·
  two-overdue) all PASS — run pre-apply AND again against the **deployed** functions,
  inside `BEGIN … ROLLBACK` (0 test rows persisted; 4 seasons / 4 configs / 1 active
  unchanged). Advisor: **no new findings** — the `function_search_path_mutable` WARN and
  the `season_config` `rls_disabled_in_public` ERROR are pre-existing (the untouched
  `season_config_clone`/`_validate` carry the same WARN). `npm run test:season-config` (22).
- **Known gaps:** child writes are **not transactional** (PostgREST cannot do
  multi-statement transactions — a mid-sequence failure returns an explicit "reload before
  editing further" rather than pretending atomicity); `conferences` is empty so the
  conference scope option is disabled; Thread-level theme allocation is stored/read but the
  editor exposes Theater + Sector.

## Game icon art refresh (CC-DC-ICON-REFRESH-1.0, feat/dc-icon-refresh, 2026-07-30)

**One-time upgrade, and it supersedes FAR-394's per-game color decision.** The
seven game icons were hand-drawn inline SVG (Ch.09b geometry, recolored to jewel
tones by FAR-394 two days earlier). They are now **raster art**, authored outside
the repo. The "do not recreate the icons" rule in the cosmetic-buff section still
stands for everything after this pass.

- **Art is a build artifact, not code.** `scripts/build-game-icons.mjs` crops the
  1280² masters to the 1024² tile at `(128,50)` and emits `public/icons/games/`:
  `<slug>-tile-{128,256}.png` (label cropped — every surface already renders the
  game name as HTML text) and `<slug>-share.png` (640², label baked in, for the
  share card). Don't hand-edit the PNGs; re-run the generator. `sharp` is
  deliberately **not** a project dependency — it's a throwaway install (see the
  script header), so `next build` is unaffected.
- **Slugs follow routes, not labels.** Three masters carry a shorter baked label
  than the game key: `SIGNAL`→`Signal Drop`, `FIBER`→`Dark Fiber`,
  `THE CIRCUIT`→`Circuit`. Accepted by Myke; the share card reads "SIGNAL" for
  Signal Drop. Signal Drop's *glyph* also contains the word SIGNAL (it's the
  word-search answer), visible beside the HTML label at 64px — also accepted.
- **FAR-394 jewel tones are retired** (Myke-approved 2026-07-30). `GAME_ACCENT` is
  still the single source of truth and still `{accent, deep, glow}`, so
  `TodaysSignalCard` and the lobby hover glow are unchanged in shape. What the
  accent *means* changed: it used to BE the pictogram ink drawn on the forest
  tile; the pictogram is now baked art, so the accent only drives the hover glow
  and the Signal card.
- **The accents are NOT each icon's dominant color, on purpose.** Three masters
  are predominantly cyan; taking each one's modal color collapsed Signal Drop /
  Circuit / The Brief to Δ5–Δ20 and failed FAR-394's distinguishability guard,
  and Dark Fiber's core violet read 2.56:1 on forest (min 3). Each accent is
  therefore drawn from a **different real color already inside its own master** —
  Signal Drop its red waveform, The Brief its magenta highlight rows, Dark Fiber
  its lighter violet halo. **No icon was recolored.** `npm run test:contrast` is
  **29/29, closest pair Δ70**. Three mirrors must stay in sync: `GAME_ACCENT`
  (GameIcon.jsx), `--color-game-*`/`--color-neon-*` (globals.css), and the gate's
  own copy in `scripts/contrast-check.mjs`.
- **Corner geometry:** the masters have opaque `#1a1a1a` corners (no alpha) and a
  baked ~8.6% radius. The tile container's 20% radius + `overflow:hidden` clips
  them away — don't drop the container radius below ~10% or the dark corners
  reappear on the cream lobby cards. `boxSizing:border-box` on the tile is load-
  bearing: without it the 1px hairline renders the art `(size-2)×size`, oblong.
- **Removed:** `GameIconDefs` (shared SVG `<defs>`, no longer referenced) and
  `src/components/gameIconSvg.js` (the share-card SVG mirror FAR-394 required —
  there is no longer a second copy of the geometry to keep in sync).
  `buildShareIconBlob` now fetches the pre-rendered PNG instead of rasterising SVG
  on a canvas, which removes the canvas-taint and `toBlob`-availability paths.
- **Verified:** `next build` green · `npm run test:contrast` 29/29 · ESLint
  identical to the `origin/main` baseline (68 problems / 31 errors / 37 warnings)
  · 21/21 assets serve `200 image/png` · live headless pass on `/` and `/challenge`
  (7/7 icons, 0 broken, 0 console errors, 0 404s) plus in-game header + switcher.
- **Not touched:** `design-reference/faraday-daily-challenge-lobby.html` keeps the
  original pictogram geometry as provenance. League Office game-dot neons
  (`src/lib/league-office/constants.ts`) remain a separate internal registry —
  still the follow-up FAR-394 flagged.

## Legal pages · LLC footer · signup clickwrap (CC-DC-LEGAL-1.0, claude/legal-terms-privacy-footer-05ytxi, 2026-07-30)

**Operating entity = `Faraday Intelligence LLC`, a Minnesota limited liability
company.** That exact string is the attribution everywhere — footer notice and
both documents. Product names carry ™ in legal copy: Faraday Intelligence™,
Faraday Daily Challenge™, Jurisdiction Watch™.

- **Routes: `/terms` and `/privacy`** — two separate pages, both **static site
  content with the copy inline in the page component** (no CMS, no Airtable, no
  Supabase, **no new dependency** — the repo still ships only next/react/react-dom).
  The old combined `/legal` placeholder is now a **`permanentRedirect("/terms")`**
  (D1: replaced-with-`/terms`, chosen over an index page because only two nav
  links pointed at it). Keep `/legal` as a redirect — do not delete it.
- **Effective-date convention:** one `effectiveDate` literal per page component,
  currently **July 30, 2026**. ToS §7 / Privacy §10 promise that a material change
  is signalled by bumping it — so **edit the literal in the page, never a shared
  constant**, and bump it whenever the text changes materially.
- **Shell** `src/components/LegalDocument.tsx` — SiteHeaderNav + title + effective
  date + sibling cross-link, with the section/paragraph/list typography applied
  once via arbitrary-variant classes. Contact route is the **Feedback page**
  (`/help/feedback`), never a raw email address.
- **Footer** `src/components/SiteFooter.tsx` — `© 2026 Faraday Intelligence LLC.
  All rights reserved. · Terms · Privacy`. Baked into `DcStubPage` + `StubPage`
  (so every stub inherits it) and added per-page to the 18 `SiteHeaderNav` routes,
  `/live-agent`, `/jurisdiction-watch`. Three surfaces carry a **hand-rolled twin**
  instead, because they don't style from the Tailwind `@theme`: the dark in-app
  shell at the bottom of `DailyChallenge.jsx` (covers lobby + all 7 games +
  account + gate; flips light/dark by `screen`), the storefront `/` footer, and
  the two `/library` forest footers. **Edit all four when the notice changes.**
  Not reached, deliberately: `/league-office/*` (staff-only internal), `/auth`
  (transient verify screen), the pure redirects (`/legal`, `/notifications`,
  `/academy`, the 7 per-game routes), and `/api/*`.
- **Clickwrap** — "By continuing you agree to the Terms of Service and Privacy
  Policy." rendered **immediately under the submit button** in
  `src/components/OTPGate.jsx` (the live registration flow: email → `send-otp` →
  `verify-otp`; mounted by `DailyChallenge.jsx`, `/account`,
  `/account/notifications`). D4: adjacent assent, **no checkbox**. Links open in a
  new tab so an in-progress sign-up is never lost. `src/components/SocialGate.tsx`
  (the `register-with-magic-link` caller) got the same line, but note it is
  **imported by nothing** — dead code kept in tree. **No auth logic, edge
  function, schema, or RLS was touched.**
- **No cookie-consent banner (D6), and that is a verified finding, not an
  assumption:** the repo has zero third-party analytics/ad trackers — no gtag,
  GTM, `@vercel/analytics`, PostHog, Segment, Plausible, or pixel. If one is ever
  added, the banner question reopens.
- **Verified:** `npm run build` green · `npm run test:contrast` 29/29 · headless
  pass over `/terms /privacy /legal /challenge /account /leaderboard
  /help/feedback` — footer on all 7, clickwrap on the `/account` gate, `/legal`
  308s to `/terms`, **no console errors from these routes** (the only console
  noise is the sandbox's blocked Google Fonts + the 500s from unset local
  Airtable/Supabase env). ESLint unchanged: same 2 pre-existing errors before
  and after.

## League Office Announcements → in-app player banner (claude/new-session-ilg5cd, 2026-07-29)

Commissioner-authored **rich-text broadcasts** rendered as a dismissible banner in
the Daily Challenge shell. The **existing** sidebar "Announcements" item (which was
disabled with a `SOON` badge) is now live — **no second "Broadcast" nav entry**;
"broadcast" stays internal/table/action vocabulary and the send-button verb.

- **Schema** `20260729000002_lo_broadcasts.sql` (**APPLIED to prod 2026-07-29**,
  Myke-approved): `lo_broadcasts` (body_html/body_text/cta/severity/starts_at/
  expires_at/created_by_email/revoked_at) + `lo_broadcast_dismissals`
  (PK `(broadcast_id, subscriber_id)`). Both **RLS deny-all, no policies** — DC
  players hold no Supabase JWT (identity is the custom `dc_sessions` token), so an
  `auth.uid()` policy could never fire and an anon SELECT would leak staged rows.
  Approved 2026-07-29; visibility is enforced in the route instead.
- **Sanitizing is server-side at WRITE time, non-negotiable.**
  `src/lib/league-office/sanitize-html.ts` (hand-rolled — **zero new deps**; the
  repo ships only next/react/react-dom). Allowlist `p,br,strong,b,em,i,u,ul,ol,li,a`
  + `a[href,title]`, href schemes **https:/mailto: only**; disallowed tags are
  stripped (content kept) except script/style/iframe/svg/… whose content is dropped
  too; entities are decoded before the scheme check (kills `&#106;avascript:`);
  raw payloads >2,000 chars rejected. **`lo_broadcasts.body_html` always holds the
  sanitized output — the raw payload is never stored**, and `body_text` is derived
  from the sanitized html. The composer's live preview re-runs the same pure module
  client-side for PRESENTATION only (never the security boundary).
- **Write path = the existing Tier 2 funnel**: `broadcast.send` / `broadcast.revoke`
  cases in `executeAction` → one `lo_audit_log` row each (`domain='comms'`,
  `after` carries the sanitized body + recipient count, `reversible=true`; revoke
  writes `reverts_id`=send row **and** stamps `reverted_by` back on it so the Audit
  Log shows "Reverted" instead of a dead Revert button). A Revert clicked on a send
  row routes to the same revoke. Non-staff → 403 from `/api/league-office/action`.
- **Player path** `/api/broadcast`: GET returns the single most recent live,
  non-dismissed broadcast (`order=starts_at.desc&limit=1` — **query rule, not a DB
  constraint**, so a future-dated one can be staged); POST writes one dismissal row
  keyed to the **session-resolved** subscriber_id, never a body-supplied one.
  No token → no banner and no write. `BroadcastBanner` mounts between the masthead
  and `<main>` in `DailyChallenge.jsx` (`/challenge` only, per scope);
  `BroadcastBannerView` is shared with the composer preview so staff see exactly
  what players see.
- **Audience** = `dc_subscribers.active=true`, resolved at read time — **no
  fan-out table**, no per-team/per-season targeting (v1).
- **Validated live 2026-07-29** (2 throwaway subscribers + 5 broadcasts, all cleaned
  up — 0 rows left): 3 live candidates → **exactly 1 banner**, the newest (AC 8);
  expired + revoked never returned (AC 4/5); **A's dismissal did not affect B**, and
  a replayed dismiss stayed 1 row (AC 3); revoking what B still had showing dropped
  B to the next live one (revoke is global). `severity` CHECK rejects off-list values;
  **anon SELECT returns 0 rows** (deny-all holds). `get_advisors` (security): both new
  tables raise ONLY the intended `rls_enabled_no_policy` INFO — no new ERROR/WARN.
- Tests: `npm run test:broadcast` (28). `npm run build` green.

## Faraday Signal — Brief pilot (FAR-385, claude/faraday-signal-brief-pilot-393v91, 2026-07-29)

Daily "Faraday Signal" items (headline + body + optional source link), authored
**directly in Supabase** — table **`dc_daily_signal`** (migration
`20260729120000…`, **APPLIED to prod 2026-07-29**; RLS deny-all like every
`dc_*` table — NEVER add an anon/authed policy). No new Airtable coupling.
Docs + QA screenshots: `docs/far385-faraday-signal/README.md`.

- **Matching runs in the sync-day-content cron (05:10 UTC), never at request
  time.** `src/lib/signal-matcher.ts` (`matchSignalsForDay`, pure,
  `npm run test:signal-matcher`, 11 tests) scores per (puzzle, signal):
  pin override (`pinned_for_date` [+ optional `pinned_puzzle_type`] wins
  outright, latest `updated_at` on collision) · sub-domain +10 · domain +5 ·
  tag +2 · recency tiebreak. Tiers: ≥10 → `matched` ("Related Signal");
  else any published signal in the 3-day window (`signal_date` ∈
  [serve−2, serve]) → `lead` ("Elsewhere in the Sector"); else `none` → no
  card. **All 7 games get `matched_signal_id`/`signal_match_tier`/denormalized
  `signal{…}` in `dc_daily_page_content.puzzles[*]`** (jsonb shape change only,
  no migration; sync route decorates after `buildDayContentRow`, fail-soft to
  tier `none` so day pages never lose their sync to the signal layer).
- **Serve = the Take pattern:** `/api/challenge/today` `fetchTodaysTakes` now
  also attaches `puzzles[type].signal` `{tier, headline, body, source_url,
  source_label, signal_date}` — still one Supabase read, no client fetch. Like
  the Take, it rides the pre-solve payload but is rendered ONLY on the
  completion screen (non-spoiling by construction — no answer material).
- **Render:** `TodaysSignalCard.tsx` (self-contained; FAR-394 accent passed as
  prop) mounted in `ScoreCard` below `FaradaysTake`, gated by
  **`SIGNAL_ENABLED_GAMES = new Set(["The Brief"])`** in `DailyChallenge.jsx` —
  CC-FAR385-2 adds Signal Drop/Rackl by adding strings there. `none`/missing →
  renders nothing (no placeholder). All 7 ScoreCard call sites pass
  `signal={puzzle.signal}`.
- **Metadata reality (2026-07-29):** CC-1 landed same-day (see the
  CC-DC-SUPABASE-SERVING section below) but `DC_PUZZLE_SOURCE` is unset in
  prod → sync source is Airtable, whose Domain/Sub-Domain links are
  unpopulated (FAR-178, Myke) — so puzzles carry only `topic` + `puzzle_name`;
  the matcher accepts exact label-vs-topic matches meanwhile, and structured
  `matched` is effectively pin-only until the links land. `day-content.ts`
  gathers `domain_name`/`sub_domain` public labels fail-soft on the Airtable
  path; the staging path resolves `domain_name` via `resolveDomainName` and
  leaves `sub_domain` null (staging stores D#.# codes; no code→public-label
  map exists yet — flagged cutover gap). Signal `domain`/`sub_domain` are
  **IDF 4.0 public labels only, never D-codes**.
- **Seeded 2026-07-28** (3 rows, `source_label='seed'`): live 07-28 row
  decorated via the real matcher — Brief `matched` (pin), others `lead`;
  anon-key read of `dc_daily_signal` = 0 rows; advisor: only the intended
  `rls_enabled_no_policy` INFO. Playwright QA: matched/lead/none/other-game
  states all correct. `npm run build` green.

## DC serving: Airtable → Supabase (CC-DC-SUPABASE-SERVING-1.0, claude/dc-supabase-serving-migration-01yg02, 2026-07-29)

The Daily Challenge serving path is being repointed onto
**`dc_puzzle_bank_staging`**, behind **`DC_PUZZLE_SOURCE`** = `airtable`
(default) | `supabase` — the facade `src/lib/puzzle-bank.js` picks per call;
the 3 routes (today/guess/rotate) and the day-content sync all switch together.
Full runbook + phase status: **`docs/dc-supabase-serving/README.md`**.

- **Schema (migration `20260729000001…`, APPLIED to prod 2026-07-29):**
  `public_id` (unique; minted by `trg_dc_assign_public_id` ONLY on the first
  transition into Published/Live/Retired — drafts never carry one; format
  `TYPE4-YY-MM-DD-NNNNN`, GLOBAL `dc_public_id_seq` seeded at 365 = Airtable
  max 00364 + 1), `approved_by/approved_at`, `(published, go_live_date)` index.
  `theme_date`/`hint_*`/`answer_key` are now nullable ONLY for imported rows
  (`airtable_record_id` set) — the `dc_staging_import_or_complete` CHECK still
  requires them for generated rows (synthetic dc_daily_theme rows were rejected:
  theme copy is subscriber-facing).
- **Rotation = `fn_dc_rotate_live_set(date)`** — ONE transaction, exact
  AUTO-128 semantics (promote Published+today first, retire Live+strictly-before),
  idempotent; the Airtable rotator's partial-failure mode no longer exists.
  **Approval = `fn_dc_approve_puzzles(date[], actor)`** — the ONLY
  Unpublished→Published path; nothing auto-publishes. Both RPCs service-role
  only. RLS stays deny-all — NEVER add an anon policy (rows carry answers).
- **`src/lib/supabase-puzzle-bank.js`** mirrors airtable-puzzle-bank's 4 exports
  exactly; `puzzle_content` is jsonb (never JSON.parse); `answer_key` is never
  selected on the serve path; Signal Drop still routes through
  `toPublicSignalPuzzle`. Tests: `npm run test:puzzle-bank` (10).
- **State (2026-07-29):** flag unset in prod (= airtable, behavior unchanged).
  Today's 7 Live rows pilot-imported to staging; parity verified deep-equal on
  all 7 types (jsonb key reordering is the one accepted delta class). Full
  373-row backfill (`scripts/dc-migrate/backfill-airtable-to-staging.mjs`,
  dry-run default) + flag flip + Airtable-path deletion are the remaining
  Phase-5 ops steps — run the runbook in order. CC-2 (fill the bank) sequences
  first.

## Daily Challenge editorial palette (FAR-394, claude/daily-challenge-editorial-palette-9tvxzv, 2026-07-28)

Moved the DC from raw neon-on-dark toward Faraday's institutional editorial
palette — **color tokens only** (spacing/type/layout are FAR-395). Runs BEFORE
FAR-395 per the ticket so layout primitives build against final styling; both
touch `DailyChallenge.jsx`, so coordinate if run in parallel.

- **Per-game differentiator: raw neon → one desaturated jewel tone per game.**
  Single source of truth is now **`GAME_ACCENT`** in `src/components/GameIcon.jsx`
  (`{accent, deep, glow}` per game): Rackl teal `#2F9C8B` · Circuit sapphire
  `#4C90BD` · Dark Fiber amethyst `#9A74C0` · Signal Drop garnet `#C86A85` ·
  Frequency rust `#C06A3C` · The Stack bronze `#A08A3A` · The Brief olive
  `#7CA34A`. `GAME_NEON` is kept as a back-compat alias (`{neon,glow}` → accent).
  The pictogram fills (GameIcon.jsx), the **share-card SVG mirror**
  (`gameIconSvg.js` — MUST stay in sync), the lobby hover glow, and the
  `globals.css` `--color-game-*`/`--color-neon-*` mirror all derive from these.
  **These per-game values are a PROPOSED design pass** — the ticket asks to
  confirm final values with Myke/design; The Stack (bronze) is the one adjacent to
  gold and most worth a look.
- **Surfaces standardized on Warm White `#F8F5F0`** (was the near-identical Warm
  Cream `#EEE6DA`): `C.cream` in `DailyChallenge.jsx` and `SiteHeaderNav.tsx` is
  now an alias === `white` (avoids re-touching every ref) and the Rackl sample
  `textColor`s were repointed. Warm Cream stays in `globals.css`
  (`--color-warm-cream`) for the homepage editorial double-rule + League Office —
  both out of scope, untouched.
- **Accessibility:** `scripts/contrast-check.mjs` extended → **29/29 WCAG 2.1 AA**;
  adds warm-white surface pairings + each jewel ≥3:1 on the forest tile (they are
  `aria-hidden` decorative graphics, not text) + a jewel/gold/sage
  distinguishability guard (Δ≥40; closest pair Stack↔Gold Δ66). Run
  `npm run test:contrast` after any color edit.
- **Verified:** `next build` green; visual QA screenshotted at desktop (1440) +
  mobile (390), lobby + in-game. Report + full token table:
  `docs/far394-editorial-palette/qa-report.md`. League Office game-dot neons
  (`src/lib/league-office/constants.ts`) are a separate internal registry, left
  as-is (staff-only, out of the lobby+games scope) — flagged as a follow-up.

## Faraday's Take on completion (FAR-389, claude/faraday-take-completion-tquznw, 2026-07-28)

Reconciles the first-cut Take (shipped in "Launch backlog 1–3") with the full
FAR-389 ticket. Full spec: **`docs/far389-faradays-take.md`**.

- **Take source = a dedicated `Faraday Take` field** (multilineText), SEPARATE
  from the per-question `explanation` keys inside `Puzzle Content` and from the
  (non-existent) `Answer Explanation` concept. Confirmed 2026-07-28 against the
  live Puzzle Bank: **none of `Faraday Take` / `Answer Explanation` / `Take
  Byline` exist yet** — so no field collision. **BLOCKED on Myke** to add
  `Faraday Take` (+ optional `Take Byline`) manually in Airtable; the code reads
  them **by name** (`day-content.ts`) so they light up with no redeploy. Do NOT
  write the schema via API (canonical bank rejects it).
- **Voice by game type** — `src/lib/faradays-take.ts` `TAKE_VOICE_BY_TYPE`:
  Gilbert Faraday (Rackl · The Stack · Dark Fiber · Frequency), Mach Eigen
  (Circuit · The Brief · Signal Drop). `resolveTakeByline` = override → voice →
  Gilbert. The `Take Byline` field overrides per puzzle.
- **Fallback, never blank** — when no Take is authored, the win screen surfaces
  the puzzle's own per-question `explanation` (`deriveTakeFallback`) in PLAIN
  (non-italic, unsigned) styling. Derived client-side from content the browser
  already has → works day one, no field/store needed. Only Circuit/Brief/
  Frequency carry explanations; the other four show nothing until authored.
- **Render:** `FaradaysTake.tsx` (voiced italic-serif Take + byline · plain
  fallback · else null), threaded through `ScoreCard` for all 7 games. Read path
  unchanged in shape: `day-content` sync → `dc_daily_page_content` →
  `/api/challenge/today` (`fetchTodaysTakes`), now reading `Faraday Take` not
  `Answer Explanation`. The FAR-287 Answers page keeps `Answer Explanation`.
- **Recurring cost flagged:** every new puzzle needs a Take authored in Airtable
  (else fallback). No AI auto-drafting (out of scope). Tests: `npm run test:take`
  (9). `npm run build` green.

## Daily Challenge domain = faradaydailychallenge.com (claude/dc-canonical-domain, 2026-07-28)

**The Daily Challenge is canonical on `faradaydailychallenge.com` (+ `www`).** Every
subscriber-facing DC link now uses it: the in-game share card + team invite
(`SITE_URL`/`DC_URL`/`SHARE_URL` in `DailyChallenge.jsx`), the `/share` hub, the
`/leaderboard` share text, and the **auth magic-link base** (`MAGIC_LINK_BASE` in
`supabase/functions/register-with-magic-link` → `…/auth`, so the session is set on
the same origin the player uses). This **amends the FAR-119 invariant** that had
`faradaydailychallenge.com` 301-ing to `faraday-intelligence.ai/daily-challenge`.
The **storefront / brand site + the other 7 products stay on `faraday-intelligence.ai`**
— only DC-facing URLs moved.

- **Two operational prerequisites, both outside the repo:**
  1. **Vercel:** `faradaydailychallenge.com` (+ `www`) must be attached to the
     **`v0-faraday-daily-challenge-n2u5`** project and **follow current production**.
     It was found (2026-07-28) pinned to a stale pre-#101 deployment
     (`dpl_AHvf9Hkq…`) — which is why the domain showed the old "Coming soon"
     glossary while `faraday-intelligence.ai` served the finished page. Repoint /
     un-pin it in the Vercel dashboard.
  2. **Supabase:** redeploy `register-with-magic-link` so the new `MAGIC_LINK_BASE`
     takes effect (merging the code alone does nothing — edge fns deploy separately).
     One-time: subscribers who authed on the old origin will re-auth on the new one.
- `vercel.json` rewrite (`/` on `(www.)?faradaydailychallenge.com` → `/daily-challenge`)
  is retained — the branded apex opens the lobby.

## ⚠️ League Office auth kill-switch (owner-requested, 2026-07-28)

The League Office staff gate can be fully **disabled** with one env var:
`NEXT_PUBLIC_LEAGUE_OFFICE_OPEN=1` (or `true`). When set, both the client
`StaffGate` and the server `requireStaff()` bypass all session/allowlist checks and
grant commissioner access to **anyone** with the URL — on the public production
domain. This exposes player PII and the destructive Tier 2 actions (reset season
scoring, pause accounts, …). A red "Authorization is DISABLED" banner renders while
it's open, and any audited write is attributed to `auth-disabled@league-office.local`.

- **Default (env unset) = gate fully enforced** (mykemiller@gmail.com only), exactly
  as before. Merging the code alone changes nothing.
- **Open it:** set the env in Vercel + redeploy. **Restore it:** delete the env +
  redeploy (`NEXT_PUBLIC_` is inlined at build, so a redeploy is required either way).
- One `NEXT_PUBLIC_` flag drives both layers, so you can't open one and forget the
  other. Helper: `isLeagueOfficeOpen()` in `src/lib/league-office/constants.ts`.

## Intelligence Readiness rewards (FAR-393, claude/intelligence-readiness-streak-lsaa9m, 2026-07-28)

The daily play **streak** is reframed subscriber-side as **"Intelligence Readiness"**
and now pays out **real Faraday tokens** at milestones. Rename + reward layer only —
the streak counter and its scoring multiplier (`calcScore`/`getStreakMultiplier`,
`dc_subscribers.play_streak` written by `complete-puzzle`) are **unchanged**. Phase-0
investigation + final design: `docs/far393-intelligence-readiness/PHASE-0-FINDINGS.md`.

- **Source of truth = `dc_subscribers.play_streak`** (NOT `leaderboard_daily.streak`,
  which is a denormalized mirror). Timezone anchor = `America/Chicago` (server-computed).
- **One Faraday wallet = `live_agent_token_ledger`**, keyed to `dc_subscribers.id`.
  Migration `20260728120000_far393_readiness_rewards.sql` (**APPLIED to prod
  2026-07-28**) adds a **durable `bonus_balance`** (survives the monthly plan reset;
  spent before plan balance; **spendable by the free tier** — so earned tokens buy real
  Live-Agent answers). `token_transactions` is NOT used: its FK points at the empty
  `subscribers` table, so it can't key a DC player (and its `CHECK`s reject
  `tokens_burned<0` / `kind='streak_grant'`).
- **Grant path = `dc_grant_readiness_reward(subscriber, threshold)`** (SECURITY DEFINER,
  the ONLY sanctioned write). Server-verifies `play_streak` against the DB (never trusts
  the client), enforces **no pre-ship backfill** (`run start = last_day−(streak−1) ≥
  epoch 2026-07-28`) and **abuse caps**, credits `bonus_balance`, logs to
  **`dc_streak_grants`** (RLS deny-all; audit + idempotency). `/api/score` calls it after
  `complete-puzzle` when the new `playStreak` is exactly 5 or 10, and returns
  `readinessReward` only when a grant fired.
- **Ladder:** 3-day = cosmetic "Readiness: Building" (no wallet write); **5-day = +1
  token** (cap 1 / rolling 30 days); **10-day = +3 tokens** (cap 1 / calendar week — the
  FAR-393 "Friday brief" tier was **descoped** to a token grant, no brief-unlock model
  exists). Token amounts (1/3) provisional.
- **`live_agent_debit` rewritten** to spend `bonus_balance` first and let any tier spend
  it; monthly reset still only touches the plan `balance`. No edge-fn deploy (it's a
  Postgres RPC via PostgREST).
- **Copy rename** across `DailyChallenge.jsx`, `/account`, `/account/notifications`
  (label only — `streak_at_risk` key is a fixed contract), `/challenge/answers`,
  `/help/[topic]`, `/merch`, `OTPGate`, `teasers` — no subscriber-facing "streak" wording
  remains. `league-office/*` (internal admin) intentionally unchanged.
- **Validated live** (throwaway subscriber, cleaned up): 5→+1, 30-day dup blocked,
  real-fn pre-ship blocked, 10→+3, weekly dup blocked, free-tier bonus debit + idempotent
  replay + drain-to-`not_entitled`. `get_advisors` (security): only the intended
  `rls_enabled_no_policy` INFO on `dc_streak_grants`; both new fns set `search_path`; **no
  new RLS gaps**. `npm run build` green.

## Daily Challenge header — icon-dropdown nav (feature/header-icon-nav)

The masthead in `src/components/DailyChallenge.jsx` uses an **icon-dropdown** nav:
wordmark ("Faraday" / "DAILY CHALLENGE") flush left (no BrandMark tile; clickable
→ lobby), the ambient status (handle + Today's/Season Total Score, hidden ≤430px)
and **five right-aligned icon triggers** — **All Games (grid) · Help & Feedback (?)
· Compete (trophy) · Account (gear) · More Faraday (hamburger)** — each opening a
click-toggle dropdown (design-review menu structure, 2026-07-02):

- **All Games** = the 7 games in lobby-grid order (`GAME_CONFIGS` in-app;
  `DC_GAMES` in SiteHeaderNav → `/challenge?game=<type>` deep-links; keep in sync).
- **Help & Feedback** = Hints / Tips and Tricks / Questions (+ the FAR-287
  "TODAY'S CHALLENGE" group) — the `/help/*` stubs are served by the single
  dynamic route `/help/[topic]`. **Glossary / Report a Bug / Feedback moved to
  the gear (Account) menu (Myke, 2026-07-03)** — same `/help/*` hrefs, shown in
  both the authed and signed-out gear states, below a divider.
- **Compete** = Leaderboard — Today / Leaderboard — Season (both `/leaderboard`;
  no today-only view yet) / Teams (`/leaderboard?view=teams` deep-link) / Free
  Agency (`/free-agency` stub, "Trade window: TBD").
- **More Faraday** = About (`/about` stub) / Who is Faraday (`/who-is-faraday`
  stub) / Share / Invite (`/share` stub) / Notifications (`/notifications` stub) /
  Faraday Merchandise (`/merch` stub) / **Faraday Academy — disabled/grayed, no
  link (reserved for a later phase, do NOT wire)** / Terms-Privacy (**now `/terms`,
  a real page — see the Legal pages section at the top; `/legal` redirects there**).
  Other Faraday products (Jurisdiction Watch, Signal Room, …) deliberately NOT in
  this menu. No "Sign Up" in the gear menu by design.
- Stub pages share `src/components/DcStubPage.tsx` (DC masthead + "Coming soon"
  chip). Repoint menu items in the two build*Menus helpers when real pages exist.

- **Edit the dropdown text/links in ONE place:** the `buildHeaderMenus()` helper
  (just above the `DailyChallenge` component). Each item is `{label, onClick}` /
  `{label, href}` / `{label, current}` / `{label, disabled:true}` / `{divider:true}`.
  The Account menu is auth-conditional (`email` present → Account / Settings /
  Notifications / Glossary–Bug–Feedback / Sign Out; else → Sign In +
  Glossary–Bug–Feedback; Settings opens the same Account screen today).
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
  `/notifications`, `/merch`, `/free-agency` link lands on a stub (`/legal` no
  longer does — it redirects to the real `/terms`).
  Repoint in `buildHeaderMenus` / `buildSiteMenus` when real pages exist.
- **Standalone Next routes** (`/account`, `/leaderboard`, …) use the twin
  component `src/components/SiteHeaderNav.tsx` — same icon-dropdown look/behavior
  but **href-based** nav (no in-app screen state). Edit its dropdown text/links in
  `buildSiteMenus()`. It injects the shared `.dc-*` styles once per document
  (`id="dc-sitenav-styles"`). `/account` adopted it (feature/account-header-teams);
  `/leaderboard` swapped off the old D·L·A `NavLetter` nav 2026-07-03 — every
  standalone DC surface is now on `SiteHeaderNav`.

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

## Teams reconciled · MW retired · Team Captain (claude/teams-reconcile-mw-captain-fj04pj, 2026-07-03)

**`team_memberships` (subscriber_id + season_id) is THE membership table** — the
email-keyed `team_members` is dropped, and the MW currency is fully retired
(columns `teams.mw_total`, `team_members.my_mw`, `dc_subscribers.mw_balance`,
`dc_completions.mw_earned` + the completion→team MW trigger all gone).
Migrations `20260703120000_teams_reconcile_captain.sql` (additive: captain +
data migration) and `20260703120001_retire_mw_and_team_members.sql`
(RPC rewrites + drops) — **both applied to prod 2026-07-03**, with the MW-free
edge fns (`complete-puzzle`, `verify-otp`, `verify-magic-link`,
`create-subscriber`) deployed in between (the old deployed complete-puzzle
REQUIRED `mwEarned`, so `/api/score`'s forward was 400-ing silently — fixed).

- **Team Captain (MVP):** `teams.captain_id` → `dc_subscribers.id`
  (ON DELETE SET NULL). Creator = captain automatically: `/api/teams` create
  sets it, and the `team_create` RPC sets it. `team_leave` rolls captaincy to
  the earliest remaining member; last-member leave deletes the team (unless a
  company with child teams). This column is the hook for the FUTURE
  trade-approval session — no trade/Trading Window/League Office logic exists.
- **RPCs kept their names/signatures** (`team_create/join/leave`,
  `team_get_my_teams`, `team_leaderboard`, `fn_group_member_emails`) but now
  run on `team_memberships` (active season, `pending=false`); `team_join` cap
  is 5 (canon). `team_get_my_teams.role` derives from `captain_id`
  ('creator'/'member'); `team_leaderboard` ranks by season score
  (`score_events`), return column `mw` → `score`. Legacy `team_get_my_team`
  (singular) dropped.
- **"Signals" = score now:** every ranking/cache fn (`fn_leaderboard_daily/
  season`, `fn_player_rank_*`, `fn_group_member_board`, `fn_leaderboard_rollover`,
  `fn_dc_completion_cache_upsert`, `fn_backfill_daily_cache`) sums
  `dc_completions.score` where it previously summed `mw_earned` (which had
  degraded to a flat 5/puzzle) — global/season standings are score-based.
- **`teams.season` (text) DEPRECATED:** founding-era label only (mixed formats
  "Summer 2026"/"Season 1 — Power Crunch"), now nullable + commented; still
  stamped on create for continuity. Never filter/join on it — season scoping is
  `team_memberships.season_id`.

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

## Daily Challenge day-content pages (FAR-287, claude/daily-challenge-content-pages, 2026-07-03)

Three day-level pages covering the FULL daily set (all 7 types), reached from a
second labeled group ("TODAY'S CHALLENGE") in the "?" Help dropdown of BOTH
`buildHeaderMenus` and `buildSiteMenus` (new `{heading:"…"}` menu-item type):
**`/challenge/hints`** (Hints Today) · **`/challenge/about`** (About Today's
Challenge) · **`/challenge/answers`** (Answers Today). The evergreen `/help/hints`
stub stays — "Hints Today" is a distinct, day-scoped page.

- **Data:** `dc_daily_page_content` (one row per CT serve day; migration
  `20260703000002…`, **not yet applied to prod** — apply at promotion). RLS
  deny-all/service-role-only, deliberately NOT public-read like
  `library_catalog_cache`: the `puzzles` jsonb carries answers + explanations,
  so an anon-key SELECT policy would leak ungated answers via PostgREST.
- **Sync (idempotent):** `/api/cron/sync-day-content` (vercel.json 05:10 +
  06:10 UTC, ten minutes after the AUTO-128 rotator; same midnight-Chicago
  guard + CRON_SECRET + `?force=1`, plus force-only `?date=` backfill). Gather
  logic in `src/lib/day-content.ts` (`buildDayContentRow`): reads the bank's
  Live rows **by field NAME** (Hint 1/2/3 exist; **"Answer Explanation" +
  "Domain"/"Sub-Domain" links are Phase-1 prerequisites Myke adds in Airtable —
  absent fields → nulls, never a sync failure**), resolves Domain → IDF Domain
  Registry `Domain ID`, and picks one Academy course per domain (base
  `appzhpKGOI248bCDQ` / `Courses`, `School ID` = Domain ID, free-with-URL
  first) at SYNC time — pages never touch Airtable. Upsert keys on
  `puzzle_date` (`resolution=merge-duplicates`).
- **Reads:** `/api/challenge/day-content` (hints/about; answers STRIPPED) and
  `/api/challenge/answers` (THE gate: a puzzle's answer unlocks only when the
  subscriber completed it that day per `dc_completions`, or the day rolled
  over; partial unlock normal; anonymous today = all locked). Live stats
  (completion % from `dc_daily_attempts`/`dc_completions`, avg `hints_used`)
  are computed fresh per request — NEVER stored in generated content.
- **Hint gate (FAR-198) untouched:** the Hints page spends the SAME
  localStorage budget key as the in-game HintControl
  (`faraday_hints_${TODAY}_${gameType}`, UTC-slice day, HINT_MAX 3) — shared
  budget, no duplicated/modified enforcement. New: the game now reports that
  count at completion (`/api/score` forwards optional `hintsUsed` →
  `complete-puzzle`, which always accepted it; previously nothing sent it, so
  `dc_completions.hints_used` was always 0). Analytics-only — never score input.
- **Academy links (FAR-21 reversed):** hint tier-3 footers + missed-puzzle recs
  on Answers deep-link the course `URL` (fallback `/academy` lobby redirect).
  The More Faraday "Faraday Academy — disabled" menu item is separate nav
  design and stays. Follow-ups flagged: no Supabase-synced Academy catalog
  exists yet (sync queries the Courses base live, daily, server-side); Academy
  lobby has no per-course/per-school deep-link scheme beyond the `URL` field.
- **Verified:** `extractAnswer` (all 7 Puzzle Content shapes) + about/course
  pickers pass 24 checks against the real 2026-07-03 live set; `npm run build`
  green. Env needed (already provisioned): `AIRTABLE_API_KEY` (its PAT must
  also read the Academy base for course recs — fails soft to no-nudge if not),
  `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.

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

## IDF 4.0 sub-domain tagging layer (FAR-319 Wave 0, claude/idf-4-subdomain-coverage-id5ln0, 2026-07-05)

Sub-domain feed coverage is now measurable: **`artifacts.ifs_subdomains text[]`**
(migration `20260705000001…`, **NOT yet applied** — apply, THEN deploy
`faraday-crawl` v1.2, in that order; the function writes the new column).
D#.# codes are validated against `faraday_subdomains.subdomain_code`
(116/116 backfilled) by a BEFORE trigger that STRIPS invalid codes with a
WARNING — never rejects the row (ingest chunks of 10). `splitIfsTags()` in
`faraday-crawl/index.ts` (pure, tested) routes dedicated-crawler D#.# tags into
`ifs_subdomains` and derives the parent D# into `ifs_domains` — before this,
Tier-1/2 crawlers wrote D#.# codes INTO `ifs_domains` (historical rows keep
that convention until backfill). Backfill: `scripts/idf4-subdomain-backfill.mjs`
(dry-run default; Phase A deterministic split 1.9k rows, Phase B LLM
precision-gated for the ~3.9k domain-only rows — high-confidence,
domain-consistent only, no forced assignments). Coverage query (fed = ≥1
artifact/14d per sub-domain, reads BOTH conventions):
`docs/idf4-coverage/subdomain-feed-coverage.sql`. Baseline 2026-07-05:
**60/116 fed**; Waves 1–2 of FAR-319 (AUTO-060–119) were already live via
FAR-200/202 — the push to ≥70 runs through Phase-B backfill + whitespace
crawlers. Verification report: `docs/idf4-coverage/wave0-verification-report.md`.

**Wave 3 (same branch): the AUTO-137→176 block was RESHAPED** per Myke's
FAR-319 approvals comment (2026-07-05): AUTO-137 = D18.1 Opposition Tracker
(Designed, supersedes both the old AUTO-176 assignment and the interim
AUTO-137=D7.1 scaffold), **AUTO-138–152 = `WAVE3_ACTIVATION`** (the 15 priority
whitespace crawlers: D7.1–7.4, D9.1–9.4, D10.1/.2/.3/.5, D4.5/.6, D6.3 — wired
into the fleet, ≥4 sources each), AUTO-153–163 + 167–175 = renumbered inert
scaffolds with **D8.2 pinned at AUTO-168** (Industry Conferences annotations
reference it). **D3 reconciliation:** PR #84 (merged) self-assigned
AUTO-164/165/166/176/177 → D3.1/.4/.5/.2/.3 — those IDs stay with the live D3
feeds; the 4 displaced scaffolds (D11.6, D16.5, D16.6, D18.3) sit on PROPOSED
ids **AUTO-179–182** (`placeholder:true`, pending Myke grant; AUTO-178 =
crawl healthcheck; next free = AUTO-183).
Registry renumber/flips = prepared change list only (`docs/idf4-coverage/
wave3-whitespace-activation.md`, incl. corpus gaps: CoolIT, Boyd, Danfoss,
Holder, BladeRoom, Compass, Apollo, Emerald AI). Dry-run harness:
`scripts/idf4-crawler-dryrun.mjs` (no-write; blocked 07-05 on the depleted
Anthropic credit balance — run before any Status flip).

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
