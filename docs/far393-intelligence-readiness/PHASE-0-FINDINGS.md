# FAR-393 — Phase 0 Investigation Findings

**Reframe Streaks as "Intelligence Readiness" with Real Intelligence Rewards**

Author: Claude (session) · Date: 2026-07-28 · Repo: `v0-faraday-daily-challenge`
Supabase project: `ycadmmngkdhvpcsrcuaq`

> **Status: Phase 0 gate reached. Implementation is BLOCKED pending Myke's
> decisions.** The investigation confirmed the ticket's core premise is sound
> (streaks exist, rewards can be layered) but invalidated **four** of the
> pre-resolved decisions with hard facts from the live database. Per the ticket's
> own guardrails — "if `leaderboard_daily.streak` is not actually the live source
> of truth … stop and report back rather than silently building around a second
> source" — this doc is the report-back. No schema or UI changes were made.

---

## TL;DR — what changed vs. the ticket's assumptions

| # | Ticket assumed | Reality (verified) | Impact |
|---|---|---|---|
| 1 | `leaderboard_daily.streak` is the streak source of truth | **`dc_subscribers.play_streak` (+ `play_streak_last_day`) is the SoT.** `leaderboard_daily.streak` is a denormalized per-day mirror. There is also a second streak (`full_set_streak`). | Triggers the "stop and report back" guardrail. Not a blocker to build — the real SoT already exists — but the reward trigger must read `dc_subscribers`, not `leaderboard_daily`. |
| 2 | Grant via `token_transactions` with `tokens_burned = -1` (negative credit) and `kind = 'streak_grant'` | **Both are rejected by live CHECK constraints.** `CHECK (tokens_burned >= 0)` forbids negatives; `CHECK (kind IN ('unlock','grant','adjustment'))` forbids `streak_grant`. | The recommended grant convention cannot be inserted. Must use `kind='grant'` + positive `tokens_burned` (the existing sanctioned grant shape) or a schema change. |
| 3 | A `token_transactions` insert produces a corresponding `live_agent_token_ledger.balance` increase | **The two are entirely decoupled.** No trigger links them. They are two separate wallets keyed to two different subscriber tables. | Acceptance criterion #2 ("verified by a `token_transactions` row **and** a corresponding `live_agent_token_ledger.balance` increase") is not satisfiable as written — those are different systems. |
| 4 | The streak subject and the token wallet share an identity | **Identity gap.** Streaks live on `dc_subscribers` (11 rows). `token_transactions.subscriber_id` FKs to `subscribers` (**0 rows**, the JW/Stripe side). No mapping exists between them. | A JW-wallet grant to a DC player will **fail the FK** unless an identity bridge is chosen. This is the central architectural decision Phase 0 exists to surface. |

MW-retirement re-verification (decision 5): **still clean.** No new subscriber-facing
MW columns. Confirmed 2026-07-28 (see §7).

---

## 1. Streak computation — source of truth

**Confirmed SoT: `dc_subscribers`, NOT `leaderboard_daily`.**

The live streak state is written by the **`complete-puzzle` edge function**
(`supabase/functions/complete-puzzle/index.ts`), which reads the subscriber's prior
streak and writes back to `dc_subscribers`:

- `play_streak` (int, default 0) — the "played at least one puzzle today" streak.
- `play_streak_last_day` (date) — last day the play streak advanced.
- `full_set_streak` (int, default 0) — the "completed all core types today" streak.
- `full_set_last_day` (date) — last day the full-set streak advanced.

Increment logic (`complete-puzzle/index.ts`):

```
playIncrementingDay = sub.play_streak_last_day !== puzzleDate
playContinues       = sub.play_streak_last_day === yesterday || sub.play_streak === 0
newPlayStreak       = playIncrementingDay ? (playContinues ? sub.play_streak + 1 : 1) : sub.play_streak
```

`leaderboard_daily.streak` (int) is a **denormalized copy**: `/api/score`'s
`upsertLeaderboardDaily()` stamps `completionResult.playStreak` (which originates from
`dc_subscribers.play_streak` via complete-puzzle) onto the daily row. It is a display
convenience, never read back for streak math.

**Read paths for streak today:**
- `/api/subscriber-state` → returns `playStreak` / `fullSetStreak` from `dc_subscribers`.
- `DailyChallenge.jsx` hydrates from that endpoint and renders the streak in the UI.
- `fn_assign_badges(p_play_streak, …)` (recognition-only badges) is fed the new play streak.

