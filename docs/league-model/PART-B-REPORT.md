# CC-LEAGUE-MODEL-1.0 — Part B run report (2026-08-01)

Teams become durable franchises. Two-phase migration:

- **Phase 1** `20260801000002_league_model_part_b_durable_teams.sql` — data
  moves + all function rewrites. **APPLIED to prod 2026-08-01** after a full
  transactional dry run (gates green both times).
- **Phase 2** `20260801000003_league_model_part_b_drop_hierarchy_columns.sql`
  — drops `teams.season` / `group_type` / `parent_id` + the hierarchy trigger.
  **⚠️ NOT YET APPLIED — apply only after this PR's Vercel production deploy
  is live** (the pre-Part-B app still selects those columns). Until then both
  old and new code work: `group_type` has a default, the others are nullable.

Edge functions redeployed 2026-08-01 (work with both schemas):
`get-team-leaderboard` v15, `get-leaderboard` v17. `team-action` needed no
change (it passes `p_group_type`, which the new `team_create` accepts and
ignores; the in-app client never sends a groupType).

## Approved decisions (Myke, 2026-08-01)

- **Q1 — drop the demo DELOITTE company team.** Member overlap between the two
  Deloittes was ZERO: DELOITTE held 5 `@example.com` demo accounts
  (demo_alex/jordan/lee/priya/sam, captain demo_alex); DELOITTE-2026 holds the
  3 real accounts (ipadfun = mykemiller@gmail.com, my_work_fun =
  mykemiller@deloitte.com, justcoolyo = sheshami@gmail.com). Deleted row for
  the record: code `DELOITTE`, name "Deloitte", season label "Summer 2026",
  group_type company, league DELOITTE, 5 Season-1 membership rows (cascade),
  0 conversations.
- **Q2 — derive, don't guess.** `team_conference_memberships` = the DISTINCT
  (team, season) pairs in `team_memberships` (the "Summer 2026" label matched
  no season; the membership rows showed those teams actually played Season 1
  AND Season 2). 12 rows: each of the 6 surviving teams × S1 + S2. Kept live
  by `trg_team_memberships_tcm_autofill` (AFTER INSERT on team_memberships),
  so every write path — RPCs, /api/teams REST, create-subscriber — maintains
  the derivation.
- **Q3 — HCI + Network Edge join the Deloitte org conference** (their old
  `parent_id` pointed at the DEMO company; their members are real people).
  The DELOITTE-2026 league's GENERAL conference was upgraded in place to
  code `DELOITTE` / name "Deloitte" / `type='org'` / org_domain deloitte.com.
- **Q4a — full rewrite scope** (7 DB fns + trigger, 2 edge fns, ~8 app files)
  in this one PR.
- **Q4b —** LO season-scope "leagues" now come from the real `leagues` table
  (they were top-level `teams` rows); "Hot summer Final Beta"'s 4 team-id
  scope rows reset to one `platform` row.
- **Q4c —** demo DELOITTE league + its conference ARCHIVED
  (`archived_at`/`is_active=false`), not deleted.

## End state (verified live)

- 6 teams: DELOITTE-2026, DELOITTE-NET, HCI → league DELOITTE-2026 /
  conference Deloitte (org); LONELY-HEART-2026 → INDEPENDENT / Lonely hearts
  (private, new); TEAM-SHEBA, TEAM-PE → INDEPENDENT / GENERAL (public).
- `team_conference_memberships`: 12 rows (2 per team: S1 + S2).
- Leagues: INDEPENDENT + DELOITTE-2026 active; DELOITTE archived.

## Acceptance — verified live 2026-08-01

1. **Every team has ≥1 team_conference_memberships row** (0 without).
2. **team_memberships 29 → 24**: exactly the approved 5 demo rows gone;
   per-team counts byte-identical for all 6 survivors (D-2026=5, NET=4,
   HCI=4, LONELY=2, PE=3, SHEBA=6).
3. **team_leaderboard identical before/after** — same 6 rows, same scores,
   same ranks (D-2026 5237 r1 · HCI 4750 r2 · SHEBA 4705 r3 · LONELY 1650 r4
   · NET 1605 r5 · PE 1605 r6). The demo company never ranked (its members
   have no score_events on the board path). Company standings changed BY
   DESIGN: old = DELOITTE(demo) 4387 + DELOITTE-2026 3389 (company-team
   members only); new = one org conference "Deloitte" at 7109 — the Q3 merge
   pulling NET/HCI members in, deduped at member level (verified 4 distinct
   active-season members).
4. **No code references teams.season / group_type / parent_id** — repo-wide
   grep clean (comments describing the retirement only). Guarded further by
   phase 2's gate.
5. **A team can join two conferences in two different leagues** — TEAM-SHEBA
   (INDEPENDENT/GENERAL) + Deloitte org conference (DELOITTE-2026 league) for
   Season 2 inserted successfully, verified, rolled back.

`npm run build` green · test suites green (season-config 24, game-library 26,
advisory-only 6, messaging 28, puzzle-bank 10).

## Function/API surface changes

- `fn_group_member_emails(p_group)` — p_group is now a team id OR a
  conference id (conference branch replaces the company branch). The whole
  standings chain (`fn_group_member_board` → `fn_group_period_signals`) is
  unchanged above it.
- `fn_company_standings` / `fn_company_team_standings` — "company" = org
  conference; `p_company` takes a conference id.
- `team_get_my_teams` — return columns changed: `group_type`/`parent_id`/
  `parent_code` → `conference_code`/`conference_name` (drop + recreate).
- `team_create` — keeps its 5-arg signature; `p_group_type`/`p_parent_code`
  ignored; new teams land in INDEPENDENT/GENERAL (resolved by code).
- `team_leave` — company-with-children special case removed.
- `/api/leaderboard/team/[teamId]` no longer returns `team.group_type`.
- LO `getLeagues` reads real conferences; `loadLeagues` reads real leagues.

## Post-merge ops (in order)

1. Merge this PR; wait for the Vercel production deploy.
2. Apply `20260801000003_league_model_part_b_drop_hierarchy_columns.sql`.
3. Re-run the repo grep + a teams write (join/leave) as a sanity check.
