# CC-DC-SHARE-1.0 — Phase 0: Share-surface audit (investigation only)

**Date:** 2026-07-31 (audit executed against `main` @ `fa9764b`)
**Scope:** every place a subscriber can hit "Share" in the Daily Challenge, plus the
static OG/meta layer, puzzle-number semantics, per-game result shapes, assets, and the
`next/og` rendering capability check.
**No code was changed in this phase.** This report is the Phase 0 gate deliverable.

---

## Executive summary

- There are **5 live share/copy call sites** (plus one download fallback inside the
  shared cascade). Two of them (`ScoreCard`, in-app team invite) already share one
  helper (`shareViaDevice`); the other three are independent ad-hoc implementations.
- **No share surface today satisfies all of a–e.** The closest is the per-game
  ScoreCard share (icon image + score + Public ID + link) — it lacks a human puzzle
  number and any result visualization.
- **No `og:image`/`twitter:card` metadata exists anywhere in the app** (D9 is
  greenfield). Root and challenge layouts export `title`/`description` only.
- **`next/og` `ImageResponse` is confirmed available** in the installed Next 16.2.3
  (D3 is feasible), with one real constraint: **no font binaries exist in the repo**
  — the card renderer needs font data supplied explicitly.
- **D2 epoch data:** the serving bank's earliest `Go Live Date` is **2026-06-24 for
  all 7 puzzle types** (continuous daily coverage 2026-06-24 → 2026-08-14, no gaps).
  Today (2026-07-31) would be **#38** for every game.
- **One live spoiler vector to design around (D5):** Signal Drop's `puzzleName` prop
  on `ScoreCard` *is the revealed answer* post-completion, and the localStorage day
  snapshot stores the answer (`word`) and Dark Fiber's full `pairs`. Current share
  text doesn't touch them; the new `buildShare` must be constructed so it never can.
- **One live canonical-domain bug (AC 4-adjacent):** the team invite link on
  `/leaderboard/team/[teamId]` is built from `window.location.origin` — visited via
  `faraday-intelligence.ai` it emits a non-canonical invite URL.
- **Two data gaps for result visuals (flagged per the STOP rule):** Rackl records no
  guess-by-guess history (only a mistake count), and Dark Fiber's mistake count is
  never threaded out of component state. Neither game can honestly render a
  Wordle-style per-guess grid today without a small client-state change in Phase 3.
- **Asset contract not yet satisfiable:** no icons were attached to the task prompt in
  this session, `public/share/icons/` does not exist, and there is **no Daily
  Challenge generic mark** at share size (only the 192/512 PWA roundel and
  `src/app/icon.svg`). The 640² per-game `<slug>-share.png` set from
  CC-DC-ICON-REFRESH-1.0 is a usable interim source for the 7 games.

---

## 1. Full inventory of share entry points

Grep sweep executed for: `navigator.share`, `navigator.clipboard`, `writeText`,
`share/Share`, `copy`, `og:image`, `twitter:card`, `ImageResponse`, `html2canvas`,
`toBlob`, `mailto:`, `intent/tweet`, `linkedin.com/share`. Results:

- `html2canvas`: **0 hits** (removed in CC-DC-ICON-REFRESH-1.0).
- `toBlob`: comment-only (the removal note).
- `ImageResponse`: **0 hits** (nothing renders card images today).
- `intent/tweet`, `linkedin.com/share`: **0 hits**.
- `mailto:`: League Office broadcast composer/sanitizer only (staff-internal link
  allowlist, not a share surface — out of scope).
- `og:image`: **0 hits** in `src/`. The static design artifact
  `public/faraday-home.html` (served verbatim at `/faraday-home.html`, not a Next
  route) carries `twitter:card`/`twitter:title` meta with **no image** — legacy
  artifact, flagging for cleanup consideration, not a share surface.

### 1.1 Per-game ScoreCard share — the main event

**File:** `src/components/DailyChallenge.jsx:626–645` (`handleShare` inside
`ScoreCard`), shared cascade `shareViaDevice` at `:576–600`, icon fetch
`buildShareIconBlob` at `:564–572`.
**Trigger:** "↑ Share Result" button on the completion screen of **all 7 games**
(single `ScoreCard` component, 7 call sites at lines 781, 961, 1125, 1230, 1330,
1419, 1527).
**Payload today:**

- Text: `Faraday Daily Challenge - {puzzleType} Score - {score}` + newline +
  `{publicId}` (when set).
