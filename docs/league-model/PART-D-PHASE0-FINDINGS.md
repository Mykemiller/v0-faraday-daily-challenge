# Part D — Phase 0 investigation findings (CC-FARADAY-LEAGUE-1.0)

**Status: Phase 0 complete — STOPPED at the approval gate. No writes were made**
(no Supabase writes, no Airtable writes, no migration, no application code).
Investigated 2026-08-01 against live Supabase `ycadmmngkdhvpcsrcuaq`, the live
Airtable corpus base `appxfti7VuoHYUeu6`, and this repo at the merge of PR #143
(Parts A, B, C, C½ all merged and applied).

---

## 1. Does any worker advance a generation run past `calendar_built`?

**No deployed worker exists. Saying it plainly: this is the gap the ticket closes.**

The only thing that can advance a run is the **local Node script**
`scripts/far287/generate-puzzles.mjs` — and it has never been invoked. Run
`34dd26f6-9fe7-40be-bfcd-7a733031e2e5` still reads `status='calendar_built'`,
`written_count=0`, `failed_count=0`, `completed_at` NULL (params carry the
CC-DC-BANK-RESUME-1.0 Phase-2 backfill only). No edge function, no Vercel route,
no cron touches `dc_puzzle_generation_runs`.

What the script does have vs. what Part D requires:

| Part D worker requirement | FAR-287 script today |
|---|---|
| Resumable via `phase_cursor` | Partial — `--resume <run_id>` rebuilds an "already written" set from staging (idempotent re-entry), but there is no cursor column and no mid-run checkpoint |
| Heartbeat | **Absent** — the run row is written only at start and at process end |
| Honest counters | **Defective** — resume *overwrites* `written_count`/`failed_count` with the current invocation's totals, and terminal status is stamped unconditionally even when items failed (defects enumerated in `ops/2026-07-30-far287-generation-resume-investigation.md` Q2) |
| Bounded batches | Yes — `--batch`, clamped 8–12, default 10 |
| Idempotent | Yes — `unique(puzzle_type, go_live_date)` + unique `content_hash`; but `sbInsert` sends `resolution=merge-duplicates` with `on_conflict=content_hash`, so running **without** `--resume` against a populated staging table is dangerous (documented sharp edge) |
| Season scoping | **Absent** — the run row has no `season_id`; the calendar is global |

**Pilot-definition conflict to resolve:** the script's `--pilot` = the first
**7 themed days × 7 types = 49 puzzles** (CC-DC-BANK-RESUME Phase-3 convention).
Part D **DEC-5** defines the pilot as **one puzzle per configured game** (7 for a
full slate). These are different gates; Part D's build should implement DEC-5 and
retire the day-count pilot, but confirm.

## 2. League Office Tier 2 audited-write pattern + staff gate

Verified in tree, matching the PR #83/#120 pattern:

- **Staff gate:** `requireStaff()` — `src/lib/league-office/service.ts:65`;
  allowlist = `STAFF` in `src/lib/league-office/constants.ts`
  (**mykemiller@gmail.com only**). Non-staff hitting `/api/league-office/action`
  → 403. ⚠️ The `NEXT_PUBLIC_LEAGUE_OFFICE_OPEN` kill-switch bypasses both layers
  when set (owner-requested, 2026-07-28) — Part D's generate/approve/lock actions
  inherit that behavior automatically.
- **Write funnel:** `executeAction()` — `src/lib/league-office/write.ts:129`.
  One `lo_audit_log` row per action with a mandatory reason;
  `season_config_promote` self-logs (never double-log). Part D adds cases in this
  funnel (`domain='seasons'`, `target_type='season'`, `reversible=false` for lock).
- **Seasons UI shell already exists:** `/league-office/seasons` (index) ·
  `/seasons/new` wizard · `/seasons/[id]` (version timeline + action bar) ·
  `/seasons/[id]/config/[configId]` editor — Part D's buttons/validation panel/run
  progress extend these pages rather than creating a new surface.

## 3. How generation calls an LLM today

`scripts/far287/lib/clients.mjs` → `anthropicJson()`:

- Raw `fetch` to `api.anthropic.com/v1/messages` (no SDK), model
  **`claude-sonnet-4-6`** (env-overridable `FAR287_GEN_MODEL`), `max_tokens` 4096.
- One call per batch of 8–12 puzzles of one type; **sequential loop, no retry
  logic, no backoff** — a failed call fails those items (recovered only by a
  later `--resume` pass). Truncation is salvaged object-by-object (`parseArray`).
- Cost controls: batch size + the run's `target_count` hard stop only. The
  2026-07-31 estimate for a 3,500-puzzle run: **≈ $19–24, ≈ 4.5–7 h single pass**.
