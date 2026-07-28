# FAR-393 — Phase 0 investigation findings

**Reframe streaks as "Intelligence Readiness" with real intelligence rewards.**

Status: Phase 0 gate. This document is the required deliverable of Phase 0 item 5
("write findings to a committed doc before writing any implementation code"). It
records what the live schema actually is, and where it **diverges from the
assumptions baked into the ticket**. Read the "Bottom line" first.

Investigated live against Supabase project `ycadmmngkdhvpcsrcuaq` on 2026-07-28
(read-only). Everything below is confirmed **in code / in the live schema**, not
inferred.

---

## Bottom line (what changed vs. the ticket)

1. **The streak source of truth is `dc_subscribers.play_streak`, NOT
   `leaderboard_daily.streak`.** `leaderboard_daily.streak` is a write-only
   *mirror*. The ticket's Phase 0 item 1 named the wrong column. Per the ticket's
   own guardrail ("Do not build a new streak table unless Phase 0 reveals
   `leaderboard_daily.streak` is not actually the live source of truth — if so,
   stop and report back"): **no new streak table is needed** — the real SoT
   (`dc_subscribers.play_streak`) already exists and is authoritative. Build the
   reward layer on top of `dc_subscribers`, not `leaderboard_daily`.

2. **The reward-grant integration described in the ticket is not implementable as
   specified.** `token_transactions` and `live_agent_token_ledger` are **two
   unrelated token economies** (Jurisdiction Watch vs. Live Agent), with no
   trigger or code path linking them. `token_transactions` is FK'd to the
   `subscribers` table — which is **empty (0 rows)** and shares **zero ids and
   zero emails** with `dc_subscribers` (the table that owns Daily Challenge
   streaks). Two DB CHECK constraints also directly reject the ticket's proposed
   `tokens_burned = -1` and `kind = 'streak_grant'` conventions. See
   "Reward-path blockers" — this half is a **stop-and-report**, exactly the case
   the ticket anticipates.

3. **The rename half ("Intelligence Readiness") is clean and unblocked** — it is
   display copy only, with no schema/identity dependency, and is shipped in this
   branch. It fully satisfies acceptance criterion 1.

---

## 1. Streak source of truth — CONFIRMED (with correction)

**Authoritative store: `dc_subscribers`.** Columns (live):

| column | type | default |
|---|---|---|
| `play_streak` | integer | 0 |
| `play_streak_last_day` | date | null |
| `full_set_streak` | integer | 0 |
| `full_set_last_day` | date | null |

**Where it's written:** the `complete-puzzle` edge function
(`supabase/functions/complete-puzzle/index.ts`) — the *only* writer. On each
completion it recomputes and writes `play_streak` / `play_streak_last_day` (and
the full-set variants). Excerpt:

```ts
const playIncrementingDay = sub.play_streak_last_day !== puzzleDate;
const playContinues = sub.play_streak_last_day === yesterday || sub.play_streak === 0;
const newPlayStreak = playIncrementingDay
  ? (playContinues ? sub.play_streak + 1 : 1)
  : sub.play_streak;
```

**Where it's read (all read the same authoritative column):**
- `/api/subscriber-state` → `select ... play_streak ...` → returns `playStreak`.
  This is what the app hydrates on load.
- `/api/challenge/answers` → reads `play_streak` for the "you're on an N-day
  streak" nudge.
- `DailyChallenge.jsx` → `setStreak(data.playStreak || 0)`; the in-session
  counter is optimistic and reconciled from the server `playStreak`.

**`leaderboard_daily.streak` is a mirror, not the SoT.** `/api/score`
(`upsertLeaderboardDaily`) writes `leaderboard_daily.streak` from the
`complete-puzzle` response (`completionResult.playStreak`). Nothing reads
`leaderboard_daily.streak` back as authority. It exists for the daily aggregate
row only.

**No hidden/duplicate streak table.** The only other streak-named columns are
`dc_subscribers.full_set_streak` (a *distinct* streak — completing all 4 core
puzzle types in a day) and the `leaderboard_daily.streak` mirror. No conflict.

> **Decision:** reward logic keys on `dc_subscribers.id` + `play_streak` /
> `play_streak_last_day`. `full_set_streak` is out of scope (the ticket's ladder
> is about the daily *play* streak).

---

## 2. Timezone anchor — CONFIRMED: America/Chicago (Central), lazy reset

The Daily Challenge "day" is the **America/Chicago calendar date**, not UTC.
`complete-puzzle` stamps `puzzle_date` via:

```ts
const DC_TZ = "America/Chicago";
function centralDate(d) { return Intl.DateTimeFormat("en-CA",{timeZone:DC_TZ,...}).format(d); }
const puzzleDate = centralDate(new Date());
```

Streak continuation compares against `previousDay(puzzleDate)`, which does string
date math on the Central date (DST-safe — a day is treated as a calendar step,
not a 24h subtraction). So:

- **Increment:** first completion on a new Central day where
  `play_streak_last_day === yesterday` → `play_streak + 1`.
- **Reset:** first completion on a new Central day where `play_streak_last_day`
  is **not** yesterday (a gap) → `play_streak = 1`.

> **Important nuance for reward logic — reset is LAZY, not scheduled.** There is
> **no cron** that zeroes stale streaks at midnight. If a subscriber misses a
> day, `dc_subscribers.play_streak` keeps its stale value until their *next*
> completion recomputes it. Therefore any reward evaluator that reads
> `play_streak` **must also check `play_streak_last_day`** and treat the streak
> as "current" only when `play_streak_last_day` is today (Central). Reading
> `play_streak` alone would reward a stale streak from days ago. The safe place
> to evaluate a grant is **inside/just after `complete-puzzle`**, where
> `newPlayStreak` is the freshly-computed, definitely-current value.

---

## 3. Wallet write paths — CONFIRMED: two separate token systems

### 3a. `token_transactions` = Jurisdiction Watch tokens (NOT a generic wallet)

Row count at build time: **0** (re-confirmed 2026-07-28 — matches the ticket's
2026-07-28 check). But it is **not** a blank generic ledger. Live schema:

| column | type | notes |
|---|---|---|
| `id` | uuid | PK |
| `subscriber_id` | uuid | **FK → `subscribers(id)`** |
| `jurisdiction_id` | uuid | FK → `jurisdictions(id)`, nullable |
| `tokens_burned` | integer | **CHECK `tokens_burned >= 0`** |
| `kind` | text | **CHECK `kind IN ('unlock','grant','adjustment')`**, default `'unlock'` |
| `unlocked_until` | timestamptz | 30-day unlock window |
| `product_key` | text | nullable |
| `ref_id` | uuid | nullable, no FK |

Balance is **computed**, not stored — `jw_token_balance(p_sub)`:

```sql
allowance (from jw_watchlists)
  + sum(tokens_burned) where kind='grant'
  - sum(tokens_burned) where kind='unlock'
```

Grants are made by `jw_grant_tokens(p_sub, p_blocks)` → inserts
`kind='grant'`, `tokens_burned = p_blocks*100` (**positive**). Spends go through
`jw_unlock_jurisdiction()` → `kind='unlock'`. **Sign is encoded by `kind`, never
by a negative `tokens_burned`.**

### 3b. `live_agent_token_ledger` = Live Agent tokens (a stored balance)

| column | type | notes |
|---|---|---|
| `subscriber_id` | uuid | PK |
| `tier` | text | FK → `live_agent_plan(tier)` |
| `balance` | integer | **stored** balance |
| `cycle_month` | date | monthly reset |
| `updated_at` | timestamptz | |

`balance` is mutated **only** by `live_agent_debit()` (the Live Agent Q&A spend
RPC). It resets monthly to the plan grant.

### 3c. Relationship between them — CONFIRMED: NONE

- **No triggers** on `token_transactions` or `live_agent_token_ledger` (checked
  `information_schema.triggers` — empty for both).
- `live_agent_token_ledger.balance` is **never** derived from
  `token_transactions`. A `token_transactions` insert does **not** move
  `live_agent_token_ledger.balance`.
- They are keyed to different products (JW vs Live Agent) and, critically,
  different identity spaces (`subscribers` vs whatever the Live Agent uses).

> This directly answers ticket Phase 0 item 4: the ledger `balance` is **not**
> maintained by a trigger reacting to `token_transactions`. Do **not** write to
> both "to be safe" — they are unrelated, and writing to `token_transactions`
> has no effect on the Live Agent ledger.

---

## 4. Reward-path blockers (why the grant half is stop-and-report)

The ticket's Decision 3 recommendation, and acceptance criterion 2 ("a
`token_transactions` row **and** a corresponding `live_agent_token_ledger.balance`
increase"), cannot be satisfied as written. Four concrete blockers:

- **B1 — `tokens_burned = -1` is rejected by DB.** CHECK
  `token_transactions_tokens_burned_check (tokens_burned >= 0)`. The ticket
  anticipated this ("do NOT force this convention — surface the conflict"). The
  correct grant convention here is `kind='grant'` with a **positive**
  `tokens_burned` (what `jw_grant_tokens` already does).

- **B2 — `kind = 'streak_grant'` is rejected by DB.** CHECK
  `token_transactions_kind_check (kind IN ('unlock','grant','adjustment'))`.
  Even if we added the value, `jw_token_balance` only sums `kind='grant'`, so a
  `streak_grant` row would grant a token that never appears in the balance. To
  make a granted JW token spendable it must be `kind='grant'`; distinguish
  streak grants via `product_key` (e.g. `'streak_5day'`) and `ref_id` for the
  cap query — not via a new `kind`.

- **B3 — Identity mismatch (the hard blocker).** `token_transactions.subscriber_id`
  FKs to **`subscribers`**, which has **0 rows** and is **disjoint** from
  `dc_subscribers` (11 rows; 0 shared ids, 0 shared emails). Daily Challenge
  streaks live on `dc_subscribers`. So a streak grant for a DC player **cannot be
  inserted** without new plumbing: either (a) provision/bridge a `subscribers`
  row per DC player and define the identity link, or (b) re-point/extend the FK.
  Both go **beyond** the ticket's authorized surface ("table structure beyond
  `token_transactions` / `live_agent_token_ledger` writes and (if needed) a
  `kind` enum addition"). This is precisely a stop-and-report.

- **B4 — No brief-access gating exists for the 10-day reward.** "Mach Eigen" is a
  **fictional byline persona** (Faraday's colleague; see
  `src/app/who-is-faraday/page.tsx` and the launch-backlog "Market Laggard"
  byline), not a product or table. Brief-ish tables exist (`two_analyst_briefs`,
  `jw_briefings`, `briefing_links`) but **none** gate per-subscriber access for
  `dc_subscribers`, and there is no "Friday forward-projection brief" object to
  unlock. The 10-day tier has no wiring target today.

---

## 5. Recommended resolution (for Myke's review)

**Ship now (this branch), unblocked:**
- The full **Intelligence Readiness** rename (display copy only) — satisfies AC 1.
- The **3-day tier** ("Readiness: Building") — the ticket defines it as
  client-side display only, **no wallet write**. Safe to build with the rename.

**Hold for a decision (do not silently build):** the 5-day and 10-day grants.
Recommended path once Myke picks a lane:

- **5-day → JW token grant, done right:** grant inside `complete-puzzle` when
  `newPlayStreak === 5` and `play_streak_last_day` is today, by inserting
  `token_transactions(kind='grant', tokens_burned=<positive>, product_key='streak_5day',
  ref_id=<audit>)` — **after** resolving B3 (the DC→`subscribers` identity
  bridge). Cap: reject if a `kind='grant' AND product_key='streak_5day'` row
  exists for that subscriber in the last 30 days (server-side, pre-insert).
  This makes `jw_token_balance` reflect the grant. It does **not** touch
  `live_agent_token_ledger` — so AC 2's "ledger balance increase" clause should
  be **corrected** to "`jw_token_balance` increase" (or the reward retargeted to
  the Live Agent ledger instead — Myke's call).

- **10-day → deferred** until a brief-access model for `dc_subscribers` exists,
  or repointed to a concrete unlock (e.g. a Live Agent token bundle) if Myke
  wants a shippable reward now.

**Identity-bridge options for B3 (Myke to choose):**
1. Backfill a `subscribers` row per active `dc_subscribers` (shared email or a
   link column), then grant against it. Highest fidelity to the JW model; most
   plumbing.
2. Add a nullable `dc_subscriber_id` to `token_transactions` + relax the FK, and
   grant DC rewards against `dc_subscribers` directly. Least plumbing; forks the
   identity model.
3. New additive `token_grants` table keyed to `dc_subscribers` for DC rewards
   only, kept separate from the JW ledger. Cleanest separation; a second ledger
   to reason about.

---

## Baseline security advisors (pre-change, for the AC 2 "no new RLS gaps" check)

Captured 2026-07-28 so any future schema change can be diffed against it:

| level | name | count |
|---|---|---|
| ERROR | rls_disabled_in_public | 1 |
| ERROR | security_definer_view | 6 |
| WARN | anon_security_definer_function_executable | 75 |
| WARN | authenticated_security_definer_function_executable | 77 |
| WARN | function_search_path_mutable | 54 |
| WARN | extension_in_public | 7 |
| WARN | materialized_view_in_api | 2 |
| INFO | rls_enabled_no_policy | 125 |

The rename half changes no schema, so it introduces no advisor delta. Re-run
`get_advisors(security)` after any grant-path DDL and confirm these counts do not
grow.

---

## Phase 1 — build (per Myke's 2026-07-28 decisions)

Myke reviewed the blockers and decided:
- **5-day reward → a generic "Faraday Token" usable at any Faraday storefront** (not
  the JW token, not literally a Live Agent token — a new cross-storefront currency).
- **10-day reward → deferred** (no DC brief-access model exists; "Mach Eigen" is a
  byline persona, not a product).
- **3-day tier → display-only** ("Readiness: Building"), no wallet write (unchanged
  from the ticket).

### What was built (this branch)
- **`supabase/migrations/20260728000002_faraday_token_wallet.sql`** (additive,
  reversible, **un-applied — apply at promotion**): the generic Faraday Token wallet,
  keyed to `dc_subscribers.id` (the identity behind every `dc_session`, so it sidesteps
  blocker B3 entirely — no `subscribers` bridge needed).
  - `faraday_token_ledger` (per-subscriber balance; earned, no monthly reset).
  - `faraday_token_transactions` (append-only audit; `delta`>0 credit / <0 spend;
    `kind IN ('streak_grant','spend','adjustment')`; unique `(subscriber_id, ref_id)`
    for idempotency). **Note:** this is a *new* table, deliberately NOT the JW
    `token_transactions` — so blockers B1/B2 (that table's `tokens_burned>=0` and
    `kind` CHECKs) do not apply here.
  - `faraday_token_grant_streak(p_subscriber, p_streak, p_play_date, p_amount=1)` —
    SECURITY DEFINER, the financial guard: re-reads `dc_subscribers.play_streak` +
    `play_streak_last_day` (rejects a stale or client-faked streak), idempotent
    (`ref_id`), and **30-day capped** for the 5-day milestone. Only the 5-day tier
    grants today; other values return `no_milestone`.
  - `faraday_token_balance(p_subscriber)` read helper. RLS deny-all / service-role only.
- **`complete-puzzle` edge fn:** on a **fresh** `newPlayStreak === 5`, calls
  `faraday_token_grant_streak` (fail-soft — a grant error never fails the completion).
  Returns `readinessReward` in the response.
- **`/api/score`:** forwards `readinessReward` to the client.
- **`DailyChallenge.jsx`:** `readinessTier()` renders the display-only tier label
  ("Readiness: Building" at 3, "Established" at 5, "Peak" at 10 — breakpoints match the
  reward ladder; no new tiers invented).

### Gated promotion steps (NOT done here — Supabase MCP was disconnected this session)
1. Apply `20260728000002_faraday_token_wallet.sql` to `ycadmmngkdhvpcsrcuaq`.
2. Deploy the updated `complete-puzzle` edge fn (**after** step 1 — it calls the RPC).
3. Run `get_advisors(security)` and diff against the baseline table above — confirm no
   new RLS gaps (the two new tables carry the intended `rls_enabled_no_policy` INFO
   deny-all posture; service role bypasses RLS).
4. End-to-end validation: drive a subscriber to a fresh 5-day streak → confirm one
   `faraday_token_transactions` (`kind='streak_grant'`) row + a `faraday_token_ledger`
   balance increase; re-trigger within 30 days → `capped` (no duplicate).

### Explicit follow-ons (out of FAR-393 scope)
- **Cross-storefront redemption (spend):** the schema is spend-ready (negative `delta`,
  `kind='spend'`, `product_key`) but no redeem RPC / storefront integration exists yet.
- **Win-screen "token earned" celebration:** `readinessReward` is plumbed to the client;
  a richer earned-token UI (beyond the tier label) is a small follow-on, kept minimal
  here out of FAR-46 caution (do not publish meter/balance values).
- **AC wording:** acceptance criterion 2's "`live_agent_token_ledger.balance` increase"
  is superseded — the grant lands in `faraday_token_ledger` (the generic wallet), per
  Myke's decision. Verify against that table.

---

## Retired MW points — re-confirmed clean

No subscriber-facing `mw_total` / `mw_balance` / `my_mw` columns. The MW currency
was fully retired (see CLAUDE.md "Teams reconciled · MW retired"). No conflict
with layering token rewards.