- URL: `https://www.faradaydailychallenge.com?game={puzzleType}&p={publicId}`
  (display-name `game` param, URL-encoded; matches the deep-link reader at `:3004`
  which parses `?game=`).
- Image: pre-rendered `public/icons/games/{slug}-share.png` (640², label baked in)
  fetched as a blob, attached only on the `navigator.canShare({files})` rung.
- Cascade: Web Share w/ file → Web Share text+url → `clipboard.writeText(text url)`
  → **anchor-download of the PNG** ("Saved") → `"idle"` (button text just resets —
  effectively a dead end on a browser with no share, blocked clipboard, and no blob).

**a–e scorecard:** a ✅ (type in text + baked label in image) · b ✅ score ·
c ⚠️ Public ID only (`RACK-26-07-30-00351`-style fine print; no human `#N`) ·
d ⚠️ game icon only, **no result visualization** · e ✅ canonical link.
**Note:** the `title` field (`"Faraday Daily Challenge"`) is dropped by most
targets; the text block is not the Wordle-style multi-line card the ticket wants.

### 1.2 In-app team invite (Team Leaderboard panel)

**File:** `src/components/DailyChallenge.jsx:2343–2350` (`handleInvite` in
`TeamLeaderboard`).
**Trigger:** "Invite teammates" button on the in-app team standings panel.
**Payload:** text `Join my team "{name}" on the Faraday Daily Challenge — team code
{code}.` + url `https://www.faradaydailychallenge.com` via the same `shareViaDevice`
cascade (no blob → no image rung).
**a–e:** generic share; no icon/image, no card. Candidate for the D7 generic card.

### 1.3 `/share` hub ("Share & invite", FAR-408)

**File:** `src/app/share/page.tsx:33–51` (`doShare` in its own local `ShareCard`).
**Trigger:** "Share the challenge" button (invite-a-colleague card). The other two
cards are plain links to `/leaderboard` and `/account` (no share calls).
**Payload:** text `Play the Faraday Daily Challenge — seven quick games a day on the
AI data center economy.` + url `https://www.faradaydailychallenge.com/challenge`;
`navigator.share` → clipboard → visible URL text on the page (its own partial D8
ladder — no image anywhere).
**a–e:** generic; no image/card.

### 1.4 `/leaderboard` rank share

**File:** `src/app/leaderboard/page.tsx:269–281` (`share()`).
**Trigger:** a share affordance on the "you" rank row (renders `shareMsg` feedback).
**Payload:** text-only: `{points} pts · #{rank} on the Faraday season leaderboard —
faradaydailychallenge.com/leaderboard` (note: **scheme-less, non-`www` URL inside the
text**, no `url` field). Ladder: `navigator.share` → clipboard → **silent failure**
(no textarea rung, no visible link).
**a–e:** generic; no image; link is a bare string a chat client may or may not
linkify.

### 1.5 Team page invite link (standalone leaderboard)

**File:** `src/app/leaderboard/team/[teamId]/page.tsx:116–127` (`copyInvite`), URL
built at `:116–118`, rendered in a read-only input at `:450`.
**Trigger:** "copy invite" on the team management page.
**Payload:** `${window.location.origin}/leaderboard/join/{join_token}` —
**clipboard-only** (no Web Share rung), with the visible input as the manual-copy
fallback.
**⚠️ Finding:** `window.location.origin` means a player on
`faraday-intelligence.ai/leaderboard/team/…` copies a `faraday-intelligence.ai`
invite link. This is the one live surface that can emit the retired origin today
(violates the spirit of D6/AC4 before the project even starts). Phase 3 should pin it
to the canonical constant.

### 1.6 Static OG / meta layer

- `src/app/layout.tsx` — `title` + `description` only. No `openGraph`, no `twitter`,
  no `metadataBase`.
- `src/app/challenge/layout.tsx` — `title: "Faraday Daily Challenge"` only.
- ~20 other pages export `title` (+ occasionally `description`); **zero** export
  `openGraph`/`twitter` fields.
- No `opengraph-image.*` / `twitter-image.*` file conventions anywhere under
  `src/app/**`. App icons only: `src/app/icon.svg`, `src/app/apple-icon.png`,
  `public/icon-192.png`, `public/icon-512.png`, `favicon.ico`.
- `src/app/manifest.ts` — PWA manifest (roundel icons, `start_url: /daily-challenge`).

**Conclusion:** a link to any DC page unfurls with no image today. D9 is a clean
build, not a migration.

---