- **No server-side generation path exists** (no edge function, no Vercel route).

**Runtime blocker (measured from this environment, 2026-08-01):**

| Endpoint | Direct egress from this container |
|---|---|
| `api.anthropic.com` | ✅ reachable (401 = key missing) — but `ANTHROPIC_API_KEY` is **unset** here |
| `api.airtable.com` | ❌ **proxy-blocked** (CONNECT 403) even though `AIRTABLE_API_KEY` is set |
| `ycadmmngkdhvpcsrcuaq.supabase.co` REST | ❌ **proxy-blocked** (CONNECT 403); DB access works only via the Supabase MCP |

So the generator **cannot run inside this remote session**. It must run where
egress + keys exist: Myke's machine (as FAR-287 assumed), or be rebuilt as a
deployed runtime (Vercel already provisions `ANTHROPIC_API_KEY`,
`AIRTABLE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; a Supabase edge function is the
other candidate). **This is an architecture decision for the approval gate** —
Part D's "Generate" button needs a runtime the button can actually start.

## 4. Exact FK binding staging → theme, and composite-FK violations

Live constraint (simple, not composite):

```
dc_puzzle_bank_staging_theme_date_fkey
  FOREIGN KEY (theme_date) REFERENCES dc_daily_theme(theme_date)
```

It references `dc_daily_theme_theme_date_key` — the **UNIQUE (theme_date)**
constraint. `dc_daily_theme` has **no `season_id` column today**.

**Rows that would violate the new composite FK `(season_id, theme_date)`: 0.**
All 105 staging rows have `season_id` NULL, and a MATCH SIMPLE composite FK skips
rows with any NULL member. The 7 Unpublished pilot imports additionally have
`theme_date` NULL (permitted by `dc_staging_import_or_complete` for
`airtable_record_id` rows).

**⚠️ Migration subtlety the spec does not state:** Part D acceptance 5 (two
seasons over overlapping dates each produce their own theme rows) is only
possible if the global **UNIQUE (theme_date) is dropped** — otherwise two seasons
can never both have a row for the same date. Dropping it cascades: the existing
simple FK depends on that unique constraint, so the migration must **drop the old
FK + unique together, then add** the partial unique index
`(season_id, theme_date) where season_id is not null` **plus** (for the retained
NULL-season corpus and the 98 season-less import rows) either a partial unique on
`theme_date where season_id is null` + a replacement validity guarantee, or accept
that the 98 import rows' theme link is no longer FK-enforced. Proposed resolution
to approve: keep a partial unique `theme_date where season_id is null` (preserves
the corpus invariant and re-hosts nothing), drop the simple FK, add the composite
FK — 0 rows violate either. Alternatives welcome; **not decided silently.**

## 5. The staging rows' `season_id` and `theme_date`

The ticket's "7 existing staging rows" is stale — the Part C½ forward import
landed 98 more. Live state (105 rows, **all `season_id` NULL** ✓):

| published | rows | theme_date | go_live_date |
|---|---|---|---|
| Live | 7 | 2026-08-01 | 2026-08-01 |
| Published | 91 | 2026-08-02 → 2026-08-14 | same as theme_date |
| Unpublished (07-28 pilot imports) | 7 | **NULL** | 2026-07-28 |

## 6. Game library = exactly the 7 live types

`game_catalog` holds 18 rows: **exactly 7 `lifecycle_state='live'`** with
`runtime_key` = Rackl · Signal Drop · The Stack · Circuit · The Brief ·
Dark Fiber · Frequency, plus 11 `new_idea` concepts (`is_active=false`,
`runtime_key` NULL — the default catalog filter keeps them out of slate editors).
**No eighth live type. No "Logo Match" anywhere in the catalog.** Condition 4's
game-key check can (and should) be driven off
`lifecycle_state='live'`/`runtime_key`, not a hardcoded list.

## 7. Corpus read access from the generation runtime

All five corpus tables verified **readable right now via the Airtable MCP
connector** (read-only; totals from live metadata):

| Table | ID | Live count |
|---|---|---|
| IDF Theme Registry | `tbl9BRMxHm5fL8oy5` | 7 threads (Active incl. T-002, T-003) |
| IDF Domain Registry | `tbltFtmWgBYPuRLSc` | **23 records, all Active, D1–D23** — confirms the spec's warning; the table description's "18" is wrong |
| IDF Sub-Domain Registry | `tbla7rtRY9AaeoWhu` | 116 |
| Lexicon | `tblibfOpAa5wh0dA5` | 540 |
| Tracking Companies | `tbluDYoK8Nj2DGQ0r` | 469 |

Credential story is split by runtime: the MCP connector (Myke's OAuth) works
from Claude sessions; the script runtime's `AIRTABLE_API_KEY` is set in this
container but **direct api.airtable.com egress is proxy-blocked** (see §3).
From Vercel, `AIRTABLE_API_KEY` is provisioned and unblocked (the day-content
sync reads Airtable daily in prod). The FAR-287 generator also carries a
committed taxonomy snapshot (`scripts/far287/idf-taxonomy-snapshot.json`) that
the calendar builder uses instead of live reads — but Part D condition 7 requires
**live** Domain Registry queries at validation time, so the deployed runtime must
be one with Airtable reach (Vercel qualifies).

---

## Spec-vs-live reconciliation (must be resolved at the approval gate)

Part D's migration/validation text was written against the *spec's* Part A
schema. Part A as actually built **adopted the live LO season-config model
instead**, so several Part D references don't exist in that shape:

1. **`season_games` is not the spec's table.** Live shape:
   `season_games(season_config_id, game_id, is_enabled, weight, points_override,
   difficulty_floor/ceiling, appears_on_days, starts_on, ends_on, sort_order)` —
   keyed to the **versioned `season_config`**, joined to `game_catalog` by uuid.
   There is **no `game_key`, no `difficulty_mix`, no `theme_emphasis`, no
   `puzzle_count` column anywhere**. Difficulty mixes live in
   `season_difficulty_mix(season_config_id, difficulty_band, target_pct,
   applies_to_game_id)`; theme mixes live in `season_theme_mix(season_config_id,
   theater_id, sector_code, thread_code, target_pct, is_excluded)`.
   → Part D's validation conditions 3–7 and DEC-2's `puzzle_count` need to be
   **mapped onto this model** (proposed: add `puzzle_count` to the live
   `season_games`; validate mixes from the two mix tables), not implemented
   against the spec's phantom table.
2. **Theme emphasis is keyed by IDF Theater/Sector/Thread, not D-codes.** The
   whole live theme pipeline (`dc_daily_theme.theater_id/sector_code/
   thread_codes`, `season_theme_mix`, the FAR-287 calendar builder) speaks
   Theaters. Condition 7 ("every `theme_emphasis` key is an Active domain code
   queried live from the Domain Registry") contradicts that. Decision needed:
   (a) validate the Theater/Sector/Thread mix and check *domain* emphasis only
   where puzzles carry `domain` (D#) — recommended; or (b) add a domain-keyed
   emphasis structure and a D-code↔Theater mapping. The D16/D18 >15% WARN maps
   cleanly onto whichever structure wins.
3. **`dc_puzzle_generation_runs` is missing every Part D column** (`season_id`,
   `run_kind`, `superseded_at`, `last_heartbeat_at`, `phase_cursor`) and
   `seasons` is missing `pilot_approved_at`/`generated_at` — the spec's ALTERs
   are clean and additive as written. `seasons.locked_at` exists ✓.
4. **Locked-season config mutation is currently API-enforced (423), not
   DB-enforced.** Part D's guardrail "locked seasons reject all config mutation
   at the DB level" is new — needs triggers on `season_config` +
   `season_games`/`season_difficulty_mix`/`season_theme_mix`.
5. **Season 2 has the only active config.** Hot summer Final Beta
   (2026-08-03 → 09-04) has **no active `season_config`** — it must be configured
   through this new flow (or the existing editor) before it can ever be
   GENERATABLE. It is on the critical path: **staging + Airtable both run dry
   after 2026-08-14**, and Part D is the mechanism that fills the bank
   (CC-2). The 5 seasons are otherwise unchanged, all in league INDEPENDENT.

## Decisions queued for Myke (the STOP list)

1. **Worker runtime**: local script run by Myke (fastest, keys exist) vs. a
   deployed runtime (Vercel API route / Supabase edge fn) the LO "Generate"
   button can invoke. This session's container can do **neither Airtable nor
   Supabase REST directly** — it cannot be the runtime.
2. **§4 FK restructure**: approve dropping `UNIQUE(theme_date)` + the old simple
   FK in favor of the partial-unique + composite-FK design (required for
   acceptance 5), with the NULL-season partial unique preserving the corpus
   invariant.
3. **Reconciliation choices** from the section above: where `puzzle_count`
   lives, and Theater-based vs. domain-based `theme_emphasis` validation.
4. **Pilot definition**: DEC-5 (1 puzzle per configured game) supersedes the
   script's 7-day/49-puzzle pilot — confirm.
5. **`ANTHROPIC_API_KEY` provisioning + credit check** for whichever runtime is
   chosen (the crawl fleet has twice stalled on a depleted balance).

**STOP. Awaiting approval before any migration, worker code, or UI work.**
