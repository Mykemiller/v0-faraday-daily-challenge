# FAR-395 — Phase 0 UI Audit (current state, all 7 games)

**Ticket:** FAR-395 — Standardize UI proportions and brand anchors across all 7 games
(effort-xl, Launch Weekend backlog 9/10).
**File audited:** `src/components/DailyChallenge.jsx` (all 7 games live in one file).
**Method:** read-only inspection of the actual rendered styles per game — this records
*current* state, not intended state, per the ticket's hard prerequisite.

This audit is the gate for the primitives extracted in the same PR
(`src/lib/dc-ui`, `src/components/dc`). It is **not** the migration — no game was
changed in this PR.

## Sequencing / dependency status

- **FAR-394 (palette) is `In Progress`, not merged** (checked 2026-07-28). Per the
  ticket's pre-resolved decision, we did **not** build layout primitives against the
  old neon palette. Instead the primitives are **palette-agnostic**: every primitive
  that needs color takes the `C` token object at call time and derives its tints from
  it (`src/lib/dc-ui/color.ts`). A FAR-394 value change flows through automatically —
  the "painting the same surface twice" risk the ticket names is avoided structurally,
  so the two tickets can land in either order without rework. **Flagged to Myke.**

## Shared baseline (already in the file)

- **`C` palette** (lines 22–42): `gold #C4922A`, `sage #8CA68A`, `forest #1C3424`,
  `cream #EEE6DA`, `green #4ADE80`, `amber #F59E0B`, `red #F87171`, `text #E8E4DE`,
  `muted #9A938C`, `border rgba(255,255,255,0.07)`, `surface rgba(255,255,255,0.03)`,
  `dim #2A2520` (decorative only).
- **Fonts:** `mono` (IBM Plex Mono), `serif` (IBM Plex Serif), `sans` (Bricolage
  Grotesque).
- **`Btn`** (lines 224–241): the shared button. Radius 6px; padding `10px 20px`
  (small `6px 14px`); 12px (small 11px); 4 variants (primary/ghost/success/danger).
  **No hover/active state** — only a CSS transition. Disabled → opacity 0.5.
- **Accessibility floor contract** (CLAUDE.md "cosmetic buff", enforced by
  `npm run test:contrast`): nothing readable < 11px; explanations ≥ 12; options/tiles
  /terms ≥ 13; primary prompts ≥ 16.

## Per-game current state

| Game | Root gap | Interaction grid | Answer buttons | Gold anchor |
|---|---|---|---|---|
| **Rackl** (card-sort) | 16 | `repeat(4,1fr)` gap 8, tile pad `14px 8px` — **fluid, not square** | raw `<button>`, cream/gold-tint, `2px` border, radius 8, transition 0.12s, selected lift | selection state only |
| **Signal Drop** (Wordle) | 16 | flex cells `flex:1 1 0; aspectRatio:1/1; maxWidth:44px` gap 4 — **fluid square capped 44px** | raw keyboard `<button>`, fixed 32/52×40px, radius 4, `border:none` | none (uses amber) |
| **The Stack** (rank) | 12 | none (draggable list) | raw draggable `<div>`, gold-tint border, radius 8, transition 0.1s | drag-active border only |
| **Circuit** (True/False) | 20 | `1fr 1fr` gap 12 | raw `<button>` green/red tint, radius 8, pad 18, transition 0.1s | none |
| **The Brief** (reading) | 16 | **none — scrolling `<p>` prose**, maxHeight 320, pad 20 | raw `<button>` option, radius 6, pad `12px 16px`, transition 0.12s | selection state only |
| **Dark Fiber** (match) | 10 (grid) | `1fr 1fr` gap 10 | raw `<button>`, matched/selected tints, radius 6, transition 0.12s | `<SL color=gold>Terms</SL>` header |
| **Frequency** (MC quiz) | 16 | none (option list gap 8) | raw `<button>` reveal/selected tints, radius 6, pad `12px 16px`, transition 0.15s | selection state only |

