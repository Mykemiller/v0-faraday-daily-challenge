# FDY-460 follow-up · Re-vendor faraday-masthead 1.1.0 + faraday-gate 1.2.0 into Daily Challenge

Package source: Faraday-Workbench `main` at `2428096` (PR #56). Branch `claude/fdy-460-revendor-masthead-1-1`.

## What changed

| Area | Change |
|---|---|
| `src/lib/faraday-masthead/` | Whole package copied from the canonical 1.1.0 (`diff -r` against the Workbench is empty). `check-drift.mjs` and `--canonical <workbench>/packages/faraday-masthead` both pass. |
| `src/lib/faraday-gate/` | Same file subset as before (core, server/*, ui/*, README, VERSION, `gate-copy/predicts.json`) copied from canonical 1.2.0; `MANIFEST.sha256` regenerated (5 files changed hash: README, VERSION, core.ts, ui/GatePage.tsx, ui/gate.html; `predicts.json` and `server/*` unchanged). |
| Local workaround removed | `dcAppBarStyles.ts`: the `.dc-appbar .fm-appbar-in { overflow:visible; }` rule and its layout note. Both DC AppBars (`SiteHeaderNav.tsx`, `DailyChallenge.jsx`) now pass `overflow="visible"` (package class `fm-appbar--menus`: `overflow:visible; flex-wrap:wrap`). The `.dc-appbar` wrapper stays: it is the sticky element. |
| Predicts gate home | `src/app/predicts/layout.tsx` passes `homeHref="/predicts"` to `GatePage`, so the gate's mark and wordmark go to `/predicts` instead of `/` (FDY-445 decision 5). |
| `{{HOME}}` in `gate.html` | No server in this repo fills `gate.html` (searched the repo for `gate.html`, `fillGateHtml`, `{{APP_NAME}}`, `{{HOME}}`): Predicts renders the React `GatePage`. Nothing to fill. |
| Test | `faraday-gate-render.test.mjs` asserts `homeHref` reaches the gate's mark + wordmark and defaults to `/`. |

The Predicts AppBar (`PredictsShell.tsx`) holds links and the record pill, no dropdowns, so it keeps the default
scrolling row.

## Tests

| Suite | Result |
|---|---|
| `npm test` (drift check + masthead + tokenomics/dc-ui/pwa/sw/gate) | drift clean; 112/112, 0 skipped (canonical present) |
| `npm run test:faraday-masthead` | drift clean; 19/19 |
| `npm run test:faraday-gate` with `FARADAY_GATE_CANONICAL=<workbench>/packages/faraday-gate` | 16/16 (byte-identical to canonical 1.2.0) |
| `src/lib/faraday-masthead/test/render.test.mjs` with esbuild on `NODE_PATH` | 2/2 (React = static byte parity; gate renders the shared masthead) |
| `npm run test:hosts` | 83/83 |
| `npm run test:contrast` | 38/38 |
| `npm run build` | pass |
| `tsc --noEmit` | 17 errors, all pre-existing (Deno test files, member-counts test), none in changed files |

No headless browser in this environment, so there are no screenshots for this PR: the dropdown-not-clipped and
narrow-menu-closes checks were run in Chromium by the Workbench package's own `test/masthead-page.mjs` (PR #56), not here.

## Found, not changed

- ESLint reports 4 new errors, all inside canonical vendored files (which must not be edited here):
  `faraday-masthead/ui/Masthead.tsx:59` (`react-hooks/set-state-in-effect`) and `faraday-masthead/test/masthead.test.ts`
  (2 × `no-explicit-any`, 1 × `no-this-alias`). `next build` does not lint, so nothing fails. Fix in the Workbench package
  (or add the two vendored dirs to this repo's ESLint ignores).
