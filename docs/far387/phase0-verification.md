# FAR-387 — Plain-Language Domain Naming: Phase 0 Verification Report

**Ticket:** FAR-387 (Task · Launch backlog 1 of 10 · effort-s)
**Date:** 2026-07-28
**Outcome:** **Verification pass — zero D-code / T-code leaks found on any subscriber-facing
surface.** One latent hardcoded-copy drift corrected (theme name); one Airtable schema gap
reported to Myke. No leak remediation was required.

> Context: the core enforcement (`src/lib/idf-labels.ts` + resolvers + build guard) was already
> shipped by commit `13fb166` ("Launch backlog 1–3"). What was outstanding — and what this pass
> completes — is the rigorous Phase 0 sweep, the Theme Registry gap report, and the drift check
> the ticket actually asks for.

---

## Phase 0 — investigation results

### 1. Full Puzzle Bank sweep (all 373 records) — CLEAN
Swept **373 / 373** records of the Faraday Puzzle Bank (`appxfti7VuoHYUeu6` / `tbliJaRmctbIWJC43`),
scanning `Puzzle Content` (JSON), `Puzzle Name`, and `Hint 1/2/3` for `\bD\d{1,2}(\.\d+)?\b` and
`\bT-?0*\d+\b`. Confirmed two independent ways (classification-aware scan + raw regex over
full-fidelity dumps) plus a manual pass.

- **Confirmed leaks: 0. Ambiguous/incidental: 0.**
- **373/373 records carry a plain-language `domain` value** in Puzzle Content; 0 null, 0 bare codes.
- Near-miss strings correctly NOT flagged: "Tier IV", "800G/400G", "N+1 / 2N", "800V DC", "$80B",
  hex colors like `#1C3424`.
- This supersedes the earlier 15-record sample — the *whole* table is confirmed code-free, not just a slice.

### 2. Application codebase grep — CLEAN (already enforced)
- Build guard `npm run test:no-codes` (`scripts/no-idf-codes-check.mjs`) scans all
  subscriber-facing `src/**` for `\b[DT]\d+(\.\d+)?\b` and **passes**. Internal-only files
  (League Office admin, ingestion pipelines, the map module itself, tests) are on a commented allowlist.
- Every subscriber-facing domain render routes through `resolveDomainName()`:
  - `src/app/challenge/about/page.tsx:94` — "Domain: {name}"
  - `src/components/DailyChallenge.jsx:3248` — in-game puzzle preview chip
  - `src/app/api/challenge/signals/route.ts:95` — Top Signals domain chips (drops unmapped codes silently)
- `ScoreCard` receives a `domain` prop from all 7 games but **does not render it** (dead prop — no leak).
- `resolveThemeName` / `formatDomainTheme` / `THEME_LABELS` are **defined but unused** by any
  subscriber surface today (dormant).

### 3. Domain Registry is the canonical source — CONFIRMED, in sync
- IDF Domain Registry `tbltFtmWgBYPuRLSc`: **23 Active records, D1–D23** (the table's own description
  saying "18 domains" is stale — do not trust it, per the ticket).
- Every live `Domain ID → Domain Name` pair matches the hardcoded `DOMAIN_LABELS` in
  `idf-labels.ts` **exactly (23/23)**. No domain drift today.
- **Drift risk flagged:** `DOMAIN_LABELS`/`THEME_LABELS` are a *hardcoded local copy* of the live
  registries with **no live sync** — they can silently drift (and the theme half already had, see below).
  Follow-up candidate: sync from Airtable (or a Supabase read-model mirror) instead of hardcoding.

### 4. FAR-382 (nav content audit) cross-check — CONSISTENT
`reports/nav-content-audit.md` ran the same `\b[DT]\d+(\.\d+)?\b` regex over every nav-reachable
page and found **no leaks in rendered copy**. Its one conditional path (`/challenge/about` →
`IDF Domain <code>`) was fixed by FAR-387's commit; `domain_code` is null in prod regardless.

