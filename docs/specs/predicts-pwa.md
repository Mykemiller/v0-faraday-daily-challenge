# Faraday Predicts — installable mobile app + push for Flashes

**CC-PREDICTS-PWA-1.0 · FDY-127 (26-47-v01) · Phase 1 spec · 2026-11-06**
Status: **spec only — nothing built, nothing deployed, no database row written.**
Phase 2 build is a HARD STOP until Myke replies "go" on FDY-127.

---

## 0. What Phase 1 found (read-only, 2026-11-06 22:30 CST)

Checks run against Supabase project `ycadmmngkdhvpcsrcuaq` (SELECT-only) and this repo:

| Check | Result |
|---|---|
| `to_regclass('public.predicts_flash_decisions')` | **NULL — table does not exist.** FDY-117 (Flash trigger engine) is **Todo**. |
| `to_regclass('public.predicts_recipients')` | `predicts_recipients` exists. 16 rows. RLS on, one policy (`predicts_recipients_service_role`). |
| `predicts_recipients.preferences` | jsonb column exists, and **every row is empty** (no keys anywhere). |
| FDY-119 preferences function | **Not deployed.** No preferences edge function in the project; FDY-119 is **Todo**. |
| FDY-118 SMS consent + delivery | **Todo.** No SMS consent columns or table exist yet. |
| `predicts_config.release_tag` | Present (`26-45-v02` today). Read at runtime, never hardcoded. |
| Predicts edge functions deployed | `predicts-public`, `predicts-optin`, `predicts-unsubscribe`, `predicts-optin-invite`, `faraday-predicts-{generate,generate-preview,digest,resolve}` |
| Code-level allowlist | `APPROVED_ALLOWLIST` + `ALLOWLIST_LIFTED = false` + `isAllowlisted()` in `predicts-recipients-pure.ts` (FDY-112), shared by the three opt-in functions. |
| `grep -rn "serviceWorker" src` | **No matches.** The site has no service worker today. |
| `src/app/manifest.ts` | Daily Challenge manifest, `start_url: /daily-challenge`, no `scope` (so the scope is `/`, the whole site). See Appendix A. |
| `npm test` | 52 / 52 pass. `npm run test:predicts` 25 / 25 pass. |

**What this means.** Three of the four screens (Today's calls, Receipts, the
app shell) can be built on what exists today. **Followed forecasts, Preferences
and the whole push send path depend on FDY-117 and FDY-119, which do not exist
yet.** Phase 2 has to be split. §11 describes how. Inventing a preferences store or
a Flash table here would duplicate those issues, and the prompt forbids it.

Paths differ from the prompt. The data helpers are `src/lib/predicts.ts` (+
`predicts.test.ts`). The page is `src/app/predicts/page.tsx` + `PredictsView.tsx`.

The Faraday repo (`Mykemiller/Faraday`) could not be attached in this session.
The deployed edge function source was read through the Supabase function-source
API instead (read-only). Phase 2 needs that repo attached with push access.

---

## 1. Scope per screen

Every screen reads an API that already exists or that an upstream issue owns.
This spec invents no new data surface (Done-When 2).

