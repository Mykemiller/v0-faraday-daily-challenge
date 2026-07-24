# Puzzle Bank — `Puzzle Content` JSON schemas (FAR-287)

**Reverse-engineered from the live game components** (`src/components/DailyChallenge.jsx`,
`src/lib/signal-drop.js`) and validated against **real bank records** (the 2026-07-23 Live
set, base `appxfti7VuoHYUeu6` / table `tbliJaRmctbIWJC43`). This is the authoritative
contract a generator must emit. Each record's `Puzzle Content` field holds one of these
objects **as a JSON string**.

## Conventions that apply to all 7 types

- `Puzzle Content` is a **string** containing JSON — `JSON.parse` must succeed or the type
  falls back to a built-in mock (`parsePuzzleContent` → `null`).
- Every object may carry two cosmetic top-level fields, both read by `ScoreCard`:
  - `name` (string) — puzzle title (win screen). **Author it.**
  - `domain` (string) — a short topic label shown on the win screen. In the live bank this
    is **free-text and inconsistent** ("Compute", "Grid", "GPU & Accelerators", "Power
    Architecture"), *not* an IDF code. For FAR-287 we set it to the day's **Sector display
    name** (public label, count-agnostic); the IDF codes live in staging DB columns, never
    in `Puzzle Content`.
- **Never author `__publicId`** — the route injects it from the separate `Public ID` field.
- The three escalating hints live in Airtable **`Hint 1` / `Hint 2` / `Hint 3`** fields, not
  in `Puzzle Content` (except Signal Drop's optional in-content `hint1`/`hint2`, see below).

---

## 1. Rackl — Connections-style grouping

**Hard shape: exactly 4 groups × exactly 4 items (16 tiles).** Win condition is hard-coded
`solved.length === 16`; `content.groups.flatMap(...)` throws if `groups` is absent.

```jsonc
{
  "name": "Grid & Interconnect",
  "domain": "Grid & Regulatory",
  "groups": [                              // REQUIRED — exactly 4
    {
      "label": "ISO/RTOs",                 // REQUIRED — solved-banner text + hint source
      "color": "#1C3424",                  // REQUIRED — CSS color, banner background
      "textColor": "#EEE6DA",              // REQUIRED — CSS color, banner text
      "items": ["PJM","ERCOT","MISO","CAISO"]   // REQUIRED — exactly 4 strings
    }
    // 3 more groups
  ]
}
```
Real record (`recSgYhlpTSJWoMoD`, 2026-07-23): 4 groups — ISO/RTOs, FERC Actions, Capacity
Terms, Reliability — each 4 items, palette `#1C3424`/`#C4922A`/`#2A5A3A`/`#5A4010`.

---

## 2. Signal Drop — Wordle

The one type transformed before it reaches the browser (`toPublicSignalPuzzle` strips the
answer). **Author the raw shape** below; do **not** author `wordLength`/`hints` (derived).

```jsonc
{
  "name": "SUBSTATION",                    // mirrors `word` by convention; STRIPPED for client
  "domain": "Power Architecture",
  "word": "SUBSTATION",                    // REQUIRED — THE ANSWER (upper-cased). STRIPPED for client
  "clue": "A facility that transforms transmission voltage down to usable distribution levels", // REQUIRED
  "hint1": "Where high voltage steps down",   // optional — gated hint 1
  "hint2": "Proximity speeds interconnection"  // optional — gated hint 2
}
```
Real record (`reclYwDoVKWCR6LkS`, 2026-07-23) — exactly this shape.
`SIGNAL_ANSWER_FIELDS = ["word","name","answer","solution"]` are all stripped client-side.
Answer is validated server-side via `/api/challenge/guess` → `getSignalDropAnswer`. Keep the
answer a **single A–Z token** (no spaces/punctuation); grid width = `word.length`.

---

## 3. The Stack — drag-to-rank

```jsonc
{
  "name": "Rank voltage classes by level",
  "domain": "Power & Electrical",
  "items": ["Rack PDU","Busway","Medium-voltage","Transmission"],  // REQUIRED string[]
  "correctOrder": [0,1,2,3],               // REQUIRED number[] — indices into items, rank #1 first
  "metric": "Nominal voltage, lowest to highest",                  // rendered as the ranking prompt
  "values": ["208V","415V","13.8kV","138kV"]                        // optional — per-item value shown in results
}
```
Real record (`recbb1Z0gwK7AGTNW`, 2026-07-23) — exactly this.
**Authoring rule:** keep `correctOrder` the identity `[0,1,…]` over **pre-ranked** `items`,
with `values[i]` describing `items[i]`. (The in-game results panel indexes `values` by rank
position and `day-content.extractAnswer` by item index; identity order keeps both consistent.)
The ranking must be **verifiable and total** — real ordered quantities (voltages, TDPs, MW,
dates), not opinion.

---

## 4. Circuit — true/false timed sprint

```jsonc
{
  "name": "GPU & Accelerators Sprint",
  "domain": "GPU & Accelerators",
  "timeLimit": 60,                         // REQUIRED number (seconds) — content-driven timer + scoring denominator
  "questions": [                           // REQUIRED array (real records use 6)
    {
      "q": "GPUs excel at the parallel matrix math used in AI training.", // REQUIRED string
      "a": true,                           // REQUIRED boolean — the answer
      "explanation": "Massive parallelism suits neural-network computation." // REQUIRED string
    }
    // ...
  ]
}
```
Real record (`recT2xXS6IC2qx7zF`, 2026-07-23): `timeLimit: 60`, **6** T/F questions.
**Circuit is the only type whose `timeLimit` is read from content** — it must be present
(NaN breaks the timer). Convention: 6 questions, `timeLimit: 60`.

---

## 5. The Brief — read + multiple-choice

```jsonc
{
  "name": "Custom Silicon vs NVIDIA's Moat",
  "domain": "Compute",
  "readTime": 90,                          // REQUIRED number (seconds) — read-phase timer (display only, not scored)
  "brief": "Paragraph one.\n\nParagraph two.\n\nParagraph three.",  // REQUIRED — split on \n\n into <p>
  "questions": [                           // REQUIRED array (real records use 3)
    {
      "q": "What is described as NVIDIA's deepest moat?",       // REQUIRED
      "options": ["...","The CUDA software ecosystem...","...","..."], // REQUIRED string[] (4)
      "correct": 1,                        // REQUIRED number — 0-based index of correct option
      "explanation": "The brief identifies the CUDA ... moat."  // REQUIRED
    }
    // ...
  ]
}
```
Real record (`recPBV7myjW5GiWlz`, 2026-07-23): `readTime: 90`, a 3-paragraph `brief`
(paragraphs joined by `\n\n`), **3** MCQs × 4 options. `correct` is **0-based**.

---

## 6. Dark Fiber — term ↔ definition matching

```jsonc
{
  "name": "Site Metrics",
  "domain": "Facility Measurement",
  "pairs": [                               // REQUIRED array (real records use 6)
    { "term": "PUE",  "def": "Power Usage Effectiveness comparing total energy to IT energy" },
    { "term": "WUE",  "def": "Water Usage Effectiveness tracking water used per unit of IT energy" }
    // ... (6 total)
  ]
}
```
Real record (`recZXwk51kUsXBedY`, 2026-07-23): 6 pairs (PUE, WUE, CRITICAL LOAD, TIER III,
RAISED FLOOR, GENERATOR). Definitions are truncated to ~80 chars in the UI — keep them tight.
Prime source: the **Lexicon** (540 approved term/definition rows).

---

## 7. Frequency — multiple-choice quiz

Same question shape as The Brief but **no `brief`/`readTime`**.

```jsonc
{
  "name": "GPU Generations & TDP Quiz",
  "domain": "Chips & Density",
  "questions": [                           // REQUIRED array (real records use 4)
    {
      "q": "Which Nvidia architecture came after Hopper?",  // REQUIRED
      "options": ["Blackwell","Ampere","Volta","Pascal"],   // REQUIRED string[] (4)
      "correct": 0,                        // REQUIRED — 0-based
      "explanation": "Nvidia's Blackwell architecture succeeded Hopper." // REQUIRED
    }
    // ...
  ]
}
```
Real record (`recCZBmU7vDnVZKvy`, 2026-07-23): **4** MCQs × 4 options.

---

## Answer extraction / round-trip (`src/lib/day-content.ts` `extractAnswer`)

The Answers-Today page derives the correct answer per type from `Puzzle Content`:

| Type | Answer derived from |
|---|---|
| Rackl | `groups[].label` + `groups[].items` |
| Signal Drop | `word` (upper-cased) |
| The Stack | `items` reordered by `correctOrder`, paired with `values` |
| Circuit | per-question `a` (boolean → True/False) |
| The Brief / Frequency | per-question `options[correct]` |
| Dark Fiber | `pairs[].term` ↔ `pairs[].def` |

The Phase-5 round-trip test feeds each generated `puzzle_content` through this exact path;
a null/empty extraction means the schema is wrong.

## Per-type counts & scoring dependencies (convention)

| Type | Array size (convention) | Scoring input from content |
|---|---|---|
| Rackl | 4 groups × 4 items (hard 16) | none (maxPoints hard-coded 16) |
| Signal Drop | 1 word, ≤2 in-content hints | none (max guesses 6) |
| The Stack | 4 items (identity order) | none (maxPoints = items.length) |
| Circuit | 6 T/F questions | **`timeLimit`** (also the timer) |
| The Brief | 3 MCQs × 4 options | none (`readTime` display-only) |
| Dark Fiber | 6 pairs | none |
| Frequency | 4 MCQs × 4 options | none |
