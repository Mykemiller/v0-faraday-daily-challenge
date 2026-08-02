# Concurrent seasons — scope

What it would take to run several seasons at once, each with its own dates,
game slate, domain mix, playoff configuration and player set.

Everything below was verified against live prod (`ycadmmngkdhvpcsrcuaq`) and the
merged tree on 2026-08-02. Counts are real, not estimates.

---

## 0. Why it doesn't work today

Four independent blockers. Fixing any one alone changes nothing.

### B1 — Serving has no season dimension

`src/app/api/challenge/today/route.js` calls `getLivePuzzles()`, which selects
`published = 'Live'` and nothing else. There is exactly **one global live set**,
rotated nightly by `fn_dc_rotate_live_set(date)` / the AUTO-128 rotator.

`dc_puzzle_bank_staging.season_id` exists (added by Part C½ as a "forward hook")
and is **read by nothing**.

### B2 — One puzzle per game per day, globally

```
dc_puzzle_bank_staging_type_date_uniq  UNIQUE (puzzle_type, go_live_date)
```

No season column in the key. Two concurrent seasons **cannot** have different
Rackl puzzles on the same date — it is unrepresentable, not merely unwired.
This is also what makes B1's "different domain mix per season" impossible.

### B3 — 18 places resolve "THE active season"

**11 app call sites**, all `status=eq.active … limit 1`:

| File | Consequence with >1 active season |
|---|---|
| `api/teams/route.ts` (×2) | joins/creates land in an arbitrary season |
| `api/score/route.ts` | wrong season's lock check |
| `api/leaderboard/season/route.ts` | wrong board |
| `api/leaderboard/team/[teamId]/route.ts` | wrong team board |
| `api/playoffs/route.ts` | wrong playoff state |
| `api/season/active/route.ts` | wrong freeze/phase for every client |
| `api/challenge/signals/route.ts` | wrong tz |
| `lib/messaging/server.ts` | broadcast authorization against wrong season |
| `lib/league-office/write.ts` | `membership.add`/`move` into wrong season |
| `lib/league-playoffs/server.ts` | wrong freeze guard |

**7 DB functions** resolve it internally: `team_join`, `team_leave`,
`team_create`, `team_get_my_teams`, `team_leaderboard`, `fn_group_member_emails`,
`fn_leaderboard_rollover`.

**4 edge functions** touch season: `create-subscriber`, `get-leaderboard`,
`get-team-leaderboard`, `team-action`.

Most use bare `limit 1` with **no ORDER BY** — the pick is whatever Postgres
returns first. Two use `order=starts_on.desc`. So the failure is silent and
inconsistent between surfaces: the leaderboard and the join path could disagree
about which season you are in.

This is the singleton assumption Part A deferred: *"safe while only INDEPENDENT
runs seasons; becomes 'active season FOR a league' in later parts."* That part
was never built.

### B4 — No player→season relationship exists

- `dc_subscribers` has **no** `league_id` / `season_id` / `conference_id` column.
- The only path from a player to a league is `team_memberships → teams.league_id`.
- **1 of 7 active subscribers is on no team at all** — under a team-derived
  model they would belong to no season and see nothing.
- `season_scopes` holds 6 rows, all `scope_type='platform'`, and is read by
  **nothing** outside the League Office config editor.
- There is no capacity column, allowlist, or enrollment table anywhere.

So "a limited set of subscribers" and "up to 200 players" have no mechanism to
attach to — not an unenforced one, none at all.

### Also true, and separate

**The season game slate is advisory (D4).** Configuring 4 or 6 games changes what
the console displays, never what is served. `npm run test:advisory-only` (6
assertions) actively guards this — it asserts the served set is identical before
and after a slate toggle *and* that no serving module mentions `season_games` /
`season_config` / `game_catalog`. Enforcing the slate means deliberately
retiring that decision and rewriting the test, not deleting it.

---

## 1. Prerequisite, currently unmet

**`DC_PUZZLE_SOURCE` is unset in prod**, so serving still reads **Airtable**, not
`dc_puzzle_bank_staging`. Every proposal below assumes the Supabase serve path.
Making the Airtable bank season-aware is not worth doing — it is scheduled for
deletion.

⚠️ Two live dates constrain any work here:
- **The bank runs dry after 2026-08-14** (Airtable and staging both end there).
- Hot Summer needs its own generation run before **2026-08-15**.

Nothing in this scope should start before those are resolved, or it will collide
with the cutover runbook (`docs/dc-supabase-serving/README.md`).

---

## 2. Proposed phases

Ordered by dependency. **A is the spine — B, C and D are each cheap after it and
near-impossible before it.**

### Phase A — Season-aware serving  ·  L  ·  the hard one

**A1. Re-key the puzzle bank.**
Drop `dc_puzzle_bank_staging_type_date_uniq`; replace with
`UNIQUE (season_id, puzzle_type, go_live_date)`. Decide what `season_id IS NULL`
means — proposal: a **shared pool** any season may serve, which preserves today's
98 imported rows and lets a small season borrow puzzles rather than generate its
own. Backfill existing rows to NULL (already their state).

`fn_dc_rotate_live_set(date)` becomes per-season, or gains a season loop. The
`published` state machine stays as-is.

**A2. Season-aware serve.**
`getLivePuzzles()` takes a season; `/api/challenge/today` resolves the caller's
season (Phase B) and passes it. Anonymous visitors need a defined default —
proposal: the platform-scoped season.