**No hidden/competing streak table.** The only other `streak`-named column is the
`leaderboard_daily.streak` mirror above.

**Consequence for the reward layer:** the milestone trigger MUST evaluate
`dc_subscribers.play_streak` server-side (in or immediately after complete-puzzle /
`/api/score`), keyed by `dc_subscribers.id`. Which of `play_streak` vs `full_set_streak`
the reward ladder should key off is a decision — the ticket says "streak," and
`play_streak` (play at least one puzzle/day) is the natural match. **Recommend keying
the ladder off `play_streak`.** (Decision D1 below.)

## 2. Timezone boundary — confirmed `America/Chicago`

The "day" for streak purposes is the **Central calendar date**, computed **server-side**
and never trusted from the client:

- `/api/score/route.ts`: `const DC_TZ = "America/Chicago"; const playDate = centralDate(new Date());`
  where `centralDate` formats via `Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" })`.
- `complete-puzzle/index.ts`: same `DC_TZ = "America/Chicago"` + `centralDate()`; the comment
  is explicit — "the Daily Challenge day resets at midnight America/Chicago, NOT UTC … so
  streaks line up with the board."
- `puzzleDate` passed into streak math is this server-computed Central date; `yesterday =
  previousDay(puzzleDate)`.

**Reset rule** therefore is: a streak breaks when a Central calendar day passes with no
completion (i.e. on the next completion, `play_streak_last_day !== yesterday` and
`play_streak !== 0` → resets to 1). This matches the ticket's intended "resets to 0 on any
day with no puzzle." Note the existing code lazily resets *on next play* (it recomputes from
`*_last_day`); it does not proactively zero a subscriber at midnight. Any UI that displays
"current streak" for an idle user should compute freshness against `*_last_day` the same way,
or it will show a stale non-zero streak until the user next plays. (Decision-adjacent note,
not a blocker.)

> ⚠️ Minor inconsistency worth noting: the **hint budget** (FAR-198) keys its localStorage
> day off a **UTC** slice (`faraday_hints_${TODAY}` where TODAY is a UTC date), while
> **scoring/streaks use Central**. Not in scope for FAR-393, but flagged so no one wires the
> readiness display to the hint day key by accident.

## 3. `token_transactions` write-path — unused in prod, but constrained

**Row count re-check 2026-07-28: `token_transactions` = 0 rows.** Confirmed still empty at
build time (ticket Phase 0 item 3). It is a safe integration point in the sense that nothing
depends on its contents yet — **but it is not schema-unconstrained**:

- `CHECK (tokens_burned >= 0)` — `token_transactions_tokens_burned_check`. **Negative values
  are rejected.** The ticket's "`tokens_burned = -1` as a credit" convention **cannot be
  inserted.**
- `CHECK (kind IN ('unlock','grant','adjustment'))` — `token_transactions_kind_check`.
  **`kind = 'streak_grant'` is rejected.** The existing grant vocabulary is `'grant'`.
- `FOREIGN KEY (subscriber_id) REFERENCES subscribers(id)` — see §4/§5 (identity gap).
- Other columns: `product_key text`, `ref_id uuid`, `jurisdiction_id uuid → jurisdictions`,
  `unlocked_until timestamptz`, `created_at`, `id uuid pk`.

**How balance is actually derived (the general/JW wallet):** there is **no stored balance**
for this wallet. `wallet_token_balance(p_sub)` computes it on read:

```
watchlist allowance (jw_watchlists, trialing/active)
  + SUM(tokens_burned) WHERE kind='grant'
  - SUM(tokens_burned) WHERE kind='unlock'
```

So the schema's design is **positive `tokens_burned` + `kind` determines sign** — a grant is
`kind='grant'` with a positive amount; a spend is `kind='unlock'` with a positive amount. The
negative-credit idea is contrary to the existing model and DB-blocked.

**Existing sanctioned grant paths already exist** (we do not need to invent one):
- `jw_grant_tokens(p_sub, p_blocks)` → inserts `kind='grant'`, `tokens_burned = blocks*100`.
- `wallet_record_grant(p_event_id, p_type, p_sub, p_tokens)` → idempotent by `stripe_events.id`,
  inserts `kind='grant'`, positive `p_tokens`. **This idempotent-by-event-id shape is the
  right model to imitate** for "one grant per subscriber per threshold."
