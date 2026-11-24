# faraday-masthead (FDY-444 · CC-BRAND-MASTHEAD-1.0)

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
- The skip link targets `#main` by default (`skipTo` to change). Give your `<main>` that id.
- Under 640 px the context collapses into a 44 px initial button that opens a small menu; the wordmark stays centred.
- `<AppBar>` takes `links` and/or `children` (dropdowns, buttons).

## Use (static HTML)

Include `static/masthead.css` (or `MASTHEAD_CSS`) once, render `renderMastheadHtml(opts)` (or fill
`static/masthead.html`), and optionally add `MASTHEAD_SCRIPT` for the narrow-screen menu toggle (it also opens by
keyboard focus without the script).

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
skips without them). The Workbench also runs `test/masthead-page.mjs` (Playwright screenshots at 380/768/1280/1920 px).
