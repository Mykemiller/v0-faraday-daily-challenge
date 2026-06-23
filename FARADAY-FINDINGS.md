# FARADAY-FINDINGS.md — Brand Unification Discovery (Phase 0)

_Branch: `feat/brand-unification` · Not deployed. Source of truth for palette/type/voice/IDF: Faraday Brand Bible 4.0 (Notion). Where the live product and the prompt diverge, the **live product wins** and the conflict is flagged here._

## 0. Headline conclusion

Both "front doors" live in **one repo** — the engine-as-site. The prompt assumed the home-page repo was unknown and that the two pages might be separate; they are not. This is **token-drift removal + the two locked decisions + IA cleanup**, not a reskin. The forest+gold system is already consolidated in `globals.css @theme`.

**Locked decisions applied this pass (per Myke):**
1. Keep H1 **"Your unfair advantage in the AI data center economy."** — already the H1; preserved.
2. Bring **Jurisdiction Watch** and **Signal Room** under the brand. Signal Room is already an in-brand route; Jurisdiction Watch was leaking off-domain — fixed (see §5).
3. Freight fonts licensed **in parallel by Myke** — this pass builds the `next/font/local` seam + graceful fallback + drop point; it does not fetch or substitute the licensed faces.

## 1. Where each page lives

| Surface | URL | File | Deploy |
|---|---|---|---|
| Home / storefront (revenue door) | `faraday-intelligence.ai/` | `src/app/page.tsx` | Vercel `v0-faraday-daily-challenge-n2u5` (`prj_A7MhvdAWivMLOccGMTp6AFYZQ1s1`) |
| Daily Challenge lobby (free/viral door) | `faraday-intelligence.ai/challenge` (`/daily-challenge` rewrites in) | `src/app/challenge/page.tsx` → `src/components/DailyChallenge.jsx` | same project |

- **One repo, one Vercel project.** `faraday-daily-challenge` **is** the entire `faraday-intelligence.ai` site (engine-as-site, FAR-119). No `basePath`. The brand repo `Faraday-intelligence` is retired/dormant.
- Per-product stub routes: `/intelligent-alert`, `/live-agent`, `/briefing-library`, `/jurisdiction-watch`, `/signal-room`, `/thought-forge`, `/academy`. `/leaderboard` is a scaffold.

## 2. The stack

- **Next.js App Router** (with repo-local breaking changes — see `AGENTS.md`; read `node_modules/next/dist/docs/` before writing Next code).
- React + **Tailwind CSS v4** (`@import "tailwindcss"` + `@theme`, via `@tailwindcss/postcss`). No `@config` directive.
- Styling: Tailwind utility classes on the marketing surfaces; an inline JS color object `C` inside the game component.

## 3. Existing design tokens (where colors/fonts are defined)

| Location | What | Status |
|---|---|---|
| `src/app/globals.css` `@theme` (L8–42) | **Single source of truth.** Full forest/gold/cream palette, AA variants, 7 game neons, font vars | Keep — canonical |
| `tailwind.config.ts` | Legacy v3-style `theme.extend` with **duplicate camelCase colors** + **wrong font families** (Inter / Georgia / JetBrains Mono) | **Dead** (Tailwind v4 ignores it — no `@config`). **Deleted** this pass as drift removal |
| `src/components/DailyChallenge.jsx` `C` object (L15–35) | In-game JS mirror of the palette + game-feedback utility colors (green/amber/red) + `bg #0D110E` | Keep — in-game runtime needs JS values; mirrors `@theme` |
| `src/components/GameIcon.jsx` `GAME_NEON` (L11–19) | The 7 locked neon hexes + glows | Keep — locked, pictograms only |

**Palette (locked, in `@theme`):** forest `#1c3424` / forest-mid `#244228` / forest-light `#325638`; gold `#c4922a` / gold-light `#dab050`; warm-white `#f8f5f0` / warm-cream `#eee6da`; near-black `#141210`; sage `#8ca68a`; deep-amber `#b8710a`; warm-gray `#b2a898`. AA variants: amber-dark `#94560a`, sage-dark `#4f6b4d`, sage-light `#a6bca4`.

