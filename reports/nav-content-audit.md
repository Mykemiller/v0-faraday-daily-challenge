# Nav Bar Content Audit — Daily Challenge

**Ticket:** FAR-382 · **Epic:** FAR-386 (Launch Weekend) · **Target:** Mon Jul 27, 2026
**Repo:** `v0-faraday-daily-challenge` (Next.js App Router) · **Date of audit:** 2026-07-24
**Author:** Claude Code (discovery only — no page/component/route/content changed)

> This is a **discovery** artifact. It does not fix anything (D8). Every finding that
> needs work is listed as a proposed follow-up ticket in §6 for Myke to file.

---

## Summary counts

Distinct nav-reachable pages assessed: **19**

| Status | Count | Pages |
|---|---|---|
| **Real** | 6 | `/challenge`, `/challenge/hints`, `/challenge/about`, `/challenge/answers`, `/account`, `/account/notifications` |
| **Placeholder** | 13 | `/leaderboard`, `/free-agency`, `/about`, `/who-is-faraday`, `/share`, `/merch`, `/legal`, `/help/hints`, `/help/tips`, `/help/questions`, `/help/glossary`, `/help/report-a-bug`, `/help/feedback` |
| **Broken** | 0 | — |

**Launch blockers (must-fix before Sat, see §3):**

1. **`/leaderboard` ships destructive admin controls to every visitor.** The page renders an
   "Admin · Testing Only" block with **⚠ Reset All Scores** and **⚠ Clear All Subscribers**
   buttons, with **no auth/role guard** — any subscriber reaching Compete → Leaderboard can
   POST to `/api/admin/reset-scores` / `/api/admin/clear-subscribers`. One click from the
   primary trophy icon.
2. **Day-content data plane may be empty at launch.** `/challenge/hints`, `/challenge/about`,
   `/challenge/answers` are Real code but read `dc_daily_page_content`, whose migration
   (`20260703000002…`) is **not yet applied to prod** (per repo CLAUDE.md). If unpopulated,
   all three render "isn't ready yet" empty states. All three sit in the "?" Help dropdown.
3. **`/free-agency`** — "Trade window: TBD" stub, in the Compete dropdown.
4. **Six `/help/*` stubs** — Hints / Tips / Questions (Help "?" menu) and Glossary /
   Report a Bug / Feedback (gear menu). "Report a Bug" and "Feedback" are exactly what a
   launch-weekend subscriber reaches for; both are "Coming soon" stubs.

---

## Phase 0 — Investigation

### 0.1 Nav structure

The masthead is implemented **twice** as a deliberate twin pair (confirmed in repo CLAUDE.md):

- **In-app nav** — `HeaderIconNav` in `src/components/DailyChallenge.jsx`, menus built by
  `buildHeaderMenus()` (line ~2480). Used on `/challenge` (the lobby + all 7 games). Items are
  in-app screen switches (`onGame`, `onAccount`, …) or `href`s.
- **Standalone nav** — `SiteHeaderNav` in `src/components/SiteHeaderNav.tsx`, menus built by
  `buildSiteMenus()` (line 72). Used on every standalone Next route (`/account`,
  `/account/notifications`, `/leaderboard`, `/challenge/hints|about|answers`, and the
  `DcStubPage` shell). Items are real `href`s.

Both expose the intended **five-icon structure**, matching the design spec:

| # | Icon | Label | Confirmed |
|---|---|---|---|
| 1 | grid (tile) | All Games | ✓ |
| 2 | ? | Help & Feedback | ✓ |
| 3 | trophy | Compete | ✓ |
| 4 | gear | Account | ✓ (auth-conditional contents) |
| 5 | hamburger | More Faraday | ✓ |

The two builders are kept in sync (verified item-by-item). Behavior (single-open dropdown,
click-outside + Escape close, caret flip) is consistent. **No nav item points nowhere** — every
`href` resolves to an existing route or an in-app action. **Faraday Academy** (More Faraday) is
intentionally `disabled: true` with no href — inert by design, not a dead link.

### 0.2 Route inventory (App Router)

45 `page.*` files exist. Mapping nav → route below. Routes that exist but are **not** reachable
from the DC nav are listed in §5 (Orphans).