- Spend paths: `wallet_burn(p_sub, p_product_key, p_ref_id, p_window)` (product-meter priced,
  `unlocked_until` window) and `jw_unlock_jurisdiction(p_sub, p_jur)`.

## 4. `live_agent_token_ledger` vs `token_transactions` — two decoupled wallets

**They are NOT related. No trigger links them. They serve different products and different
identity tables.** (Ticket Phase 0 item 4 — answered from code, not inference.)

**Wallet A — `live_agent_token_ledger` (the Daily-Challenge-player wallet):**
- Columns: `subscriber_id uuid PK`, `tier text → live_agent_plan`, `balance int` (**stored**),
  `cycle_month date`, `updated_at`.
- `balance` is mutated **directly** by `live_agent_debit(p_subscriber, …)` (SECURITY DEFINER
  RPC): monthly reset to the plan grant, decrement per answered Live-Agent question, idempotent
  by `request_id`. **Nothing in `token_transactions` touches it.**
- `subscriber_id` is a **bare uuid PK with no FK**, and in practice it is a **`dc_subscribers.id`**:
  `/api/live-agent` resolves the caller via `dc_sessions.token → subscriber_id` (= `dc_subscribers.id`)
  and passes that as `p_subscriber`. **This is the wallet a DC player actually owns.**

**Wallet B — `token_transactions` (the JW / storefront wallet):**
- Balance is **derived on read** via `wallet_token_balance` / `jw_token_balance` (no stored
  balance column).
- `subscriber_id` FKs to **`subscribers`** — the Beehiiv/Stripe subscriber table, **currently
  0 rows** — NOT `dc_subscribers`.
- This is the wallet that gates **Jurisdiction Watch unlocks** (`jw_unlock_jurisdiction`) and
  storefront product unlocks (`wallet_burn` against `product_meters`).

**The collision:** the ticket's reward is a **"Jurisdiction Watch unlock token"** (Wallet B),
but the streak subject is a **DC player** who exists only in `dc_subscribers` and owns
**Wallet A**. Wallet B is keyed to `subscribers` (empty), and a DC player has no `subscribers`
row. **You cannot currently grant a JW token to a DC player** without first deciding how the
two identities bridge.

Acceptance criterion #2 as written ("a `token_transactions` row **and** a corresponding
`live_agent_token_ledger.balance` increase") mixes the two wallets and is **not satisfiable** —
a `token_transactions` insert does not, and should not, move `live_agent_token_ledger.balance`.

## 5. Identity gap — the central blocker

```
dc_subscribers (11 rows)              subscribers (0 rows)
  id ── streaks, handle, tier           id ◄── token_transactions.subscriber_id (FK)
  │                                      └── beehiiv_subscriber_id, stripe_customer_id
  └── live_agent_token_ledger.subscriber_id (no FK, by convention = dc_subscribers.id)
```

- `dc_subscribers` — Daily Challenge players. Holds streaks, handle, tier, `active`. 11 rows.
- `subscribers` — storefront/JW/Stripe identity. Holds `beehiiv_subscriber_id`,
  `stripe_customer_id`. **0 rows.** This is what `token_transactions` points at.
- **No column links a `dc_subscribers` row to a `subscribers` row** (no shared id, no FK, no
  join column verified in either schema). They can share an `email` in principle, but no
  integrity constraint or code path currently reconciles them.

This must be resolved before any JW-token streak grant can be written.

## 6. Where brief access (10-day tier) is gated — no existing hook

The 10-day reward is "access to the Friday **Mach Eigen** forward-projection brief."
**No such gated asset exists in code or schema.** "Mach Eigen" / "Friday brief" /
"forward-projection" appear only in **editorial/marketing copy** (`who-is-faraday`,
`FARADAY-FINDINGS.md`, launch-backlog README) — there is no product, table, or unlock path
for it.

The closest existing brief-gating primitive is the storefront meter model:
`product_meters` has `briefing` (cost 5) and `briefing_library` (cost 10), spent via
`wallet_burn(..., unlocked_until)` — i.e. a **time-boxed unlock window** on **Wallet B**
(again keyed to `subscribers`). There is no per-week "this Friday's brief" record to grant
against.

**Consequence:** the 10-day tier has **no build target**. It needs either (a) a real
"weekly brief" asset + access model to be defined, or (b) descoping to a token grant like the
5-day tier, or (c) deferral. (Decision D4 below.)

## 7. MW-retirement re-verification (decision 5) — clean

