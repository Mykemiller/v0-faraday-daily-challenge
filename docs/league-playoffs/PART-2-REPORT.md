# League Playoffs — Part 2: phase-windowed scoring

CC-LEAGUE-PLAYOFFS-1.0 · branch `claude/league-playoffs-implementation-b78mg6`

Adds read paths that score only the playoff window, alongside the existing
whole-season behaviour. **Status: NOT APPLIED to prod** — migration
`supabase/migrations/20260802130000_league_playoffs_part2_phase_scoring.sql`
is proven in `BEGIN … ROLLBACK` and awaiting sign-off. Down:
`part2-down.sql`.

## The window

`fn_season_phase_window(season, phase)` returns an inclusive `[from_on, to_on]`:

| phase | window | when playoffs aren't configured |
|---|---|---|
| `full` | `starts_on … ends_on` | unchanged — the legacy behaviour |
| `regular` | `starts_on … playoff_starts_on − 1` | the whole season |
| `playoff` | `playoff_starts_on … ends_on` | **zero rows** |

**Zero rows means "this phase does not exist for this season" and is
load-bearing.** A caller must never widen that to the full season — doing so
would report regular-season points as playoff points. An invalid phase raises
`22023` rather than silently coercing.

`fn_season_phase_window()` and `phaseWindow()` in
`src/lib/league-playoffs/phase.ts` implement the same rules and must stay in
sync: the TS copy drives UI state, the SQL copy drives what actually gets
summed. `npm run test:playoffs` pins the TS side; the migration's gate pins the
SQL side against the same fixtures.

## The three originals are untouched

`global_leaderboard`, `team_leaderboard_season`, `team_total_score` keep their
names, signatures and results. Each new `*_phase` sibling is a copy of its
original with the single predicate

```sql
se.played_at::date BETWEEN sn.starts_on AND sn.ends_on
```

replaced by a join against the window. Ranking expression, `MIN(played_at)`
tiebreak, `active`/`pending` filters, handle fallback and return columns are
byte-for-byte the original. Team membership still keys on the **season**
(`tm.season_id = p_season_id`), not the phase — a player is on the team all
season; the phase only narrows which of their events count.

## Deploy-order safety

`phase=full` — the default, and what any unrecognised value falls back to —
calls the **original** RPCs, not the siblings. So the app can ship before the
migration is applied: the default path is correct either way, and only an
explicit `?phase=playoff` reaches the new functions.

## Acceptance evidence (prod, inside `BEGIN … ROLLBACK`)

10/10 PASS.

| # | Check | Result |
|---|---|---|
| 1 | migration gate: `full` === the originals across **all** seasons and teams | PASS |
| 2 | real-data split: regular **4283** + playoff **7932** = full **12215** | PASS |
| 3 | both phases non-empty (regular 3 players, playoff 5) — the split proves something | PASS |
| 4 | playoff total = hand-computed sum over 07-28…08-02 | PASS |
| 5 | regular total = hand-computed sum over 07-11…07-27 | PASS |
| 6 | team split: regular 4283 + playoff 5625 = full 9908 | PASS |
| 7 | team `full` still equals the untouched `team_total_score` | PASS |
| 8 | **the original `global_leaderboard` is unchanged by adding a playoff date** | PASS |
| 9 | DOWN: all four phase functions dropped | PASS |
| 10 | DOWN: the three originals still present | PASS |

The gate also asserts an invalid phase raises `22023`, and that the two windows
**partition** each season exactly (no gap, no overlap) for every season row.

No prod season has both playoff dates and score events yet (Hot Summer starts
08-03), so checks 2–8 temporarily gave the *active* season a playoff date of
2026-07-28 inside the transaction — exercising a real 117-event corpus — then
rolled back.

## Surfaces

- `?phase=full|regular|playoff` on `/api/leaderboard/season` and
  `/api/leaderboard/team/[teamId]`. Both now also return a `playoff` block
  (phase, live, start date, countdown, roster_frozen) derived server-side in the
  season's timezone.
- `/leaderboard` gains a **Season · Playoffs** toggle — orthogonal to the
  Global/Teams/per-team tabs, so it re-scores whichever board is open rather
  than replacing it. Rendered **only** when the season configures playoffs, so
  every season that doesn't looks exactly as before. A "Playoffs live" chip
  appears inside the window; before it opens, a "Playoffs begin `<date>`" panel
  explains the empty board rather than letting it read as "everyone scored zero".

## Grants

All four functions are `service_role` only — the two calling routes hold the
service key. Granting anon/authenticated would add 8 advisor findings for
callers that do not exist. anon/authenticated are revoked **by name** (Supabase
default privileges grant them at CREATE time; `revoke … from public` is not
enough — the Part 1 gate caught this).

## Gates

`npm run build` green · `test:playoffs` 21/21 · `test:contrast` 29/29 ·
messaging 28 · season-config 24 · game-library 26 · advisory-only 6 ·
generation 17 · take 9 · signal-matcher 11 · broadcast 28 — all unchanged.

Advisor delta expected: **zero** — no new table, all four pin `search_path`, and
none is anon/authenticated-executable.