- The **All Games** menu deep-links to `/challenge?game=<type>`; the lobby honors the `game`
  param on mount (DailyChallenge.jsx ~line 2915). The **7 standalone per-game routes**
  (`/challenge/rackl`, `/circuit`, `/dark-fiber`, `/frequency`, `/signal-drop`, `/the-brief`,
  `/the-stack`) are `redirect('/challenge')` shims — not nav-reachable, never 404.
- **Duplicate destinations:** "Leaderboard — Today" and "Leaderboard — Season" both → `/leaderboard`
  (no today-only view exists yet). "Account" and "Settings" both open `/account`. "Notifications"
  appears in both the gear and hamburger menus → `/account/notifications`.

### 0.3 Auth gating

There is **no `middleware.*` and no route-level auth gate**. Every nav-reachable route renders in
both auth states:

- **Public, identical logged-in/out:** `/challenge`, all `/help/*`, `/free-agency`, `/about`,
  `/who-is-faraday`, `/share`, `/merch`, `/legal`.
- **Public, content differs by token:** `/leaderboard` (adds the "you" row when signed in),
  `/challenge/answers` (server-side gate: anonymous → all answers locked; the page still renders),
  `/challenge/hints` & `/challenge/about` (render regardless).
- **Renders an embedded sign-in gate when unauthenticated (OTPGate), full UI when authed:**
  `/account`, `/account/notifications`. These are functional in both states — the signed-out
  state is a real sign-in screen, not a block or error.

No nav-reachable page **hard-requires** auth. Differences by state are noted per-row in §1.

---

## Phase 1 — Inventory

Legend: **R** = Real · **P** = Placeholder · **B** = Broken. "Auth" = does the page's *content*
change by auth state (no route is hard-gated).

