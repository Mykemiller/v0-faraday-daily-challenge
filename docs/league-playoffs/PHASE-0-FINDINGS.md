# League Playoffs — Phase 0 findings + plan

Investigation gate for CC-LEAGUE-PLAYOFFS-1.0 (branch
`claude/league-playoffs-implementation-b78mg6`). Everything below was re-confirmed
against **live prod** (`ycadmmngkdhvpcsrcuaq`) and the working tree on
2026-08-02 — not carried over from the ticket text.

---

## 1. What the playoff/freeze dates do today: nothing

`seasons` (confirmed live):

| column | type | null |
|---|---|---|
| `starts_on` / `ends_on` | date | NOT NULL |
| `playoff_starts_on` | date | NULL |
| `roster_freeze_on` | date | NULL |
| `locked_at` | timestamptz | NULL |
| `status` | enum `upcoming\|active\|closed` | NOT NULL |
| `league_id` | uuid | NOT NULL |
| `tz` | text | NOT NULL — **per-season timezone, currently unused by any date math** |
| `free_agency_start` / `free_agency_notice_start` | date | **GENERATED ALWAYS** (cannot be written) |

Constraints (`pg_constraint` on `seasons`) — date ordering only, exactly as stated:

- `seasons_playoff_window` — `playoff_starts_on > starts_on AND <= ends_on`
- `seasons_freeze_order` — `roster_freeze_on <= playoff_starts_on`
- `seasons_freeze_not_too_early` — `roster_freeze_on >= starts_on + (ends_on-starts_on)/4`
- plus `seasons_no_overlap_per_league` (gist exclusion) and the `ends_on >= starts_on` check.

**Full-database sweep for consumers**: zero functions, views, triggers or pg_cron
jobs reference `playoff_starts_on` / `roster_freeze_on`. In the repo the only
behavioral reader is `src/lib/league-office/generation-logic.ts` **condition 2**
(lines 155–169) — a pre-generation checklist that errors if the dates are absent
or mis-ordered. Everything else is display: `SeasonDatesCard.tsx` (the editor),
`seasons/[id]/page.tsx` ("Playoff & roster dates" card), and the
`SEASON_FIELDS` / `LOCK_EXEMPT_FIELDS` handling in `season-write.ts`.

### ⚠️ Name collision to keep straight

`season_config.roster_lock_on` **is a different column** from
`seasons.roster_freeze_on`. The former is versioned/effective-dated config
rendered as "Roster lock" on the season detail page (`page.tsx:190`) and edited in
`ConfigEditor.tsx:884`; nothing reads it either. **The freeze feature keys on
`seasons.roster_freeze_on`** — the column the DB CHECKs and the generation gate
already agree on. Do not conflate them, and do not "unify" them in this work.

## 2. Roster changes are genuinely unguarded

Live definitions (`pg_get_functiondef`), all `SET search_path = public`:

- **`team_join(p_email, p_code)`** — resolves the single `status='active'` season,
  caps at 5 memberships, inserts `pending=false`. No date logic at all.
- **`team_leave(p_email, p_code)`** — deletes the membership, rolls captaincy to
  the earliest remaining member, deletes the team when it empties. No date logic.
- **`team_create(p_email, p_name, p_code, p_group_type, p_parent_code)`** — creates
  the team in INDEPENDENT/GENERAL and self-joins. No date logic. (`p_group_type` /
  `p_parent_code` remain accepted-and-ignored per Part B.)

App-side write paths — **most of them bypass the RPCs entirely and write
`team_memberships` over PostgREST**, so an RPC-only guard would not be enough:

| path | writes | guard today |
|---|---|---|
| `POST /api/teams` `action:'create'` | direct insert `teams` + `team_memberships` | `locked_at` only |
| `POST /api/teams` `action:'join_by_token'` | direct insert `team_memberships` | `locked_at` + 5-cap |
| `POST /api/teams` (default upsert) | direct DELETE + INSERT diff | `locked_at` only |
| `POST /api/leaderboard/team/[teamId]` `action:'leave'` | calls `team_leave` RPC | `locked_at` **not checked on leave** |
| `POST /api/leaderboard/team/[teamId]` `action:'rename'` | PATCH `teams` | `locked_at` |
| League Office `membership.add` / `membership.move` | direct insert/delete `team_memberships` | audited, no date guard |

