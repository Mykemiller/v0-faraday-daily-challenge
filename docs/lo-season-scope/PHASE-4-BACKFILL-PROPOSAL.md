# Phase 4 — `Hot summer Final Beta` scope backfill: PROPOSAL ONLY

**Status: NOT APPLIED. Awaiting Myke's decision.**
**Recommendation: apply nothing. Set the scope forward from the UI instead.**

`Hot summer Final Beta` (`7cca7cad-0b42-4c48-a1c3-a619aa73e8fa`) is the **active** season.
Changing its scope re-ranks the leaderboard the commissioner is looking at right now.

Everything below is computed against live data on 2026-08-03 via
`fn_season_scope_preview` / `fn_season_scope_resolve`. Nothing was written.

---

## What the audit row records

`season.create`, 2026-07-31 03:09:27, reason "Test 2":

```json
{"mode": "leagues",
 "refIds": ["6346a188-64e4-483f-a9c7-979627ccbd39"],
 "excludeIds": ["7d98b18f-0d35-4208-a7d5-9ec64f51c6a7",
                "210b0bc3-048e-41b0-a0c7-986ea53d0662",
                "f5741976-52b8-4e1b-b561-cf050c668e0f"]}
```

## The three exclusions, resolved

All three are **teams**. None is a league, which is what they were stored as.

| id | Name today | Name on 2026-07-31 | Status today |
|---|---|---|---|
| `7d98b18f…` | Lonely hearts | Lonely hearts | **archived** 2026-08-02, reason "demo team" |
| `210b0bc3…` | Deloitte (`DELOITTE-2026`) | Deloitte | active · 3 members · **670 pts, rank 3** |
| `f5741976…` | Strategy & Growth | **`Team_PE`** | active · renamed 2026-08-03 14:41 |

## Candidate interpretations of the include

| | Interpretation | Teams in scope | On the board | Teams dropped from the live board |
|---|---|---|---|---|
| **a** | Whole platform − the three | 7 | 6 | Deloitte (670), Strategy & Growth (0) |
| **b** | `DELOITTE-2026` league − the three | 5 | 4 | Deloitte (670), Independent players (0), Strategy & Growth (0), Team_Sheba (0) |
| **c** | `DELOITTE` conference − the three | 5 | 4 | *identical to (b)* |

**(b) and (c) resolve to byte-identical team sets** — every team in the `DELOITTE-2026`
league is currently in its `DELOITTE` conference, so the distinction is unobservable
today. It would stop being unobservable the moment a second conference is added to that
league.

### Live board, for reference

| Rank | Team | Members | Score |
|---|---|---|---|
| 1 | Cloud and Platforms | 3 | 1578 |
| 2 | Cloud Platform Team 2 | 1 | 908 |
| 3 | **Deloitte** | 3 | **670** |
| 4 | Grid Champions | 1 | 670 |
| 5 | Independent players | 2 | 0 |
| 6 | M&A - PE | 1 | 0 |
| 7 | **Strategy & Growth** | 1 | 0 |
| 8 | Team_Sheba | 1 | 0 |

---

## Why I recommend applying none of them

### 1. The entity graph the commissioner was picking from is substantially gone

Four of the eight teams on today's board **did not exist on 2026-07-31**:
`Independent players` (created 08-02), `Grid Champions`, `Cloud Platform Team 2` and
`M&A - PE` (all created 08-03). A rule set authored on 07-31 has no opinion about them —
yet interpretations (b)/(c) silently *include* three of them and *exclude* the fourth,
purely as a side effect of conference assignments made on 08-02 and 08-03.

`Strategy & Growth` moved league entirely: it was in **INDEPENDENT / GENERAL** on 07-31
and was moved to **DELOITTE-2026 / DELOITTE** on 2026-08-02 03:41. So under (b)/(c) it is
in-scope-then-excluded today, but on 07-31 it would have been out of scope before the
exclusion ever applied.

### 2. All three interpretations exclude a live, actively-playing team

Every candidate drops `Deloitte` — rank 3, 670 points, and **3 members including
`clobdell@deloitte.com`, who joined at 16:59 today**. Removing a real player's team from
the board mid-season, on the strength of a reconstructed intent, is not a reversible
inconvenience.