| Nav path | Route | Auth | Status | Evidence | Recommended action |
|---|---|---|---|---|---|
| Tile → All Games → (Rackl, Circuit, Dark Fiber, Frequency, The Stack, Signal Drop, The Brief) | `/challenge` (`?game=<type>`) | Public (play anon) | **R** | The live game lobby + 7 puzzles (`DailyChallenge.jsx`, ~5k lines). No MW leak, no dev/test copy, no stub markers. Deep-link param honored. | None. |
| ? → Hints | `/help/hints` | Public | **P** | `DcStubPage` — "Coming soon" chip + "This page will collect per-game hint guides." | Write evergreen hints how-to, or repoint to `/challenge/hints`. |
| ? → Tips and Tricks | `/help/tips` | Public | **P** | `DcStubPage` stub, blurb only, no body content. | Write strategy content. |
| ? → Questions | `/help/questions` | Public | **P** | `DcStubPage` stub, blurb only. | Write FAQ. |
| ? → Hints Today | `/challenge/hints` | Public | **R** | Functional page: fetches `/api/challenge/day-content`, 3-tier reveal sharing the FAR-198 hint budget, empty + error + loading states. **Caveat:** depends on `dc_daily_page_content` (migration unapplied to prod → may render "hint set isn't ready yet"). | Ensure migration applied + sync cron live + Airtable Hint fields populated before launch. |
| ? → About Today's Challenge | `/challenge/about` | Public | **R** | Functional: day theme/domain framing from `about_content`, empty/error/loading states. **Caveat:** same data dependency; also renders `IDF Domain {domain_code}` when populated — cross-ref **FAR-387** (raw D#.# leak). `domain_code` is null today, so nothing leaks now. | Same data gate; confirm FAR-387 decides whether to surface raw domain codes. |
| ? → Answers Today | `/challenge/answers` | Content differs | **R** | Functional: per-puzzle answer + explanation, server unlock gate (anon = all locked, rendered with sign-in prompt), live stats, streak. **Caveat:** same `dc_daily_page_content` dependency. | Same data gate. |
| Trophy → Leaderboard — Today | `/leaderboard` | Content differs | **P** | Standings/teams/you-row are **Real & functional**, BUT the page renders an unguarded **"Admin · Testing Only"** block with **Reset All Scores** / **Clear All Subscribers** buttons (lines 475-504) visible to every visitor. Classified Placeholder on the "dev/test copy" criterion (D1/D2). Also: "Today" == "Season" destination (no today-only view). | **Remove the admin block from the page** (and confirm the `/api/admin/*` routes are server-side gated). Add a real today view or relabel. |
| Trophy → Leaderboard — Season | `/leaderboard` | Content differs | **P** | Same page/route as above (duplicate destination). | See above. |
| Trophy → Teams | `/leaderboard?view=teams` | Content differs | **P** | Same page, Teams tab — aggregate team totals are Real. Inherits the admin-block defect. | See above. |
| Trophy → Free Agency | `/free-agency` | Public | **P** | `DcStubPage` — renders literal **"Trade window: TBD"** + "nothing here is functional yet" (in-code comment) / "Details land here before the first window." | Build free-agency window or keep clearly labeled coming-soon. |
| Gear (authed) → Account | `/account` | Gate/authed | **R** | Full page: handle edit w/ validation, streak, teams picker (join≤5/leave), recent games, leave/rejoin. Unauth → embedded OTPGate sign-in. | None. |
| Gear (authed) → Settings | `/account` | Gate/authed | **R** | Duplicate destination — opens the same Account page (no separate settings surface yet). | Optional: separate Settings or drop the item. |
| Gear → Notifications | `/account/notifications` | Gate/authed | **R** | Full page: master switch, 4 alert categories × SMS/Email chips, optimistic auto-save, unauth → OTPGate. Defaults cleanly if `notification_preferences` column absent. | None. |
| Gear → Glossary | `/help/glossary` | Public | **P** | `DcStubPage` — "A browsable glossary is on the way." | Build glossary from Lexicon. |
| Gear → Report a Bug | `/help/report-a-bug` | Public | **P** | `DcStubPage` — "A proper report form is coming here." No form. | Launch-sensitive: provide a real report path (form or mailto). |
| Gear → Feedback | `/help/feedback` | Public | **P** | `DcStubPage` — blurb only, no input. | Launch-sensitive: provide a real feedback path. |
| Gear (signed-out) → Sign In | `/account` | Unauth | **R** | Opens `/account`, which shows the OTPGate sign-in screen. Functional. | None. |
| Gear → Sign Out | *(action)* | Authed | **R** | Clears session localStorage → `/challenge`. Not a route. | None. |
| Hamburger → About Faraday Intelligence | `/about` | Public | **P** | `DcStubPage` — has real brand prose but wears the "Coming soon" chip and says "The full story is being written." | Promote to a finished page (strip coming-soon framing). |
| Hamburger → Who is Faraday | `/who-is-faraday` | Public | **P** | `DcStubPage` — real persona copy but "Coming soon" chip + "his full story … is on its way." | Finish persona page. |
| Hamburger → Share / Invite | `/share` | Public | **P** | `DcStubPage` — "A dedicated share hub lands here." Points users back to in-product sharing. | Build share hub or repoint. |
| Hamburger → Notifications | `/account/notifications` | Gate/authed | **R** | Duplicate of gear → Notifications. Real. | None. |
| Hamburger → Faraday Merchandise | `/merch` | Public | **P** | `DcStubPage` — "The shop isn't open yet." | Build/repoint to external shop when ready. |
| Hamburger → Faraday Academy | *(no href)* | — | *n/a* | `disabled: true` — grayed, no link, by design. Not reachable. | None (intentional). |
| Hamburger → Terms / Privacy | `/legal` | Public | **P** | `DcStubPage` — "Final terms … are being prepared." No legal text. | **Launch-sensitive:** publish real ToS/Privacy. |

---

## Phase 2 — Automated pass (D4 patterns)

Ran the D4 case-insensitive pattern set across `src/app/**/page.tsx` and imported content
(`DailyChallenge.jsx`, `DcStubPage.tsx`, `SiteHeaderNav.tsx`). Results (D3: regex is a first
pass, not the verdict):

- **`lorem ipsum`, `dummy`, `test content`, `example.com`, `foo`/`bar` (user-visible)** — no hits.
- **`TODO` / `TBD` / `FIXME` / `XXX`** — no hits in user-visible copy. Two `// TODO` *code
  comments* in the nav builders ("no today-only view yet"). One **user-visible "TBD"**:
  `/free-agency` renders "Trade window: TBD" (already Placeholder).
