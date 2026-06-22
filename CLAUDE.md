@AGENTS.md

## Faraday Intelligence site canon (set 2026-06-19, engine-as-site — approved by Myke; FAR-119)

This repo **is the entire `faraday-intelligence.ai` site** — not just the Daily
Challenge. The domain `faraday-intelligence.ai` (+ `www`) lives on this Vercel
project (`v0-faraday-daily-challenge-n2u5`, `prj_A7MhvdAWivMLOccGMTp6AFYZQ1s1`).

Routes:
- `/` — storefront homepage, 8 storefronts (`src/app/page.tsx`)
- `/challenge` — Daily Challenge lobby; `/daily-challenge` rewrites to it (canonical DC URL)
- per-product stub pages (`/intelligent-alert`, `/live-agent`, `/briefing-library`,
  `/jurisdiction-watch`, `/signal-room`, `/thought-forge`, `/academy`)
- `/leaderboard` — scaffold (Preview; full build gated on FAR-64/71)
- `/api/ask` (server-side Anthropic), `/api/subscribe` (Beehiiv), `/api/lexicon` (Airtable)

Invariants:
- **No `basePath`** (the domain root is served here). Don't re-add it.
- `faradaydailychallenge.com` (+ `www`) **301** → `faraday-intelligence.ai/daily-challenge`
  via the host-conditioned edge redirect in `vercel.json` (a real 301 — Next
  `redirects()` only emit 307/308).
- Production deployment URL must stay public (Deployment Protection = *Only Preview
  Deployments*) so the custom domains serve.
- Env required: `ANTHROPIC_API_KEY`, `BEEHIIV_API_KEY`, `BEEHIIV_PUB_ID`, `AIRTABLE_API_KEY`.
- Per-product token meters are **DRAFT (FAR-46)** — do not publish meter values.
  IDF copy is count-agnostic (Nine Core Domains OK; total count unpublished).
- The brand repo `Faraday-intelligence` is **retired/dormant** (no production
  domain). Do not build new surfaces there. This supersedes the earlier
  basePath+proxy arrangement (FAR-63) and reverses Decision Log D2.

## Daily Challenge rotation cron (AUTO-128, fixed 2026-06-22)

The Daily Challenge serves the Airtable **Puzzle Bank** (`src/lib/airtable-puzzle-bank.js`):
base `appxfti7VuoHYUeu6`, table `tbliJaRmctbIWJC43` ("Faraday Puzzle Bank").
`/api/challenge/today` reads `Published = "Live"`; `/api/cron/rotate` rotates the
serve set nightly at midnight America/Chicago.

**Root cause of the recurring 500 (fixed):** the helper read the Airtable key from
`FARADAY_AIRTABLE_API_KEY`, but the June-19 engine-as-site migration (FAR-119)
standardized Airtable creds under **`AIRTABLE_API_KEY`** (see `/api/lexicon`), which
is what production provisions. The key was therefore unset for the Puzzle Bank, so
every read *and* write threw — the consumer masked it (catch → empty `{}` → mock
fallback, 200) while the rotator surfaced it as a 500 at the promote step. The
helper now reads `AIRTABLE_API_KEY` first, with `FARADAY_AIRTABLE_API_KEY` (and
`AIRTABLE_BASE_ID` / `AIRTABLE_TABLE_ID`) as legacy fallbacks. **`AIRTABLE_API_KEY`
must have write access to the Puzzle Bank** (it is the same Airtable PAT used by
the lexicon route; ensure its scope includes write, not just read).

**Hardened rotate contract** (`/api/cron/rotate` + `rotateLiveSet`):
- **Promote:** `Published = "Published"` AND `Go Live Date = today` (Chicago) → `Live`.
- **Retire:** `Published = "Live"` AND `Go Live Date < today` (strictly before, day-
  granular `DATETIME_DIFF`) → `Retired`. Never touches today's or a future-dated row.
- **Idempotent:** both filters are self-correcting — a re-run finds nothing to
  promote (already `Live`) or retire (prior set already `Retired`); never double-promotes.
  The 06:00-UTC safety re-run after the 05:00-UTC run is a safe no-op.
- **Guard:** runs only at hour 0 in America/Chicago (DST-aware via `Intl`), unless
  `?force=1`. `CRON_SECRET` (Bearer) enforced when set; `?force=1` still requires it.
- **Logging:** failures log structured JSON (`step` = promote/retire, `recordIds`,
  upstream `error`/`cause`) via `RotationError` — not a truncated message.
- Promote runs before retire so a mid-run failure never leaves zero `Live` rows.

**Puzzle Bank field / option IDs** (stable across renames — use these):
- `Published` (singleSelect) field `fldLzhFxNWLnvJlvW`: `Published`=`seljRJZrs4HBwJrtU`,
  `Live`=`selNKyT2AewWpWJA9`, `Retired`=`selakY5RgVqZW1DSL`, `Unpublished`=`sel3PyzvmWXbN3HCv`.
- `Go Live Date` field `fldemR86qFJXwJe6g`; `Puzzle Type` field `fldQ6d9fdAdE4bqkT`;
  `Puzzle Name` field `fld1Et18F9muU7nWl`; `Puzzle Content` (JSON) field `fldBNhNWxcig4j4D8`;
  `Status` field `fld7qyUy5UP7EoUVu` (`Approved`=`sellYe934cbLkfCDw`).
- 7 puzzle types: Rackl, Signal Drop, The Stack, Circuit, The Brief, Dark Fiber, Frequency.
- June 14–19 sets were skipped during the outage and stay `Published` (never shown) — accepted; do not backfill.
