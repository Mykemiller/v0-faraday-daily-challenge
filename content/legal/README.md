# Faraday legal corpus — how it fits together

**CC-TOS-PRICING-1.0.** One master, five schedules, one copy of each document
anywhere.

## The model

There is **one** Terms of Service body for all of Faraday. It lives in exactly
one file, is published at exactly one URL, and every storefront **incorporates it
by reference** — a link, never a copy.

```
                    content/legal/terms-of-service.md          (THE MASTER)
                    published: https://faraday-intelligence.ai/terms
                                      ▲
              ┌───────────┬───────────┼───────────┬───────────┐
              │           │           │           │           │
        Schedule JW  Schedule DC  Schedule SR  Schedule BL  Schedule FA
```

Each Schedule opens with the same incorporation clause and the same conflict
rule: *the Schedule controls for its storefront only, and only to the extent of
the conflict.* No Schedule restates the master body.

## Who owns what

| Document | Source of truth | Published at |
|---|---|---|
| **Master Terms** | this repo — `content/legal/terms-of-service.md` | `faraday-intelligence.ai/terms` |
| **Schedule JW** — Jurisdiction Watch | `faraday-jurisdiction-watch` — `content/legal/schedules/jurisdiction-watch.md` | `jurisdiction-watch.com/terms` |
| **Schedule DC** — Daily Challenge | this repo — `content/legal/schedules/daily-challenge.md` | `faradaydailychallenge.com/terms/daily-challenge` |
| **Schedule SR** — Signal Room | this repo — `content/legal/schedules/signal-room.md` | `faraday-intelligence.ai/terms/signal-room` |
| **Schedule BL** — Briefing Library | this repo — `content/legal/schedules/briefing-library.md` | `faraday-intelligence.ai/terms/briefing-library` |
| **Schedule FA** — Faraday Academy | this repo — `content/legal/schedules/faraday-academy.md` | manual paste into LearnWorlds |

A Schedule lives in the repository that owns its storefront wherever such a
repository exists. Jurisdiction Watch owns its own; the hub hosts the three whose
storefront repositories this work could not reach, plus Academy, which has no
repository at all (see `docs/legal/DISCOVERY.md`). Whichever repo holds it, a
document exists **once**.

`src/lib/legal/documents.ts` encodes this table. A `remote` entry is never
vendored here — `/terms/jurisdiction-watch` permanently redirects to the
storefront that publishes it.

## Rendering

The markdown IS the legal text; the pages are a view of it.

- `src/lib/legal/markdown.ts` — pure parser for the authored subset. Zero
  dependencies, on purpose: this repo ships only next/react/react-dom, and a
  legal document should not pull in an MDX toolchain.
- `src/components/legal/MarkdownBody.tsx` — renders the parsed blocks.
- `src/app/terms/page.tsx` — the master. `src/app/terms/[storefront]/page.tsx` —
  the schedules.

A `>` blockquote in this corpus always means **conspicuous notice** (the
auto-renewal disclosure, the counsel-review blocks). It renders as a bordered,
tinted box. Do not use it for pull quotes.

## Editing rules

1. **Never copy the master body into a Schedule or into another repo.**
   `npm run test:legal` fails on it.
2. **The effective date is front matter, not a page literal.** This supersedes
   the CC-DC-LEGAL-1.0 convention of a literal in the page component — the text
   and its date now travel together in one file.
3. **Everything is `status: DRAFT` until counsel clears it.** While a document is
   draft, every page renders a non-dismissible "not yet in force" banner and
   suppresses the effective date. Flipping a document live means: counsel signs
   off, the `TODO` placeholders are resolved, `effective` becomes a real date,
   and `status` stops being `DRAFT`.
4. **`TODO(myke)` and `TODO(myke + counsel)` are load-bearing.** Two of them —
   governing law/venue, and token expiry/forfeiture — are open questions the
   corpus deliberately refuses to answer. Do not close them by guessing.
5. **Never assert that tokens never expire, and never invent an expiry period.**
   Both are guarded by tests. See Schedule BL, BL-4 for why.
6. **Attribution is institutional.** Required credit is "Faraday Intelligence",
   never a persona byline. Guarded by a test over the attribution section.

## Tests

```
npm run test:legal     # parser + corpus compliance guards
npm run test:pricing   # pricing contract + no hardcoded prices
```

The corpus guards are not style checks. Each one pins a required clause or a
stop condition; read the assertion message before changing a test.
