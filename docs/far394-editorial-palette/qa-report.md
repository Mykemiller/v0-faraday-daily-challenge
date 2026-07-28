# FAR-394 — Daily Challenge editorial-palette pass (QA + token report)

Moves the Daily Challenge from raw neon-on-dark toward Faraday's institutional
editorial palette: desaturated jewel tones framed in gold/sage on Editorial
Forest and Warm White. **Color tokens only** — no spacing, typography, or layout
changes (that is FAR-395's scope).

Sequencing note: per the ticket's pre-resolved decision, this palette pass runs
**before** FAR-395 (layout/proportions) so FAR-395 builds its shared layout
primitives against final styling. If FAR-394 and FAR-395 are being run in
parallel, coordinate — both touch `DailyChallenge.jsx`.

## Finalized token set

| Purpose | Token | Value | Notes |
|---|---|---|---|
| Primary background | Editorial Forest | `#1C3424` | Unchanged — already brand-aligned |
| Primary accent / CTA | Faraday Gold | `#C4922A` | The dominant highlight (unchanged; already the DC accent) |
| Secondary accent | Sage | `#8CA68A` | Secondary emphasis where gold would be overused |
| Surface / card | Warm White | `#F8F5F0` | **Standardized** — replaces the near-identical Warm Cream `#EEE6DA` on all DC lobby/game surfaces (intentional per ticket) |
| In-game canvas | ink | `#0D110E` | Unchanged (game chrome bg) |

### Per-game differentiator — PROPOSED design pass (confirm with Myke/design)

One desaturated jewel tone per game, replacing the Ch.09b raw-neon registry.
Single source of truth: `GAME_ACCENT` in `src/components/GameIcon.jsx`. Each
keeps its game's hue identity but is pulled to an institutional jewel; none
competes with Faraday Gold as a dominant color.

| Game | Old neon | New jewel (`accent`) | Family |
|---|---|---|---|
| Rackl | `#00FFC8` | `#2F9C8B` | Teal |
| Circuit | `#00CFFF` | `#4C90BD` | Sapphire |
| Dark Fiber | `#BF5FFF` | `#9A74C0` | Amethyst |
| Signal Drop | `#FF2D78` | `#C86A85` | Garnet rose |
| Frequency | `#FF6B00` | `#C06A3C` | Rust / copper |
| The Stack | `#FFE600` | `#A08A3A` | Citrine / bronze |
| The Brief | `#B8FF00` | `#7CA34A` | Olive |

Each game also carries a `deep` companion (darker secondary fills) and a subtle
`glow` (lobby-tile hover), both derived from the `accent`.

**Flag for design confirmation:** The Stack is the one jewel adjacent to the gold
family (yellow desaturates toward amber). It is the closest pair to gold in the
distinctness guard (Δ66, still well above the Δ40 floor) and reads as bronze on
its forest tile in QA, but it is the value most worth a design look.

## Accessibility validation — `npm run test:contrast`

Extended `scripts/contrast-check.mjs`; **29/29 pairings pass** WCAG 2.1 AA. New/
changed pairings verified:

- Lobby/card surfaces re-pointed from Warm Cream to **Warm White `#F8F5F0`**:
  near-black 17.2:1, forest 12.3:1, deepAmber 5.4:1, black/0.62 5.1:1 — all ≥4.5.
- Forest-panel text moved cream→warm-white: warm-white 12.3:1, warm-white/0.85
  9.3:1, sage 5.1:1, goldLight 6.6:1 — all ≥4.5.
- **Per-game jewels on the darkest forest tile stop (`#1C3424`)** at the 3:1
  non-text UI-component bar (pictograms are `aria-hidden` decorative graphics):
  Rackl 3.99, Signal Drop 3.74, The Stack 3.95, Circuit 3.85, The Brief 4.59,
  Dark Fiber 3.60, Frequency 3.43 — all ≥3.0.
- Homepage Warm-Cream pairings retained and re-verified (out of scope, unchanged).

The per-game accents are **not used as readable text** anywhere (decorative fills
+ hover glow only), so the 4.5:1 text bar does not apply to them; if FAR-395 ever
promotes one to text, re-check it at 4.5:1 first.

A distinguishability guard (weighted sRGB ΔE proxy, Δ≥40) asserts every jewel is
separable from every other jewel and from gold/sage. Closest pair: The Stack ↔
Gold at Δ66. Interactive states (hover glow, gold-outlined disabled/submit, error
red) use unchanged brand tokens.

## Visual QA — screenshots

Rendered from a production build (`next build` green) at two breakpoints:

- **Lobby grid — desktop (1440w)** and **mobile (390w)**: all 7 jewel icons on
  forest tiles against the warm-white canvas; gold double-rule + labels;
  responsive layout intact.
- **In-game (Rackl) — desktop**: teal game glyph + the six other jewel glyphs in
  the SWITCH row; warm-white tiles; gold Submit/Hint; forest masthead.

No raw neon remains on any surface; the palette reads as one institutional
system. (PNGs shared with Myke in-session; not committed to avoid repo bloat.)

## Scope boundary / FAR-395 handoff

No spacing, padding, type-scale, or component-structure changes were made. No
layout imbalance was uncovered that required a neon color's visual weight to
"work," so there are no FAR-395 handoff items from this pass. Warm Cream
(`#EEE6DA`) remains defined in `globals.css` (`--color-warm-cream`) for the
homepage editorial double-rule and the League Office console — both out of this
ticket's lobby+games scope and deliberately untouched.