- **`coming soon` / `under construction` / `placeholder`** — the only user-visible hits are the
  `DcStubPage` "Coming soon" chip (the intended stub marker) on the 11 stub pages, and input
  `placeholder=` attributes (not content). Confirms the stub set.
- **`\b[DT]\d+(\.\d+)?\b` (leaked domain codes)** — no hits in rendered copy on any nav page. One
  *conditional* render path: `/challenge/about` line 90 would show `IDF Domain <code>` if
  `about.domain_code` were populated (currently null). Flagged for **FAR-387**.
- **`mw_total` / `mw_balance` / `my_mw` / "MW points"** (retired concept) — **no user-visible
  leaks.** Apparent `MW`/`mw_` matches were false positives: a base64 image blob, code comments,
  and legitimate puzzle content ("DC-DC converter", "800V DC Transition").
- **Heading-only components** — none among nav pages; every page has body content, a data fetch,
  or a functional gate.

Automated pass did **not** surface the leaderboard admin block (it has no keyword trigger) — it
was caught in the manual pass, underscoring D3.

---

## Phase 3 — Manual pass (D5 auth states, D6 breakpoints)

Every page was read at the source level and assessed for rendered content in both auth states.
**Breakpoint note (methodology):** the data layer (Supabase/Airtable) is not provisioned in the
audit container, so a live browser render would mostly show loading/empty states. Breakpoint
assessment was therefore done by **static analysis of the responsive markup**, not live rendering.
All nav pages use consistent responsive Tailwind (`max-w-2xl` containers, `flex-wrap`, fixed-then-
fluid grids like `grid-cols-[2.5rem_1fr_4rem_4.75rem]` that fit ≥360px) and the shared nav hides
the ambient status ≤430px. **No obvious mobile-collapse was found in static analysis**, so no page
is classified Broken on D6 — but a live mobile smoke-test on a seeded environment is recommended
before sign-off (listed as a follow-up).

Manual-pass overrides applied:
- `/leaderboard` — regex-clean but **downgraded to Placeholder** on manual read (admin block).
- `/about`, `/who-is-faraday` — have real prose but are **Placeholder** because they explicitly
  wear the "Coming soon" chip and defer their real content (D2: when uncertain, Placeholder).

---

## Phase 3.5 — Launch blockers vs post-launch

### Launch blockers (Broken + one-click Placeholders a subscriber will hit)

| Page | Why it's a blocker | Severity |
|---|---|---|
| `/leaderboard` | Destructive **Reset All Scores / Clear All Subscribers** buttons render for all visitors, unguarded; Compete → Leaderboard is a primary-icon click. | **Critical** |
| `/challenge/hints`, `/challenge/about`, `/challenge/answers` | Real code, but `dc_daily_page_content` migration unapplied to prod → likely empty "not ready yet" states at launch. Three items in the "?" menu. | **High** (data/ops gate) |
| `/help/report-a-bug`, `/help/feedback` | Launch weekend = peak bug/feedback intent; both are "Coming soon" stubs (gear menu). | **High** |
| `/free-agency` | "Trade window: TBD" stub in the Compete dropdown. | Medium |
| `/help/hints`, `/help/tips`, `/help/questions`, `/help/glossary` | Coming-soon stubs one click from the "?" and gear menus. | Medium |
| `/legal` | Terms/Privacy is a stub with no legal text; launch-sensitive for compliance. | Medium |

### Post-launch (Placeholders buried enough to survive the weekend)

Behind the **hamburger** (More Faraday), lower-traffic during launch:
`/about`, `/who-is-faraday`, `/share`, `/merch`. Each is a clearly-labeled "Coming soon" stub with
holding copy — acceptable to ship as-is for launch weekend, schedule fills afterward.

---

## Phase 5 — Orphans

### Routes that exist but are NOT nav-reachable from the DC nav

