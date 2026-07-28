# FAR-387 — Plain-Language Domain Naming: Verification Report

**Date:** 2026-07-28
**Ticket:** FAR-387 (Launch Weekend backlog 1 of 10, effort-s)
**Outcome:** Verification pass. **Zero live subscriber-facing D-code / T-code leaks
found.** The one historical leak the ticket hypothesized was already fixed and
merged (PR #98). No new copy fixes were required; the changes in this PR harden
and document the existing enforcement.

---

## TL;DR

- **Full Puzzle Bank sweep (all 373 records):** 0 D-code / T-code hits in any
  `Puzzle Content` blob. Every `domain` value is a plain-language name.
- **Application codebase:** 0 raw codes in subscriber-facing source. Enforced by
  the existing build guard `scripts/no-idf-codes-check.mjs` (passes) and confirmed
  by the FAR-382 nav audit (no `[DT]\d+` hits in rendered nav copy).
- **The mapping is genuinely wired up:** both subscriber surfaces that show a
  domain (`/challenge/about`, the in-game domain chip) route through
  `resolveDomainName` from the canonical `src/lib/idf-labels.ts`.
- **Two flags for Myke** (documentation/structural, not leaks): the Theme Registry
  has no queryable T-ID field, and `DOMAIN_LABELS` is a hardcoded copy of the
  Domain Registry (drift risk). Details below.

---

## Prior work (already merged, inherited by this branch)

FAR-387's core code change shipped in **PR #98 "Launch backlog 1–3"** (commit
`13fb166`), an ancestor of this branch:

- Added `src/lib/idf-labels.ts` — frozen `DOMAIN_LABELS` (D1–D23) + `THEME_LABELS`
  (T-001…T-007) with `resolveDomainName` / `resolveThemeName` (code→name, unmapped
  code→`null`, plain name passthrough) and `formatDomainTheme`.
- Replaced the **one** subscriber-facing raw D-code: `/challenge/about` previously
  rendered `IDF Domain {domain_code}`; it now renders `Domain: {plain name}` via
  the resolver. (`domain_code` is null in prod today, so nothing was leaking live —
  but the conditional path is now safe.)
- Routed the in-game domain chip in `DailyChallenge.jsx` through the resolver too.
- Added build guard `scripts/no-idf-codes-check.mjs` (`npm run test:no-codes`).

This report completes the parts PR #98 did **not** do: the full-table Puzzle Bank
sweep (it fixed the one page; it did not sweep all 373 records) and a repo-wide
grep beyond nav pages.

## Phase 0 — Investigation results

### 1. Full Puzzle Bank sweep — all 373 records (not the 15-record sample)

Pulled every record from the canonical Puzzle Bank (`appxfti7VuoHYUeu6` /
`tbliJaRmctbIWJC43`) and grepped every `Puzzle Content` JSON blob
(`fldBNhNWxcig4j4D8`) for `\b[DT]-?\d+(\.\d+)?\b`.

- **0 records** contain a D-code or T-code anywhere in their content.
- All 373 store a **plain-language `domain`** value. No `theme` / `subDomain` keys
  are present in any content blob.
- This confirms the ticket's finding at full-table scale: the leak described in the
  ticket example (`Category: D3 / T1`) does **not** exist in the Puzzle Bank.

