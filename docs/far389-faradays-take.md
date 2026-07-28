# FAR-389 — Faraday's Take on puzzle completion

Replaces the generic win state ("You Win!", "3/3 Correct!") with a short,
editorially voiced **Faraday's Take** — set in italic serif and signed — on the
completion screen of all 7 games.

## Phase-0 investigation (re-confirmed 2026-07-28, against live schema)

- **No `Faraday Take` field exists** in the Puzzle Bank (base `appxfti7VuoHYUeu6`
  / table `tbliJaRmctbIWJC43`). Live fields: Puzzle Type, Puzzle Name, Go Live
  Date, Status, Published, Attachment Summary, Puzzle Content, Puzzle ID
  Number/Display, Today's puzzle id, Public ID, Hint 1/2/3, Hints Ready.
- **No `Answer Explanation` field exists** either — it is a FAR-287 *planned*
  concept, not a shipped column. The ticket's flagged "confirm before building a
  second field" dependency therefore resolves to **no conflict**: there is no
  field to collide with.
- **What does exist:** per-question `"explanation"` keys *inside* the
  `Puzzle Content` JSON (Circuit / The Brief / Frequency only). Those are
  mechanical answer-justifications — a different shape from the single, voiced,
  whole-puzzle Take. The Take is its own field; these are the **fallback** source.

## Field needed (BLOCKED on Myke — manual Airtable add, do not write via API)

The canonical Puzzle Bank rejects programmatic schema writes, so per the standing
write-approval gate this is flagged, not written:

| Field | Type | Purpose |
|---|---|---|
| **`Faraday Take`** | multilineText | The 2-sentence voiced verdict for the whole puzzle. |
| `Take Byline` *(optional)* | singleLineText | Per-puzzle voice override; blank → the game-type default voice. |

Both are read **by name** in `src/lib/day-content.ts` (the day-content sync),
so they light up the moment they exist — no code change, no redeploy of the read
path. Until then every puzzle uses the fallback.

## Voice attribution (default per game type; editorial may override)

`src/lib/faradays-take.ts` → `TAKE_VOICE_BY_TYPE`:

| Voice | Games |
|---|---|
| **Gilbert Faraday** (Authority / Warmth) | Rackl · The Stack · Dark Fiber · Frequency |
| **Mach Eigen** (Precision / forward-looking) | Circuit · The Brief · Signal Drop |

Resolution order (`resolveTakeByline`): explicit `Take Byline` override → the
game-type voice → Gilbert Faraday (last resort). This is a **proposed default** —
set `Take Byline` on any row where the other voice reads better.

## Fallback (never a blank, never a generic "Nice work!")

When a puzzle has no authored Take, the completion screen surfaces the puzzle's
own per-question `explanation` text (`deriveTakeFallback`), rendered **plain
(non-italic) and unsigned** so it never masquerades as an authored, signed Take.
Only Circuit / The Brief / Frequency carry `explanation` content; the other four
types have none, so they show nothing until a Take is authored. The fallback is
derived **client-side from content the browser already has**, so it needs neither
the new field nor the `dc_daily_page_content` store — it works from day one.

## Read path (why it routes through the day-content store)

`src/lib/airtable-puzzle-bank.js` `getLivePuzzles()` reads fields **by field id**
(`returnFieldsByFieldId=true`, rename-safe) — but a not-yet-created field has no
id, so it cannot be read that way. The name-keyed **day-content sync**
(`/api/cron/sync-day-content` → `buildDayContentRow`) reads `Faraday Take` /
`Take Byline` by name into `dc_daily_page_content`; `/api/challenge/today`
(`fetchTodaysTakes`) reads the take back from that store and attaches
`faradays_take` / `take_byline` to each puzzle. Airtable stays out of the take's
per-request hot path.

**Promotion prerequisites for the *voiced* take** (the fallback needs none):
1. Myke adds the `Faraday Take` field (+ optional `Take Byline`) in Airtable.
2. The `dc_daily_page_content` migration is applied and the day-content sync runs
   (both already gated in the FAR-287 changelog).
3. `SUPABASE_SERVICE_ROLE_KEY` is set for `/api/challenge/today` (already required).

## Authoring workflow (recurring editorial cost — flagged, not a one-time build)

- Takes are authored **in Airtable**, in the `Faraday Take` field on each Puzzle
  Bank row — the same place the rest of the puzzle is authored (Airtable authors,
  Supabase/app reads). No separate authoring surface is built, by design.
- **Target:** ~2 sentences, editorial voice, one per puzzle. Optionally set
  `Take Byline` to flip the voice for that row.
- This is an **ongoing cost**: every new puzzle needs a Take written, or it shows
  the plain explanation fallback. Do **not** auto-generate Takes via AI as a
  substitute for editorial authorship (out of scope per the ticket) — that is a
  separate, explicit decision if ever wanted.
- Cross-referenced from `docs/puzzle-schemas.md` (the puzzle authoring contract).

## Files

- `src/lib/faradays-take.ts` — voice map, `resolveTakeByline`, `deriveTakeFallback`.
- `src/lib/faradays-take.test.ts` — `npm run test:take` (9 cases).
- `src/components/FaradaysTake.tsx` — shared render (voiced take · fallback · null).
- `src/components/DailyChallenge.jsx` — `ScoreCard` threads `take` / `takeByline`
  (`puzzleType`) / `takeFallback` to `FaradaysTake` for all 7 games.
- `src/lib/day-content.ts` — reads `Faraday Take` / `Take Byline` by name.
- `src/app/api/challenge/today/route.js` — attaches the take from the store.

## Out of scope / guardrails honored

- No change to per-question `explanation` behavior (still shown by the Answers page).
- No programmatic Airtable schema write.
- No AI-generated Takes.
