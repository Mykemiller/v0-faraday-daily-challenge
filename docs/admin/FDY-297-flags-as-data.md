# FDY-297 (ADM-2.4) — env flags as data (Predicts / Daily Challenge)

The Predicts PWA kill switch is read on the server from the Faraday config store (`v_effective_config`, app `FP`)
through `src/lib/config/resolver.ts` (the FDY-295 reference contract: 60 s cache, 4 s timeout, fail closed,
service key server-only) and handed to the client shell as a prop.

| Env var (fallback) | Setting key | Status | Read in |
|---|---|---|---|
| `NEXT_PUBLIC_PREDICTS_PWA` (code default: on; only `off` turns it off) | FP `predicts_pwa_enabled` (boolean, default `true`) | enforced | `src/app/predicts/layout.tsx` → `src/app/predicts/PredictsPwa.tsx` (`disabled` prop) |
| `HINT_GATE_ENFORCED` (Vercel name only) | DC `hint_gate_enforced` (boolean, default `false`) | recorded_only | **no reader**: nothing in this repo reads it; the hint budget (FAR-198) is client-side localStorage |

Rule: a console value wins within 60 s, no redeploy. The env value stays when the read fails, the key is unknown,
the value is not a boolean, or nobody has set a value.

Not moved (configuration that is not a flag, or a secret): `NEXT_PUBLIC_PREDICTS_API_URL`, `VITE_PREDICTS_API_URL`
(endpoint), `NEXT_PUBLIC_PREDICTS_VAPID_PUBLIC_KEY` (public key), `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_SECRET`,
`ANTHROPIC_API_KEY`, `AIRTABLE_API_KEY`/`AIR_TABLE_API_KEY`, `BEEHIIV_API_KEY` (secrets stay in env; the resolver
never logs a key or value). Found, not changed: `NEXT_PUBLIC_LEAGUE_OFFICE_OPEN`, `DC_PUZZLE_SOURCE`,
`FARADAY_GATE_ENFORCE` are further candidates for a later pass.

Tests: `npm run test:predicts-settings` (`src/lib/config/resolver.test.ts`, `src/lib/predicts-settings.test.ts`), also in `npm test`.