**A3. Retire D4.**
Serving reads `season_games` for the slate. `test:advisory-only` is rewritten
into its inverse (`test:slate-enforced`), and the D4 note plus the page copy
change in the same commit. **Do not just delete the test.**

**Risk:** this is the highest-blast-radius change in the codebase — it touches
what every player sees every day. Wants its own Phase 0, a flag
(`DC_SEASON_AWARE_SERVING`), and a parity harness proving the single-season case
is byte-identical before flipping.

---

### Phase B — Player → season resolution  ·  S  ·  unblocks everything else

> **DECIDED (Myke, 2026-08-02): a player is in exactly ONE season at a time.**
> This collapses what was the largest source of complexity in B and C.

With one-season-at-a-time, the model is a **single nullable column**:

```sql
alter table public.dc_subscribers
  add column current_season_id uuid references public.seasons(id);
```

No join table, no (season, subscriber) uniqueness to police, no "which of my
seasons is this score for" ambiguity — the question is answerable from the
subscriber row alone. `team_memberships.season_id` stays exactly as it is and
remains the roster record; this column answers a different question ("which
season is this player *playing*").

**Why not the enrollment table** (the earlier recommendation): its only real
advantage was supporting dual enrollment, which is now explicitly out. A table
would still be the right call if history matters — "which seasons has this
player been in" — but that is already reconstructable from `team_memberships`
and `score_events` dates, so the column is enough.

Then: one `resolveSeasonForSubscriber(subscriberId)` helper, and the 18 call
sites move onto it. The 7 DB functions each gain a `p_season_id` argument
defaulting to current behaviour, so the RPC wire contract holds (the same
technique Part B used for `team_create`'s ignored args).

**Open sub-decision:** what happens to a player whose season ends — does
`current_season_id` go NULL (they pick a new season), or auto-roll to the next
season in the same league? Affects the season-transition path, not this schema.

---

### Phase C — Enrollment + capacity  ·  S  ·  needs B

- Per-season row (`dc_season_enrollment_config`, or columns on `seasons`):
  `max_players`, `enrollment_mode` (`open` | `invite` | `closed`).
- Capacity check on the one write that sets `current_season_id`. With B as a
  single column this is **one** choke point, not a set of them — count
  `dc_subscribers where current_season_id = X` against `max_players`.
- Same two-layer shape as the roster freeze: a `SECURITY DEFINER` predicate
  (fails closed under the deny-all RLS on `seasons`) plus a route guard, with
  staff writes above it by construction.
- League Office surface: roster list, invite, remove; audited through
  `executeAction` as `enrollment.*`, `domain='seasons'`.

⚠️ **Capacity needs a race guard.** Two players enrolling simultaneously can
both read count = 199 and both write. Either take a row lock on the season, or
enforce with a counter column updated in the same statement. Cheap to get right
up front, genuinely unpleasant to retrofit after a season overfills.

Genuinely small **after B**. Impossible before it.

---

### Phase D — Slate + domain mix per season  ·  S  ·  mostly falls out of A

Once serving reads `season_games` (A3), "6 games" and "4 games" work with no
further change. The per-season domain mix already drives generation via
`season_theme_mix`; it only looks broken today because serving is global.

Remaining work is the **generation** side: the worker must target a season's
slate and mix, and `UNIQUE(season_id, puzzle_type, go_live_date)` from A1 must
let two seasons generate the same game on the same day. Part D's `puzzle_count`
warning logic (which currently treats surplus as unrepresentable, *because* of
the global unique) should be revisited at the same time.

---

## 3. Sequencing

```
 (prereq)  DC_PUZZLE_SOURCE cutover + bank refilled past 2026-08-14
     │
     ├── Phase B  player → season          ── can start in parallel with A
     │       │
     │       ├── Phase C  enrollment + capacity
     │       │
     └── Phase A  season-aware serving
             │
             └── Phase D  slate + domain mix
```

B and A are independent and can run concurrently; C needs B; D needs A.

---

## 4. Decisions

### Settled

1. ~~**Can one player be in two concurrent seasons?**~~ **NO** (Myke, 2026-08-02).
   Phase B becomes a single `dc_subscribers.current_season_id` column; Phase C
   gets one choke point instead of several. B drops M → S.

### Still open

2. **What `season_id IS NULL` means in the bank** — shared pool any season may
   serve, or legacy-only? (Recommend **shared pool**: it preserves the 98
   imported rows and lets a short season borrow puzzles instead of generating
   its own.)
3. **Which season an anonymous visitor sees.** Today everyone sees one global
   set. With concurrent seasons this needs a defined default — likely the
   platform-scoped season, but it is a product call.
4. **Is D4 really being retired?** Enforcing the slate changes what subscribers
   receive. If the answer is "not yet", A3 drops out and Phase A shrinks
   materially — A1 and A2 still deliver per-season *puzzles*, just not per-season
   *game lists*.
5. **Season transition** — when a player's season ends, does `current_season_id`
   go NULL or auto-roll to the next season in that league?

**Question 4 is now the one that most changes the size of this work.**

---

## 5. What works today, unchanged

Worth stating plainly, because the scope above is about *concurrency* only:

- Any single season with any dates, playoffs on or off, and its own theme mix.
- **Sequential** seasons of any length — the three scenarios that prompted this
  all work fine one after another.
- Playoffs end-to-end (freeze, phase scoring, seeding, bracket) — shipped and
  applied 2026-08-02.

The gap is exclusively *at the same time*.
