# League Playoffs — Part 3: seeding + bracket

CC-LEAGUE-PLAYOFFS-1.0 · branch `claude/league-playoffs-implementation-b78mg6`

Snapshots the qualifying field from regular-season standings, builds a
single-elimination bracket, and settles it from real playoff-window
`score_events`. **Status: NOT APPLIED to prod** — migration
`supabase/migrations/20260802140000_league_playoffs_part3_bracket.sql` is proven
in `BEGIN … ROLLBACK`; down: `part3-down.sql`. Depends on Part 2's
`fn_season_phase_window()`.

## Model

| table | holds |
|---|---|
| `dc_playoff_config` | per-season format · `participant_kind` (team\|player) · `qualifier_count` · `seeding_source` |
| `dc_playoff_brackets` | one per season (unique index). **Config is COPIED in**, not referenced |
| `dc_playoff_seeds` | who qualified, their seed, and the points that earned it — all snapshotted |
| `dc_playoff_matchups` | the tree: round/slot, both sides, per-round points, winner, feed-forward wiring |

All four are **RLS-on with zero policies**, service-role reads only, like every
other `dc_*` table.

Config is copied onto the bracket deliberately: editing config later must never
silently reinterpret a bracket that has already been seeded and played. Seed
`display_name` is snapshotted for the same reason — a later rename cannot
rewrite history.

## Rules

- **Format**: single elimination by seed. The field is padded to the next power
  of two with byes, which land on the **top seeds** — a property the standard
  reflection order (`order(2)=[1,2]`; each doubling maps `s → (s, 2n+1−s)`)
  gives for free, along with 1 and 2 meeting only in the final.
- **Round windows** split the playoff window into contiguous, non-overlapping
  ranges, remainder to the earliest rounds. A window shorter than the round
  count is refused (`PLY05`) rather than overlapping rounds, which would
  double-count points.
- **Advancement never fabricates.** A matchup is decided only once its round's
  window has **closed**; a lead mid-round is not a result. Byes are the one
  exception — there is nothing to wait for. Ties break to the better seed;
  a tie with no seeds stays *undecided* rather than being picked arbitrarily.
- **Seeding source is the REGULAR window** by default, so playoff points can
  never feed back into the seeding that produced them.

The same rules live twice: `src/lib/league-playoffs/bracket.ts` (pure, 25 tests)
and the SQL functions. Keep them in sync.

## The bug the acceptance harness caught

The first dry run failed exactly one check — *"cached points === a fresh
recomputation"* — and it was a real defect, not a bad assertion.

`fn_playoff_recompute` originally iterated **one cursor** over every matchup
`order by round, slot`. A cursor snapshots its rows, so the round-2 row was read
with `participant_a` still NULL *even after round 1 had propagated a winner into
it*. Its points were then computed against an empty slot and cached as NULL
while the table said otherwise — the cache disagreed with reality until some
later run happened to correct it.

Fixed by iterating **round by round**, opening the query for round *r* only
after round *r−1* has finished writing. Check #15 now proves the consequence:
recompute is idempotent in a **single** pass (a repeat run changes 0 rows),
which the buggy version could not manage.

## Acceptance evidence (prod, inside `BEGIN … ROLLBACK`) — 16/16 PASS

Run against the active season's real 117-event corpus, given a temporary
playoff date of 2026-07-28 so seeding *and* advancement could both be exercised
(no prod season has playoff dates and score events yet — Hot Summer starts
08-03). Result: a 3-team field → 4-slot bracket, 2 rounds, 1 bye, **2 decided /
1 undecided** — genuinely mid-run, which is the state that exercises both paths.

| # | Check | Result |
|---|---|---|
| 1 | gate: 4 RLS tables, 0 policies, service_role-only functions | PASS |
| 2 | seeded 3 teams; rounds=2, size=4 | PASS |
| 4 | seed order === regular-window standings, best first | PASS |
| 6 | tree complete: 3 matchups (size−1) | PASS |
| 8 | round windows exactly cover the playoff window | PASS |
| 9 | 1 bye, decided immediately with `reason='bye'` | PASS |
| 10 | **no open-window matchup decided on points** | PASS |
| 11 | every points-decided winner really has the higher points | PASS |
| 12 | cached points === a fresh independent recomputation | PASS *(was FAIL)* |
| 13 | winners propagate to the correct next-round side | PASS |
| 14 | advanced participants keep their **original** seed | PASS |
| 15 | recompute idempotent in one pass | PASS |
| 16 | 2 decided / 1 undecided — genuinely mid-run | PASS |
| 17 | `status`/`champion` mutually consistent | PASS |
| 18 | re-seeding leaves exactly **one** bracket | PASS |
| 19 | seeding a season with no playoff window is refused (`PLY03`) | PASS |
| 20 | down-migration leaves no table or function behind | PASS |

Prod re-verified untouched after the run: 0 playoff tables, 0 playoff functions,
active season's `playoff_starts_on` still NULL, 23 memberships.

## Error codes

`PLY01` no config · `PLY02` no seeding window · `PLY03` no playoff window ·
`PLY04` fewer than 2 qualifiers · `PLY05` playoff window shorter than the round
count.

## Still to come in this phase

The commissioner write path (`playoff.*` cases in `executeAction` → one
`lo_audit_log` row each, `domain='playoffs'`) and the season-detail card are not
in this commit. The DB layer and pure logic land first so they can be reviewed
against the evidence above; the audited surface follows.

## Gates

`npm run build` green · `npm run test:playoffs` **46** (21 phase + 25 bracket).
Advisor delta expected: **4 new `rls_enabled_no_policy` INFOs**, one per new
table — the intended deny-all posture, and nothing else.
