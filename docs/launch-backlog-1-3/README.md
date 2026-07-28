# Launch Backlog 1–3 (FAR-387 · FAR-388 · FAR-389)

Three subscriber-facing completion-screen polish items, shipped as one branch
because they all land in the same surface (`ScoreCard` in
`src/components/DailyChallenge.jsx`).

## FAR-387 — Domain naming
- Canonical map: **`src/lib/idf-labels.ts`** — frozen `DOMAIN_LABELS` (D1–D23) +
  `THEME_LABELS` (T-001…T-007), with `resolveDomainName` / `resolveThemeName`
  (code → name; unmapped code → `null`; plain name passes through) and
  `formatDomainTheme` (`Domain: {name} | Theme: {name}`, omitting empty slots).
- Fixed the one subscriber-facing raw-code render: `/challenge/about` no longer
  prints `IDF Domain D2` — it maps to `Domain: Power Architecture`.
- In-game domain chip routes through `resolveDomainName` (future-proof if the
  puzzle feed ever carries a code instead of a name).
- Build guard: **`npm run test:no-codes`** (`scripts/no-idf-codes-check.mjs`)
  fails the build if `\b[DT]\d+(\.\d+)?\b` appears in subscriber-facing source.
  Internal-only files (League Office admin, ingestion pipelines, the map module,
  tests) are on a commented allowlist.

## FAR-388 — Market Reaction Speed
- **`src/lib/market-reaction.ts`** — per-game `PAR_TIMES` + a **three-band**
  resolver: `< 0.5×` par → *Ahead of Consensus*, `0.5–1.25×` → *On Consensus*,
  `> 1.25×` → *Market Laggard*. Band label is primary, raw seconds secondary. No
  countdown, no red states.
- Each of the 7 games now captures its (already-measured) client-side solve time
  into state and passes it to the shared `ScoreCard`. **No migration** — solve
  time is not persisted; this is display-only (follow-up: persist it).

## FAR-389 — Faraday's Take
> Reconciled with the full FAR-389 ticket (2026-07-28). The first cut (this
> commit) read the Airtable **`Answer Explanation`** field and rendered nothing
> when absent. The ticket mandates a **dedicated `Faraday Take` field** (separate
> from answer-justification), **voice-by-game-type**, and a **fallback** instead
> of a blank. See `docs/far389-faradays-take.md` for the authoritative spec.

- **`src/components/FaradaysTake.tsx`** — one shared component: the take in real
  IBM Plex Serif Italic (via the `--font-take` seam), byline beneath. When there
  is no authored take it renders the **plain (non-italic, unsigned) explanation
  fallback**; only with neither take nor fallback does it render nothing.
- **`src/lib/faradays-take.ts`** (pure, tested — `npm run test:take`): the
  game-type voice map (Gilbert Faraday: Rackl/The Stack/Dark Fiber/Frequency ·
  Mach Eigen: Circuit/The Brief/Signal Drop), `resolveTakeByline` (override →
  voice → Gilbert), and `deriveTakeFallback` (joins the puzzle's own per-question
  `explanation` strings).
- Read path: `/api/challenge/today` enriches each puzzle with `faradays_take` /
  `take_byline` from `dc_daily_page_content` (the day-content sync reads the
  Airtable **`Faraday Take`** field by name — a name-keyed read, because the new
  field has no stable field id yet). The **fallback** is derived client-side from
  each puzzle's own content, so it works day one without the field or the store.
- **Blocked on Myke:** add a `Faraday Take` (multilineText) field — and optional
  `Take Byline` (singleLineText) — to the Puzzle Bank. Flagged, not written.

## Screenshots
| State | Image |
|---|---|
| Take present · Ahead of Consensus | `reaction-ahead-of-consensus.png` |
| Take present · On Consensus | `reaction-on-consensus.png` |
| Take present · Market Laggard (Mach Eigen byline) | `reaction-market-laggard.png` |
| Take absent · prior state unchanged | `take-absent.png` |