Re-ran the live column scan 2026-07-28. Only `mw`-suffixed columns remaining:
`jds_scores.l1_mw_total / l2_mw_total / l3_mw_total` and
`stg_airtable_companies.mw_total_airtable` — all **megawatt capacity** figures on the
intelligence/company side, unrelated to any gamified points system. No subscriber-facing
`mw_total` / `mw_balance` / `my_mw` / `mw_earned`. No conflict with layering token rewards.

---

## Decisions needed from Myke before Phase 1 build

**D1 — Which streak drives the ladder?** Recommend **`dc_subscribers.play_streak`** (one
puzzle/day). `full_set_streak` is stricter and rarer. Reward trigger reads this column
server-side.

**D2 — Which wallet receives the reward, and how is identity bridged?** Three options:

- **D2-a (recommended, lowest friction): grant into Wallet A (`live_agent_token_ledger`),
  keyed to `dc_subscribers.id`.** This is the wallet the DC player already owns. It needs a
  new grant primitive (the ledger has no grant RPC today — only `live_agent_debit`), and its
  monthly-reset semantics mean a granted balance may not roll over. Cleanest identity story
  (no bridge needed) but the granted "token" would be a **Live-Agent** credit, not a JW unlock
  token — i.e. **the reward currency changes** from what the ticket names.
- **D2-b: keep the reward as a JW/`token_transactions` grant, and build a `dc_subscribers ↔
  subscribers` bridge** (backfill/upsert a `subscribers` row per DC player, add a link column,
  agree the FK direction). Matches the ticket's "JW unlock token" wording but is a materially
  larger change touching the JW identity model — out of the ticket's stated "don't touch
  beyond token_transactions / ledger writes" guardrail.
- **D2-c: introduce a purpose-built `streak_grants` / additive-`amount` path** decoupled from
  both wallets, and reconcile at redemption. Most explicit, most new surface.

**D3 — Grant convention (given D2).** If we write to `token_transactions` at all: use
`kind='grant'` + **positive** `tokens_burned` (NOT the `-1` / `streak_grant` convention, both
DB-blocked). If a distinct audit label is required, either (i) add `'streak_grant'` to the
`kind` CHECK via migration, or (ii) tag via `product_key='streak_grant'` and keep `kind='grant'`.
Recommend (ii) — no CHECK migration, still auditable, `ref_id` = the milestone date/row.

**D4 — 10-day brief tier.** No gated "Friday brief" asset exists. Recommend **descope the
10-day tier to a second token grant (or a larger token grant) for launch**, and file a
follow-up to define a real weekly-brief access model. Do not invent a brief-unlock table under
this ticket.

**D5 — Acceptance-criteria correction.** AC#2's "`token_transactions` row AND
`live_agent_token_ledger.balance` increase" conflates two wallets and can't both be true.
Whichever wallet D2 selects, AC#2 should assert against that **one** wallet.

## What is unblocked regardless (safe to build once D1–D5 land)

- **The 3-day cosmetic tier** — display-only, no wallet write. Safe.
- **The "Intelligence Readiness" rename** — client copy/iconography swap across
  `DailyChallenge.jsx`, `SiteHeaderNav.tsx`, account surfaces, stubs. Safe (coordinate with
  FAR-394/395 palette per ticket, don't block on them).
- **Server-side milestone evaluation against `dc_subscribers.play_streak`** — reading the SoT
  is safe; only the *grant write* is gated on D2.
- **Abuse caps** — modeled on `wallet_record_grant`'s idempotent-by-event-id pattern (one row
  per subscriber/threshold/window), enforced server-side against prior grant rows.
- **No-backfill rule** — grants fire only from ship date forward; do not reward pre-ship
  streaks. (Implementation: record a per-subscriber "readiness feature start" marker or gate on
  grant-row absence + a ship-date floor.)

## Verification commands used (all read-only)

- Streak SoT: grep of `complete-puzzle/index.ts`, `/api/score/route.ts`, `/api/subscriber-state/route.ts`.
- Row counts + constraints + function defs: `mcp__Supabase__execute_sql` against
  `information_schema`, `pg_constraint`, `pg_proc`, `pg_trigger` on `ycadmmngkdhvpcsrcuaq`.
- Wallet keying: grep of `/api/live-agent/route.ts` (`dc_sessions → subscriber_id → live_agent_debit`).

No schema changes, no UI changes, no writes were made in Phase 0.