**No off-brand drift on public surfaces.** No electric greens / cool grays / generic-tech blues. The only non-palette colors are in-game feedback states (success/error/warning) inside `DailyChallenge.jsx`, isolated to gameplay — acceptable.

## 4. Font loading (today) and the licensing seam

**Today:** Google Fonts CDN `<link>` in `src/app/layout.tsx` — **IBM Plex Serif** (display) · **Bricolage Grotesque** (body/UI) · **IBM Plex Mono** (data). No `next/font`, no `/fonts` dir.

**Divergence from the prompt (flagged):** the prompt's type table specifies Tiempos/Freight (display), **Inter** (body), **JetBrains Mono** (data). The live product uses IBM Plex Serif / Bricolage / IBM Plex Mono. Per "live product is source of truth," this pass does **not** swap the working body/mono families (no Inter/JetBrains churn). It only adds the **display** seam Myke is licensing.

**The seam (this pass):**
- `public/fonts/` created with a `README.md` drop-point and `// TODO` for the licensed Freight/Tiempos files.
- `--font-display` added to `@theme`, mapped to `'Freight Display Pro', 'Tiempos Headline', var(--font-serif)` → **graceful fallback** to the live serif (IBM Plex Serif → Georgia) until the files land. H1/hero opener consume `font-display`.
- A ready-to-activate `next/font/local` module is documented in `public/fonts/README.md`. It is **not imported** yet, because `next/font/local` throws at build time on missing files. When Myke drops the licensed `.woff2`s, follow the README to activate (uncomment the module, swap the `--font-display` family).

## 5. Jurisdiction Watch — the off-domain leak (locked fix)

**Before:** the home tile `href` and the `/jurisdiction-watch` route both pointed to **`https://jurisdiction-watch.com`** (a hard 301 off-domain) — a brand/session leak mid-funnel.

**Decision (locked by Myke): subdomain.** JW runs under the brand at
`jurisdiction-watch.faraday-intelligence.ai`, keeping its own stack/Supabase/Stripe/
token-ledger/invariants intact (no risky in-engine port; JW is Next 14, the engine is newer).

**Engine side (done this pass):**
- Home tile → internal `/jurisdiction-watch`.
- `/jurisdiction-watch/page.tsx` → in-brand `StubPage` landing whose CTA opens
  `https://jurisdiction-watch.faraday-intelligence.ai` ("Open the live map"). **No off-domain
  `jurisdiction-watch.com` leak anywhere** (verified: 0 occurrences in the built output).

**Infra side (needs Myke — Vercel/DNS, secrets already set on the JW project):** the JW Vercel
project **already exists and has a READY production deployment** — `faraday-jurisdiction-watch`
(`prj_x0p5eLBgAiAytctUQErzXc8Eqv3Q`, team `team_JS3rgFwySt8w8yds7fAh1KeM`). It currently serves
`jurisdiction-watch.com`. Bringing it under the brand is a **domain attach + DNS only** — no redeploy:

1. Vercel → project **faraday-jurisdiction-watch** → Settings → Domains → **Add**
   `jurisdiction-watch.faraday-intelligence.ai`.
2. DNS for the `faraday-intelligence.ai` zone:
   - If the zone is on **Vercel DNS** → the record is created automatically on add.
   - If external registrar → add **CNAME `jurisdiction-watch` → `cname.vercel-dns.com`**.
3. (Optional) keep `jurisdiction-watch.com` attached as a secondary domain, or 301 it to the
   subdomain so the brand becomes canonical.
4. Verify `https://jurisdiction-watch.faraday-intelligence.ai` serves, then deploy this engine branch.

Signal Room already renders an in-brand `StubPage` (no external link) — already "under the brand."

## 6. Daily Challenge internals (do-not-touch boundary respected)

