# FDY-445 · BRAND-1a · Faraday masthead on Daily Challenge, Faraday Predicts, Intelligent Alert

Workstream CC-BRAND-MASTHEAD-1.0 (parent FDY-444). Package source: Faraday-Workbench PR #55
(`packages/faraday-masthead` 1.0.0, `packages/faraday-gate` 1.1.0). Branch `claude/fdy-445-masthead`.

## What changed

| Area | Change |
|---|---|
| Vendoring | `src/lib/faraday-masthead/` = byte copy of the canonical 1.0.0 package (all files incl. `VERSION`, `MANIFEST.json`, `check-drift.mjs`, `scripts/`, `static/`, `test/`). `node src/lib/faraday-masthead/check-drift.mjs` → "vendored copy matches its manifest". |
| Gate | `src/lib/faraday-gate/` re-vendored 1.0.2 → **1.1.0** (same file subset as before: core, server/*, ui/*, README, VERSION, `gate-copy/predicts.json`); `MANIFEST.sha256` regenerated. GatePage now imports `../../faraday-masthead/ui/Masthead.tsx`. |
| CI | The repo has no `.github/workflows/`; the drift check + the package's 16 unit tests are wired into `npm test` (first step) and `npm run test:faraday-masthead`. |
| Daily Challenge (standalone routes) | `SiteHeaderNav.tsx`: `<Masthead appName="Daily Challenge" homeHref="/challenge">`, @handle chip in the context slot, signed-in email from `dc_email` (only when a `dc_session` token exists), "Sign in" → `/account` (the existing Sign In target). Message dock + the five icon dropdowns moved into `<AppBar label="Daily Challenge">`. `buildSiteMenus` untouched. |
| Daily Challenge (in-app) | `DailyChallenge.jsx`: same masthead; @handle + Today's/Season score chips in the context slot (handle button still opens Account / the gate); "Sign in" is a button (`onSignIn`) that opens the in-app gate, as before. Dock + `HeaderIconNav` in the AppBar. `buildHeaderMenus` untouched. |
| Shared nav CSS | `src/components/dcAppBarStyles.ts` — ONE copy of the `.dc-*` trigger/dropdown CSS used by both mastheads (was duplicated). Recoloured for the surface-warm AppBar (see Contrast). |
| Predicts | `PredictsShell.tsx`: forest bar + sticky Predicts header replaced by `<Masthead appName="Faraday Predicts" homeHref="/predicts">` + a sticky `<AppBar>` carrying the section tabs (≥768px, as before), the record pill and "← All storefronts" (→ `/`). The fixed bottom tab bar on phones is unchanged (it is the phone section nav, so the AppBar does not repeat the tabs there). `layout.tsx` passes the gate-verified email. |
| Predicts gate | Renders the masthead from the vendored package (asserted in `faraday-gate-render.test.mjs`: `data-fm="1.0.0"` + `fm-app` = "Faraday Predicts"; screenshot `FDY-445-predicts-gate-*-top.png`, taken with `FARADAY_GATE_ENFORCE=1`). |
| Intelligent Alert | `StubPage` gained an opt-in `masthead` prop; `/intelligent-alert` uses it (`appName="Intelligent Alert"`, `homeHref="/intelligent-alert"`, AppBar = "← All storefronts" → `/`). Other stub pages unchanged. |
| Skip link | `id="main"` on the `<main>` of every page that wears `SiteHeaderNav`, the in-app `<main>`, `StubPage`'s `<main>`; Predicts wraps its content in `<div id="main">`. |
| Sticky offset | `/help/glossary` search bar `top-[68px]` → `top-[49px]` (the sticky element is now the 49px AppBar). |

Every menu item and link target is unchanged. League Office, `/`, scoring, game logic, puzzle content and API routes
are untouched.

## Contrast (WCAG 2.1 AA, `npm run test:contrast` — 38/38)

AppBar background is surface-warm `#EEE6DA`. Trigger glyph forest `#1C3424` 10.8:1 · caret ink/0.7 `#55524D` 6.3:1 ·
unread dot deep amber `#94560A` 4.7:1 (gold `#C4922A` would be 2.3:1) · hover/open = forest tint + gold inset
underline (the AppBar's own current-link treatment). Dropdown panels stay forest: items warm-white 12.3:1, labels/
headings and the dock hint sage 5.1:1 (were cream/0.4 = 3.0:1), hover/current gold-light 5.3:1 (was gold 3.8:1).
Context slot: @handle gold 4.8:1, season score warm-white 12.3:1, labels sage 5.1:1.

`scripts/contrast-check.mjs` used to exit 0 before checking anything when no service key was set; it now always runs
the static pairings (incl. the new masthead/AppBar ones) and skips only the game-accent checks, which must never run
against a stale copy.

## Tests

| Suite | Result |
|---|---|
| `npm run build` | pass |
| `npm test` (drift check + masthead 16 + tokenomics/dc-ui/pwa/sw/gate) | drift clean; 16/16; 108 pass + 1 skip (canonical-path test, skips when the Workbench is not at `../../../faraday-workbench`) |
| `npm run test:faraday-gate` with `FARADAY_GATE_CANONICAL=<workbench>/packages/faraday-gate` | 16/16 (byte-identical to canonical 1.1.0) |
| `test:contrast` | 38/38 |
| `test:hosts` 83 · `test:lobby-model` 35 · `test:messaging` 28 · `test:predicts` 62 · `test:predicts-pwa` 25 · `test:predicts-preferences` 5 · `test:share` 40 · `test:legal` 43 · `test:no-codes` 2 | all pass |
| `tsc --noEmit` | 17 errors, all pre-existing (Deno test files), none in changed files |
| ESLint on every changed file vs `origin/main` | identical error/warning counts; vendored dir clean |

## Screenshots (`docs/brand/`, deviceScaleFactor 1)

380 and 1440 px, top 300 px + full viewport: `challenge` (lobby, signed in), `game` (Rackl), `leaderboard`, `account`,
`predicts`, `intelligent-alert`; plus `challenge-*-help-open` (dropdown open inside the AppBar, not clipped),
`challenge-380-masthead-menu` (context chips in the narrow-screen menu), `challenge-signedout-*-top`,
`predicts-gate-*-top`. Taken against `next start` of the production build with a local stub for the game catalog
(Supabase is blocked from the container) and `?mock=1` fixtures; signed-in state seeded in localStorage.
Measured in the final run: no horizontal overflow on any route at either width (masthead + AppBar never exceed the viewport), wordmark centred (190/720 px), Escape closes the
dropdown, the masthead's narrow menu opens over the sticky AppBar (z 40 vs 30).

## Decisions

1. **`.fm-appbar-in` overflow.** The vendored AppBar row is a horizontal scroller, which clips absolutely positioned
   descendants — the DC dropdowns would be cut off at the bar edge. The DC wrapper (`.dc-appbar`) sets
   `overflow:visible` on its own AppBar row (six 44px triggers fit at 320px). Vendored file untouched.
   **Recommended package follow-up:** an AppBar option for rows that host dropdowns, so apps need no override.
2. **Sticky AppBar, scrolling masthead.** The old DC/Predicts headers were sticky; now the AppBar (the nav) sticks
   and the masthead scrolls away, keeping ~49px of sticky chrome instead of ~117px.
3. **Wordmark → `/challenge`** in the in-app header is a real link (the masthead takes `homeHref`), so mid-game it
   reloads the lobby rather than switching screen in place. The old wordmark also left the game without a confirm.
4. **Sign-in targets:** DC standalone → `/account` (the existing "Sign In" item); in-app → the existing gate screen;
   Predicts and Intelligent Alert have no sign-in route of their own → `/account`. The gate page keeps its own
   sign-in button (package behaviour).
5. **Predicts gate home** is `/` (the gate package passes no `homeHref`); changing that is a package change.
6. Removed the now-dead `useWindowWidth` hook (only the old ≤430px status-hide used it) and the dock's ≤430px
   icon-row squeeze rule (it would push six triggers past 320px).

## Found, not changed

- The Rackl grid can overflow a 380px viewport by 6–24px depending on the tile shuffle (long labels in a 4-column grid; game layout, out of scope — the masthead/AppBar measured ≤380px in the same run).
- `globals.css` `.fdc-header-inner` / `.fdc-chip` are now unused by these components (left in place).