> **Adjacent data-hygiene note (out of FAR-387 scope, not a leak):** the 373
> `domain` values are highly inconsistent free-form names — 100+ distinct spellings
> (e.g. "Cooling & Water" / "Cooling & Water Technology" / "Cooling" / "Water &
> Cooling" / "Thermal Management" / "Heat Rejection" all coexist). None are codes,
> so none leak, and the resolver passes each through unchanged. Normalizing these
> to the 23 canonical Domain Registry names is a separate ticket (name hygiene, not
> code enforcement).

### 2. Application-codebase grep

- `npm run test:no-codes` — **passes.** The scanner strips comments and data: URIs,
  then fails on `\b[DT]\d+(\.\d+)?\b` in remaining string/JSX text across `src/`,
  with a tight internal-only allowlist (the mapping module itself, server-only
  ingestion libs, and the League Office admin console).
- The `D#`/`T#` tokens the initial grep surfaced in `src/` are **internal
  design-decision comment markers** (`(D8)`, `(D10)`, …) and ISO datetime literals
  (`T12:00:00Z`), not subscriber copy — the guard correctly ignores them.
- **Other repos (sanity):**
  - `jw` (Jurisdiction Watch): clean — uses JPS scores, no IDF D-codes.
  - `Faraday-intelligence`: **retired static site, no production domain (FAR-119).**
    Its `public/faraday-subscriber-profile-v7.jsx` (`THEMES` table) and
    `public/faraday-academy.jsx` (`DOMAINS` table) embed codes in data structures
    (`code:"D1"`, `domains:["D2","D3",…]`). These are **dead artifacts of the
    retired site** and serve to no subscriber. Flagged for optional cleanup only if
    that repo is ever un-retired; not fixed here (out of live-surface scope).

### 3. Domain Registry is the canonical source — and matches the code 1:1

- Domain Registry (`appxfti7VuoHYUeu6` / `tbltFtmWgBYPuRLSc`): **23 Active records,
  D1–D23** (confirmed live 2026-07-28), fields `Domain Name` (`fldDK0tlu4gKog6y0`)
  and `Domain ID` (`fldljR88WnQlnzj0g`).
- Cross-checked all 23 registry names against the hardcoded `DOMAIN_LABELS` in
  `src/lib/idf-labels.ts`: **exact match, 23/23. No drift today.**

### 4. FAR-382 nav audit — cross-referenced

FAR-382's `reports/nav-content-audit.md` (merged) already ran the
`\b[DT]\d+(\.\d+)?\b` pattern across nav-reachable pages: **no hits in rendered
copy on any nav page**, and it explicitly cross-referenced the one conditional
`/challenge/about` path to FAR-387 (now fixed). Its `T1`–`T15` entries are the
report's own task-table row labels, not theme codes.

---

## Flags for Myke (not leaks — structural / documentation)

### A. Theme Registry has no queryable T-ID field

The IDF Theme Registry (`appxfti7VuoHYUeu6` / `tbl9BRMxHm5fL8oy5`) has **7 Active
themes** but exposes only `Theme Name`, `Thesis & Scope`, and `Lifecycle State`.
The T-ID (`T-001`…`T-007`) is present **only as freeform text inside `Thesis &
Scope`** (`"Theme ID: T-003 | Tagline: …"`), not as a dedicated field — even though
the table's own description says "Theme IDs use T-### format."

Consequence: there is no canonical Theme-code→name lookup to confirm. `THEME_LABELS`
in `idf-labels.ts` is therefore a **hand-maintained** map, not a mirror of a
queryable field. (No live T-code leak was found, so no runtime impact today.)
Per the ticket's guardrails, **adding a T-ID field is out of scope** (schema change,
Myke-gated). Reporting the description-vs-schema inconsistency as requested.

> The `Thesis & Scope` blobs also embed D-codes ("Cross-Domain Span: D3 …"). This
> is a backend field, not rendered to subscribers, so it is not a leak — noted for
> completeness.

### B. `DOMAIN_LABELS` is a hardcoded copy of the Domain Registry (drift risk)

`DOMAIN_LABELS` (D1–D23) is a frozen local copy of the live Domain Registry. It
matches 1:1 today, but nothing syncs it — if a Domain is renamed in Airtable, the
subscriber-facing name silently drifts from canon. A real sync (or a
Supabase read-model mirror) would remove the second source of truth. Left as a
**follow-up** (building a sync is beyond this copy-only ticket), flagged per scope.

---

## Changes in this PR

This is a verification pass; no copy fixes were needed. The changes only harden and
correct the existing FAR-387 mechanism:

1. `src/lib/idf-labels.test.ts` — **new** behavioral tests for the resolvers
   (code→name, sub-domain→parent, unmapped→null, plain-name passthrough, all theme
   forms, `formatDomainTheme` slot-dropping). 11 tests, all pass
   (`npm run test:idf-labels`). Also makes the module comment's reference to this
   test accurate.
2. `src/lib/idf-labels.ts` — corrected the header comment (it referenced a guard
   test that did not exist; now points at both the real build guard
   `scripts/no-idf-codes-check.mjs` and the new resolver test).
3. `package.json` — added `test:idf-labels` script.
4. This report.

## How to re-verify

```bash
npm run test:no-codes      # build guard: no raw code in subscriber-facing src
npm run test:idf-labels    # resolver behavior
# Full Puzzle Bank sweep: pull tbliJaRmctbIWJC43 and grep every Puzzle Content
# (fldBNhNWxcig4j4D8) for \b[DT]-?[0-9]+(\.[0-9]+)?\b  → expect 0 hits.
```