| Screen | Route | Data source (reused) | Available today? |
|---|---|---|---|
| **Today's calls** | `/predicts` (default view) | `predicts-public?view=open&horizon=…`, which the current page already uses (`PredictsView` → `PredictsResponse`) | **Yes** |
| **Receipts** | `/predicts?view=receipts&outcome=…` | `predicts-public?view=receipts` + `cursor` (FDY-114, merged in #204) | **Yes** |
| **Faraday got it right** | `/predicts?view=right` | `predicts-public?view=right` | **Yes** (existing view, kept) |
| **Followed forecasts** | `/predicts/following` | `predicts-public?view=open` filtered **client-side** by the recipient's FDY-119 preferences (D5). There is no follow table in v1. | **No.** Needs FDY-119's preference shape and read endpoint. |
| **Preferences** | `/predicts/preferences` | The FDY-119 preferences function (read + write, token-authorised). This issue only **adds one toggle** to it, the push opt-in (D4). | **No.** FDY-119 not built. |

Notes:
- The app reuses `PredictsView` and the `predicts.ts` copy rules unchanged:
  no accuracy percentage, the no-misses line, no taxonomy counts. The PWA
  wraps the existing page. It does not fork it.
- **Identity.** Followed forecasts and Preferences need to know *which
  recipient* is using the app. The only recipient credential that exists is
  `predicts_recipients.token` (the FDY-112 link token). FDY-119 decides how a
  recipient signs into preferences. This app adopts that decision and adds no
  new auth scheme. If FDY-119 settles on "the link token", the app keeps it in
  `localStorage` under `faraday_predicts_token` after the first visit through a
  digest link, and never prints it.
- Public screens (Today, Receipts, Right) work signed out, exactly as now.

## 2. Manifest design (D1)

The Predicts app gets **its own manifest and scope**, so installing it does not
take over the Daily Challenge, and installing the game does not take over Predicts.

- New route `src/app/predicts/manifest.webmanifest/route.ts`. It returns
  `application/manifest+json`. Next's `app/manifest.ts` convention only works
  at the root, and that file stays the Daily Challenge manifest, unchanged.
- New `src/app/predicts/layout.tsx` sets `metadata.manifest =
  "/predicts/manifest.webmanifest"`. That overrides the root `<link rel="manifest">`
  for `/predicts/*` only. It also sets `appleWebApp` (`capable`, `title`,
  `statusBarStyle`) and the apple-touch-icon.
- Manifest fields (proposed values. Name and short name are copy for Myke):
  ```json
  {
    "id": "/predicts",
    "name": "Faraday Predicts",
    "short_name": "Predicts",
    "start_url": "/predicts?source=pwa",
    "scope": "/predicts",
    "display": "standalone",
    "background_color": "#1C3424",
    "theme_color": "#1C3424",
    "icons": [/* existing /icon-192.png, /icon-512.png + a maskable 512 */]
  }
  ```
- **Fix to the existing Daily Challenge manifest, flagged and not done here:**
  it has no `scope`, so its scope is `/`, and that already includes `/predicts`.
  Phase 2 should add `scope: "/challenge"` (or the DC path the app actually
  serves) *only if Myke agrees*. It is a Daily Challenge behaviour change.
  Without it, a phone that installed the game opens `/predicts` links inside
  the game's window. Listed as **D6**.
- Host. `/predicts` lives on `faraday-intelligence.ai` (it is not a DC page in
  `src/lib/hosts.ts`), so the PWA origin is `https://www.faraday-intelligence.ai`.
  Push subscriptions are bound to that origin.

## 3. Service worker design (D2)

- One file, `public/predicts/sw.js`, plain JS. **No new dependency**: no
  next-pwa, no Workbox, which matches the repo's no-new-vendor rule. Registered
  from the Predicts layout with `navigator.serviceWorker.register("/predicts/sw.js",
  { scope: "/predicts" })`. Because the file sits under `/predicts/`, the scope
  cannot widen past it, and no `Service-Worker-Allowed` header is needed.
- `next.config.ts` adds headers for `/predicts/sw.js`: `Cache-Control: no-cache`
  and `Content-Type: text/javascript`, so a new worker is picked up on the next
  visit.
- **Caching (D2: read-only offline):**
  - *Install:* pre-cache the app shell (`/predicts`, `/predicts/following`,
    `/predicts/preferences`, icons, fonts the page uses). The cache name
    carries a version constant that changes with each worker release.
  - *Navigations:* network first, falling back to the cached shell.
  - *`predicts-public` GETs:* network first. A successful response is stored
    (last-good copy per query key). Offline, the last-good copy is served,
    and the page shows a stale banner whose text is quoted in §8.
  - *Never cached:* any POST, anything carrying a token, the preferences
    function, the push subscribe endpoint. **There are no offline writes.** A
    preference change made offline is refused with a message. It is never
    queued.
- **`push` event handler:** shows the notification from the payload (§5). It
  does no fetch, so a Flash shows even if the network drops after delivery.
- **`notificationclick`:** focuses an open Predicts window, or opens
  `payload.url`. The URL must be within `/predicts`. Anything else is dropped.
- **`pushsubscriptionchange`:** re-subscribes and posts the new subscription to
  the subscribe endpoint, so a browser key rotation does not silently stop Flashes.

## 4. Push subscription storage

Migration file, **written in Phase 2 and left unapplied until Myke approves**:
`supabase/migrations/<timestamp>_fdy127_push_subscriptions.sql` (Faraday repo,
applied only through `apply_migration`).

```sql
create table if not exists public.predicts_push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid not null references public.predicts_recipients(id) on delete cascade,
  endpoint        text not null unique,          -- push service URL, origin-bound
  p256dh          text not null,                 -- client public key
  auth            text not null,                 -- client auth secret
  user_agent      text,                          -- truncated to 200, display only
  platform        text check (platform in ('ios','android','desktop','unknown')),
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count   integer not null default 0,
  revoked_at      timestamptz                    -- 404/410 from the push service, or the user turned push off
);
create index if not exists predicts_push_subscriptions_recipient_idx
  on public.predicts_push_subscriptions (recipient_id) where revoked_at is null;
alter table public.predicts_push_subscriptions enable row level security;
-- deny-all for anon/authenticated (no policies for them); explicit service_role policy:
do $$ begin
  if not exists (select 1 from pg_policy where polname = 'predicts_push_subscriptions_service_role') then
    create policy predicts_push_subscriptions_service_role on public.predicts_push_subscriptions
      for all to service_role using (true) with check (true);
  end if; end $$;
revoke all on public.predicts_push_subscriptions from anon, authenticated;
```

- Consent (D4) is **not** stored on this table. It lives with the recipient's
  other channel consents (§6). A subscription row is only the delivery address.
  A recipient can have several (phone + laptop).
- The `p256dh`/`auth` keys are credentials for that one browser. They never
  leave the service role and are never logged.
- The migration ends in a DO block that raises unless: RLS is on, there are no
  anon/authenticated grants, and the service_role policy is present. That is
  the same gate pattern the Predicts migrations already use.

**Subscribe endpoint.** New edge function `predicts-push-subscribe` (Faraday
repo, `verify_jwt=false`, token-authorised like `predicts-optin`):
- `POST {token, subscription, platform}` → it resolves the recipient by token
  and requires `review_status='approved'`, `optin_status='confirmed'` and push
  consent on. Then it upserts on `endpoint`.
- `DELETE {token, endpoint}` → sets `revoked_at`.
- It returns no recipient data. An unknown token gets a neutral 404, the same
  as `predicts-optin`.

## 5. Send path

New edge function `predicts-push-send` (Faraday repo). It is **driven by FDY-117,
never by a cron of its own.**

1. **Input.** It reads `predicts_flash_decisions` rows with `decision='selected'`
   that have no push delivery yet. The table and the trigger engine are
   FDY-117's. This function only reads them. *(The table does not exist today. See §0.)*
2. **Recipients.** It joins to `predicts_recipients` where
   `review_status='approved'` and `optin_status='confirmed'`, push consent is
   on, and the recipient's FDY-119 preferences select this Flash. It then joins
   to their non-revoked subscriptions.
3. **Allowlist assertion.** It reuses FDY-112's `isAllowlisted()` from the
   shared `predicts-recipients-pure.ts`. There is no second copy of the list.
   Immediately before **each** push call, `assertPushAllowed(recipient.email)`
   **throws** if the address is not allowlisted. The throw aborts that
   recipient and is logged with a recipient id (never the email). The run reports it.
   This sits *in front of* the provider call, not as a filter beside it. The
   test mock (§7) proves the provider is never called for a non-allowlisted
   address, even when the rows above the assertion are hand-built to slip past
   the SQL filters.
4. **Payload.** Built by a pure `buildPushPayload(flash, releaseTag)`:
   ```json
   { "title": "…", "body": "…", "url": "/predicts?view=open#<prediction_id>",
     "tag": "flash-<prediction_id>", "release": "<predicts_config.release_tag>" }
   ```
   - It carries **no `source_signal`, no evidence text, no answer to "why", no
     token and no email.** That is enforced by an allowlist of keys in the
     builder plus a test that plants those fields in the input and asserts
     they are absent from the output.
   - `release` comes from `predicts_config.release_tag`, read per run.
   - Dates in the body are built from `YYYY-MM-DD` string parts (reusing
     `formatDate` semantics), never through `new Date(s)`.
   - The body is capped at about 120 characters. iOS truncates past that.
5. **Transport (D3).** Plain Web Push with VAPID (RFC 8291 payload encryption
   + RFC 8292 VAPID) from the edge function. No third-party push vendor. The
   implementation choice for Deno is listed as D3a for Myke: (a) a small vendored
   implementation over WebCrypto, or (b) the `web-push` npm package through
   `npm:` specifiers. (b) is a dependency, not a vendor, but it is still a new
   dependency.
   - Secrets (names only, Myke creates them): `PREDICTS_VAPID_PUBLIC_KEY`,
     `PREDICTS_VAPID_PRIVATE_KEY`, `PREDICTS_VAPID_SUBJECT`
     (`mailto:signals@faraday-intelligence.ai`). The public key also reaches
     the site as `NEXT_PUBLIC_PREDICTS_VAPID_PUBLIC_KEY`. It is public by design.
   - `TTL` is 6 hours. A Flash older than that is not worth waking a phone for.
     `Urgency: high`. `Topic: flash-<id>` collapses repeats.
6. **Delivery log.** It reuses the delivery-log pattern FDY-118 sets for SMS
   and email (one row per recipient × Flash × channel, `channel='push'`) if
   FDY-118 builds a shared table. If FDY-118's table is channel-specific, a
   `predicts_push_deliveries` table is added to the §4 migration. Listed as
   **D7**, so this issue does not fork FDY-118's design.
7. **Failures.** Push service 404/410 → set `revoked_at`. Other errors → bump
   `failure_count`. After 5 consecutive failures, revoke. No retries inside one run.
8. **Push as an alternative to SMS.** A recipient's channel choice (FDY-119
   preferences) decides between SMS, push or both for Flashes. The send
   functions of FDY-118 and this issue each filter on their own channel. Neither
   decides for the other.

