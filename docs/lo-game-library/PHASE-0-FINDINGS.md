# CC-LO-GAME-LIBRARY-1.0 — Phase 0 investigation findings

Investigated 2026-07-30 against live Supabase `ycadmmngkdhvpcsrcuaq` and `origin/main`
(`27e0523`, PR #121). **No files modified, no migrations run.**

---

## 5. Count verification — PASS, proceed

| Table | Expected | Actual | |
|---|---|---|---|
| `game_catalog` | 7 | **7** | ✅ |
| `season_games` | 28 | **28** | ✅ |
| `season_config` | 4 | **4** | ✅ |
| `seasons` | 4 | **4** | ✅ |
| `lo_audit_log` | 8 | **8** | ✅ |

All 7 catalog rows: `is_active=true`, `is_beta=false`, `launched_on=2026-06-13`,
`retired_on=null`, `sort_order` 10/20/30/40/50/60/70. Existing audit domains:
`teams` (6), `comms` (1), `subscribers` (1).

---

## 1. Where League Office lives

Merged to `main` (PR #82 read screens, #83 audited writes, #120 season config).

| Concern | Path | Signature |
|---|---|---|
| Staff gate (server, **the real fence**) | `src/lib/league-office/service.ts:65` | `requireStaff(): Promise<StaffContext>` |
| Staff gate (client, convenience) | `src/components/league-office/StaffGate.tsx` | — |
| API-route guard | `src/lib/league-office/api-guard.ts` | `guard()` → `{ok, s, email}` \| `{ok:false, response}` |
| **Audited-write helper (PR #83)** | `src/lib/league-office/write.ts:114` | `executeAction(s: Svc, staffEmail: string, input: ActionInput): Promise<ActionResult>` |
| — its audit writer | `src/lib/league-office/write.ts:70` | `writeAudit(s, {staff_email, domain, action, reason, target_type, target_id, before, after, reversible, reverts_id?})` |
| Action endpoint | `src/app/api/league-office/action/route.ts` | POST, 403 for non-staff |
| Nav rail | `src/components/league-office/Rail.tsx:14` | `OPERATIONS[]` — Game Library slots in here |

`executeAction` is a `switch (input.action)` returning `{ok, message}`; it **rejects any
call with an empty `reason`** before dispatch (`write.ts:119-120`). Reuse verbatim: add
`game.*` cases to that switch and a `log(...)` call per case.

⚠️ **Kill-switch:** `NEXT_PUBLIC_LEAGUE_OFFICE_OPEN=1` bypasses both gates and attributes
writes to `auth-disabled@league-office.local`. Unset in prod = gate enforced.

---

## 2. Every read of `game_catalog` / `season_games`

**All five call sites are server-side service-role. There is no anon or authenticated
read of either table anywhere in the codebase.**

| Call site | Table | Key |
|---|---|---|
| `src/lib/league-office/seasons.ts:147` `loadGameCatalog()` | `game_catalog` | service role |
| `src/lib/league-office/season-write.ts:245` (`createDefaultsConfig`) | `game_catalog` | service role |
| `src/lib/league-office/seasons.ts:230,320,423` | `season_games` | service role |
| `src/lib/league-office/season-write.ts:252,318,326,454,456` | `season_games` | service role |
| `src/app/api/lo/game-catalog/route.ts` (GET, behind `guard()`) | `game_catalog` | service role |
| `src/components/league-office/ConfigEditor.tsx` (renders, does not query) | — | — |

Consequence for **D10**: nothing would break if RLS were enabled, but per D10 **no RLS
change is made**. See §6 below for the security item to log separately.

---

## 3. Does any code read `game_key` or `short_code`?

**No code reads either value.** They appear only as *type fields* in
`src/lib/league-office/seasons.ts:29,31` (`GameCatalogRow`), populated by `select=*` and
never branched on, compared, or rendered as a key. `grep` for both across `src/` and
`supabase/` returns those two type declarations and nothing else.

D3 and D8 are therefore safe: freezing `game_key` and leaving `short_code` unreconciled
breaks nothing.

**D8 prefixes verified against live `dc_puzzle_bank_staging.public_id` — exact match to
the ticket, and they genuinely differ from `short_code`:**

| Game | `game_catalog.short_code` | Public ID prefix (live) |
|---|---|---|
| Rackl | RKL | RACK |
| Signal Drop | SGD | SGNL |
| The Stack | STK | STAK |
| Circuit | CIR | CIRC |
| Dark Fiber | DKF | FIBR |
| Frequency | FRQ | FREQ |
| The Brief | BRF | BRIF |

Two live systems, no derivation rule. D8 holds.

---

## 4. How `/api/challenge/today` selects the day's games — **D4 CONFIRMED**

Season config is **not consulted**. Grep for `season_config|season_games|game_catalog`
across `src/app/api/challenge/`, `src/lib/puzzle-bank.js`,
`src/lib/supabase-puzzle-bank.js`, `src/lib/airtable-puzzle-bank.js` → **zero hits**.

The route calls `getLivePuzzles()` from the `DC_PUZZLE_SOURCE` facade. Both backends
select on publish state alone:

- **Supabase** (`src/lib/supabase-puzzle-bank.js:70`):
  `?published=eq.Live&select=puzzle_type,puzzle_content,public_id&order=go_live_date.desc`
- **Airtable** (`src/lib/airtable-puzzle-bank.js`): `Published = "Live"`, per AUTO-128.

Both key the result map by the free-text `puzzle_type` (`supabase-puzzle-bank.js:94`),
and the component fills any missing type from built-in mock data. Nothing joins
`game_catalog.game_key`. **Toggling `season_games.is_enabled` cannot change what is
served.** Advisory-only is real.

Runtime free-text values confirmed live in `dc_completions.puzzle_type` and
`dc_puzzle_bank_staging.puzzle_type`, all 7: `Rackl`, `Signal Drop`, `The Stack`,
`Circuit`, `Dark Fiber`, `Frequency`, `The Brief` — these are the `runtime_key` values.

---

## 6. Findings NOT requested, but material

### 6a. D5's mechanism is stale — its *intent* is already shipped

D5 describes: on an `active` season, "create a new `season_config` version (v+1, state
`active`, prior row → `superseded`) and copy forward all rows."

PR #120 (prod, migration `20260730000001` applied) implements exactly that outcome by a
different mechanism, and **D5's literal mechanism would fail**:

- `editability()` (`season-config-logic.ts:42`) is the single source of the rule:
  `draft`/`scheduled` writable; `active` → *"This version is live. Clone it to make
  changes."*; `superseded`/`cancelled` read-only. Enforced at the API
  (`season-write.ts:418` → `409`), not just the UI.
- The real path is `season_config_clone()` → v+1 **draft** → edit → `season_config_promote()`
  → flips to `active`, supersedes the incumbent, with effective-dating.
- Inserting a second row already in state `active` would trip the
  `season_config_one_active_uq` partial unique index — that is *literally defect 3*
  documented in `CLAUDE.md` for this migration.

**Reading:** D5's rationale ("Respects the existing versioned-config state machine rather
than mutating history") endorses the shipped machinery; only its mechanical description
predates PR #120. Phase 4 will implement D5's intent via `season_config_clone` +
`season_config_promote`, which satisfies AC5 (new version created, prior superseded)
without a competing state machine. **Flagging rather than silently reinterpreting.**

Live season/config state matches D5's editability map:

| Season | `seasons.status` | config v1 `state` | D5 verdict |
|---|---|---|---|
| Season 1 — Power Crunch | `closed` | `superseded` | read-only (both routes agree) |
| Season 2 — Post-YOTTA | `active` | `active` | clone-and-promote |
| Season 3 — Post-CES/Pre-GTC | `upcoming` | `draft` | edit in place |
| Season 4 — Post-GTC | `upcoming` | `draft` | edit in place |

Also: a season with `seasons.locked_at` set rejects every config mutation with `423`
(`season-write.ts:100`). All 4 are currently unlocked.

### 6b. Phase 4 season assignment overlaps the shipped ConfigEditor

`/league-office/seasons/[id]/config/[configId]` already edits the game slate, rendered
from `game_catalog` merged with `season_games`. Its writer `saveConfigBundle`
(`season-write.ts:452-458`) **deletes the whole `season_games` set for the config and
re-inserts it**, and logs `domain='seasons'`.

Phase 4 will therefore *not* build a parallel bundle writer. The Game Library's
assign/unassign will be a narrow single-row action reusing `editability()` and the
clone/promote helpers, logging `domain='game_library'`. Two consequences:

- The D9 trigger must tolerate the existing delete-then-reinsert cycle (it will —
  the trigger fires per inserted row and every row in that cycle is an already-assigned
  live game).
- The ticket's guardrail *"do not delete `season_games` rows for closed or superseded
  seasons"* is already satisfied structurally: `saveConfigBundle` is unreachable for
  those states via `editability()`.

### 6c. D4's stated gate has already shipped

D4 defers enforcement "behind the `DC_PUZZLE_SOURCE` Supabase cutover
(CC-DC-SUPABASE-SERVING-1.0)." That ticket **merged as PR #115 on 2026-07-29**. The gate
is now an env-var flip (`DC_PUZZLE_SOURCE` is unset in prod = Airtable), not an unbuilt
ticket. D4's substance is unaffected — neither backend consults season config — but the
deferred work is nearer than the ticket implies.

### 6d. Schema facts that change Phase 1

- **`game_catalog.metadata jsonb NOT NULL DEFAULT '{}'` already exists.** D7 needs no new
  column for it.
- **There is no CHECK constraint on `game_catalog.category`** — the only constraints are
  `PRIMARY KEY (id)` and `UNIQUE (game_key)`. The appendix's "if a check constraint on
  `category` exists, extend it" is moot; `spatial` inserts cleanly.
- `season_games` already has `UNIQUE (season_config_id, game_id)`.
- Enum `game_lifecycle_state` does not exist yet. `season_config_state` =
  `{draft,scheduled,active,superseded,cancelled}`; `season_status` = `{upcoming,active,closed}`.
- None of `runtime_key`, `lifecycle_state`, `public_id_prefix`, `idea_source`, `notes`
  are referenced anywhere in `src/` or `supabase/` — all five are genuinely new.

### 6e. Puzzle-bank depth will read as 1 per game (Phase 3)

`dc_puzzle_bank_staging` currently holds exactly **1 row per puzzle type** (the PR #115
pilot import). The 373-row Airtable backfill has not been run. The Phase 3 "puzzle-bank
depth" column is therefore accurate but near-empty — it is not a bug.

### 6f. Security item to log separately (D10 — reported, not acted on)

`game_catalog`, `season_games`, `season_config`, `season_difficulty_mix` all have
**`relrowsecurity = false`** (RLS disabled). Per D10 this ticket changes nothing. Since
§2 confirms every read is service-role, enabling RLS deny-all would be safe *today* —
but that is a separate decision, deliberately out of scope here.
(For contrast: `lo_audit_log` and `seasons` do have RLS enabled.)