### 5. Other repos — CLEAN
Quick subscriber-facing grep of `jw` (Jurisdiction Watch) and the retired `Faraday-intelligence`
found no D-code/T-code leaks. Domain/Theme codes are an IDF/Daily-Challenge concept; the primary
surface is this repo.

---

## Finding A — Theme Registry schema gap (report to Myke; independent of any leak)

The IDF Theme Registry (`tbl9BRMxHm5fL8oy5`) **has no T-ID field.** Its table description states
"Theme IDs use T-### format," but no column stores that ID — only `Theme Name`, `Thesis & Scope`,
`Lifecycle State`, `Assignee` are queryable. The T-IDs exist **only as freeform text** ("Theme ID:
T-00X | …") embedded inside the `Thesis & Scope` field.

**Implication:** there is no canonical, queryable Theme Code → Theme Name lookup — the mapping the
ticket asked to "confirm exists" does **not** exist for themes. Any T-code that ever appeared in
subscriber copy could not have come from this table as a lookup; it would be ad-hoc.

**Action:** reported to Myke as a documentation/schema inconsistency (Jira comment on FAR-387).
Per the ticket's explicit guardrail, **no T-ID field was added** — that is a gated schema decision
requiring Myke's manual Airtable entry.

## Finding B — Latent theme-name drift, CORRECTED (in scope)

The hardcoded `THEME_LABELS["T-002"]` said **"The Thermal Reckoning"**, but the live registry's
canonical `Theme Name` for T-002 is now **"The Rack Revolution"** (Active; its thesis explicitly
reframes "why T-002 is broader than Thermal alone"). The other 6 theme names match live.

This is dormant today (`resolveThemeName` is unused), so it is **not an active leak** — but it is a
wrong plain-language name in a hardcoded copy, and would surface a wrong label if the theme resolver
is ever wired up. Corrected `THEME_LABELS["T-002"] → "The Rack Revolution"` to align the display map
to the live canonical Theme Name (the ticket's declared source of truth for theme names).

**Residual (follow-up, not changed here):** the same stale name also lives in the build-provenance
artifacts `scripts/far287/build-snapshot.mjs` and `scripts/far287/idf-taxonomy-snapshot.json`. Those
feed the historical 500-day calendar/puzzle generation; rewriting them implies a regeneration
decision that is **out of this ticket's copy-only scope**. Left as-is and flagged. (The theme name
is only a display label there — the seed/structure key off theme *IDs*, not names — and no theme
name reaches subscriber puzzle content per the sweep above, so the residual is inert today.)

## Finding C — Domain-string normalization (data hygiene, out of scope)

The 373 records use **114 distinct free-text domain strings** that are not normalized to the 23-name
controlled vocabulary (e.g. "Cooling & Water" vs "Cooling" vs "Water & Cooling"; "New Entrants" vs
"New Entrants & Neoclouds"). These are all plain-language (never codes), so they satisfy FAR-387 and
render correctly through `resolveDomainName` (which passes any non-code string through unchanged).
Normalizing them to the canonical registry names is a separate taxonomy-hygiene pass — flagged, not done.

---

## Changes made in this PR
- `src/lib/idf-labels.ts`: corrected `THEME_LABELS["T-002"]` to the live canonical name; fixed a
  comment that referenced a non-existent `idf-labels.test.ts` (the real guard is
  `scripts/no-idf-codes-check.mjs`); added a drift caveat documenting the hardcoded-copy risk.
- `docs/far387/phase0-verification.md`: this report.

## Acceptance criteria status
- [x] Full sweep completed & documented (373 records + all code paths + nav pages + other repos).
- [x] Confirmed leaks replaced — **none existed**; verification pass, no manufactured changes.
- [x] Theme Registry T-ID field gap reported to Myke (Jira comment), independent of leak status.
- [x] Hardcoded local-copy drift flagged (Finding A/B) rather than left as a silent second source.
- [ ] PR merged → transition FAR-387 to Done (gated on merge; this is a draft PR).