## 6. Consent (D4)

- Push opt-in is a **separate, explicit toggle** in Preferences, off by default
  for every recipient, never inferred from SMS or email consent.
- Stored with the recipient's other channel consents, in the shape FDY-118/119
  choose: `push_consent_at timestamptz` + `push_revoked_at timestamptz`, or the
  jsonb equivalent inside `preferences`. Today `preferences` is empty for all
  16 recipients, so there is nothing to migrate.
- Turning the toggle on runs, in order: an explicit tap → `Notification.requestPermission()`
  → `pushManager.subscribe({userVisibleOnly: true, applicationServerKey})`
  → POST subscribe → record `push_consent_at`. If any step fails, consent stays off.
- Turning it off: record `push_revoked_at`, DELETE every subscription for the
  recipient, and `unsubscribe()` locally.
- `predicts-unsubscribe` (FDY-112) already wins over everything. It must also
  revoke push subscriptions. That is a one-line addition to its write boundary,
  listed under Myke actions because it changes a deployed function.
- No permission prompt on page load, ever. The browser prompt only follows the toggle tap.

## 7. Security

- Every new table has RLS on with zero anon/authenticated policies and an
  explicit service_role policy. Every new function is `verify_jwt=false` with
  token-in-body auth, the same as `predicts-optin`, and runs on the service role.
