# faraday-gate (FDY-414 · ADM-1.7)

One beta access gate for every Faraday app. **Canonical copy lives here**; each app vendors it as
`lib/faraday-gate/` with the `VERSION` file. Never edit a vendored copy — change this one, bump `VERSION`,
re-vendor, and the app's byte-identity test tells you if a copy drifted.

| File | Runs | Does |
|---|---|---|
| `core.ts` | anywhere | types, `parseEntitlement` (fail closed), `gateView`, `displayCopy` (draft copy never shows), `COMMERCIAL_LINE`, price/count guards |
| `server/check.ts` | server | `checkAccess({email, app}, cfg)` → `estate_entitled` with the **service key**, 2 s timeout, 60 s cache per (email, app), errors never cached, any failure = deny |
| `server/identity.ts` | server | app-verified email first; else the gate's own Supabase Auth **email one-time code** (typed code, `verifyOtp` type `email`, no redirect link) held in the httpOnly `fgate_at` cookie |
| `server/request.ts` | server | "Request demo access" / "Join the waitlist" → `estate_access_request`; 5 per IP per hour (in-memory) |
| `server/handlers.ts` | server | one Web `Request → Response` handler for `POST /api/faraday-gate/{code,verify,request,signout}`; same-origin only |
| `server/guard.ts` | server | `guardRoute({app, appEmail, cookieHeader}, cfg)` — mode `open` passes through with no identity lookup |
| `ui/GatePage.tsx` | client | the standard gate page (shared S3 masthead from `faraday-masthead`, story, two buttons, commercial line, Terms/Privacy/version) |
| `ui/gate.html` | static | fallback for apps without React; its masthead block is generated from `faraday-masthead` (between the markers) |
| `gate-copy/<access_key>.json` | data | per-app story, `status: "draft"` until Myke approves |

## Masthead (1.1.0, FDY-444)
Since 1.1.0 the gate renders its masthead from the shared `faraday-masthead` package (no second copy of the markup).
Vendor **both** side by side: `lib/faraday-gate/` and `lib/faraday-masthead/` (GatePage imports
`../../faraday-masthead/ui/Masthead.tsx`). Gate behaviour and copy are unchanged.

## Config (`GateServerConfig`)
`{ supabaseUrl, serviceKey, anonKey? }` — read from the app's **existing** env names (no new secret for the check).
`anonKey` is only needed for the gate's own one-time-code sign-in. The service key never leaves the server.

## Rules
- No prices, dollar figures or token counts anywhere on the gate. No counts of Theaters, Sectors, Threads or Domains.
- Copy with `status: "draft"` renders neutral text; flipping it to `"approved"` is Myke's call (always-human copy).
- Daily Challenge is always open; it gets no gate copy.
- Supabase Auth's email template must include `{{ .Token }}` for code sign-in to work (one-time Myke check).

## Tests
`node --experimental-strip-types --test packages/faraday-gate/test/gate.test.ts` (17, no network) and
`test/render.test.mjs` (renders every view and greps for `$`; needs react + esbuild, skips without them).
