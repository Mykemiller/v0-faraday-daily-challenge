# IDF 4.0 Coverage Bridge — Data-Integrity Findings & Escalations

> **RESOLVED 2026-06-24 (Myke approved).** Finding 0 → block `AUTO-137–175` granted +
> registered Designed; next free is `AUTO-177`. Finding 1 → AUTO-049 Designed row
> reassigned to **AUTO-176**. Finding 2 → 6 Industry-Conferences annotations repointed
> to **AUTO-168** (D8.2). Finding 3 → stale tags fixed in the operational source
> (`index.ts` AUTOMATIONS) for AUTO-028/029/030/031/032. Finding 4 (registry sync) →
> still open as **FAR-205** (separate gate). Tier-1 AUTO-060–069 deployed + Active.

_FAR IDF-4. Verified against live infrastructure 2026-06-23: Automation Registry
(Airtable `appxfti7VuoHYUeu6` / `tbl1ef6FgxUc3Uevg`, 129 rows), Industry Conferences
(`tblb1S5IKFBPEmUJL`), IDF Sub-Domain Registry (`tbla7rtRY9AaeoWhu`), Supabase
`ycadmmngkdhvpcsrcuaq`. Nothing here is auto-applied — items touching **Active**
crawlers are proposals pending Myke per §6 Boundaries._

---

## 🔴 FINDING 0 (NEW — corrects the prompt) — "Next free ID is AUTO-134" is wrong

The prompt's §6 Boundaries state the next free AUTO-ID is **AUTO-134**. It is not.
The Registry shows three rows already **Active** in that range:

| AUTO-ID | Status | Auto Name |
|---|---|---|
| AUTO-134 | **Active** | Engine IDF→Entities Classifier (`engine-idf-entities`, daily 12:30 UTC) |
| AUTO-135 | **Active** | Engine Prognostications (`engine-prognostications`, daily 12:00 UTC) |
| AUTO-136 | **Active** | Engine Two-Analyst — Gil+Mach (`engine-two-analyst`, daily 13:30 UTC) |

**The next free AUTO-ID is `AUTO-137`.** This task scaffolds **39** new whitespace
routines, so the contiguous block to approve is **`AUTO-137` → `AUTO-175`**.
(Highest ID currently in the Registry is AUTO-136.)

> ⛔ Escalation: do not self-assign. The 39 scaffolds in `coverage-bridge.ts` carry
> `AUTO-NEW-01..39` placeholders until Myke grants AUTO-137→175.

---

## 🔴 FINDING 1 — AUTO-049 is double-assigned (ID collision, verified)

Two Registry rows both claim **AUTO-049**:

| Status | Source Type | Auto Name | crawler_id |
|---|---|---|---|
| **Active** | email | Email Ingestion — Gmail Forward Parser | `ingest-email_v1.0` |
| **Designed** | regulatory | Community Opposition & Moratorium Tracker (D3, D18) | — |

The **Active** AUTO-049 = email ingestion is the governance-approved one (CLAUDE.md,
"approved by Myke 2026-06-23"; commit `0fa8b6b`). The **Designed** "Community
Opposition & Moratorium Tracker" is the duplicate.

**Proposed fix (not applied — Designed row, but reassignment needs ID grant):**
re-ID "Community Opposition & Moratorium Tracker" into the new block (e.g. the first
free slot of AUTO-137+); keep AUTO-049 = Email Ingestion. The Coverage Matrix row
**D18.1** currently points at the Designed AUTO-049 and is flagged ⚠ accordingly —
it should follow the reassigned ID.

> Note: AUTO-050 (PUC & Utility Rate Case, → D3.3), AUTO-051 (Local Gov DC Action,
> → D18.2), AUTO-052 (Midterm Electoral, → D18.x) are single-assigned Designed rows;
> only AUTO-049 collides.

---

## 🟠 FINDING 2 — AUTO-028 / AUTO-029 collision vs the Industry Conferences table

Multiple **Industry Conferences** rows (`tblb1S5IKFBPEmUJL`) annotate their notes
with **"AUTO-028 primary target"** / **"AUTO-028 + AUTO-029 primary target"**
(e.g. NVIDIA GTC, OCP Global Summit, DCD>Connect NY, Data Center World POWER, Yotta).
There, AUTO-028/029 mean a **conference-intelligence scraper** — i.e. IDF **D8.2
Conference Intelligence & Speaking Circuit**.

But in the **Automation Registry**, those IDs are already taken by unrelated Active
crawlers:

| AUTO-ID | Registry (Active) | Conferences table intends |
|---|---|---|
| AUTO-028 | Networking & Interconnect Signal Crawl (→ D12) | conference scraping (D8.2) |
| AUTO-029 | Community Relations Signal Crawl (→ D13) | conference scraping (D8.2) |

This is a **semantic ID collision**: the Conferences table references a
conference-crawler concept under IDs the Registry assigns elsewhere. The
"AUTO-028/029 primary target" notes are stale pre-4.0 references.