- The token is never logged, never put in a URL the app generates, and never
  echoed in a response.
- The allowlist is enforced three times: the SQL filter in the send query,
  `isAllowlisted()` in subscribe (a non-allowlisted recipient cannot register a
  subscription at all), and the throwing assertion right before the provider call.
- The notification click URL is checked against the `/predicts` scope.
  Payloads carry no evidence or source text, so a lock-screen preview leaks
  nothing beyond the headline.
- The service worker is same-origin, scoped to `/predicts`, and has no
  `importScripts` from any CDN.

## 8. Copy for Myke's review

These are the only new subscriber-facing strings. All are proposals.

| Where | String |
|---|---|
| Manifest name / short name | "Faraday Predicts" / "Predicts" |
| Preferences toggle | "Flash alerts on this device" |
| Toggle help | "Get a notification when Faraday makes a new call you follow. You can turn this off at any time." |
| iOS not-installed hint | "To get alerts on iPhone, tap Share, then Add to Home Screen, and open Predicts from there." |
| Permission denied | "Notifications are blocked for this site. Turn them on in your browser settings to get Flash alerts." |
| Offline banner | "You're offline — showing the calls as of {date}." |
| Offline write refused | "You're offline. Preference changes need a connection." |
| Install prompt (Android/desktop) | "Install Faraday Predicts" |