## 2. Expected surfaces — confirmation + misses

| Surface (from the task prompt) | Exists? | Share affordance today |
|---|---|---|
| Per-game ScoreCard, all 7 games | ✅ | Yes — §1.1 (one shared component) |
| End-of-day / all-seven completion summary | **❌ does not exist** | Lobby marks played tiles (`GameTile` `played`/`priorScore`) and shows `todayScore`, but there is **no all-seven summary screen and no share** for the completed day. Building one is new UI, not a replacement — flagging as scope decision for Phase 3 (D7 covers the payload if built). |
| Streak / readiness surfaces | ✅ streak shown (ScoreCard chip, account pages) | **No share affordance anywhere** for streak alone |
| Leaderboard | ✅ | Yes — §1.4 |
| Team / league surfaces | ✅ | Yes — §1.2 (in-app) and §1.5 (standalone). `/free-agency` is a stub with no share. |
| Content pages (Hints/About/Answers Today) | ✅ | **No share affordances** (grep hits are comments only) |
| Static OG/meta | ✅ layouts exist | **No OG/twitter tags at all** — §1.6 |
| Lobby / root route | ✅ | No share button on the lobby; storefront `/` has none |

**Surfaces the prompt didn't list, found in the sweep:**

- `/share` hub page (§1.3) — the "More Faraday → Share / Invite" destination.
- The **replay screens** (`GameReplay` and per-game replay components,
  `DailyChallenge.jsx:1612–1758`) — lobby "played" tiles reopen a completed game
  read-only. **No share button there today**; if Phase 3 adds share-from-replay, the
  data source would be the localStorage snapshot (see spoiler note in §4).
- `src/components/SocialGate.tsx` — dead code (imported by nothing), no share call.
- League Office composer link-prompt (staff-internal) — out of scope.

---

## 3. Puzzle-number semantics today

**No human-legible puzzle number exists anywhere in the product.** What is
user-visible:

1. **`Public ID`** (`TYPE4-YY-MM-DD-NNNNN`) surfaces in exactly four places:
   - the in-game header next to the game title (`DailyChallenge.jsx:3326–3327`);
   - line 2 of the ScoreCard share text (§1.1);
   - the `p=` query param of the share URL (§1.1);
   - the Answers Today page rows (`src/app/challenge/answers/page.tsx:212`).
2. `NNNNN` is the **global cross-game counter** (`dc_public_id_seq`, seeded 365) —
   confirmed live: today's set runs `…-00351` (Rackl) through `…-00357` (Frequency).
   As the ticket says, it reads as noise for a per-game index.

**D2 epoch data (earliest `Go Live Date` per type, Airtable serving bank —
373 rows: 7 Live · 105 Published · 252 Retired · 9 Unpublished):**

| Puzzle type | Earliest Go Live | Rows |
|---|---|---|
| Rackl | **2026-06-24** | 53 |
| Signal Drop | **2026-06-24** | 53 |
| The Stack | **2026-06-24** | 54 |
| Circuit | **2026-06-24** | 53 |
| The Brief | **2026-06-24** | 53 |
| Dark Fiber | **2026-06-24** | 54 |
| Frequency | **2026-06-24** | 53 |

- Coverage is **continuous daily from 2026-06-24 through 2026-08-14** — no date gaps
  (the June 14–19 outage sets are not date-carried into this range; a handful of
  Unpublished rows have no date). So `days_between(2026-06-24, serve_date) + 1` is
  clean and monotonic: **2026-07-31 ⇒ #38 for every game**. All 7 games share the
  same epoch, which also means the generic all-seven card can carry the same number.
- **⚠️ Do not derive the epoch at runtime.** `dc_puzzle_bank_staging` (the future
  Supabase serving source behind `DC_PUZZLE_SOURCE`) currently holds only the 7
  pilot rows dated **2026-07-28** — computing "earliest go-live" from the active
  serving source post-cutover would silently renumber every share. The epoch must be
  **pinned constants** in `src/lib/share/manifest.js` (per game, all `2026-06-24`).
- **Date availability at share time:** the client never receives `go_live_date`, and
  the in-app `TODAY` constant (`DailyChallenge.jsx:1771`) is the **UTC** date slice
  while the serve day is **America/Chicago** — they disagree for 5–6 hours a day.
  The Public ID, however, **embeds the serve date** (`YY-MM-DD` segment), so both
  `n` and the D6 `d=` param can be derived deterministically from `__publicId`
  client-side with no payload change. Recommend that as the Phase 1 source of truth
  (fallback: omit `n`/`d` when `publicId` is null — mock/offline play).

