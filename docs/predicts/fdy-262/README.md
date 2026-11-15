# FDY-262: velocity tag, evidence line and "What we looked at" on /predicts

Captured 2026-11-14 15:03 CT with `next dev` against a **local fixture API**. The predicts-public
allow-list change (Mykemiller/Faraday, FDY-262 PR) is not deployed, and no production row has the
fields yet (0 of 217 on 2026-11-14). The fixture is the live `view=open` response, with the three
fields injected in the shape the patched function emits. It cycles accelerating, stable, decelerating
and legacy, so the board also shows cards with **no** velocity elements (D4).

| File | What it shows |
|---|---|
| `board-default-375.png`, `board-default-1200.png` | The default board: Thread rows carry the chip only (rows are links; the evidence block cannot nest inside one) |
| `board-375.png` | Search results (`?q=cooling`) at 375px, first disclosure opened |
| `board-1200.png` | The same at 1200px |
| `forecast-375.png`, `forecast-1200.png` | One forecast page with the chip in the status strip and the evidence block |

DOM checks run with the captures (both widths): 16 cards, 14 with an evidence block, no horizontal
overflow, no `L<n>` code and no word "layer" anywhere in `<main>`. The `<summary>` takes focus and
opens with Enter.

Default board (both widths): 77 Thread rows visible, 56 with a chip (the fixture leaves every fourth forecast legacy), no overflow, no codes.