| Route | Note |
|---|---|
| `/` | Storefront homepage (8 products). Site root; reachable by URL and via the `/about` stub's link, but the DC nav wordmark points to `/challenge`, not `/`. |
| `/challenge/{rackl,circuit,dark-fiber,frequency,signal-drop,the-brief,the-stack}` | 7 legacy per-game routes, all `redirect('/challenge')`. Nav uses `?game=` deep-links, not these. Intentional non-404 shims. |
| `/academy` | `redirect()` to external Academy app. The "Faraday Academy" nav item is intentionally disabled (no link); homepage links here. |
| `/auth` | Magic-link/OTP auth flow. Reached during sign-in, not a nav item. |
| `/intelligent-alert`, `/briefing-library`, `/jurisdiction-watch`, `/signal-room`, `/thought-forge`, `/live-agent` | Product storefronts — homepage-reachable, deliberately **not** in the DC nav (per design). `/live-agent` is live; the other four are `DcStubPage`/`StubPage` stubs. |
| `/library`, `/library/[id]` | Briefing library surface. Not in DC nav. (`/library` renders a "Coming Soon" block.) |
| `/internal/clerk-program` | Internal tool, not subscriber-facing. |
| `/league-office` + `/audit`, `/leagues`, `/puzzles`, `/seasons[/id]`, `/subscribers[/id]`, `/teams[/id]` | Admin/ops console. Not in subscriber nav (correct). |
| `/leaderboard/team/[teamId]` | Reachable **transitively** from `/leaderboard` (team rows link here), not directly from nav. |
| `/leaderboard/join/[token]` | Team-invite deep link. Reached from invite URLs, not nav. |
| `/notifications` | `redirect('/account/notifications')`. Kept so old menu links/bookmarks never 404. |

### Nav entries that resolve to nothing

**None.** Every nav href maps to an existing route or in-app action. "Faraday Academy" is
deliberately inert (`disabled`, no href) — flagged here only so it isn't mistaken for a dead link.

---

## Phase 6 — Recommended follow-up tickets (for Myke to file — not created here)

| # | Proposed summary | Route(s) | Priority |
|---|---|---|---|
| T1 | Remove the "Admin · Testing Only" reset/clear block from the public leaderboard; verify `/api/admin/*` are server-gated | `/leaderboard` | **P0 — pre-launch** |
| T2 | Ensure day-content data plane is live before launch (apply `dc_daily_page_content` migration, enable sync cron, populate Airtable Hint/Answer/Domain fields) | `/challenge/hints`, `/about`, `/answers` | **P0 — pre-launch** |
| T3 | Real "Report a Bug" path (form or mailto) | `/help/report-a-bug` | **P0/P1** |
| T4 | Real "Feedback" path | `/help/feedback` | **P0/P1** |
| T5 | Publish real Terms of Service / Privacy Policy | `/legal` | **P1 (compliance)** |
| T6 | Free Agency: build the window or ship an explicit, honest coming-soon (remove "TBD") | `/free-agency` | P1 |
| T7 | Evergreen Help content: Hints how-to, Tips & Tricks, Questions/FAQ, Glossary (from Lexicon) | `/help/{hints,tips,questions,glossary}` | P1 |
| T8 | Finish "About Faraday Intelligence" — strip coming-soon framing | `/about` | P2 |
| T9 | Finish "Who is Faraday" persona page | `/who-is-faraday` | P2 |
| T10 | Build Share / Invite hub (or repoint to in-product share) | `/share` | P2 |
| T11 | Merchandise page or repoint to external shop | `/merch` | P2 |
| T12 | Add a real today-only leaderboard view, or relabel the two identical "Today/Season" nav items | `/leaderboard` | P2 |
| T13 | Decide whether raw IDF domain codes should render to subscribers (coordinate with FAR-387) | `/challenge/about` | P2 |
| T14 | Live mobile/desktop smoke-test of all nav pages on a seeded env (audit did static breakpoint analysis only) | all nav pages | P2 |
| T15 | Consider dropping the duplicate "Settings" nav item or giving it a distinct surface | `/account` | P3 |

---

## Acceptance criteria check

- [x] Every nav entry point, including all dropdown items, appears in the inventory (§1).
- [x] Every nav-reachable page classified Real / Placeholder / Broken — no blanks.
- [x] Every classification carries specific evidence.
- [x] Both auth states assessed; differences reported (§0.3, §1).
- [x] Both breakpoints assessed (static responsive-markup analysis; live smoke-test flagged as T14).
- [x] Launch blockers separated from post-launch (§3.5).
- [x] Orphaned routes and dead nav entries listed (§5).
- [x] Report committed at `reports/nav-content-audit.md`.
- [x] Zero changes to any page, component, route, or content file — the diff is this report only.
