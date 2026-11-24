# FDY-414 (ADM-1.7) — Faraday beta access gate on Faraday Predicts

Branch `claude/fdy-414-access-gate`. Nothing here is deployed by merging alone: the gate is
seeded `open` for Predicts, so it changes nothing visible until someone changes the mode in the
database.

## What is gated

| Surface | Gated? | How |
|---|---|---|
| Every page under `/predicts` (`/predicts`, `/predicts/[id]`, `/company/[slug]`, `/following`, `/movers`, `/preferences`, `/receipts`, `/record`, the Predicts 404) | Yes | `src/app/predicts/layout.tsx` calls `guardPredicts()` before rendering the shell. When the gate does not pass, the layout returns the standard `GatePage` in place of the Predicts shell and page. |
| `/predicts/manifest.webmanifest`, `/predicts/sw.js`, `/predicts/-/opengraph-image` | No | Route handlers, static files and metadata images are not wrapped by layouts. |
| Predicts data (`predicts-public`, `predicts-vote`, `predicts-preferences`, `predicts-push-subscribe`, `predicts-feeds` edge functions) | No (v1, deliberate) | They are Supabase edge functions called directly by the browser; this repo has **no** `/api/predicts*` routes. The feeds and preferences flows carry their own token auth. |
| Daily Challenge, League Office, the home page, every other surface | No | Untouched. Daily Challenge (`dailychallenge`) is always open by contract. |

Modes (from `estate_entitled(p_email, p_app)`, access key `predicts`, app code FP):

- `open` → pass straight through. One probe RPC, no identity lookup, no visible change.
- `invite` / `waitlist` / `live` → the gate resolves identity and either passes or shows the
  request / expired / waitlist view.
- Probe **error** (RPC missing before the migration, timeout, no Supabase env) → **pass through**,
  unless `FARADAY_GATE_ENFORCE=1`, which closes it (the "unavailable" view). Only `error` is
  softened; real denials and `unknown_app` are always honoured. Implemented and tested in
  `src/lib/faradayGate.ts` (`applyEnforcePolicy`).

## Identity source

The gate's own **email one-time code** (Supabase Auth on `ycadmmngkdhvpcsrcuaq`, typed code,
`verifyOtp` type `email`, no redirect link), held in the httpOnly `fgate_at` cookie. Predicts has
no server-visible verified email: its `?t=` preferences link token lives in
`localStorage["faraday_predicts_token"]` and Daily Challenge's `dc_session` is also browser-only,
so neither reaches a server layout on a page request. `appEmail` is therefore `null` in v1.

## Files

- `src/lib/faraday-gate/` — vendored package v1.0.0, byte-identical to
  `Mykemiller/faraday-workbench/packages/faraday-gate` (canonical commit `9c99e07` on the
  workbench branch `claude/fdy-414-access-gate`). `MANIFEST.sha256` lists every file. **Never edit
  a vendored file**: change the canonical package, bump `VERSION`, re-vendor, regenerate the
  manifest (`cd src/lib/faraday-gate && find . -type f ! -name MANIFEST.sha256 | sed 's|^\./||' | LC_ALL=C sort | xargs sha256sum > MANIFEST.sha256`).
- `src/lib/faradayGate.ts` — config, enforce flag, `guardPredicts()`.
- `src/app/api/faraday-gate/[action]/route.ts` — `POST code | verify | request | signout`
  (same-origin only). `/api/*` is never redirected across hosts (`src/lib/hosts.ts`
  `NEVER_REDIRECT`), so the route answers on every host; `src/proxy.ts` / `hosts.ts` are unchanged.
- `src/app/predicts/layout.tsx` — the guard, plus `await connection()`.
- Tests: `src/lib/faraday-gate.test.ts` (wrapper policy, end-to-end through the vendored guard
  with injected fetch, gate copy, manifest + canonical byte identity) and
  `src/lib/faraday-gate-render.test.mjs` (renders `GatePage` under React 19 in every view; no `$`
  or price text). `npm run test:faraday-gate`; both are also in `npm test`.

## Environment

| Name | New? | Used for |
|---|---|---|
| `SUPABASE_URL` | existing | RPC base |
| `SUPABASE_SERVICE_ROLE_KEY` | existing | `estate_entitled`, `estate_access_request`, token → email (server only) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | existing name | the gate's one-time-code sign-in only. If unset, the code endpoints answer 400 "Sign-in is not configured" and the rest of the gate still works. |
| `FARADAY_GATE_ENFORCE` | **new**, optional | `"1"` = a probe error closes Predicts. Unset (default) = a probe error passes through. Set it only after the `estate_entitled` migration is live and verified. |

## Behaviour change to know about

`await connection()` makes every `/predicts` page render per request. Three pages that were ISR
(`/predicts/following`, `/predicts/preferences`, `/predicts/record`, 5-minute revalidate) are now
dynamic. Their data reads still use the 300 s data cache in `predictsGet`; only the HTML is
rendered per request. Without this, a build with no Supabase env would prerender the
pass-through and freeze it, and a later mode change would never take effect on those pages.
Each request adds at most one `estate_entitled` call (2 s timeout, cached 60 s per server
instance, errors never cached).

## Verified locally (2026-11-18)

- `next start` with no Supabase env: `/predicts` renders the normal Predicts page (probe error →
  pass through). With `FARADAY_GATE_ENFORCE=1`: `/predicts` and `/predicts/preferences` render the
  gate's "unavailable" view. `/challenge` unaffected.
- `/api/faraday-gate/code` POST → 400 (no anon key in the local env), GET → 405, cross-origin POST
  → 403, `signout` clears `fgate_at`, unknown action → 404.

## Follow-ups (not in this PR)

1. **Before switching Predicts off `open`:** `/predicts/preferences` (the "Manage your
   preferences" link in every digest) sits behind the gate too. Decide whether email recipients
   must pass the gate to manage preferences; if not, move the gated pages into a route group so
   `preferences` can sit outside it. Confirm the digest's unsubscribe link goes to the edge
   function, not this page.
2. Gate the Predicts data plane if the beta must hide data, not just pages: today the gate is
   presentational over anonymous public edge functions (`predicts-public` is `verify_jwt=false`).
3. Prefer an app-verified email once Predicts has a server-visible sign-in (e.g. resolve the
   `?t=` token server-side to the recipient's email and pass it as `appEmail`).
4. `/api/faraday-gate/*` is fixed to `predicts`. If another product in this app (JW, Signal Room,
   Library…) is gated here later, take the app from the request and validate it against an allow-list.
5. Supabase Auth's email template must include `{{ .Token }}` for code sign-in (one-time Myke check).
6. Predicts gate copy (`gate-copy/predicts.json`) is `status: "draft"`, so the gate shows neutral
   text until Myke approves it in the canonical package.
7. The vendored `GatePage` raises one ESLint warning (`@next/next/no-page-custom-font`, its font
   `<link>`); it cannot be fixed in the vendored copy.
