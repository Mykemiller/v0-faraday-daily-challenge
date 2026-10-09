# 26-41-v01 P9 — /predicts preview screenshots (FDY-147)

Captured headless (Chromium, DPR 2, full page) against the Vercel **preview**
`v0-faraday-daily-challenge-n2u5-6rkhiw4hw-project-foundry.vercel.app`
on **2026-10-09 17:17 CT**, then downscaled to logical width and encoded as JPEG.

| Page | 375px | 1280px |
|---|---|---|
| `/` (home, Predicts tile) | `home-375.jpg` | `home-1280.jpg` |
| `/predicts?view=open&h=30d` | `open-30d-375.jpg` | `open-30d-1280.jpg` |
| `/predicts?view=open&h=24m` (empty state) | `open-24m-375.jpg` | `open-24m-1280.jpg` |
| `/predicts?view=right` | `right-375.jpg` | `right-1280.jpg` |

The gate these were captured by is in the PR body. `24m` is empty by design —
there are 0 active forecasts in that bucket (measured 2026-10-09 16:41 CT), so
that shot is the empty state, not a failure.