---

## 4. Result-shape inventory (what a visual result block can honestly show)

What `ScoreCard` receives today (all 7 games): `score`, `dailyTotal`, `puzzleType`,
`puzzleName`, `publicId`, `domain`, `streak`, `elapsedSec`, take/signal props.
**It receives none of the per-game result detail** — that lives in each game
component's state and is only serialized into `onComplete(score, snapshot,
elapsedSec)` → localStorage `faraday_daily_{UTC-date}` `puzzleSnapshot`. Wiring the
result shape into the share payload is a prop-threading change in each of the 7
completion renders (no new storage, no schema).

Solve-band data is available at share time via `resolveMarketReaction` →
`{label: "Ahead of Consensus" | "On Pace" | "Taking the Long View", elapsedSec}`
(percentile bands from `/api/challenge/today`, seed-par fallback, or **null** —
the card must tolerate a missing band).

| Game | Mechanic | Result data in component state at share time | Snapshot (`onComplete` arg) | Visual block feasible today |
|---|---|---|---|---|
| Rackl | Connections (4×4 groups, 4-mistake budget) | `solved` (16 tile-ids, **in solve order**), `mistakes` count, `lost` | `{solvedGroups: labels, mistakes}` | Solved-group count/order + mistake pips. **⚠️ No guess-by-guess history is recorded** — a true Connections-style per-guess color grid is not reconstructable. Needs a small `guessHistory` state addition in Phase 3 if wanted. |
| Signal Drop | 6-guess Wordle (server-validated) | `guesses[]`, `results[]` (per-letter `correct/present/absent`), `won` | `{guesses, results, word, won}` — **snapshot contains the answer** | ✅ Full Wordle grid (rows of per-letter states). Best-in-class data. |
| The Stack | Rank N items | `order` vs `puzzle.correctOrder` → per-position ✓/✗ | `{finalOrder, correctOrder, items, values, metric}` — **contains answer content** | ✅ Single row of N per-position marks + count. |
| Circuit | Timed T/F, per-question | `answers[]` `{ok,…}` in order, timer | `{answers}` (contains correct answers + explanations) | ✅ Row of per-question ✓/✗ in order. |
| The Brief | Read + MC quiz | `answers[]` `{ok,…}` | `{answers}` | ✅ Row of per-question marks. |
| Dark Fiber | Term↔definition matching | `matched` (always all pairs at completion), `mistakes` count **in state only** | `{pairs: puzzle.pairs}` — **the snapshot is literally the answer key, and carries no result data at all** | ⚠️ Pairs-count + mistake pips — but `mistakes` must be threaded out (1-line change); the snapshot alone can't drive any visual. |
| Frequency | MC, per-question reveal | `answers[]` `{ok,…}` | `{answers}` | ✅ Row of per-question marks. |

**D5 spoiler vectors confirmed (design the module against these):**

1. `ScoreCard`'s `puzzleName` prop for Signal Drop is `revealed || puzzle.name` —
   **post-completion this is the answer word** (e.g. today's "PEAKER"; the bank's
   `Puzzle Name` for Signal Drop is the answer by convention, and
   `toPublicSignalPuzzle` strips `name` pre-solve for exactly this reason,
   `src/lib/signal-drop.js:19`). `buildShare` must key on `puzzleType`/slug and must
   **never accept a display-name/`puzzleName` field for Signal Drop**. The current
   share text happens to use `puzzleType` — the invariant is one refactor away from
   being lost, which is why the spoiler test (AC 3) matters.
2. localStorage `puzzleSnapshot` carries answers for Signal Drop (`word`), The Stack
   (`correctOrder`+`values`), Circuit/Brief/Frequency (`answers[].correct` +
   explanations), Dark Fiber (`pairs`). Any share-from-replay/lobby feature must map
   snapshots to outcome-shape only (ok/not-ok sequences) before anything reaches
   `buildShare`.
3. Result-block encoding must be **outcome-shape only** (per D5): sequences of
   correct/present/absent/✓/✗ and counts — never item/letter/word content.

---

## 5. Asset inventory

**In `public/` today:**

| Asset | Dimensions | Notes |
|---|---|---|
| `icons/games/{slug}-share.png` × 7 | 640×640, 8-bit palette PNG | Labeled share frames (game name baked in; Signal Drop reads "SIGNAL", Dark Fiber "FIBER", Circuit "THE CIRCUIT" — accepted deltas per CC-DC-ICON-REFRESH-1.0) |
| `icons/games/{slug}-tile-{128,256}.png` × 14 | 128² / 256² | Label-cropped tiles (used by `GameIcon`) |
| `icon-192.png`, `icon-512.png` | 192² / 512² RGBA | Faraday "F" roundel (PWA) |
| `src/app/icon.svg`, `apple-icon.png` | vector / app icon | Favicon-class marks |
| `public/Newicons` | — | **Stray 71KB JavaScript source file sitting in `public/`** (publicly served). Unrelated to this project; flagged for removal in a cleanup pass. |

**Contract gaps:**

- `public/share/icons/` **does not exist**, and **no assets were attached to the task
  prompt in this session** (no reference screenshot either). Per the asset contract
  those come from Myke. Until they land: the 7 per-game 640² share PNGs are a usable
  interim source, but **there is no Daily Challenge generic mark at share size** —
  the D7 generic card and the missing-icon fallback both need one (the 512² roundel
  is the only candidate and it's a different visual family). **Blocker for Phase 1
  asset placement; not a blocker for building `buildShare`.**
- `gameShareIconSrc()` returns `""` for unknown games — today's fallback is "no
  image", not a DC mark (D7/AC7 not yet satisfiable without the DC asset).

**Brand tokens the renderer can import (no duplication needed):**

- `GAME_ACCENT` in `src/components/GameIcon.jsx` — `{accent, deep, glow}` per game
  (post-icon-refresh values; mirrored in `globals.css` `--color-game-*` and in
  `scripts/contrast-check.mjs` — a card route importing `GAME_ACCENT` adds no fourth
  mirror). `manifest.js` should import it per the task's asset contract.
- In-game surface tokens: the `C` object in `DailyChallenge.jsx` (not exported);
  homepage tokens in `globals.css` `@theme`. The card's dark background should match
  the icon field (`#1a1a1a` corners / forest `#1C3424` family) — exact value is a
  design call for the preview page.
