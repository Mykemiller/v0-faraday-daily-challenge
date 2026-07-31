# CC-LO-SEASON-CONFIG-1.0 — League Office Season Configuration

Commissioner-facing season configuration: create a season end-to-end without
SQL, edit a versioned effective-dated config, schedule a change for a future
date, and read a diffable version history.

Routes:

| Route | What it is |
|---|---|
| `/league-office/seasons` | Index — scope · slate size · config version · row menu |
| `/league-office/seasons/new` | 4-step wizard (nothing written until step 4) |
| `/league-office/seasons/[id]` | Overview · version timeline · effective-now · diff |
| `/league-office/seasons/[id]/config/[configId]` | The editor (sections A–I) |

---

## Migration `20260730000001` — APPLIED 2026-07-30

**`supabase/migrations/20260730000001_season_config_effective_dating_fix.sql`
is applied to prod** (Myke-approved). Promote and Schedule work.

Keep the write-up below: it is the record of why these functions look the way
they do, and the reason not to "simplify" `season_config_apply_due()` back into
a single statement.

Four defects were found in the already-applied season-config functions by
exercising the real RPCs end-to-end. Defects 1 and 2 masked each other, which
is why the pair looked healthy: nothing could ever be promoted, so the
scheduling path was never reached.

1. **`season_config_promote()` always threw.** `set state = case … end` yields
   `text`; Postgres will not implicitly cast that to the `season_config_state`
   enum in an `UPDATE … SET`. Every call failed with `42804`.
2. **Scheduling superseded the incumbent immediately** — leaving the season with
   *no* config in force until the effective date (`v_season_effective_config`
   returned nothing). This breaks the core promise that the current version
   stays live until the change is due.
3. **`season_config_apply_due()` violated `season_config_one_active_uq`.** It
   demoted the incumbent and promoted the due version in one statement via
   data-modifying CTEs; those share a snapshot, so the unique partial index saw
   two active rows (`23505`). Only defect 2 hid this.
4. **`effective_to > effective_from` violated** when an incumbent is superseded
   at the same instant it took effect (two promotes in one second, or a flip
   landing on the same timestamp).

Also hardened: if two scheduled versions for one season are both overdue (a
missed cron run), the **latest wins** and the overtaken one is marked
superseded, instead of being promoted next hour and flip-flopping the season.

**Verification:** a 17-assertion harness — promote-now · schedule · incumbent
stays live during the wait · cron flip · exactly-one-active invariant ·
idempotent re-run · blocking-validation refusal · two-overdue resolution — all
PASS, run inside `BEGIN … ROLLBACK` so no test rows persisted. Run **twice**:
once before applying, and again against the **deployed** functions afterwards.
Post-apply state confirmed unchanged (4 seasons, 4 configs, 1 active, 28
`season_games`, 0 test rows); a real `season_config_apply_due()` returned `0`.

**Security advisor after apply: no new findings.** Both functions carry a
`function_search_path_mutable` WARN — but so do the untouched
`season_config_clone` and `season_config_validate`, so it is a pre-existing
property of the original migration that `CREATE OR REPLACE` preserved, not
something this change introduced. Same for the `rls_disabled_in_public` ERROR on
`season_config`. Both are worth hardening on their own ticket.

`promoteErrorMessage` in `season-write.ts` still maps the pre-fix SQLSTATE to a
named, actionable message — kept as a safety net for any environment where the
migration has not been applied.

---

## Architecture

```
season-config-logic.ts   PURE decisions (no I/O) — shared by client + server
seasons.ts               readers  (Svc → typed view-ready objects)
season-write.ts          audited mutations (one lo_audit_log row each)
api-guard.ts             staff re-verification for every /api/lo/* route
```

`src/components/league-office/season/` holds the editor, wizard, version
timeline, action bar, reason dialog and form primitives.

### Editing rules (enforced in the API, not just the UI)

| State | Editable |
|---|---|
| `draft` | yes |
| `scheduled` | yes (changing `effective_from` re-schedules) |
| `active` | **no** — clone is the only path |
| `superseded` / `cancelled` | no |

A **locked season** (`seasons.locked_at`) rejects every config mutation at the
API layer with `423`, so a hand-rolled request is stopped exactly like a UI
click.

### Optimistic concurrency — why not `updated_at`

`season_config` has **no `updated_at` column**, and the child rows (games,
mixes) carry no timestamps at all — a row-timestamp guard could not detect a
slate edit even in principle. Instead the editor round-trips a **fingerprint**
(`configFingerprint`) computed over the config *and* its children; any
concurrent write moves it and the save is rejected with `409` and a reload
prompt. Strictly stronger than an `updated_at` check, and needs no schema
change. Covered by tests that assert each child kind changes the hash.

### Cross-season copy is not `season_config_clone`

`season_config_clone(p_season_id, …)` resolves the source from its own
`p_season_id` and writes the copy back into that **same** season. Pointing it at
a source season would add a stray draft to the *source* and return an id
belonging to the wrong season. So:

- **same-season versioning** → the RPC (what it is built for);
- **wizard "copy from another season"** → a read-then-insert in
  `copyConfigAcrossSeasons`, which deliberately drops calendar-bound dates
  (registration windows, per-game staggering) because they belong to the old
  season's window.

Its source pick reuses `pickFocusConfig` rather than a PostgREST `order`:
ordering by the enum would put `draft` **first** and silently copy a stale draft
over the live config.

### Catalog-driven slate

The Game Slate renders from `game_catalog` merged with `season_games` — every
catalog row gets a slate row whether or not the config already has one. Adding
an 8th puzzle type to the catalog makes it appear with **zero code change**.

### Mixes

Both allocation editors pin a running-total bar (green at exactly 100, amber
otherwise) with `Normalize to 100%` and `Even split`. Normalization absorbs
rounding drift into the largest element so a set always sums to exactly 100.00,
never 99.99. Only **Theater-level, non-excluded** rows count toward the theme
total; sector rows are a sub-allocation. Only rows **without**
`applies_to_game_id` count toward the difficulty total. This mirrors
`season_config_validate()` exactly.

Theme hierarchy (Theater → Sector → Thread) is derived from live
`dc_daily_theme` rows — public labels only, never IDF D-codes.

### `max_teams_per_subscriber`

Lowering the cap below what existing memberships already use returns `409` with
the count of subscribers over the limit and requires an explicit
acknowledgement. **No membership is ever removed automatically.**

---

## Cron

`/api/cron/season-config-apply` — hourly at **:05** (`vercel.json`), calling
`season_config_apply_due()` and logging the returned count. This is what makes
effective dating real rather than decorative. Idempotent; an audit row is
written **only when something actually flipped**, so the Audit Log is not buried
under 24 no-op rows a day.

---

## Tests

`npm run test:season-config` — 22 tests over the pure logic (normalization,
fingerprint, patch sanitation, findings, diff, window validation, cap counting).

`sanitizeConfigPatch` is whitelist-only: `state`, `version`, `season_id` and
`id` are dropped, so a client can never promote itself by PATCHing `state`.

---

## Known gaps

- **Child writes are not transactional.** PostgREST cannot run multi-statement
  transactions, so a save patches the config then replaces each child set in
  sequence. A mid-sequence failure returns an explicit "reload before editing
  further" message rather than pretending atomicity. Making this atomic needs an
  RPC (deliberately not added — the brief said not to rebuild schema).
- **Conferences table is empty**, so the "Specific conferences" scope option is
  disabled until rows exist. Leagues (top-level `teams`) work today.
- Theme **Thread**-level allocation is stored and read but the editor exposes
  Theater and Sector; threads render once a sector carries them.
