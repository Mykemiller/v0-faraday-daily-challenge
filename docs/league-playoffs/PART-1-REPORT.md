# League Playoffs — Part 1: roster freeze

CC-LEAGUE-PLAYOFFS-1.0 · branch `claude/league-playoffs-implementation-b78mg6`

Makes `seasons.roster_freeze_on` load-bearing. Phase-0 established it was inert
(see `PHASE-0-FINDINGS.md`); this phase enforces it, server-side, on every player
roster path — and deliberately on none of the commissioner's.

**Status: NOT APPLIED to prod.** Migration
`supabase/migrations/20260802120000_league_playoffs_part1_roster_freeze.sql`
is proven in `BEGIN … ROLLBACK` and awaiting sign-off. Down-migration:
`part1-down.sql`.

## The rule

Once the season reaches `roster_freeze_on` — evaluated in the season's OWN
timezone (`seasons.tz`, fallback `America/Chicago`) — players can no longer
join, leave, or create teams for the rest of the season. A season with no
`roster_freeze_on` is never frozen, so this ships **inert for 5 of the 6
seasons**; only *Hot summer Final Beta* (freeze 2026-08-17) is affected.

Frozen is independent of locked. A season can be frozen and unlocked, locked and
unfrozen, both, or neither. The freeze lands well before the lock, so it is the
state a player meets first — the UI copy gives it precedence.

## Why the guard is not a table trigger

A `BEFORE INSERT/DELETE` trigger on `team_memberships` is the obvious central
choke point and is the **wrong tool here**. The League Office `membership.add` /
`membership.move` actions write `team_memberships` directly over service-role
PostgREST, so a trigger would freeze the commissioner out of their own override.
The commissioner is deliberately above the freeze.

So the guard sits on the player-facing paths only, in two layers:

| Layer | Covers | Mechanism |
|---|---|---|
| **DB** | `team_join` · `team_leave` · `team_create` (the `team-action` edge-fn path) | `fn_season_roster_frozen(season)` → `RAISE … ERRCODE 'FRZ01'` |
| **Route** | `/api/teams` create · join_by_token · upsert; `/api/leaderboard/team/[teamId]` leave | `rosterFreezeGuard()` → `403 {error:'roster_frozen'}` |

Both layers are needed: **the routes bypass the RPCs entirely** and write
`team_memberships` themselves, so the DB guard alone would leak. Staff writes
touch neither layer, so the exemption falls out by construction rather than
needing a carve-out someone could later "tighten" by mistake.

## `fn_season_roster_frozen` is SECURITY DEFINER on purpose

`seasons` is RLS-on with **zero policies**. An invoker-rights read therefore
returns no row for any non-service role, and the guard would **fail open**
(no row → no freeze date → "not frozen" → the write proceeds). A guard must fail
closed, so it reads with definer rights and returns a boolean.

**Grants are `service_role` only** — narrower than the sibling `team_*` RPCs,
which still carry a legacy `PUBLIC`/`anon`/`authenticated` grant. Verified
against prod: anon and authenticated see **0 rows** in both `seasons` and
`dc_subscribers`, and all three RPCs look the subscriber up *first*, so a
non-service caller raises `subscriber not found` before ever reaching the freeze
check. The grant would be dead weight costing two real advisor findings.

> ⚠️ **anon/authenticated must be revoked BY NAME.** Supabase ships
> `ALTER DEFAULT PRIVILEGES` granting EXECUTE on every new public function to
> PUBLIC, anon, authenticated, postgres and service_role at CREATE time — so
> `revoke … from public` alone leaves the two role grants intact. The
> in-migration gate caught exactly this on the first dry run; the migration now
> does `revoke all … from public, anon, authenticated`.

## Acceptance evidence (all against prod, inside `BEGIN … ROLLBACK`)

Behavioural run — 11/11 PASS:

| # | Check | Result |
|---|---|---|
| 1 | `FRZ01` is a valid, catchable custom SQLSTATE | PASS |
| 2 | null season → not frozen (`team_leave` depends on it) | PASS |
| 3 | 5 seasons with no freeze date → none frozen | PASS |
| 4 | day after freeze → frozen | PASS |
| 5 | the freeze day **itself** → frozen | PASS |
| 6 | day before freeze → NOT frozen | PASS |
| 7 | `team_leave` BEFORE the freeze → allowed | PASS |
| 8 | `team_join` WHILE frozen → blocked, `FRZ01` | PASS |
| 9 | `team_leave` WHILE frozen → blocked, `FRZ01` | PASS |
| 10 | **staff direct membership write WHILE frozen → still allowed** | PASS |
| 11 | membership count 11 → 11 (leave −1, staff add +1) | PASS |

Also verified: `seasons.tz` genuinely drives the boundary (a season set to
`Pacific/Kiritimati`, UTC+14, reports frozen while Chicago has not reached the
date), and an unrecognised tz falls back instead of throwing.

Migration + down round trip — 5/5 PASS: the in-migration gate block passes; the
grant is service_role-only; the down drops the helper, leaves zero guards behind,
and restores all three RPCs to SECURITY INVOKER with `search_path=public`.

**Prod re-verified untouched after every run**: helper absent, zero RPCs
guarded, 23 memberships, active season's `roster_freeze_on` still NULL.

> Note on the 23: `CLAUDE.md` records 24 memberships as of 2026-08-01. The
> current 23 is **pre-existing drift, not damage** — Season 2's newest membership
> is timestamped 03:53 UTC on 2026-08-02, hours before any of this work, and every
> proof transaction rolled back whole (Postgres has no partial commit).

## Surfaces

- **`/api/season/active`** now returns derived `roster_frozen`,
  `days_until_roster_freeze`, `season_phase`, `playoffs_live`,
  `days_until_playoffs` alongside every pre-existing field. It is THE single
  season source for both team pickers, so the state is computed **once,
  server-side, in the season's zone** — a client in another timezone can never
  disagree about the boundary day.
- **`/account`** and the in-app account screen (`DailyChallenge.jsx`) both gain
  `canEditTeams = … && !isRosterFrozen`, plus gold "Rosters are frozen for the
  playoffs — your teams are locked in for the rest of the season." copy that
  takes precedence over the season-locked line.
- **Team page leave** maps `roster_frozen` to its own message.

Hiding a picker is never the enforcement point — every write re-checks
server-side.

## Code

- `src/lib/league-playoffs/phase.ts` — pure, zero-dependency: `seasonToday`,
  `seasonPhase`, `phaseWindow`, `rosterFreezeState`, `playoffStatus`,
  `parseScoringPhase`. Phase 2 windows are already here and unused.
- `src/lib/league-playoffs/server.ts` — season loading + `rosterFreezeGuard()` +
  `isDbRosterFrozenError()` (so a freeze that flips *between* the route check and
  the RPC call still returns the route's shape, not a raw 500).
- `npm run test:playoffs` — **21 tests**, incl. the exact partition property
  (regular ∪ playoff = the full season, no gap, no overlap).

## Gates

`npm run build` green · `test:playoffs` 21/21 · `test:contrast` 29/29 ·
messaging 28 · season-config 24 · game-library 26 · advisory-only 6 ·
generation 17 · take 9 · signal-matcher 11 · broadcast 28 — all unchanged.

## Advisor delta

Expected **zero new findings**: no new table (so no `rls_enabled_no_policy`), and
the helper pins `search_path` (no `function_search_path_mutable`) and is not
anon/authenticated-executable (no `*_security_definer_function_executable`).
Baseline recorded pre-apply: 173 `rls_enabled_no_policy` INFO · 63
`function_search_path_mutable` · 85 anon- / 87 authenticated-
`security_definer_function_executable`. To be re-run and diffed at apply time.

## Apply order

1. Sign-off.
2. Apply the migration.
3. Deploy the app (the route guards read `roster_freeze_on` directly and are
   safe to deploy in either order — both layers fail closed independently).

Reverting the DB alone leaves the route guards enforcing. To fully revert, roll
back the app deploy too, or clear `roster_freeze_on` on the season.