- **Fonts: none in the repo.** The site loads IBM Plex Serif / Bricolage Grotesque /
  IBM Plex Mono from **Google Fonts `<link>` tags** (`src/app/layout.tsx`);
  `public/fonts/` contains only a README (licensed Freight Display Pro not yet
  supplied). This matters for D3 — see §6.

---

## 6. Rendering capability check (D3)

Verified against the installed toolchain (`npm install` run in this sandbox;
`node_modules/next` = **16.2.3**, per AGENTS.md the bundled docs were consulted:
`next/dist/docs/01-app/03-api-reference/04-functions/image-response.md`):

- **`next/og` resolves** (`next/og.js` → `dist/server/og/image-response`), backed by
  the compiled `@vercel/og` (satori + resvg.wasm) shipping **both edge and Node
  builds** (`index.edge.js` / `index.node.js`) — so `GET /api/share/card` works as a
  route handler on either runtime on Vercel. Default output is exactly the spec's
  1200×630; `width`/`height` options cover the 1080×1080 variant.
- **Constraints to design around (not silent workarounds):**
  1. **Fonts must be provided as `ArrayBuffer` data.** The repo has no font files
     (§5); `@vercel/og` bundles only Geist Regular. The card route must either ship
     subsetted IBM Plex TTF/WOFF files in-repo (recommended — deterministic, no
     network) or fetch them at build/runtime. Licensing for IBM Plex is OFL — safe
     to vendor. This is the "one font stack" D3 promises and it is currently
     unfunded.
  2. **500KB bundle ceiling** for the route (JSX + fonts + inlined assets). The 640²
     icon PNGs are ~50–70KB each palette-encoded; the route should `fetch` the icon
     from `public/` at request time (same-origin absolute URL or filesystem read on
     Node runtime) rather than importing all 8 into the bundle.
  3. Satori supports a **subset of CSS** (flexbox, no grid) — the card template must
     be authored to it; the `/share/preview` page (Phase 2) is the review gate.
- **`ImageResponse` is not currently used anywhere** — no conflicts.

---

## 7. Pre-resolved decisions — feasibility notes (flag-only, per the mandate)