### 3. "Deloitte-only, except Deloitte" is self-contradictory

Interpretations (b)/(c) read as *scope the season to the Deloitte league, then exclude the
Deloitte team*. That is not a coherent instruction, which is strong evidence the recorded
ids do not mean what a naive reading says.

The likeliest explanation: on 07-31 there were **two entities named Deloitte** — the demo
`DELOITTE` company team and the real `DELOITTE-2026` franchise — and the picker, which at
that time listed `teams WHERE parent_id IS NULL` under the label "leagues", showed both
identically. Part B then ran `delete from public.teams where code='DELOITTE'`, the only
team deletion in that migration, which makes the deleted demo `DELOITTE` team the most
probable identity of the unresolvable include `6346a188-…`.

If that is right, the intent was "the Deloitte **company**, minus these three sub-teams",
authored against a hierarchy that no longer exists — and the exclusion of `210b0bc3` was
probably aimed at a *different* Deloitte than the one it now names. I cannot confirm this:
the row was hard-deleted and `lo_audit_log` has no record of it.

### 4. The reason string is "Test 2"

The season was created as a test. The scope was very likely exploratory rather than
considered.

---

## What I propose instead

**Leave `Hot summer Final Beta` on its platform scope.** It is what the season has been
running under since 2026-08-01, it is what every standing on the board reflects, and it is
not wrong — merely not what someone may have intended on 07-31.

If the season *should* be Deloitte-only, set it forward from the League Office UI once
Phase 3 is deployed. That path gives what a backfill cannot:

- the live preview naming every team that will be in scope, before committing;
- the active-season confirm naming every team entering and leaving;
- a commissioner-authored reason in `lo_audit_log`, instead of my guess.

The whole point of this work is that a scope change is a deliberate, audited act. Applying
a reconstructed one by migration would be the first violation of it.

---

## If you want one applied anyway

Say which letter and I will run it through `lo_set_season_scope` — not a raw migration —
so it lands with a real audit row and the active-season warning. My order of preference is
**(a)**, then **(c)**, then **(b)**:

- **(a)** touches least: it keeps every team that is playing, and honours only the
  exclusions, which are the one part of the payload that resolves unambiguously.
- **(c)** over **(b)** because if the intent was organisational, the conference is the
  entity that actually models "the Deloitte org" — and the two are indistinguishable today
  anyway, so (c) costs nothing and is more precise later.

Exact payloads, ready to run:

```sql
-- (a) whole platform minus the three
select lo_set_season_scope(
  '7cca7cad-0b42-4c48-a1c3-a619aa73e8fa',
  '[{"scope_type":"platform","scope_ref_id":null,"is_excluded":false},
    {"scope_type":"team","scope_ref_id":"7d98b18f-0d35-4208-a7d5-9ec64f51c6a7","is_excluded":true},
    {"scope_type":"team","scope_ref_id":"210b0bc3-048e-41b0-a0c7-986ea53d0662","is_excluded":true},
    {"scope_type":"team","scope_ref_id":"f5741976-52b8-4e1b-b561-cf050c668e0f","is_excluded":true}]'::jsonb,
  '<your email>', '<your reason>');

-- (c) DELOITTE conference minus the three
select lo_set_season_scope(
  '7cca7cad-0b42-4c48-a1c3-a619aa73e8fa',
  '[{"scope_type":"conference","scope_ref_id":"d931ccd8-0bd8-43c1-9635-ccdf2532f72d","is_excluded":false},
    {"scope_type":"team","scope_ref_id":"7d98b18f-0d35-4208-a7d5-9ec64f51c6a7","is_excluded":true},
    {"scope_type":"team","scope_ref_id":"210b0bc3-048e-41b0-a0c7-986ea53d0662","is_excluded":true},
    {"scope_type":"team","scope_ref_id":"f5741976-52b8-4e1b-b561-cf050c668e0f","is_excluded":true}]'::jsonb,
  '<your email>', '<your reason>');
```

Both are accepted by the validation trigger: `Lonely hearts` is archived, but it appears
only as an *exclusion*, which the narrowed D8 permits.
