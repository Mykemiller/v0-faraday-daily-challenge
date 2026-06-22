# /public/fonts — licensed display faces (drop point)

The Faraday display face is **Freight Display Pro** (fallback target: Tiempos Headline).
These are **licensed** (Klim / Garage) and are **not** on Google Fonts or any free CDN.
Do **not** commit pirated/lookalike copies. Myke licenses and supplies the files.

## TODO — drop the licensed files here

Place the licensed WOFF2 files in this directory, e.g.:

```
public/fonts/FreightDisplayPro-Semibold.woff2
public/fonts/FreightDisplayPro-Bold.woff2
```

## Activate the seam

Until the files exist, the site falls back gracefully via the `--font-display`
variable in `src/app/globals.css`:

```css
--font-display: 'Freight Display Pro', 'Tiempos Headline', var(--font-serif);
```

`var(--font-serif)` resolves to IBM Plex Serif → Georgia, so headlines render
cleanly today with no broken build.

When the licensed files land, wire them with `next/font/local` (do **not** add a
CDN `<link>` for these). Add `src/app/fonts.ts`:

```ts
import localFont from "next/font/local";

export const freightDisplay = localFont({
  variable: "--font-display",
  display: "swap",
  src: [
    { path: "../../public/fonts/FreightDisplayPro-Semibold.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/FreightDisplayPro-Bold.woff2",     weight: "700", style: "normal" },
  ],
  fallback: ["Tiempos Headline", "IBM Plex Serif", "Georgia", "serif"],
});
```

Then in `src/app/layout.tsx` add `freightDisplay.variable` to the `<html>`/`<body>`
className, and in `globals.css` change the `@theme` line to:

```css
--font-display: var(--font-display), 'IBM Plex Serif', Georgia, serif;
```

> `next/font/local` throws at build time on missing files — that is why the module
> above is documented here rather than imported now. Activate it only after the
> `.woff2` files are present.
