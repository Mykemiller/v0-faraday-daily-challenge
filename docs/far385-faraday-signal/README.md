# FAR-385 — Faraday Signal: schema, matcher, Brief pilot

Daily "Faraday Signal" layer: short, dated intelligence items authored
**directly in Supabase** (`dc_daily_signal` — no Airtable coupling), matched
**per-puzzle** to the day's Daily Challenge content at sync time by
`/api/cron/sync-day-content`, and rendered post-solve on the ScoreCard.
Pilot renders on **The Brief only**; the matcher computes for all 7 games so
Signal Drop / Rackl (CC-FAR385-2) are a one-line config flip
(`SIGNAL_ENABLED_GAMES` in `DailyChallenge.jsx`).

## Data flow (mirrors the FAR-389 Faraday's Take pattern)

```
dc_daily_signal (Supabase-direct authoring, RLS deny-all)
   │  05:10 UTC sync-day-content cron
   ▼  matchSignalsForDay() — src/lib/signal-matcher.ts (pure, unit-tested)
dc_daily_page_content.puzzles[*] += { matched_signal_id, signal_match_tier, signal{...} }
   │  /api/challenge/today (service-role read, one Supabase call — unchanged shape)
   ▼
puzzles[type].signal → ScoreCard → <TodaysSignalCard/> (The Brief only)
```

## Matcher (deterministic, structured-first)

1. **Pin override** — `pinned_for_date = serve date` (+ optional
   `pinned_puzzle_type`) wins outright → tier `matched`; colliding pins →
   latest `updated_at` wins + a logged warning.
2. Sub-domain exact match **+10** · domain exact match **+5** · tag overlap
   **+2/tag** (vs. domain/sub-domain labels + topic/name tokens).
3. Recency tiebreak: latest `signal_date` ≤ serve date, then `updated_at`.
4. Tiers: score ≥ 10 → `matched` ("Related Signal"); else if the 3-day window
   (`signal_date` in `[serve−2, serve]`, published) is non-empty → `lead`
   ("Elsewhere in the Sector", best-scoring); else `none` → **no card**.

While the bank's Domain/Sub-Domain links are unpopulated (FAR-178, Myke adds
in Airtable), the domain/sub-domain rules also accept an exact label match
against the puzzle's own `topic` line — so a signal labeled
"Hyperscaler Activity" still domain-matches a puzzle whose topic is exactly
that. Structured `matched` (score ≥ 10) is effectively pin-only until the
links land; that is intended — `matched` framing is reserved for real
metadata agreement.

## Authoring a signal (service role / SQL editor)

```sql
insert into dc_daily_signal (signal_date, headline, body, source_url, source_label,
                             domain, sub_domain, tags, published)
values ('2026-07-30', 'Headline …', 'One-two sentences …',
        'https://…', 'Source Name',
        'Power Architecture', null, array['800v','dc'], true);
-- Commissioner pin (wins outright for that serve day):
--   pinned_for_date = '2026-07-30', pinned_puzzle_type = 'The Brief' (or null = all games)
```

domain / sub_domain are **IDF 4.0 public labels only** — never D#/D#.# codes.

## QA (2026-07-28 serve day, Playwright against the real app)

| State | Result |
|---|---|
| The Brief · tier `matched` | "Related Signal · Jul 28" card renders below the Take — `brief-matched.png` |
| The Brief · tier `lead` | "Elsewhere in the Sector" framing — `brief-lead.png` |
| The Brief · no signal | No card, no empty frame |
| Circuit · signal present in payload | No card (gated by `SIGNAL_ENABLED_GAMES`) |

Live verification: 3 seed signals (`source_label='seed'`) matched against the
real 2026-07-28 row — all 7 puzzles carry `matched_signal_id` +
`signal_match_tier`; The Brief `matched` via pin; anon-key read of
`dc_daily_signal` returns 0 rows (deny-all).