**Proposed fix (not applied):** the D8.2 Conference Intelligence routine is
scaffolded as `AUTO-NEW-32` (Scheduled Cowork over the Conferences table). On ID
grant, repoint the Conferences-table annotations from "AUTO-028/029 primary target"
to the new D8.2 ID. **Do not** touch AUTO-028/029 in the Registry for this — they
are Active and correct for Networking/Community (subject only to Finding 3's tag fix).

---

## 🟠 FINDING 3 — Stale 3.x domain tags on Active Intelligence-Crawl rows

The original Intelligence-Crawl set (AUTO-027–034) was tagged with **pre-4.0**
primary-domain numbers. The 4.0 renumber moved those domains; the `IFS Domains`
field (an **`aiText` / generated** field — one row already shows `isStale: true`)
still carries the old numbers. Each crawler's **name** identifies its true 4.0 home:

| AUTO-ID | Name (true subject) | Current tag | 4.0 correct primary | Δ |
|---|---|---|---|---|
| AUTO-028 | Networking & Interconnect | `D10, D6, D4` | **D12** | D10→D12 |
| AUTO-029 | Community Relations | `D11, D3` | **D13** | D11→D13 |
| AUTO-030 | Real Estate & Site Selection | `D12, D4, D5` | **D14** | D12→D14 |
| AUTO-031 | Sustainability & ESG | `D13, D7, D3` | **D11** | D13→D11 |
| AUTO-032 | Workforce & Labor Markets | `D14, D5, D6` | **D17** | D14→D17 |

The prompt named AUTO-028/030/031/032; **AUTO-029 has the same defect** and is
included. (AUTO-033 Sovereign AI → D15 ✓ and AUTO-034 Security → D16 ✓ are already
correct.)

**Proposed fix (NOT applied — all five are Active, changing domain routing):**
correct the primary domain tag per the table. Because `IFS Domains` is a *generated*
`aiText` field, the durable fix is to correct the **generation source/prompt** (or
pin the field), not just overwrite the cell — otherwise it regenerates stale.
Escalated for Myke sign-off before any write (§2 DONE / §6).

---

## 🟡 FINDING 4 — Airtable + Supabase IDF registries are out of 4.0 sync (FLAG ONLY)

Per §2/§6 this task **flags** the staleness and **does not** backfill (separate
governance gate + the "new Number fields need a manual UI value before API writes"
caveat from the canon's Open Items).

Verified current state (the prompt's "18 Domains / 30 Sub-Domains" is itself stale):

| Store | Domains | Sub-Domains | Themes | vs 4.0 canon (23 / 116 / 7) |
|---|---|---|---|---|
| Airtable `IDF Sub-Domain Registry` (`tbla7rtRY9AaeoWhu`) | — | **59** rows, mostly "Coming Soon — <4.0 name>" | — | partial 4.0 names, **no stable D#.# Number IDs** |
| Supabase `faraday_domains` | **16** | — | — | behind (needs 23) |
| Supabase `faraday_subdomains` | — | **4** | — | far behind (needs 116) |
| Supabase `faraday_themes` | — | — | **7** | ✓ matches |

**Consequence for this bridge:** the dedicated crawlers and new scaffolds tag 4.0
`D#.#` IDs (D1.4, D2.5, D7.1, D9.3, …) that do **not** resolve in either registry
store. Coverage tagging works at the artifact level (`artifacts.ifs_domains` is a
free `text[]`), but any join/rollup against the registry tables will miss.

**Recommended next action (separate story, prerequisite to full activation):** run
the governed IDF 4.0 registry sync — write the 116 sub-domains with stable D#.#
Number IDs into `tbla7rtRY9AaeoWhu` (honoring the manual-UI-value caveat) and bring
`faraday_domains`/`faraday_subdomains` to 23/116. Track as its own FAR sub-task.

---

## Hygiene note (minor)

- **AUTO-055** ("Lexicon-Powered Puzzle Draft Agent") has a **blank Status** in the
  Registry (neither Designed/Active/Testing). Recommend setting an explicit Status.

---

## Escalation summary (for Myke)

1. **Approve the AUTO-ID block `AUTO-137 → AUTO-175`** (39 scaffolds). Corrects the
   prompt's stale "AUTO-134".
2. **Resolve AUTO-049 collision** — reassign the Designed "Community Opposition &
   Moratorium Tracker" to a new ID; keep AUTO-049 = Email Ingestion (Active).
3. **Sign off on the Finding-3 tag corrections** (Active crawlers, domain routing).
4. **Confirm AUTO-028/029 → D8.2 conference-routine repoint** for the Conferences table.
5. **Authorize the separate IDF 4.0 registry sync** (Finding 4) as a prerequisite.
6. Any **`source_type` enum addition** needed for NRC/FERC/USPTO primary-source
   connectors (§4 of the deployment plan).