| Decision | Status after Phase 0 |
|---|---|
| D1 dual payload | Feasible. `shareViaDevice` already implements most of the ladder; text remains the guaranteed path. |
| D2 day index | Feasible; **epoch = 2026-06-24 for all 7 games, pin as constants** (§3). Derive `n` from `publicId`'s date segment; omit when `publicId` is null (mock play). |
| D3 server PNG | Feasible (§6) with the font-vendoring prerequisite. |
| D4 one module | Feasible; the 5 call sites in §1 are the complete replacement list. |
| D5 spoiler-safe | Feasible; the three concrete vectors are enumerated in §4 — the Signal Drop `puzzleName` prop is the one to design out, and the AC-3 test should cover text, URL, card params, and the snapshot path. |
| D6 canonical link | Feasible. Two notes: (i) the current deep-link reader parses `?game=<display name>` (`DailyChallenge.jsx:3004`) — moving to `?g=<slug>` requires updating that reader (and keeping `?game=` accepted for links already in the wild); (ii) the `/` rewrite for `faradaydailychallenge.com` (vercel.json + next.config `beforeFiles`) passes query params through to `/challenge`, so root-relative share URLs survive the rewrite chain. The §1.5 `window.location.origin` invite is the one call site that must be pinned. |
| D7 generic fallback | Feasible **once a DC mark at share size exists** (§5 gap). |
| D8 degradation ladder | Ladder rungs 1–3 exist in `shareViaDevice`; the visible-textarea rung exists nowhere (leaderboard share currently dead-ends silently — §1.4). |
| D9 OG repoint | Greenfield (§1.6): nothing to repoint, everything to add. Day-scoped OG needs the card route to accept a no-score variant, as specced. |

---

## 8. Proposed glyph vocabulary (for approval before Phase 1)

One vocabulary across all 7 games, emoji-first so the text block renders as native
color in iMessage/Slack/LinkedIn without any font dependency:

- `🟩` correct / solved-in-place · `🟨` partial (Wordle "present"; Stack
  off-by-position) · `⬛` miss / unused guess.
- Per game, the result line(s):
  - **Signal Drop:** classic grid — one row per guess, per-letter glyphs (from the
    stored `results[]`), e.g. `⬛🟨⬛⬛🟩🟩` × guesses.
  - **Circuit / The Brief / Frequency:** one row, per-question in order:
    `🟩🟩⬛🟩🟩`.
  - **The Stack:** one row, per-position: `🟩⬛🟩🟩⬛`.
  - **Rackl:** per-group `🟩` in solve order + `⬛` per mistake (e.g. `🟩🟩🟩🟩 ⬛` =
    clean solve with 1 mistake) — honest to the data we have; upgrade to a true
    per-guess grid only if the Phase 3 `guessHistory` addition is approved.
  - **Dark Fiber:** `🟩` per pair + `⬛` per mismatch (requires the 1-line `mistakes`
    threading).
- Text block template (mirrors the card):

  ```
  Faraday · Dark Fiber #38
  🟩🟩🟩🟩🟩 ⬛⬛
  128 pts · 2:14 · On Pace
  faradaydailychallenge.com
  ```

  Line 3 = score · elapsed · Market Reaction band label (band line omitted when the
  band is null). Public ID moves to the card's fine print only (per D2) and drops
  out of the text block.

---

## 9. Proposed Jira ticket (not created — no ticket was supplied)

- **Summary:** `CC-DC-SHARE-1.0 — Standardize every Daily Challenge share surface
  (dual text+PNG payload, one module, spoiler-safe)`
- **Description (proposed):** Audit complete (this report). Build phases: (1) share
  manifest + `buildShare` pure module + tests; (2) `/api/share/card` `next/og`
  renderer + `/share/preview`; (3) `ShareButton` + replace all 5 ad-hoc call sites
  (ScoreCard, in-app team invite, `/share` hub, leaderboard rank, team invite link);
  (4) OG/meta repoint; (5) degradation-ladder verification + cleanup. Epoch
  2026-06-24 all games; spoiler test for Signal Drop; canonical domain everywhere.

---

## 10. Stop-points requiring input before Phase 1

1. **Assets not received** — the 8 icons + reference screenshot were not attached in
   this session; `public/share/icons/` and the DC generic mark don't exist (§5).
2. **Glyph vocabulary** (§8) needs approval.
3. **All-seven summary surface does not exist** — build it (new UI) or scope D7 to
   the surfaces that exist? (§2)
4. **Rackl guess-history + Dark Fiber mistakes threading** — approve the two small
   client-state additions in Phase 3, or accept the reduced result blocks in §8.
5. **Font vendoring** for the card renderer (OFL IBM Plex subset in-repo) — §6.
6. Jira ticket creation per §9.
