@AGENTS.md

## Daily Challenge canon (set 2026-06-19, reverses Decision Log D2 — approved by Myke)

This repo is the **canonical Daily Challenge engine**. It is mounted under
`basePath: '/daily-challenge'` (see `next.config.ts`) and served at
**`https://faraday-intelligence.ai/daily-challenge`** via a rewrite from the
brand site (repo `Faraday-intelligence`, project `prj_lhFDPfhNxPuI8JEiAtZ4K7SHNPqZ`).
The brand site **only proxies** the path — do not re-fork the Daily Challenge there.

- `faradaydailychallenge.com` (+ `www`) **301** → `faraday-intelligence.ai/daily-challenge`
  via the host-conditioned edge redirect in `vercel.json` (a real 301 — Next's
  `redirects()` only emit 307/308, so it must live there).
- The proxy depends on this project's **Deployment Protection** keeping the
  production URL public (Vercel Authentication = *Only Preview Deployments*). Do
  not re-enable Standard Protection or the brand proxy will 401.
- The in-repo Babel-standalone surface that used to live in the brand repo is
  retired (FAR-63).