Client gates are `canEditTeams = session && !isLocked` in **both**
`src/app/account/page.tsx:180` and `src/components/DailyChallenge.jsx:1764`.

**Consequence for design:** a BEFORE trigger on `team_memberships` would freeze
the commissioner too (invariant: staff stay above the freeze). So the freeze is
enforced (a) inside the three player RPCs and (b) in the four player routes —
never as a blanket table trigger. Staff writes go through `executeAction`, which
touches the table directly and is therefore correctly exempt *by construction*.

## 3. Scoring is one uniform window; the RPCs are trivially windowable

All three are `LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public'` and
each contains exactly one date predicate:

```sql
JOIN public.score_events se ON se.played_at::date BETWEEN sn.starts_on AND sn.ends_on
```

- `global_leaderboard(p_season_id)` → `(rank, subscriber_id, handle, total_points)`;
  filters `dc_subscribers.active`.
- `team_leaderboard_season(p_team_id, p_season_id)` → same shape; joins
  `team_memberships` on `season_id` with `pending=false`.
- `team_total_score(p_team_id, p_season_id)` → `bigint`.

`score_events` = `(id, subscriber_id, legacy_season_id, game_id, points, played_at)`.
234 rows total, 117 inside Season 2, 5 distinct players — small, so recompute-on-read
is cheap and no caching layer is warranted for v1.

Consumers: `/api/leaderboard/season` (global + per-team tabs, annotates with
`leaderboard_daily` "today" points) and `/api/leaderboard/team/[teamId]` (roster
view — deliberately reads `team_memberships` directly so never-scored members
still appear, then decorates with the RPC).

**Design consequence:** the window is the *only* thing that changes per phase, so
sibling `*_phase` RPCs sharing one `fn_season_phase_window()` helper give playoff
scoring without touching a single existing signature (invariant 4).

## 4. Season state today

| season | window | playoff | freeze | status | locked |
|---|---|---|---|---|---|
| Season 1 — Power Crunch | 06-13 → 07-10 | — | — | closed | no |
| Season 2 — Post-YOTTA | 07-11 → **08-02** | — | — | **active** | no |
| **Hot summer Final Beta** | **08-03 → 09-04** | **2026-08-28** | **2026-08-17** | upcoming | **locked 08-02** |
| TEST SEASON 1 | 09-07 → 09-25 | — | — | upcoming | no |
| Season 3 / Season 4 | 2027 | — | — | upcoming | no |

Only **Hot summer Final Beta** carries playoff dates — and it is *locked*, which
is fine: `season-write.ts:860` `LOCK_EXEMPT_FIELDS` already lets the two dates
through on a locked season (invariant 5). Note the active season (S2) ends the
day this work starts, so Hot Summer is the real target and playoffs land 08-28.

## 5. Surfaces + write funnel to reuse

- **Audit**: `executeAction` in `src/lib/league-office/write.ts` — `reason`
  mandatory (`lo_audit_log_reason_check` enforces non-empty at the DB), one
  `writeAudit` row per action. `lo_audit_log.domain` has **no CHECK constraint**,
  so a new `domain='playoffs'` needs no migration.
- **Player banner pattern**: `BroadcastBanner` mounted at
  `DailyChallenge.jsx:3201`, between the masthead and `<main>`, fed by
  `/api/broadcast` with the `dc_sessions` token.
- **ScoreCard**: `DailyChallenge.jsx:583`, one component for all 7 games; renders
  `score/dailyTotal` with the label `"this game / today · {puzzleType}"` — the
  natural insertion point for playoff framing.
- **Leaderboard tabs**: `src/app/leaderboard/page.tsx:293` `TabChip` row
  (Global · Teams · per-team), state `activeTab` + `teamsView`.
