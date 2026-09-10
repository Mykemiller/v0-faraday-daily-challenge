# CC-LO-CONCURRENT-SEASONS-1.0 — Step 2 of "seasons are independent"

**Status: D1–D9 LOCKED (Myke, 2026-09-10). Phases A + B + C BUILT on branch
`claude/lo-concurrent-seasons` (PR #177). Migration NOT applied to prod, app
NOT deployed; Phase D (live verification, §7 AC2–AC5) is blocked on the two
prerequisites in §0.4.** Follows CC-LO-SEASONS-OVERLAP-1.0
(PR #176, merged 2026-09-10), which removed the overlap refusal but left every
runtime reader assuming ONE active season.

Investigated 2026-09-10 against live Supabase `ycadmmngkdhvpcsrcuaq` and this
repo at the merge of PR #176.

---

## 0. Premise, verified

1. **The runtime resolves "the" season 17 times, all as `status='active' … LIMIT 1`.**
   With two active seasons each caller silently gets the most recently started
   one. Inventory in §6.
2. **The puzzle bank is one slate per calendar day.** `dc_puzzle_bank_staging`
   carries `UNIQUE (puzzle_type, go_live_date)`; the serve path reads
   `published='Live'` with no season predicate; `fn_dc_approve_puzzles(dates, actor)`
   approves every Unpublished row on those dates regardless of season; the
   generation worker treats a date as "occupied" if ANY season has a row there.
   `season_id` already exists on staging (Part C½, nullable, "never read by the
   serve path") — this CC is the day it gets read.
3. **Live today (2026-09-10):** `TEST SEASON 1` (2026-09-07 → 09-25) is the only
   active season, platform-scoped, 9 members, **0 staged puzzles**. Every other
   season is platform-scoped too; only `Hot summer Final Beta` has a scope
   exclusion. There is no overlap in prod yet, so nothing is currently wrong —
   this CC is what makes overlap safe before the first overlapping season is
   created.
4. **⚠️ Two prerequisites are Myke gates, not code:**
   - Migration `20260910180000_lo_seasons_allow_overlap.sql` is **still
     un-applied** — `seasons_no_overlap_per_league` is present on prod as of this
     investigation. Nothing in this CC can be exercised until it lands.
   - **`DC_PUZZLE_SOURCE=supabase` is not set in Vercel** (CLAUDE.md, Part C½).
     The Airtable serve path has no season concept and never will. Per-season
     puzzles (§4) are unreachable until the cutover flag is flipped. §4 is
     built against the Supabase path only; the Airtable lib is untouched.

---

## 1. Decisions

| # | Decision | State |
|---|---|---|
| **D1** | Every runtime reader resolves the season **for a subscriber** (or the platform default for anonymous callers) through ONE SQL function. No TypeScript ever picks a season by `status='active' LIMIT 1` again. | **Locked (Myke, 2026-09-10)** |
| **D2** | The bank uniqueness widens to `(season_id, puzzle_type, go_live_date)`; the serve path selects the caller's season's puzzle; approve/generate operate per season. | **Locked (Myke, 2026-09-10)** |
| D3 | **Precedence when a subscriber is in scope of >1 active season:** the season whose scope is NOT platform-wide wins (a conference beta captures its members out of the platform season); among equals, latest `starts_on`, then `id` — deterministic, never LIMIT-1-by-accident. | **Locked (Myke, 2026-09-10)** |
| D4 | **The default season** (anonymous callers, subscribers on no in-scope team) = the active season whose scope resolves to the whole platform (no include rows, or a `platform` include), latest `starts_on`. If no active season is platform-scoped, there is no default: anonymous lobby serves season-less bank rows, `/api/season/active` returns `season:null` — exactly today's "no active season" behaviour. | **Locked (Myke, 2026-09-10)** |
| D5 | **Membership, not team, decides scope membership.** A subscriber is "in" season S iff they hold a `team_memberships` row for S with `pending=false`, `left_at IS NULL`, on a team returned by `fn_season_scope_teams(S)`. Mirrors `team_leaderboard` exactly (it is the surface these readers must agree with). | **Locked (Myke, 2026-09-10)** |
| D6 | **Season-less bank rows are the platform's puzzles.** A row with `season_id IS NULL` (imports, legacy generation) serves to anyone whose season has no row of that type for that date. A season's own row always beats a NULL row for its members. Season-less rows keep their one-per-type-per-day invariant (`NULLS NOT DISTINCT`). | **Locked (Myke, 2026-09-10)** |
| D7 | **Editorial day-content stays single-slate.** `dc_daily_page_content` is `UNIQUE (puzzle_date)` and keys takes/signals by `puzzle_type`. It will describe the DEFAULT season's puzzle; a member of a carve-out season sees no take/signal for a type where their puzzle differs (the win screen already falls back to the explanation, D14 of FAR-389). Keying day-content by `public_id` is a follow-on, not this CC. | **Locked (Myke, 2026-09-10)** |
| D8 | **One play per game type per day per subscriber stays.** `dc_daily_attempts` / `dc_completions` uniqueness is untouched. A subscriber plays THEIR season's puzzle; `dc_completions.puzzle_public_id` already records which one. Score attribution is still derived from date + memberships (Part C), which is per season by construction. | **Locked (Myke, 2026-09-10)** |
| D9 | **The League Office never resolves a season implicitly.** `membership.add` / `membership.move` take the season from the header `?season` selector and refuse without one. Dashboard/preview readers default to D4's default season and say so on screen. | **Locked (Myke, 2026-09-10)** |

---

## 2. What is NOT changed (explicitly)

- `global_leaderboard` / `_phase` remain date-window based and NOT scope-aware
  (FAR-415). Consequence under overlap: each season's global board includes
  every subscriber who completed puzzles in its window, including members of
  the other season. Known, tracked there, not here.
- `fn_leaderboard_rollover`'s close loop already iterates every active season.
  Only its two `LIMIT 1` snapshot/precompute branches change (§3.3).
- `season_scopes`, `lo_set_season_scope`, `fn_season_scope_*` — untouched.
  This CC only adds consumers.
- Messaging authorization (`authorizeConversation`) is already per
  `(team_id, season_id)`; only the three callers that pick the season change.
- Airtable serve path, `DC_PUZZLE_SOURCE` facade, the rotation cron's
  promote/retire semantics (already multi-row safe — it promotes every
  Published row dated today and retires every Live row dated earlier).

---

## 3. Phase A — database (one migration, idempotent, verification gate)

`supabase/migrations/20260911000000_lo_concurrent_seasons.sql`

### 3.1 `fn_default_season(p_on date DEFAULT current CT date) RETURNS uuid` — D4
Active season containing `p_on` whose saved scope is platform-wide
(no `season_scopes` include rows, or a non-excluded `platform` row), ordered
`starts_on DESC, id`, LIMIT 1. STABLE, SECURITY DEFINER, `search_path=public`.

### 3.2 `fn_season_for_subscriber(p_subscriber_id uuid, p_on date DEFAULT …) RETURNS uuid` — D1/D3/D5
```
candidates := active seasons containing p_on
member    := candidates S where exists team_memberships tm
               (tm.subscriber_id = p, tm.season_id = S, tm.pending = false,
                tm.left_at is null, tm.team_id in fn_season_scope_teams(S))
if member non-empty:
   order by (scope is platform-wide) asc, starts_on desc, id  → first      -- D3
else:
   fn_default_season(p_on)                                                 -- D4
NULL subscriber → fn_default_season(p_on)
```
Companion `fn_season_for_subscriber_row(...)` returning the `seasons` row
(the `SEASON_PLAYOFF_COLUMNS` set + `free_agency_*`, `tz`, `locked_at`) so
routes make one call, not two.

### 3.3 `fn_leaderboard_rollover` — loop, don't LIMIT
Step 1 (yesterday's season-rank snapshot) and step 4 (`dc_season_state`
precompute) each become `FOR v_season IN SELECT id FROM seasons WHERE <day>
BETWEEN starts_on AND ends_on [AND status='active']` loops. Output jsonb gains
`seasons_snapshotted`, `seasons_precomputed` arrays. ⚠️ Same signature — this
is a genuine `CREATE OR REPLACE`, NOT a new overload (the PWR-01 trap).

### 3.4 `team_leaderboard(p_season NULL)` → `fn_default_season()`
The NULL branch currently does `status='active' ORDER BY starts_on DESC LIMIT 1`.
Replace with `fn_default_season()`. Identical result on today's data (one
platform-scoped active season). Named/slug branch unchanged.

### 3.5 Bank uniqueness — D2/D6
```
alter table dc_puzzle_bank_staging drop constraint dc_puzzle_bank_staging_type_date_uniq;
alter table dc_puzzle_bank_staging add constraint dc_staging_season_type_date_uniq
  unique nulls not distinct (season_id, puzzle_type, go_live_date);
```
PG 17.6 on prod — `NULLS NOT DISTINCT` is available. Gate before the swap:
`select season_id, puzzle_type, go_live_date, count(*) … having count(*)>1`
must return 0 rows (it must — the old constraint is strictly tighter).

### 3.6 `fn_dc_approve_season_puzzles(p_season_id uuid, p_dates date[], p_actor text)`
New NAME, not an overload of `fn_dc_approve_puzzles` — same body plus
`and season_id = p_season_id`. Grants mirror the original (service_role only).
The old function stays for the season-less import path and gets a comment
saying so.

### 3.7 `fn_dc_rotate_live_set` — report per season
Promote/retire bodies unchanged. **As built:** the top-level `live_types` /
`missing_types` keep their old meaning (any Live row of the type today, any
season — so AUTO-128's log line is unchanged); a new `per_season` jsonb map
`{season_id: {name, live_types, missing_types}}` is computed for EVERY active
season as its own rows ∪ platform rows (D6). Deviation from the draft (which
said "default season's slate at top level") — the union is backward compatible
and the default season's view is in the map.

### 3.8 The email-keyed team RPCs (found during the build)
A `pg_proc` scan for `status = 'active'` turned up five SQL readers the §6
inventory missed, all still called by the Supabase edge functions
(`team-action`, `get-leaderboard`, `get-team-leaderboard`): `team_create`,
`team_join`, `team_leave`, `team_get_my_teams` now resolve
`fn_season_for_subscriber(<subscriber by email>)`; `fn_group_member_emails`
(no caller identity) uses `fn_default_season()`. Same signatures, true
replacements, gate-checked. `workbench_health_compute` (a status card) and
`lo_reset_season_scoring` were left alone — listed in §2.

Rollback block: restore the four function bodies from `pg_get_functiondef`
captured in the migration header; re-add the old UNIQUE (will fail if a
season has generated a date the platform also holds — that is the point).

---

## 4. Phase B — serve path (Supabase source only)

| Surface | Change |
|---|---|
| `src/lib/seasons/resolve.ts` (new) | `resolveSeasonFor(h, subscriberId \| null)` → `rpc/fn_season_for_subscriber_row`. Fail-soft to `null`. THE only TS entry point. |
| `GET /api/challenge/today` | Accepts optional `?token=`; resolves subscriber → season; passes `seasonId` to `getLivePuzzles({seasonId})` and to `resolveActiveSeasonSlate(seasonId)`. Anonymous → default season. Still `no-store`. Response gains `season: {id, name} \| null`. |
| `supabase-puzzle-bank.js` `fetchLiveRows` | `published=eq.Live&or=(season_id.eq.<id>,season_id.is.null)`, ordered `season_id.desc.nullslast` so the season row is the "first valid row per type" (D6). No `seasonId` → `season_id.is.null` only. |
| `getSignalDropAnswer` | Already matches by `publicId`; the no-publicId fallback must now also take `seasonId` — never "the current live Signal Drop" when >1 can be live. `/api/challenge/guess` forwards the token the same way. |
| `season-slate-server.ts` | `resolveActiveSeasonSlate(seasonId)` — takes the id, drops its own season lookup. |
| `DailyChallenge.jsx` | The today-fetch effect depends on `sessionToken` and re-fetches on sign-in/out with `?token=`. |
| `generation/worker.ts` | Occupancy set filtered `season_id=eq.<season>` (D6: platform rows no longer block a season's own dates). Insert `on_conflict` target becomes the new constraint. |
| `generation-write.ts` | `season.approve_pilot` / `approve_puzzles` call `fn_dc_approve_season_puzzles(season, dates, actor)`. |
| `sync-day-content` cron | Reads the DEFAULT season's Live rows (D7). One-line change + comment. |

---

## 5. Phase C — readers (D1/D9)

Every entry in §6 moves to `resolveSeasonFor(h, subscriberId)` where a token is
present, and to `resolveSeasonFor(h, null)` (default season) where the route is
anonymous. Behaviour-preserving on today's data; divergent only under overlap.

League Office (`data.ts`, `write.ts`): `membership.add` / `membership.move`
gain a required `seasonId` argument fed by the header selector; the action
form disables the buttons while the selector is "All Seasons" and says why.
`getDashboard` / `getScoringResetPreview` use the selector, else the default
season, and label the card with the season name (the CC-LO-TEAM-COUNTS rule:
a number that silently changes meaning is the bug).

A guard test (`npm run test:season-resolve`) greps `src/` for
`seasons?status=eq.active` and `status === "active"` outside `resolve.ts` and
the LO status chip, and fails on any hit — the same pattern
`test:season-config` uses for `findOverlappingSeason`.

---

## 6. Reader inventory (verified by grep, 2026-09-10)

| # | File | Line | Identity available | Becomes |
|---|---|---|---|---|
| 1 | `src/lib/season-slate-server.ts` | 57 | none (called by today) | takes `seasonId` |
| 2 | `src/app/api/score/route.ts` | 285 | token | subscriber |
| 3 | `src/app/api/teams/route.ts` | 64 | token (`scope=my`) | subscriber |
| 4 | `src/app/api/teams/route.ts` | 124 | token (`join_by_token`) | subscriber |
| 5 | `src/app/api/season/active/route.ts` | 21 | none today → add optional `?token=` | subscriber / default |
| 6 | `src/app/api/leaderboard/season/route.ts` | 101 | token optional | subscriber / default |
| 7 | `src/app/api/leaderboard/team/[teamId]/route.ts` | 82 | token | subscriber |
| 8 | `src/app/api/playoffs/route.ts` | 64 | token | subscriber / default |
| 9 | `src/app/api/challenge/signals/route.ts` | 75 (tz only) | none | default season tz |
| 10 | `src/lib/messaging/server.ts` | 65 (+3 callers in `/api/messages`) | viewer | subscriber |
| 11 | `src/lib/league-playoffs/server.ts` | 69 `fetchActiveSeason` | caller-supplied | takes `subscriberId \| null` |
| 12 | `src/app/free-agency/page.tsx` | 56 | none (server page) | default season |
| 13 | `src/lib/league-office/write.ts` | 77 `resolveActiveSeasonId` | staff | explicit `seasonId` (D9) |
| 14 | `src/lib/league-office/data.ts` | 180 | staff | selector, else default |
| 15 | `src/lib/league-office/data.ts` | 445 | staff | selector (must match D9's write) |
| 16 | `src/lib/league-office/data.ts` | 612 | staff | selector, else default |
| 17 | `public.team_leaderboard` (SQL) | NULL branch | — | `fn_default_season()` (§3.4) |
| — | `fn_leaderboard_rollover` | steps 1, 4 | — | loop (§3.3) |

`src/app/league-office/seasons/[id]/page.tsx:57` is a status chip, not a reader.

---

## 6a. Built (2026-09-10) — what changed, per phase

**Phase A** — `supabase/migrations/20260911000000_lo_concurrent_seasons.sql`
(§3.1–3.8). Verified by applying it to a PGlite (PostgreSQL 18, WASM) stub of
the touched tables and running fixture checks: resolver precedence A→carve-out,
B/D/E/X/NULL→platform, no-platform-season→NULL default; `NULLS NOT DISTINCT`
enforced; per-season approve does not leak; rotate `per_season`; rollover loops
both seasons; `team_leaderboard(NULL)` = default; `team_join` lands in the
joiner's season; `team_create` lands a team-less creator in the platform
season; `fn_group_member_emails` = default-season members. The harness lives
outside the repo (`~/.cache/lo-pglite/{stub.sql,run.js}`) because PGlite is
not a project dependency; the stub is a schema STUB, not prod — AC1/AC2 still
need the live run. Pre-change bodies: `rollback-pre-phase-a.sql`.

**Phase B** — `src/lib/seasons/resolve.ts` (new), `season-slate-server.ts`
(`resolveSeasonSlate(seasonId)`), `supabase-puzzle-bank.js`
(`fetchLiveRows({seasonId})` with the D6 filter + ordering,
`getLivePuzzles({seasonId})`, `getSignalDropAnswer({publicId, seasonId})`),
`/api/challenge/today?token=`, `/api/challenge/guess {token}`,
`DailyChallenge.jsx` (re-fetch keyed on `sessionToken`), `generation/worker.ts`
(per-season occupancy), `generation-write.ts` (`fn_dc_approve_season_puzzles`),
`day-content.ts` (default season's slate, D7).

**Phase C** — every §6 reader; `messaging/server.ts` `activeSeason(h, viewerId)`;
`league-playoffs/server.ts` `fetchActiveSeason(headers, subscriberId)`; LO
`write.ts` `membership.add` requires `seasonId` (D9) + `actions.tsx` Payload +
team page gating; LO `data.ts` `loadDefaultSeason()`. Guard test
`npm run test:season-resolve` (4 tests, incl. the src/ scan). CLAUDE.md
section added.

**Verified locally:** test:season-resolve 4/4 · slate-enforced 13/13 ·
season-config 42/42 · generation 17/17 · playoffs 75/75 · messaging 28/28 ·
member-counts 10/10 · slate-filter 18/18 · game-library 26/26 · puzzle-bank
10/10 (run directly — the npm script's `--experimental-default-type` flag is
rejected by Node 24, pre-existing). `next build` / `tsc` / `eslint`: see the
PR description for the final numbers.

## 7. Acceptance criteria

1. With ONE platform-scoped active season, every §6 surface returns byte-identical
   payloads before/after (regression harness: record → replay against the
   branch preview, token + anonymous variants).
2. Fixture: `TEST SEASON 1` (platform) + `TEST SEASON 1B` (same dates,
   conference-scoped to one conference containing exactly one team). A member
   of that team: `/api/season/active`, `/api/teams?scope=my`, `/api/playoffs`,
   `/api/leaderboard/season`, messages inbox, `/api/challenge/today` all
   report **1B**. A member of any other team, and anonymous: all report **1**.
3. Generate 1B's pilot on a date the platform already holds → succeeds (D6);
   rotation promotes both rows; the 1B member's lobby serves 1B's puzzle, the
   platform member's serves the platform's; `puzzle_public_id` on each
   completion proves which.
4. `fn_dc_approve_season_puzzles(1B, dates)` leaves TEST SEASON 1's Unpublished
   rows untouched.
5. `fn_leaderboard_rollover()` on a day both are active writes `dc_season_state`
   for both and snapshots both (`seasons_precomputed` has 2 ids).
6. `npm run test:season-resolve` fails on a re-introduced `status=eq.active`
   reader; `test:season-config` 42/42, `test:slate-enforced`,
   `test:puzzle-bank`, `test:generation`, `test:playoffs`, `test:messaging`
   green; `next build` green; ESLint no new problems.
7. LO: `membership.add` with the selector on "All Seasons" is refused with the
   D9 message; with 1B selected it writes `season_id = 1B`.
8. Fixture torn down: 1B deleted with its scopes, memberships, generation run,
   staged rows (there is no season DELETE in LO — SQL, recorded in the report).

---

## 8. Order of operations

1. Myke applies `20260910180000` (Step 1) and confirms `DC_PUZZLE_SOURCE=supabase`
   in Vercel. **Both are gates for §4 verification; §3/§5 can be built and
   unit-tested without them.**
2. Phase A migration applied to prod (behaviour-preserving on one season —
   verified by AC1 before the app deploys).
3. App deploy (Phases B + C together — the today route and the bank reader
   must move in one deploy, or the lobby could see two Live rows per type and
   pick arbitrarily).
4. AC2–AC5 run live against the fixture; report filed here; fixture torn down.

Rollback: app rollback is independent of the migration (the old readers still
work on the new functions — nothing was dropped except the UNIQUE, and the new
one is only looser). Migration rollback per §3's block.

---

## 9. Open questions for Myke (non-blocking for Phase A build)

- D3 tie-break direction: carve-out beats platform (recommended), or newest
  season beats older regardless of scope?
- D7: accept "no take/signal for carve-out puzzles" for this CC, or pull the
  `public_id`-keyed day-content into scope (adds a table change + cron change)?
- Should `/api/season/active` (anonymous today) start requiring a token, or keep
  the anonymous default-season answer for the account page's first paint?