**ScoreCard** (shared, lines 586–660): score 48px/800 gold; `/dayTotal` 22px/500 sage;
captions 11px mono. Uses the shared `Btn`.

## The drift (what standardization must collapse)

- **Root gap:** 10 / 12 / 16 / 20 across games. No game sets a root `maxWidth` or
  `padding`.
- **Padding values (distinct):** `6px 14px`, `8px`, `10px 12px`, `12px`, `12px 16px`,
  `14px 8px`, `14px 16px`, `16px`, `18px`, `20px`, `24px`.
- **Radii:** 4 / 6 / 8 / 10 / 12 / 20.
- **Transitions:** 0.1s / 0.12s / 0.15s / 0.2s.
- **Font sizes:** 10 / 11 / 11.5 / 12 / 13 / 14 / 16 / 18 / 22 / 48 + `clamp(13px,4.5vw,16px)`.
- **Buttons:** shared `Btn` used **only for primary actions**. **Every** in-puzzle
  answer/tile/key/row is a bespoke raw `<button>`/`<div>` with its own radius,
  transition, and **zero hover/active handling**.
- **Gold brand anchor:** **no game has a fixed gold-bolt anchor.** Gold appears only as
  transient selection state (+ Dark Fiber's `Terms` heading). A persistent, positioned
  brand anchor is net-new.

## The 110×110 grid — compatibility finding (Phase 0 gate #3)

The ticket proposes "a unified 110×110 sub-bounding box grid matching the Product Icon
Registry." **Finding: 110×110 is an ICON/TILE spec, not an in-puzzle interaction-area
spec.** No game currently uses any fixed-square interaction grid, and several
**structurally cannot** take one:

- **The Brief** renders a scrolling multi-paragraph reading pane (`brief.split("\n\n")`
  → `<p>` at 16px/1.7, `maxHeight:320; overflowY:auto`). This is prose, not square tiles
  — **exempt** (flagged per the ticket's out-of-scope guardrail).
- **Signal Drop** is a Wordle row (square cells, but fluid-capped at 44px so 4–6 letter
  words fit any width — a fixed 110 would overflow narrow phones).
- **The Stack** and **Frequency** are vertical lists, not grids.

Encoded in `src/lib/dc-ui/grid.ts` as `SQUARE_GRID_FIT` (per-game: `square` /
`fluid` / `list` / `prose`). Two separate grid systems are provided so the migration
never forces a square grid onto content that doesn't want one:

- **`iconTileGrid()`** — the 110×110 Product Icon Registry grid, for lobby game **tiles**
  and any square emblem layout (the correct home for the 110 spec).
- **`puzzleGrid(cols)`** — the fluid `minmax(0,1fr)` interaction grid the games actually
  need (Rackl 4-col, Circuit / Dark Fiber 2-col).

## Migration difficulty ranking (hypothesis for PRs 2..N — confirm per game at migration time)

Ranked easiest → hardest by number of bespoke surfaces and layout coupling:

1. **Frequency** — plain MC option list; the cleanest `GameButton` swap. *(Recommended first — simpler than the ticket's Signal Drop guess, which has a bespoke keyboard.)*
2. **Circuit** — 2-up True/False, same option pattern.
3. **The Brief** — options are simple; the reading pane is exempt from the grid but keeps its own container.
4. **Dark Fiber** — two-column match with three tint states (matched/term/def).
5. **Rackl** — 4×4 tile board with selection lift + solved-group banners.
6. **The Stack** — drag-and-drop rows (pointer-drag interaction is the riskiest to regress).
7. **Signal Drop** — bespoke Wordle grid **and** on-screen keyboard; most custom layout.

Each migration is its own PR with its own regression pass (mobile portrait/landscape,
tablet, desktop; full interaction flow: load → mid-solve → submit → completion).
