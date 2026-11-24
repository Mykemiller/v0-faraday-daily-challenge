# faraday-masthead 1.1.0 (FDY-444 · CC-BRAND-MASTHEAD-1.0; 1.1.0 FDY-460 · BRAND-1.1)

One top bar for every Faraday subscriber app and the Workbench. **Canonical copy lives here**; each app vendors it
as `lib/faraday-masthead/` (all files, including `VERSION` and `MANIFEST.json`). Never edit a vendored copy:
change this one, bump `VERSION` (and `MASTHEAD_VERSION` in `core.ts`), run the build, re-vendor.

The design is Brand Bible 5.0 S3 and is fixed: a full-width forest bar (64 px, 56 px under 640 px) with a 2 px gold
rule above and below; the Faraday mark on the left, the "Faraday" wordmark centred, and a context slot on the right
(app name + "Sign in" or the signed-in email). **No per-app colour, logo or layout.** Each app's own navigation goes in
the `AppBar` directly underneath (surface-warm, ink text, 48 px).

| File | Does |
|---|---|
| `core.ts` | Tokens, `MASTHEAD_CSS`, `renderMastheadHtml` / `renderAppBarHtml` (the one definition of the markup), `contrastRatio`, `CONTRAST_PAIRS`, `FORBIDDEN_IN_BAR`, `MASTHEAD_SCRIPT` (static menu toggle). Pure, SSR-safe. |
| `ui/Masthead.tsx` | React 18/19: `<Masthead/>`, `<AppBar/>`, `<MastheadStyles/>`. Byte-identical to the static renderer (tested). |
| `static/masthead.css`, `static/masthead.html` | Generated. For servers without React or TypeScript (fill the `{{PLACEHOLDERS}}`). |
| `check-drift.mjs` | Run in each app's CI: vendored files match `MANIFEST.json`; with `--canonical` also the canonical `VERSION`. |
| `scripts/build.mjs` | Regenerates `static/*`, the gate's static header, and `MANIFEST.json`. `--check` = CI mode. |

## Use (React / Next.js)

```tsx
import { Masthead, AppBar } from "@/lib/faraday-masthead/ui/Masthead.tsx";

<Masthead appName="Jurisdiction Watch" homeHref="/jurisdiction-watch" email={user?.email} signInHref="/account" />
<AppBar label="Jurisdiction Watch" links={[{ label: "Map", href: "/jurisdiction-watch", current: true }, { label: "Wall", href: "/wall" }]} />
<main id="main">…</main>
```

- `context` (ReactNode) puts extra compact items before the app name: Daily Challenge passes its handle and score chips,
  the Workbench passes the signed-in Owner. It never changes colour, logo or layout.
- `onSignIn` turns "Sign in" into a button (the gate opens its sign-in panel); `signIn` replaces the control entirely.
  Pass `signIn` as a function, `signIn={(close) => …}`, to get `close()`, which shuts the narrow-screen menu.
- The skip link targets `#main` by default (`skipTo` to change). Give your `<main>` that id.
- Under 640 px the context collapses into a 44 px initial button that opens a small menu; the wordmark stays centred.
  The menu closes when any link or button inside it is activated, on Escape, on a click outside, when focus leaves it,
  and on the `fm:close` event (`document.dispatchEvent(new Event(MASTHEAD_CLOSE_EVENT))`). No app needs its own workaround.
- `<AppBar>` takes `links` and/or `children` (dropdowns, buttons). By default its row scrolls sideways on narrow screens,
  which clips absolutely positioned dropdowns. `overflow="visible"` (class `fm-appbar--menus`) turns the scroller off and
  lets items wrap instead: use it when the AppBar holds dropdown menus. The static renderer takes the same `overflow`.

## Use (static HTML)

Include `static/masthead.css` (or `MASTHEAD_CSS`) once, render `renderMastheadHtml(opts)` (or fill
`static/masthead.html`), and optionally add `MASTHEAD_SCRIPT` for the narrow-screen menu toggle (it also opens by
keyboard focus without the script). `renderAppBarHtml({ label, links, extraHtml, overflow: "visible" })` for an AppBar with
dropdowns.

