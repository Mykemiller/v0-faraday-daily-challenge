# Faraday legal-surface discovery

**CC-TOS-PRICING-1.0 · surveyed 2026-08-04**

What legal pages exist across the Faraday estate today, where they live, what
they say, and when they were last touched — plus the conflicts this survey
turned up.

---

## 1. Access limits on this survey — read this first

Three storefront repositories named in the ticket **could not be reached** from
the session that produced this report. The session's GitHub scope covered four
repositories (`v0-faraday-daily-challenge`, `faraday-jurisdiction-watch`, `jw`,
`Faraday`), and both tools for widening it — `add_repo` and `list_repos` —
require interactive approval, which a non-interactive session cannot obtain.

| Repository | Status | Consequence |
|---|---|---|
| `Mykemiller/Faraday-intelligence` | **not reachable** | See §2 — it is also retired, so this turned out not to matter. |
| `Mykemiller/Faraday-Signal-Room` | **not reachable** | Schedule SR was written but is hosted in the hub, not in the Signal Room repo. |
| `Mykemiller/Faraday-Briefing-Library-` | **not reachable** | Schedule BL was written but is hosted in the hub, not in the Briefing Library repo. |

Everything below for those three is therefore **inferred from the hub repo's own
canon** (`CLAUDE.md`, storefront stubs, the live product surfaces that reference
them) rather than observed in their source. Where that is the case it is marked
**[inferred]**. A follow-up session with those repos attached should re-run §3
against them and, if they carry their own legal pages, either retire those pages
in favour of the canonical URLs or move the schedule into the owning repo.

**Signal Room note:** the hub's homepage links Signal Room at
`https://faraday-signal-room.com/signal-room` — an external domain not served by
any repo in scope. Its current legal surface is unobserved.

---

## 2. Where the master Terms actually belong — a deviation, resolved

The ticket specifies the master ToS should live in
`Mykemiller/Faraday-intelligence`. **It has been placed in
`Mykemiller/v0-faraday-daily-challenge` instead**, and that is not merely a
consequence of the access limit above — it is the correct home on the evidence:

- `Faraday-intelligence` is documented as **retired/dormant, with no production
  domain**, and the canon says in terms: *"Do not build new surfaces there."*
  (FAR-119, Myke-approved 2026-06-19, recorded in the hub's `CLAUDE.md`.)
- The domain the ticket wants the master published on —
  **`faraday-intelligence.ai`** — is served by `v0-faraday-daily-challenge`
  (Vercel project `v0-faraday-daily-challenge-n2u5`). That repo *is* the
  faraday-intelligence.ai site; the "engine-as-site" decision folded the brand
  site into it.
- The same repo already owned the only real legal pages in the estate
  (`/terms`, `/privacy`).

So the master ToS is authored at `content/legal/terms-of-service.md` in that
repo and publishes at **`https://faraday-intelligence.ai/terms`** — the URL the
ticket asks for. **Flag for Myke:** if `Faraday-intelligence` is being revived as
the brand site, the master should move with it and every Schedule's `masterUrl`
updated in one pass.

---

## 3. Per-repository inventory

### 3.1 `Mykemiller/v0-faraday-daily-challenge` — the hub

Serves `faraday-intelligence.ai` **and** `faradaydailychallenge.com`. The only
repo in the estate that had real legal pages before this work.

| Surface | Path | Last touched | What it said |
|---|---|---|---|
| Terms of Service | `src/app/terms/page.tsx` | **2026-07-30** | A **Daily-Challenge-only** ToS, 13 sections, copy inline in the component. Effective date `July 30, 2026`. |
| Privacy Policy | `src/app/privacy/page.tsx` | **2026-07-30** | Privacy policy, copy inline. Effective date `July 30, 2026`. |
| `/legal` | `src/app/legal/page.tsx` | 2026-07-30 | `permanentRedirect("/terms")` — a retired combined placeholder. |
| Shared shell | `src/components/LegalDocument.tsx` | 2026-07-30 | Title + effective date + sibling cross-link + typography. |
| Footer notice | `src/components/SiteFooter.tsx` + **three hand-rolled twins** | 2026-07-30 | `© 2026 Faraday Intelligence LLC. All rights reserved. · Terms · Privacy` |
| Signup clickwrap | `src/components/OTPGate.jsx` | 2026-07-30 | "By continuing you agree to the Terms of Service and Privacy Policy." — adjacent assent, no checkbox. |

**Assessment of the pre-existing ToS.** It was a competent *publisher/game* ToS
and a poor *institutional data-vendor* ToS. Measured against what Faraday
actually sells, it was missing:

- any auto-renewal / cancellation / refund disclosure (it contemplated no paid
  subscription at all);
- a named-seat licence and any no-resale / no-redistribution term;
- an attribution regime for permitted reuse;
- a forecast/vintage/revision disclaimer;
- a third-party data pass-through (EIA, PJM, Aqueduct, FEMA, USGS, BLS …);
- an AI-assisted-content disclosure;
- a text-and-data-mining reservation of rights;
- an accessibility statement.

Its ML restriction was also narrower than it reads: it prohibited training only
where the model *competes with Faraday*, so a non-competing model was permitted
to train on Faraday content. Its liability cap was 12 months / US $50 (the ticket
specifies 6 months / US $100). Its arbitration posture was court-venue plus a
class waiver, not mutual arbitration.

**Disposition:** superseded. Its Daily-Challenge-specific substance survives as
**Schedule DC**; everything estate-wide moves to the master. The old text remains
in git history.

### 3.2 `Mykemiller/faraday-jurisdiction-watch` — Jurisdiction Watch

**No legal pages of any kind existed.** Verified two ways: a filename sweep for
`*terms*`/`*privacy*`/`*legal*` returned nothing, and `git log` across all
branches for those paths returned no commits — the repo had never had one.

This is the sharpest finding in the survey. Jurisdiction Watch is the storefront
that **takes money** (`/jurisdiction-watch/buy`, live Stripe checkout, the locked
token packs) and **publishes the scores** whose misuse carries the most risk, and
it was shipping with:

- no terms at all, at any URL;
- no pre-purchase disclosure of what a token is or is not;
- no disclaimer that a posture label is not a permitting determination;
- a footer reading **"© 2026 Jurisdiction Watch. All rights reserved."** and
  **"JPS™, JPAS™, JDS™ and JTS™ are trademarks of Jurisdiction Watch"** —
  attributing copyright and trademarks to a *product*, which is not a legal
  person and cannot hold either. The operating entity is Faraday Intelligence LLC.

**Disposition:** Schedule JW is now authored here, published at `/terms`, linked
from the site footer and from the buy page above the checkout button; both
copyright notices are corrected to the operating entity.

### 3.3 `Mykemiller/jw`

A **backend-only satellite**: `supabase/migrations/`, `supabase/functions/`,
docs, and a `next.config.mjs`/`tsconfig.json` with **no `app/` directory and no
components**. It shares `jurisdiction-watch`'s package name and an identical
`CLAUDE.md` with `faraday-jurisdiction-watch`.

No legal pages, no subscriber-facing surface, no legal surface required.

**Flag for Myke:** two repos carrying the same package name and the same
`CLAUDE.md` while only one has an app is a standing source of confusion —
independent of this ticket, worth resolving.

### 3.4 `Mykemiller/Faraday` — the engine

Supabase migrations and edge functions for project `ycadmmngkdhvpcsrcuaq`. No
web surface, no legal pages, none required.

### 3.5 `Mykemiller/Faraday-intelligence` — **[not reachable]**

Documented as retired/dormant with no production domain (FAR-119). Any legal page
still in it is unpublished. **[inferred]**

### 3.6 `Mykemiller/Faraday-Signal-Room` — **[not reachable]**

Legal surface unobserved. Schedule SR is authored in the hub and publishes at
`faraday-intelligence.ai/terms/signal-room`. If the Signal Room storefront
(apparently `faraday-signal-room.com`) carries its own terms, they must be
retired in favour of the canonical URLs, or the schedule moved into that repo.

### 3.7 `Mykemiller/Faraday-Briefing-Library-` — **[not reachable]**

Legal surface unobserved. Schedule BL is authored in the hub and publishes at
`faraday-intelligence.ai/terms/briefing-library`. Same follow-up as Signal Room.

### 3.8 Faraday Academy — no repository

Runs on **LearnWorlds**, an external LMS. Schedule FA is authored in the hub as a
standalone markdown document for manual paste, and states plainly that the
platform's own terms govern the platform.

---

## 4. Conflicts and defects found

Ordered by how much they matter.

### 4.1 "Tokens never expire" was published on live surfaces — **fixed**

Two hub surfaces made an affirmative, durable, public promise that **tokens never
expire**:

- `src/app/page.tsx` — the storefront homepage token section;
- `src/components/StubPage.tsx` — the **default** metered note, i.e. it appeared
  on *every* product stub page unless overridden.

This is the exact representation the ticket's stop condition forbids, and it is
not a wording nicety. A non-expiring, customer-funded prepaid balance is the
fact pattern that pulls in state gift-card statutes, prepaid-access rules, and
unclaimed-property/escheat obligations. Publishing the promise narrows the
options counsel has left. Both lines were replaced with neutral copy that neither
promises permanence nor invents an expiry, each with a comment saying why, and a
test now fails if either comes back.

**This does not resolve the underlying question** — see Schedule BL, BL-4, which
holds it open for counsel with the full analysis.

### 4.2 The Academy token grant is an unhedged redemption liability — **flagged, unresolved**

Faraday Academy contemplates granting tokens on course completion. Because tokens
do not currently expire, every grant adds to an **open-ended pool of balances
Faraday has committed to honour, with no cap, no expiry clock, and no funding
reserve**, held by learners who may never return. It compounds 4.1 rather than
sitting beside it.

Flagged in **both** Schedule BL (BL-4) and Schedule FA (FA-6), and it must be
resolved together with the expiry question, not separately. `ACADEMY_PRODUCTS`
in the pricing config carries `tokenGrant: null` with the same TODO, so no grant
size can be configured before the question is answered.

### 4.3 Persona bylines vs. institutional attribution — **flagged, not resolved**

The ticket's stop condition forbids writing any clause that requires third
parties to cite "Gilbert Faraday", "Gil Faraday", or "Mach Eigen". No such clause
was written, and a test enforces it over the attribution section.

**The underlying tension is real and is left for Myke.** Faraday's shipped
product does present personas as authors of analysis:

- `jw_briefings` forces the byline **'Gilbert Faraday'** on every generated
  Faraday's Read, and `/jurisdiction/[slug]` renders it as the byline;
- the Daily Challenge assigns Faraday's Take a voice per game type — Gilbert
  Faraday for four games, **Mach Eigen** for three — and renders a signed byline;
- Briefing Library covers carry a `byline: "Mach" | "Gilbert"`.

So a reader of a Faraday's Read sees a named author, while the master Terms
require citation to "Faraday Intelligence" as the institutional author. Master
Terms §10 addresses this as far as a ToS honestly can — it discloses that the
personas are house voices of Faraday Intelligence LLC and are not authors of
record for citation purposes — but it does **not** reconcile the product
presentation. That is a brand and disclosure decision, not a drafting one.

### 4.4 Copyright and trademarks attributed to a product — **fixed**

Both Jurisdiction Watch footers named "Jurisdiction Watch" as the copyright
holder and as the owner of JPS™/JPAS™/JDS™/JTS™. Corrected to Faraday
Intelligence LLC, with Jurisdiction Watch™ named as one of its marks.

### 4.5 Locked token-pack prices were duplicated across repositories — **fixed**

`500/$49 · 1,000/$89 · 10,000/$799` are locked human-approved canon whose source
of truth is `tokenPacks.ts` in the Jurisdiction Watch repo. The hub's homepage
carried its **own** copy as display strings — a second, unguarded copy of a
locked price, in a different repo from the one that charges the card. The day a
pack price changed, the homepage would have kept quoting the old number.

Replaced with a generated mirror (`src/config/token-packs.ts`) and a test that
fails on any price literal in a page or component. **No price was changed.**

### 4.6 The retired "MW" mechanic — **addressed**

The ticket asks Schedule DC to state that MW scoring has no cash value and is not
redeemable. **MW was fully retired from the Daily Challenge in July 2026** —
columns dropped, currency removed — and scoring is now points/score. Schedule DC
therefore writes the clause against the mechanics that actually exist (points,
scores, Readiness runs, multipliers, standings) and adds a note that the MW unit
was retired and that older material referring to it is superseded, so the
ticket's intent is met without describing a mechanic that no longer exists.

### 4.7 The Daily Challenge pays real tokens — so "no purchase necessary" is load-bearing

Intelligence Readiness milestones grant **real Faraday tokens** that are spendable
on Live Agent answers. That is a reward with economic value attached to gameplay,
which is why Schedule DC carries explicit no-purchase-necessary language, a
void-where-prohibited clause, and a statement that reward tokens are governed by
the same Schedule BL terms — including the unresolved expiry question.

### 4.8 Age gate: stated but not yet enforced — **flagged**

The pre-existing ToS said "at least 16 years old" and Schedule DC keeps that
minimum and adds an explicit age-gate commitment. **The registration flow does
not currently ask for age** — `OTPGate` collects an email and nothing else. The
schedule as drafted describes an age question at sign-up. Either the gate ships
or the clause is softened; leaving them divergent is worse than either.
**Product change required — not made here** (it is outside this ticket's scope
and touches the live auth flow).

### 4.9 Contact addresses named in the Terms may not exist — **flagged**

The master names **`cancel@faraday-intelligence.ai`** (required: a cancellation
email) and **`accessibility@faraday-intelligence.ai`** (required: an accessibility
contact). The repo is only known to send from `challenge@` and `ops@` on that
domain. **A ToS that names an unrouted mailbox is itself a compliance defect** —
provision both, or change the addresses, before publication.

### 4.10 Governing law and venue deliberately unset

Left as `TODO(myke)` in master §16, as the ticket requires, along with the
arbitration provider, rule set, seat, and fee allocation — those are counsel
decisions and naming one would be a guess wearing the clothes of a decision. A
test asserts the placeholder is still there.

---

## 5. What ships as a result

| Deliverable | Location |
|---|---|
| Master Terms of Service | `content/legal/terms-of-service.md` → `/terms` |
| Schedule DC · SR · BL · FA | `content/legal/schedules/*.md` → `/terms/{slug}` |
| Schedule JW | JW repo `content/legal/schedules/jurisdiction-watch.md` → `jurisdiction-watch.com/terms` |
| Pricing config (single source of truth) | `src/config/pricing.ts`, mirrored to the JW repo |
| Token-pack mirror | `src/config/token-packs.ts` (canon stays in the JW repo) |
| Corpus + pricing guards | `npm run test:legal`, `npm run test:pricing` |
| How it fits together | `content/legal/README.md` |

**Every document is `status: DRAFT`.** Each page renders a non-dismissible "not
yet in force" banner, and no document carries an effective date. Nothing here is
in force until counsel clears it and a human sets the dates.

---

## 6. Open items for Myke

1. **Token expiry / forfeiture** — Schedule BL, BL-4. Blocks token disclosure at
   point of sale. Compounded by the Academy grant (§4.2).
2. **Governing law, venue, arbitration provider** — master §16.
3. **Academy refund policy** — Schedule FA, FA-4; five sub-questions listed there.
4. **Provision `cancel@` and `accessibility@`** mailboxes (§4.9).
5. **Ship the age gate, or soften DC-1** (§4.8).
6. **Persona bylines vs. institutional attribution** (§4.3) — a brand decision.
7. **Confirm the master's home** if `Faraday-intelligence` is being revived (§2).
8. **Re-run this survey** against the three unreachable repos and retire any
   duplicate legal pages they carry (§1).
9. **Fill the pricing values** — every tier amount and Stripe price id in
   `src/config/pricing.ts` is `null` behind a `TODO(myke)`, by design.