- Lobby bands, tiles, user-state, scorecards, leaderboard, and the 7 neon icons live in `src/components/DailyChallenge.jsx` (+ `GameIcon.jsx`, `BrandMark.jsx`).
- **Game mechanics, scoring/MW, auth/magic-link, and data hooks were not modified.** Edits this pass are presentation-only: game **tile order** (locked order), the **domain chip** treatment, and an additive **"From Faraday Intelligence"** cross-sell band.
- **Tile order** corrected to the locked order: `Rackl · Circuit · Dark Fiber · Frequency · The Stack · Signal Drop · The Brief` (front-loads quick-momentum games). Applied in both `DailyChallenge.jsx` (`GAME_CONFIGS`) and `page.tsx` (`DC_GAMES`).
- **Domain chip:** every tile read "POWER ARCHITECTURE" (a single hardcoded `domain` on all 7 configs). The puzzle bank rotates varied content, so asserting one domain on all seven is misleading. Replaced with a **neutral chip treatment** (the prompt's sanctioned option B) rather than inventing per-game domains.

## 7. Cross-sell + teaser seam (Phase 5)

- **"From Faraday Intelligence" band** (ship-now, always on): added to the lobby. Brand-voiced, links to commercial surfaces, **no token/price talk** (lobby stays price-free; FAR-46 meters stay unpublished).
- **Behavior-driven teasers** (built, shipped OFF behind a flag):
  - Flag: **`NEXT_PUBLIC_FARADAY_TEASERS`** — default `false`. When off, `TeaserSlot` renders `null`.
  - Component: `src/components/TeaserSlot.tsx`.
  - Contract: `src/lib/teasers.ts`.
    ```ts
    interface TeaserContext {
      registered: boolean;
      streak: number;
      gamesPlayedToday: string[];
      domainsEngaged: string[];   // plain-language domains
      lastGame: string | null;
    }
    function selectTeaser(ctx: TeaserContext):
      { surface: string; copy: string; href: string;
        slot: 'scorecard' | 'lobby-inline' | 'between-games' } | null
    ```
  - `selectTeaser` ships with a few **placeholder** mappings (e.g. played The Brief → tease Briefing Library; touched Cooling & Water Technology → tease Jurisdiction Watch), clearly marked to be expanded. Turn on by setting the env flag — no re-architecture needed.

## 8. Conflicts where the live product / project invariants override the prompt

1. **Token model (resolved by Myke).** Every product is token-metered, on **one balance**,
   with three published bundles: **500/$49 · 1,000/$89 · 10,000/$799** (already on the page).
   Per-product **meter values** (how many tokens a given briefing costs) remain **unpublished**
   per FAR-46 — the copy frames a token as "a unit of depth" without naming per-surface costs.
2. **Body/mono font families** stay IBM Plex / Bricolage (live truth), not Inter/JetBrains (prompt). Only the licensed **display** seam is added.
3. **Prompt-specific soundbites** ("While others read the news…", "Everything about data centers. Nothing else.") are not in the live copy; this pass distributes the **existing** live soundbites rather than inserting new ones.
4. **IDF vocabulary:** count-agnostic per FAR-46 / Brand Bible — no Theater/Sector/Thread/Domain counts published; no internal D-codes exposed; stays on "Faraday" (no "Mach Eigen"); lobby industry signal stays unsigned.

## 9. Acceptance-criteria status (end of this pass)

**Done:** findings doc; token drift removal (dead `tailwind.config.ts`); `--font-display`
Freight seam + `/public/fonts` drop-point; JW brought under the brand (no `.com` leak) +
subdomain decision + deploy runbook (§5); Signal Room confirmed in-brand; home IA streamline
(one-idea hero + one CTA, distributed soundbites, primary surface, coverage/IDF strip,
unfair-advantage footer); token-metered copy + bundles; locked tile order (home + lobby);
domain-chip bug fixed; "From Faraday Intelligence" cross-sell band; teaser seam (off behind flag);
**full viral loop** — real share (generated OG score card → Web Share/clipboard/download across all
7 games) + one-tap team invite. Domains verified live: `faraday-intelligence.ai` → home,
`faradaydailychallenge.com` (+www) → 301 → `/daily-challenge` (lobby).

**Pending Myke (infra, secrets/DNS):** attach `jurisdiction-watch.faraday-intelligence.ai` to the
existing `faraday-jurisdiction-watch` Vercel project (domain + DNS only — runbook §5); then deploy
this `feat/brand-unification` branch.

**Deferred/flagged:** deep five-band lobby *geometry* rebuild (this pass did targeted lobby fixes,
not a full re-band); Inter/JetBrains body/mono swap (live product is source of truth — only the
licensed display seam added); per-product numeric token meters (FAR-46).
