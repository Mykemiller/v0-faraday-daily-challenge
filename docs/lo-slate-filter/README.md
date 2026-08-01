# CC-LO-SLATE-FILTER-1.0 — season config save was writing non-assignable games

**P0.** Every season config save — "Save as draft" *and* "Schedule" — failed, and
reported a concurrency conflict that did not exist.

## What was actually wrong

Three defects, stacked.

**1. The slate was sourced from the whole catalog.** `loadGameCatalog()` read
`game_catalog` with no filter. The catalog holds 18 rows: 7 `live`, 11 `new_idea`
(the CC-LO-GAME-LIBRARY-1.0 concept backlog). `mergeSlate()` rendered all 18 and
the editor posted all 18 back, so the save tried to write a `season_games` row for
each. `trg_season_games_assignable` refused — correctly: a `new_idea` game has no
puzzle bank, so scheduling one promises a game that cannot be served.

The trigger **fires on INSERT regardless of `is_enabled`**. Leaving the 11
unchecked was never a workaround.

The write path had a *different* wrong filter: `createDefaultsConfig` matched
`is_active && !retired_on`. Every catalog row is `is_active`, so it emitted 18 too.
**`lifecycle_state` is the only correct test** — it is what the DB enforces.

**2. The real error was swallowed.** `rq()` does `if (!r.ok) return null`, so the
Postgres message never reached the caller. A lifecycle refusal surfaced as a
generic "Saving the game slate failed."

**3. The writes were not atomic.** Five separate PostgREST calls, five separate
transactions. So the first failed save left this behind:

| step | table | outcome |
|---|---|---|
| 1 | `season_config` | PATCH **committed** |
| 2 | `season_games` | DELETE **committed**, INSERT refused → 400 |
| 3–5 | mixes, scopes | never reached |

That is how draft `667c488f-1c9f-4199-a7ee-40aff7c094a7` (*Hot summer Final Beta*)
ended up with 0 slate rows, 7 theme rows and 3 difficulty rows. It was created by
the cross-season copy path with a valid 7-game slate; a later edit **destroyed** it.

**And that is where the bogus concurrency message came from.** The fingerprint
check is genuine — a hash over the config *and* its children (`season_config` has
no `updated_at`, and the child rows carry no timestamps at all, so a row-timestamp
guard could not detect a slate edit even in principle). Because step 1 and step 2's
DELETE had committed, the fingerprint had genuinely moved. The client only refreshes
its fingerprint on success, so **every save after the first one 409'd, forever,
until reload.** The check was telling the truth about a state the save itself
created.

## The fix

### FIX 1 — filter the slate to assignable games

`ASSIGNABLE_LIFECYCLE_STATES = ['live','in_test']` in `game-library-logic.ts` — one
constant, mirroring `fn_season_games_assignable()`.

- **Read:** `loadGameCatalog()` applies `lifecycle_state=in.(live,in_test)`. All four
  callers feed a surface that ends in a `season_games` row (editor slate, seasons
  index counts, version diff, `/api/lo/game-catalog`). The Game Library console reads
  the whole catalog through its own loader — it is *supposed* to show concepts.
- **Write:** the bundle RPC filters server-side. `createDefaultsConfig` now filters on
  lifecycle. `copyConfigAcrossSeasons` drops a source game that has since been
  retired, instead of taking the whole insert down with it.

Still catalog-driven: promote a game to `live` or `in_test` and it appears with **no
code change**; demote it and it disappears.

Deliberately **not** filtered on `is_active` or `is_beta` — that is the same class of
bug.

### FIX 2 — surface the real error

`rpc()` now carries the SQLSTATE. `configSaveMessage()` maps it:

| SQLSTATE | shown |
|---|---|
| `23514` (`fn_season_games_assignable`) | the trigger's **own** message, with the uuid swapped for the display name |
| `23503` | same treatment (unknown game id) |
| `55P03` (locked guards) | "This season is locked; configuration is frozen." |
| `42501` / `P0002` | read-only version / not found |
| anything else | raw message, passed through |

