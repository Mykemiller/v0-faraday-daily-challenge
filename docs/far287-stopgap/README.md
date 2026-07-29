# FAR-287 stopgap — re-date plan for the Airtable Puzzle Bank (PREPARED, NOT APPLIED)

**Status: awaiting Myke's approval. Nothing has been written to Airtable.**

The live bank has no serve-set after **2026-07-31** (verified 2026-07-29 against the
canonical bank `appxfti7VuoHYUeu6` / `tbliJaRmctbIWJC43`: Live = 7 rows @ 07-28,
future Published = 07-29/30/31 only). The FAR-287 generation run cannot fill, validate,
gate-review and sync 3,500 new records before 08-01, so this plan re-dates existing
bank rows to buy runway. Serving code and the AUTO-128 rotator are untouched — the
rotator promotes each re-dated set to `Live` at midnight Chicago on its new day exactly
as it does today.

## Verified inventory (2026-07-29)

| Bucket | Rows | Notes |
|---|---|---|
| Live | 7 | 2026-07-28 set (current serve day) |
| Published, future | 21 | 07-29 / 07-30 / 07-31 — the last runway |
| **Published, stranded** | **49** | **June 14–19 + June 21 sets — past-dated during the June outage, NEVER SHOWN to players.** All full 7-type sets, all `Status=Approved`. The rotator can never promote a past-dated row, so these are dead weight where they sit. |
| Retired | 287 | 41 full 7-type sets, originally served 2026-06-10 → 2026-07-27, all `Approved` |
| Unpublished | 9 | undated drafts — untouched |

Note: the run brief said "345 Retired"; the live count is **287** (+ the 49 stranded
Published). Total reusable full sets = 48 days.

## The plan (Option A — recommended): 14 days, 2026-08-01 → 2026-08-14, 98 rows

- **Week 1 (08-01 → 08-07): the 7 stranded never-shown sets**, in original order
  (06-14→08-01 … 06-19→08-06, 06-21→08-07). These are *brand-new content for every
  player* — zero repeats for the first week. Only `Go Live Date` changes; they are
  already `Published`/`Approved`.
  - ⚠️ Deviation flag: CLAUDE.md records the June 14–19 sets as "accepted; do not
    backfill." This plan does not backfill those June dates — it forward-dates the
    never-seen content. Calling it out explicitly so approval of this plan is also
    approval of that reinterpretation. If you'd rather leave them frozen, use
    Option B below.
- **Week 2 (08-08 → 08-14): the 7 oldest Retired sets** (06-10, 06-11, 06-12, 06-13,
  06-20, 06-22, 06-23 → 08-08…08-14). Repeat content, but the oldest in the bank
  (~8–9 weeks since serve, smallest launch-era audience). Changes per row:
  `Go Live Date` → new date, `Published` → `Published` (option `seljRJZrs4HBwJrtU`).

**Option B (no CLAUDE.md deviation):** all 14 days from the 14 oldest Retired sets
(06-10 → 06-13, 06-20, 06-22 → 06-30) in the same fashion. All repeat content.

Record-level change list (98 rows, one per record id): `redate-plan.csv` /
`redate-plan.json` in this directory. Every new date carries a full 7-type set
(validated). Puzzle Names/Content/Hints untouched.

## Execution (after approval)

Two sanctioned routes — pick one:
1. Myke applies the CSV by hand / via an Airtable grid edit; or
2. Claude applies it via the Airtable MCP `update_records_for_table` in batches,
   **only after an explicit go-ahead** (the standing "never write to Airtable"
   guardrail is lifted only for the exact record ids + fields in this plan).

Idempotent and reversible: `redate-plan.csv` retains each row's original
`Go Live Date` and `Published` value, so the whole change can be rolled back.

## Interactions & follow-ups

- **Rotator:** promote requires `Published` + `Go Live Date = today(Chicago)`; retire
  only touches `Live` rows dated strictly before today. Re-dated rows behave exactly
  like normal scheduled sets. No double-promotion risk.
- **Day-content pages (FAR-287 pages)** sync by serve date and will pick these sets up
  automatically. Live stats are computed fresh; nothing stored goes stale.
- **Generator 90-day non-repeat:** the FAR-287 generator fingerprints the live bank,
  so it will steer new puzzles away from the stopgap rows' subjects. Acceptable.
- **Sync collision:** when the new 500-day set is approved and synced, its 08-01+
  records will collide by (type, date) with the stopgap rows still in the bank. The
  sync plan must either start new content at the first uncovered day or re-retire the
  stopgap rows for the overlapping dates as part of the sync. Flagged for the STEP 4
  gate.
- **Extension capacity:** 34 more Retired full sets remain after this plan → coverage
  extendable through ~2026-09-17 if the generation run slips.
