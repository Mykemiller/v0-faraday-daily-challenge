# ADR-DC-SEASON-ISOLATION-1.0 — Concurrent sponsor seasons on an extensible game library

**Status:** Approved by Myke 2026-08-20 (Option A — per-season puzzle sets)
**Supabase:** `ycadmmngkdhvpcsrcuaq` · **Repo:** `Mykemiller/v0-faraday-daily-challenge`
**Supersedes:** `CC-LO-SEASON-OVERLAP-1.0` (partial-constraint approach folded in below)

This is the contract every downstream CC prompt references. It is not itself an
implementation prompt.

---

## Goal

An unlimited number of seasons may run concurrently. Each season independently selects
its own games, domain mix, difficulty mix, scoring, branding and messaging, and owns its
own puzzle content. The game library is open-ended — adding a game must be a data
operation, never a schema or function change.

---

## Live state at time of writing (verified 2026-08-20)

| Fact | Consequence |
|---|---|
| `seasons_no_overlap_per_league` EXCLUDE constraint; all 6 seasons in league `Independent` | No two seasons may coexist |
| `dc_puzzle_bank_staging` UNIQUE `(puzzle_type, go_live_date)` — global | Two seasons cannot both run Rackl on the same day |
| `dc_daily_page_content` has **no** `season_id`; one row per `puzzle_date` | Serving mirror is season-blind |
| `fn_dc_rotate_live_set` holds `c_types` = 7 hardcoded **display names**; promotes all rows for the date, season-blind | Rotation is both fixed-7 and non-isolating |
| `dc_assign_public_id()` holds a second hardcoded CASE over the same 7 names and **raises** on unknown | An 8th game cannot be published |
| `puzzle_type` is display-name **text** in `dc_puzzle_bank_staging` and `dc_completions`; no FK to `game_catalog` | Join key is a human-readable string |
| `dc_completions.puzzle_public_id` is **NULL on all 268 rows**; no `season_id` | A completion cannot be attributed to a season or a puzzle |
| `game_catalog`: 7 `live`, 11 `new_idea`. The 11 have **no `short_code`, no `public_id_prefix`** | A season picking one would fail at publish |
| `season_games` / `season_theme_mix` / `season_difficulty_mix` exist, are populated per config, and are keyed on `season_config_id` | The config model is already season-scoped and correct |
| `season_theme_mix` exclusions **are** honored by generation | Domain control works at theater grain |
| `season_difficulty_mix` bands (`foundational/practitioner/expert`) vs generated values (`easy/medium/hard/expert/practitioner`) | Difficulty control does **not** work — vocabulary mismatch |
| `dc_daily_theme` already keyed `(season_id, theme_date)` | Already correct; the model to copy |
| `leagues` carries `league_type`, `owner_email`, `logo_url`, `brand_color`, `join_policy`, `join_token` | Sponsor branding has a foundation |

---

## The extensibility contract

Six rules. Every CC prompt in this program must assert them; any violation is a defect
regardless of whether tests pass.

**E1 — `game_catalog` is the single source of truth.**
No SQL function, migration, route, component, config file, or test fixture may contain a
literal list of games. Where a set of games is needed it is *queried*. Grep for the seven
display names is a valid acceptance check: the count outside `game_catalog` rows must be zero.

**E2 — The join key is `game_id uuid`, never a display name.**
`dc_puzzle_bank_staging` and `dc_completions` gain `game_id` FK → `game_catalog(id)`.
`puzzle_type` is retained as a denormalised display column for one release, then dropped.
Renaming a game must never orphan data.

**E3 — Publishability is a catalog property, enforced in the database.**
A game is publishable only when `lifecycle_state='live'` AND `public_id_prefix` is non-null,
exactly 4 chars, unique, AND `runtime_key` is non-null. Enforce with constraints on
`game_catalog`, not with checks scattered through app code. Public ID prefix is read from
the catalog row, never from a CASE.

**E4 — Seven is a coincidence, not a constant.**
`games_per_day` is derived as `count(*) from season_games where is_enabled`, per season.
Any UI that lays out a fixed grid of 7 must handle 1..N. Any "missing types" health check
compares against the season's enabled set, not a global array.

**E5 — Isolation key is `(season_id, game_id, go_live_date)`.**
Applies to the bank, the serving mirror, rotation, theming and generation runs. A season
never reads another season's rows. A shared/platform season is just a season whose scope
includes everyone — it gets no special-case code path.

**E6 — Every scored event names its puzzle and its season.**
`dc_completions` gains `season_id` and a populated puzzle reference. Attribution is never
re-derived from `(display name, date)` again.

---

## Target model

```
game_catalog ──< season_games >── season_config ──< season_theme_mix
     │                                │            └< season_difficulty_mix
     │                                │
     │                             seasons ──< dc_daily_theme (season_id, theme_date)
     │                                │
     └──────< dc_puzzle_bank_staging (season_id, game_id, go_live_date) UNIQUE
                        │
                        └──< dc_completions (season_id, game_id, puzzle_id)
```

**Sponsor season = a league + a season + a config bundle + its own puzzle set.**
No new "sponsor" entity. `leagues.league_type='sponsor'` plus branding fields. This keeps
sponsor seasons on the same code path as everything else, which is what makes N of them cheap.