**No branch can emit the concurrency message.** It is reachable only from the real
fingerprint check. There is a test asserting exactly that.

### FIX 3 — one transaction

New RPC `season_config_save_bundle(p_config_id, p_config, p_games, p_theme,
p_difficulty, p_scopes)`, migration `20260801160000`. A NULL argument means "leave
that set alone", matching the PATCH semantics the editor already used. Also:

- `SELECT … FOR UPDATE` on the config serializes two commissioners mid-bundle.
- Config columns are re-whitelisted inside the function (the API is the fence) — a
  client cannot promote itself by sending `state`.
- `puzzle_count` is carried across the slate replace. The editor does not send it
  (the generation planner owns it), so a routine save would otherwise null it.
- An **enabled** non-assignable game is passed through on purpose, so the trigger
  raises and names it. Only *disabled* non-assignable rows are dropped silently —
  those are noise from a stale client.

## Deliberately not done

- The trigger and its function are **untouched**. They were right.
- No `lifecycle_state` value changed. The 11 concepts are unbuilt.
- No column added or altered on `season_config` / `season_games`.
- `667c488f` not repaired — it will be completed through the UI.
- **The fingerprint race is unchanged, not closed.** The check still runs in the app
  between reading the bundle and calling the RPC. The window is *narrower* than
  before (the RPC is now one round trip, and takes a row lock), but a concurrent
  write in that gap still slips through. Closing it means reimplementing the FNV
  hash in plpgsql, which invites drift between two implementations of the same
  algorithm. Out of scope here; flagged.

## Verification

`docs/lo-slate-filter/verify-harness.sql` — run it **appended to the migration
body** inside `BEGIN … ROLLBACK`. It ends in `RAISE EXCEPTION` carrying the report,
so the transaction self-aborts even if the surrounding rollback were missed.

Run 2026-08-01 against `ycadmmngkdhvpcsrcuaq`: **9 PASSED / 0 FAILED**, 0 rows
persisted (catalog 18/7-live, `season_games` 28, 0 locked seasons — all unchanged).

| # | assertion |
|---|---|
| T1 | 18 rows sent → **7 written**, 11 named as dropped |
| T2 | zero non-assignable rows in `season_games` |
| T3 | NULL child args leave the mixes alone (7/3) |
| T4 | scalars written; `state` / `version` / `season_id` refused by the whitelist |
| T5 | an **enabled** `new_idea` game raises `23514` with the trigger's own text |
| T6 | **a failed bundle leaves NO partial write** — 7/7/3 all intact |
| T7 | `puzzle_count` survives the slate replace |
| T8 | flipping a game to `in_test` makes it assignable — slate of 8, no code change |
| T9 | a locked season is refused with `55P03` |

Read-path check (separate `BEGIN … ROLLBACK`): the filtered catalog read returns
exactly the 7 live games; `grid_lock → in_test` makes it 8; reverting makes it 7.

Also green: `npm run test:slate-filter` (14) · `test:season-config` (24) ·
`test:game-library` (26) · `test:generation` (17) · `tsc --noEmit` · `npm run build`.

## Deploy order — both steps are Myke gates

1. **Apply migration `20260801160000_season_config_save_bundle.sql` to prod.**
   It carries its own verification gate (18 catalog / 7 live / 28 `season_games`)
   and rolls itself back if the DB is not in that state.
2. **Then merge/deploy the app.** In this order, because `saveConfigDraft` calls the
   RPC — shipping the code first makes every save fail with "function does not
   exist". Applying the migration first is harmless on its own: nothing calls it yet.

Not verifiable in this environment: the rendered UI. The League Office needs
`SUPABASE_SERVICE_ROLE_KEY` and there is no `.env.local` on this machine, so
acceptance #1 was confirmed at the query layer rather than in a browser.