## What changed in 1.1.0 (FDY-460)

- `AppBar` / `renderAppBarHtml`: opt-in `overflow="visible"` (`fm-appbar--menus`: `overflow:visible`, items wrap). The default
  (one scrolling row) is unchanged.
- Narrow-screen menu: closes when a link or button inside `.fm-panel` is activated (React: click capture on the panel;
  static: `MASTHEAD_SCRIPT`). `signIn` may be a render function that receives `close`; both versions also close on the
  `fm:close` event (`MASTHEAD_CLOSE_EVENT`).
- Once the script or React has mounted, the context carries `data-fm-js` and `data-open` alone drives the menu.
  `:focus-within` stays as the no-script fallback. (In 1.0.0, a button that kept focus after a click, including the initial
  button itself, held the menu open in Chromium even after it was told to close.) Server markup is unchanged.
- `faraday-gate` 1.2.0 goes with it (optional `homeHref`).

## Re-vendor (follow-up PRs, one per app, after this merges)

Copy the whole package (and `faraday-gate` 1.2.0 where the app vendors it), run `check-drift.mjs`, then delete the local
workaround the app carried for 1.0.0:

| App | Vendored at | Delete / change |
|---|---|---|
| Daily Challenge (`v0-faraday-daily-challenge`) | `src/lib/faraday-masthead`, `src/lib/faraday-gate` | `src/components/dcAppBarStyles.ts:31` (`.dc-appbar .fm-appbar-in { overflow:visible; }`) and its note at lines 13-17; pass `overflow="visible"` to `<AppBar>` at `src/components/SiteHeaderNav.tsx:320` and `src/components/DailyChallenge.jsx:3371` (the `.dc-appbar` wrapper stays: it is the sticky element). |
| Jurisdiction Watch (`faraday-jurisdiction-watch`) | `lib/faraday-masthead`, `lib/faraday-gate` | In `src/components/site-chrome.tsx`: the positioned wrapper `<div className="jw-appbar-wrap">` (lines 254 and 270) and its rule at 220; the `.jw-menu` overrides at 221 (`position: static`) and 223 (`right:auto; margin-top:0`), re-checking the narrow inset rule at 227; the note at 186-190. Pass `overflow="visible"` to `<AppBar>` at line 255 so `.jw-menu` (position: relative) anchors its own panel. |
| Live Agent (`live-agent`) | `src/lib/faraday-masthead` | `src/ui/Shell.tsx:435`, the synthetic `document.dispatchEvent(new MouseEvent("click"))` in `openSignIn`, and the sentence about it in the comment at 428-430: the "Sign in" / "Signed in" buttons sit inside the panel, so activating them now closes the menu. |

Line numbers are from each repo's `main` at the time of FDY-460 (DC `6c0c434`, JW `376a16c`, LA `1950ec7`).

## Vendoring and drift

```bash
cp -R <workbench>/packages/faraday-masthead lib/faraday-masthead
node lib/faraday-masthead/check-drift.mjs            # CI: exit 1 on any edited/missing file
```

If the app also vendors `faraday-gate` ≥ 1.1.0, vendor both side by side under `lib/`: the gate imports
`../../faraday-masthead/ui/Masthead.tsx`.

## Rules

- Tokens only (`TOKENS`); fonts IBM Plex Serif / Bricolage Grotesque / IBM Plex Mono. No navy, no other greens.
- No prices, counts of Theaters/Sectors/Threads/Domains or marketing copy in the bar (Brand Bible G1).
- `<header role="banner">`, skip link, gold-light focus outline, 44 px tap targets, AA contrast (asserted in tests).
- The mark and wordmark link to the app's own home, never another domain.

## Tests

`node --experimental-strip-types --no-warnings --test packages/faraday-masthead/test/masthead.test.ts` (no deps) and
`test/render.test.mjs` (React parity + the gate in every view; needs react, react-dom and esbuild via `NODE_PATH`,
skips without them). The Workbench also runs `test/masthead-page.mjs` (Playwright screenshots at 380/768/1280/1920 px,
the menu closing on inner activation and the AppBar overflow modes in Chromium; its React menu checks run when react,
react-dom and esbuild are on `NODE_PATH`).