- **RLS**: every `dc_*` table is RLS-on / zero-policies; all reads are
  server-side service-role. New playoff tables follow that exactly.

---

## Plan

### Phase 1 — roster freeze (ship first)
1. Migration `…_playoff_part1_roster_freeze.sql`:
   `fn_season_roster_frozen(p_season_id uuid) → boolean` (`now() AT TIME ZONE
   seasons.tz`), and `CREATE OR REPLACE` of `team_join` / `team_leave` /
   `team_create` to raise `P0001` with a stable message when frozen. Additive
   (the originals are captured verbatim in `down.sql`).
2. `src/lib/league-playoffs/phase.ts` — pure, tested: `seasonToday(tz)`,
   `isRosterFrozen(season, today)`, `seasonPhase(season, today)`,
   `phaseWindow(season, phase)`, `daysUntil()`.
3. Route enforcement: `/api/teams` (create · join_by_token · upsert) and
   `/api/leaderboard/team/[teamId]` `leave` → `403 roster_frozen`.
4. UI: `canEditTeams` gains `&& !frozen` in `/account` and `DailyChallenge.jsx`,
   with "Rosters are frozen for the playoffs" copy; team page leave button too.
5. Staff `membership.*` untouched — commissioner is above the freeze (documented
   in-code so nobody "fixes" it later).

### Phase 2 — playoff scoring window + Playoffs view
6. Migration `…_playoff_part2_phase_scoring.sql`: `fn_season_phase_window(season,
   phase)` + `global_leaderboard_phase` / `team_leaderboard_phase` /
   `team_total_score_phase`. Existing three RPCs are **not** touched.
7. `/api/leaderboard/season?phase=playoff` and `/api/leaderboard/team/[teamId]?phase=`
   — default stays the full-season path, byte-identical.
8. `/leaderboard` gains a **Playoffs** tab: standings in-window, or
   "Playoffs begin {date}" before it opens.

### Phase 3 — seeding + bracket
9. Migration `…_playoff_part3_bracket.sql` — `dc_playoff_config`
   (per-season format · `participant_kind` team|player · `qualifier_count`),
   `dc_playoff_brackets`, `dc_playoff_seeds` (regular-season snapshot),
   `dc_playoff_matchups` (round/slot/feed-forward). All RLS-on, zero policies.
   v1 format = **single elimination by seed**, byes padding to the next power of
   two, rounds splitting the playoff window evenly.
10. `fn_playoff_seed_field(season, actor)` — snapshots seeds from the **regular**
    phase window; `fn_playoff_recompute(bracket)` — advances matchups purely from
    in-window `score_events` (higher points; tie → better seed). Nothing is ever
    hand-written.
11. `playoff.configure` / `playoff.seed` / `playoff.reseed` / `playoff.clear` in
    `executeAction` → `playoff-write.ts`, `domain='playoffs'`, one audit row each;
    surfaced as a "Playoffs" card on `/league-office/seasons/[id]`.

### Phase 4 — subscriber experience
12. `/api/playoffs` (read-only, session-optional) → phase, countdown, bracket.
13. `PlayoffBanner` beside `BroadcastBanner`; a player bracket surface; ScoreCard
    reads "Playoff points" inside the window.

### Delivery
Each phase = its own commit; every migration gets a `BEGIN … ROLLBACK` proof
against prod + a `down.sql`, an advisor delta check (expect only
`rls_enabled_no_policy` INFOs on the new tables), and **explicit sign-off before
anything is applied to prod**. `npm run build` + a new `npm run test:playoffs`
plus the existing suites gate each phase.

## Open questions (non-blocking — defaults chosen, easy to flip)
- **Bracket participants**: modelled as configurable `participant_kind`, default
  **team**. Player brackets work through the same tables.
- **Qualifier count**: default 8, clamped to the number of eligible participants.
- Both live in `dc_playoff_config` per season, so changing them is a commissioner
  action, not a code change.