## 9. iOS

- iOS/iPadOS 16.4+ allows Web Push **only for a site added to the Home
  Screen** and opened from there. In Safari tabs, `PushManager` is absent.
- So the toggle feature-detects `"PushManager" in window` and
  `matchMedia("(display-mode: standalone)")`. On iOS outside standalone mode,
  the toggle is replaced by the install hint (§8). It is never shown as a
  toggle that would silently fail.
- iOS has no `beforeinstallprompt`, so there is no install button there, only the hint.
- iOS requires a user gesture for `requestPermission`. The toggle tap is that gesture.
- iOS caps payload display and drops pushes from apps it considers idle, so
  **push is never the only Flash channel.** A recipient who picks push only is
  told the email digest still carries every Flash (FDY-118's channel).
- Test matrix: iPhone (iOS 17+) installed and in a tab, Android Chrome
  installed and in a tab, desktop Chrome, desktop Safari.

## 10. Test plan

**`npm test` (site, node --test, pure modules only):**
- `src/lib/predicts-pwa.test.ts`:
  - The manifest builder returns the `/predicts` scope and `id`, the
    `start_url` sits inside the scope, and the DC manifest is unchanged.
  - `pushSupportState(env)` → `unsupported | ios_needs_install | prompt | granted | denied`.
  - `isInScope(url)` for the notification click guard.
  - The offline cache-key function never keys on a token-bearing URL.
- `npm test` gains this file. `test:predicts` stays green, unchanged.

**`deno test` (Faraday repo, edge functions), using a recording push-provider mock:**
- `PushProvider` is an injected interface `{ send(sub, payload, opts) }`. The
  mock records every call.
- **Allowlist proof:** feed recipients `mykemiller@gmail.com`,
  `MykeMiller@Deloitte.com ` (case/space) and `someone@example.com`, all
  approved, confirmed and consented, with subscriptions. Assert the mock was
  called for exactly the first two. Assert the third raised the allowlist error
  **before** any provider call, and that `mock.calls` never contains its endpoint.
- The same proof with `ALLOWLIST_LIFTED` left `false` while hand-built rows
  bypass the SQL filter (the assertion is the last line of defence).
- Payload: plant `source_signal`, `evidence_url`, `resolution_note` and token
  in the input, and assert none appears in the serialized payload. `release`
  equals the config value passed in. A date of `2026-11-07` renders as Nov 7
  under `TZ=America/Chicago`.
- Failure handling: 410 → revoked, a 500 ×5 → revoked, 201 → `last_success_at`.
- Subscribe: unknown token → 404 with no write. A non-allowlisted recipient →
  refused with no write. A duplicate endpoint → upsert, not a second row.

**Phase 2 manual (Done-When 5):**
- Lighthouse PWA / installability checks on a **Vercel preview** for `/predicts`.
- A real push to Myke's two addresses only, from the preview, on one iPhone
  (installed) and one Android or desktop browser.

## 11. Rollout

Phase 2 is split by dependency. Each part is one PR per repo, draft, never merged by Claude.

| Step | Needs | What ships |
|---|---|---|
| **2a. Installable shell** | "go" + D1/D2/D6 | Predicts manifest + layout, the service worker (shell + read-only cache, **no push handlers yet**), the offline banner. Today's calls / Right / Receipts work installed and offline. Site repo only. |
| **2b. Push plumbing** | 2a, FDY-119 preference shape + auth decision, D3/D3a/D4/D7, the VAPID secrets (Myke) | The §4 migration (unapplied until approved), `predicts-push-subscribe`, the toggle in FDY-119's preferences screen, the push/notificationclick handlers. |
| **2c. Send** | 2b, FDY-117 `predicts_flash_decisions` live, FDY-118 delivery-log decision | `predicts-push-send`, invoked by FDY-117's pipeline. Tested only against the two allowlisted addresses. |
| **2d. Followed forecasts** | FDY-119 preferences read | `/predicts/following` filter over `view=open`. |

Every deploy, migration apply and secret creation is Myke's step.

## 12. Decisions for Myke

| # | Decision | Recommendation |
|---|---|---|
| D1 | Where the PWA lives | `/predicts` scope on the existing site with its own manifest |
| D2 | Offline behaviour | Cache the shell + last-good Today/Receipts, read-only offline |
| D3 | Push transport | Plain Web Push + VAPID from an edge function, no vendor |
| D3a | Web Push implementation in Deno | Vendored WebCrypto implementation (no new dependency). The fallback is `npm:web-push`. |
| D4 | Consent | Separate explicit toggle, timestamped, off by default |
| D5 | Followed forecasts | Filter `view=open` by the recipient's FDY-119 preferences, no follow table |
| D6 | Add `scope` to the **Daily Challenge** manifest so it stops covering `/predicts` | Yes, but it is a DC change, so it is your call |
| D7 | Push delivery log | Reuse FDY-118's table if channel-generic, else a `predicts_push_deliveries` table |
| D8 | Sequencing | Approve 2a now; hold 2b–2d until FDY-117/118/119 land |

---

## Appendix A — snapshot of current manifest / service-worker files (2026-11-06, `main` @ 77ad6d5)

`src/app/manifest.ts`, verbatim:

```ts
import type { MetadataRoute } from "next";

// PWA / Android install manifest. Icons are the Faraday "F" roundel (forest
// green #1C3424 + gold #C4922A). Next serves this at /manifest.webmanifest and
// injects the <link rel="manifest"> automatically.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Faraday Daily Challenge",
    short_name: "Faraday",
    description:
      "Faraday reads the AI data center market every day and tells you what it means.",
    start_url: "/daily-challenge",
    display: "standalone",
    background_color: "#1C3424",
    theme_color: "#1C3424",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
  };
}
```

`src/app/layout.tsx`, the PWA-relevant excerpt:

```ts
// Brand forest green — sets the browser UI / PWA theme color site-wide.
// (Next 16: themeColor lives on the viewport export, not metadata.)
export const viewport: Viewport = {
  themeColor: "#1C3424",
};
```

Service worker files: **none**. `grep -rn "serviceWorker" src` returns no
matches, `public/` contains no `sw.js`, and `package.json` has no PWA dependency.

## Appendix B — proposed Linear comment for FDY-127

> **FDY-127 Phase 1 spec ready:** `docs/specs/predicts-pwa.md` (draft PR on `fdy-127-predicts-pwa`).
>
> Findings: `predicts_flash_decisions` does not exist (FDY-117 Todo), no FDY-119
> preferences function is deployed, and `predicts_recipients.preferences` is empty
> for all 16 rows. So only the installable shell (Today's calls, Right, Receipts,
> read-only offline) can be built now. Push subscribe/send and Followed forecasts
> wait on FDY-117/118/119. The spec splits Phase 2 into 2a–2d accordingly.
>
> Nothing deployed, no DB rows written, no migration applied.
>
> **Myke:** answer D1–D8 (§12), say "go" (2a only, or all) or "hold", and create the
> `PREDICTS_VAPID_*` secrets when 2b starts.

## Appendix C — verification commands

```
select to_regclass('public.predicts_flash_decisions');   -- NULL (2026-11-06)
select to_regclass('public.predicts_recipients');        -- predicts_recipients
grep -rn "serviceWorker" src | head                      -- no output
npm test                                                 -- 52 pass / 0 fail
npm run test:predicts                                    -- 25 pass / 0 fail
```
