# FAR-395 — Shared layout primitives

Palette-agnostic layout primitives for the 7 Daily Challenge games. This is **PR 1 of
N** for FAR-395: it extracts the primitives and unit-tests them **in isolation**. It
wires **nothing** into the 7 games — that is the per-game migration work (PRs 2..N).

See `phase-0-audit.md` for the current-state audit that motivated these.

## Why "isolated first"

FAR-395 is effort-xl and, in the ticket's own words, has "the highest chance of
breaking something that currently works." The safe path (and the ticket's stated
migration strategy) is: extract shared primitives as an isolated, tested PR first, then
migrate one game at a time, each with its own regression pass — **not** a single
big-bang refactor of all 7 games.

## Architecture

- **Pure logic** — `src/lib/dc-ui/` (no React, no DOM). Unit-tested with `node --test`
  (`npm run test:dc-ui`, also part of `npm test`). This is where the standard *is*.
- **React wrappers** — `src/components/dc/` (thin `"use client"` components that consume
  the pure logic).

### Palette-agnostic by construction

FAR-394 (palette) owns color; this ticket owns layout. No primitive hardcodes a brand
hex. Anything needing color takes the `C` token object at call time and derives its
tints from it (`color.ts`), so a FAR-394 value change flows through automatically. The
test `button output is palette-agnostic` proves the real brand gold never leaks into a
resolver's output when a fake palette is supplied.

## The pure module (`src/lib/dc-ui`)

| File | Exports | What it standardizes |
|---|---|---|
| `tokens.ts` | `SPACE`, `RADIUS`, `TYPE`, `TYPE_FLOOR`, `MOTION`, `px`, `pad`, `meetsFloor`, `snapSpace`, `snapRadius` | Spacing (0/4/8/12/16/20/24), radii (6/8/12/pill), type scale (11/12/13/14/16/24 + 22/48 display), motion (120/150ms). `snap*` maps drifted values onto the scale (ties round up). |
| `color.ts` | `hexToRgb`, `tint`, `rgb` | Derives rgba tints from a passed hex — the palette-agnostic core. |
| `button.ts` | `resolveButtonStyles`, `PaletteTokens`, `ButtonVariant`, `RevealState` | One button with **default / hover / active / disabled** states (+ `selected` / `reveal` for puzzles). Variants: `primary`/`ghost`/`success`/`danger` (existing actions) + `option`/`tile` (in-puzzle answers). |
| `grid.ts` | `puzzleGrid`, `iconTileGrid`, `iconTileBox`, `ICON_TILE`, `SQUARE_GRID_FIT`, `fitsSquareGrid`, `squareGridExemptions` | The two grid systems (fluid interaction vs. 110×110 icon tile) and the per-game fit classification. |
| `anchor.ts` | `brandAnchorStyle`, `CANONICAL_ANCHOR`, `boltSvgAttrs`, `BOLT_PATH` | The canonical gold-bolt brand anchor placement (**top-right**). |

## The React wrappers (`src/components/dc`)

| Component | Purpose |
|---|---|
| `GameFrame` | Standard game container: canonical gap/padding, `position:relative`, renders the top-right `BrandAnchor`. |
| `GameButton` | The shared button. Interaction is **pointer-based** (not CSS `:hover`) so hover *and* pressed work on touch (mobile-first). Disabled always wins. Honors `prefers-reduced-motion`. |
| `BrandAnchor` | The gold bolt, top-right by default. Pass `color={C.gold}`. |
| `PuzzleGrid` | Fluid N-column interaction grid (`puzzleGrid`). |
| `useReducedMotion` | SSR-safe `prefers-reduced-motion` hook. |

## Canonical decisions (locked for the migration)

- **Grid:** 110×110 (`iconTileGrid`) is for **tiles/icons** only. Interaction areas use
  `puzzleGrid`. **The Brief is exempt** from any square grid (prose). See
  `SQUARE_GRID_FIT`.
- **Type:** 16/24 base pair (ticket) + the 11/12/13/14 accessibility floor sizes already
  canon in CLAUDE.md and enforced by `npm run test:contrast`.
- **Buttons:** default / hover / active / disabled, defined **once** here — not
  re-implemented per game.
- **Brand anchor:** gold bolt `#C4922A`, **top-right**, in every game. A per-game move
  is allowed only as a documented, justified exception (`GameFrame showAnchor={false}` +
  a note), never a silent per-game choice.

## Migration status (keep updated as PRs land)

- [x] **PR 1** — primitives extracted + unit-tested in isolation (this PR).
- [ ] PR 2 — first game (Frequency, per the audit's difficulty ranking) onto the primitives + regression pass.
- [ ] PRs 3..N — Circuit, The Brief, Dark Fiber, Rackl, The Stack, Signal Drop, one/small-batch at a time, each regression-tested.

**FAR-395 stays `In Progress` until all 7 games are migrated and regression-tested.** Per
the ticket, the "mark Done when the PR merges" instruction does **not** apply to this
multi-PR ticket — Done lands on the final game's PR, not on this primitives PR.