---

## Decisions

| # | Decision | Rationale |
|---|---|---|
| **A1** | Overlap is permitted via `seasons.overlap_exempt boolean default false` and a **partial** exclusion constraint `WHERE (NOT overlap_exempt)`. Sponsor seasons are created exempt. | Two *standard* seasons still cannot overlap, so "the flagship season on date D" stays unambiguous. Race-safe (GiST) unlike a trigger check. |
| **A2** | Isolation is by `season_id`, not by league. | A sponsor could run two seasons; a league could run none. Season is the unit that owns content. |
| **A3** | `dc_completions` gains `season_id` + `puzzle_id`, both populated at write time. Historic 268 rows backfill to the flagship season by date. | E6. Cannot ship concurrency without it. |
| **A4** | `dc_daily_page_content` gains `season_id`; unique becomes `(season_id, puzzle_date)`. | Serving mirror must be per-season or every sponsor sees the flagship's content. |
| **A5** | Public ID stays a single global sequence with a per-game prefix, prefix read from `game_catalog`. No season segment in the ID. | Public IDs are already in the wild on share cards. Format unchanged; only the lookup source changes. |
| **A6** | Rotation becomes `fn_dc_rotate_live_set(p_today date, p_season_id uuid)` and reports missing games against that season's enabled set. Called once per active season. | E4 + E5 in one change. |
| **A7** | Difficulty bands become a closed vocabulary sourced from a `difficulty_bands` reference table; generation is passed the season's mix and validated on write. `season_config.difficulty_curve` and `target_solve_rate_pct` are **removed** from the UI as redundant. | The observed failure is a vocabulary mismatch, not a missing feature. |
| **A8** | Generation is per-season. A generation run is scoped to `(season_id)` and may only emit games in that season's enabled set, domains in its theme mix, and bands in its difficulty mix. | Cost is per-season and visible; a sponsor's failures never contaminate the flagship bank. |
| **A9** | The `new_idea` games stay unselectable until they satisfy E3. The season game picker filters on publishability and shows non-live games greyed with the reason. | Prevents a sponsor selecting a game that cannot be published. |
| **A10** | Playoffs, standings, free agency, streaks and badges are all re-read for single-season assumptions before concurrency is enabled in production. | Listed as an explicit audit, not assumed safe. |

---

## Sequencing

| Order | CC | Why here | Blocks on |
|---|---|---|---|
| 1 | `CC-DC-DIFFICULTY-VOCAB-1.0` | Smallest, independent, actively degrading the live season | — |
| 2 | `CC-DC-GAME-REGISTRY-1.0` | De-hardcodes the 7 in rotation + Public ID; establishes `game_id` | — |
| 3 | `CC-DC-COMPLETION-ATTRIBUTION-1.0` | Populate `season_id` + `puzzle_id` on completions; fix the app write path | 2 |
| 4 | `CC-DC-SEASON-SCOPED-BANK-1.0` | Per-season bank, mirror, rotation, generation | 2, 3 |
| 5 | `CC-LO-SEASON-OVERLAP-2.0` | Turn concurrency on in the wizard | 4 |
| 6 | `CC-LO-SEASON-MIX-UI-1.0` | Surface games / domains / difficulty as real controls | 1, 2 |
| 7 | `CC-LO-SPONSOR-PANEL-1.0` | Sponsor branding + messaging | 5 |

Concurrency (5) must not be enabled in production before (3) lands. Turning on overlapping
seasons while completions carry no season reference produces unattributable scores that
cannot be repaired after the fact.

---

## Sponsor panel — options to explore (not yet decided)

Three levels, increasing cost:

**L1 — Branded skin.** Logo, brand colour, sponsor name in the season header and on share
cards. Reads `leagues.logo_url` / `brand_color`, which already exist. Days, not weeks.

**L2 — Sponsor messaging.** A `sponsor_panel` record per season: welcome message, a rotating
message-of-the-day, a CTA (label + URL), optional footer disclosure. Rendered in the lobby
above the game grid for members of that season only. Needs a table, an editor in League
Office, and a content-approval gate — a sponsor's copy going live unreviewed is a legal
surface, not just a design one.

**L3 — Sponsor console.** Scoped, read-only League Office access for the sponsor's own
season: standings, participation, engagement. Requires real multi-tenant authorisation, which
does not exist today — the staff gate is currently a hardcoded email, and
`NEXT_PUBLIC_LEAGUE_OFFICE_OPEN` makes League Office publicly reachable in production.
**L3 must not be attempted until that gap is closed.**

Open questions for Myke: does sponsor copy need Commissioner approval before publish (assume
yes)? Can a sponsor edit mid-season? Does sponsor messaging appear on public share cards seen
by non-members — an advertising-disclosure question, not a product one?

---

## Standing guardrails (assert in every CC in this program)

- Signal Drop's `word` **is** the answer. `answer_key` must never reach a client payload.
- No anon or authenticated RLS policy on any `dc_*` table. Serving stays service-role, server-side.
- Any staff-only mutation requires an independent server-side identity check.
- No literal game list outside `game_catalog`.
- Any verification count that does not match the Phase 0 report ⇒ **STOP and report**. Never
  "fix and continue."
