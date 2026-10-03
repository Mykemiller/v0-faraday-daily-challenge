# CC-DC-CANONICAL-DOMAIN-1.0 — the Daily Challenge gets one home

**Branch:** `claude/dc-canonical-domain-v2` · **Base:** `origin/main` @ `4c375ea`
**Investigated:** 2026-10-02 20:45–21:15 CT · **Built:** 2026-10-03 04:53–05:30 CT

## Why

The Daily Challenge was *linked* canonically (PR #112) but not *served*
canonically. Every DC page also answered **200 on `www.faraday-intelligence.ai`**.
With `faraday-player.com` arriving as a third host on the same Vercel project, the
blast radius was about to grow.

## What Phase 0 found that the brief had wrong

| Brief said | Actually |
|---|---|
| `NEXT_PUBLIC_SITE_ORIGIN` may be Production-scoped and leak into DC canonicals | **The var does not exist.** `vercel env ls` returns 14 vars; none is `NEXT_PUBLIC_SITE_ORIGIN`, `NEXT_PUBLIC_SITE_URL`, or any `*_ORIGIN`/`*_BASE_URL`. Commit `e2a0acf` describes one that was never created. Independently, only `src/lib/academy/origin.ts` reads it, only on the academy branch, only for `/academy` metadata. `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL` and `metadataBase` appear nowhere in `src/` on main. **Leak #2 did not exist.** |
| Host layer is `src/middleware.ts` (or `src/proxy.ts`) | **Neither existed.** The `/` → `/challenge` host rewrite lived in `next.config.ts` (`rewrites.beforeFiles`), with a *contradictory duplicate* in `vercel.json` targeting `/daily-challenge`. The live `x-nextjs-rewritten-query: host=…` header is the Next.js signature, so `next.config.ts` is what fires; the `vercel.json` rewrite appears dead. `src/proxy.ts` was **created** by this work. |
| `register-with-magic-link` at v25, redeployed 2026-07-28 | **v42, updated 2026-08-19.** `MAGIC_LINK_BASE` and `verify_jwt:false` both verified correct. |
| Leak #1 is `/daily-challenge` on the brand host | **Far wider.** 13 DC paths verified answering 200 off-domain. Cause: the `afterFiles` `/daily-challenge → /challenge` rewrite is **not** host-conditioned, and `/challenge*` is simply a route that answers anywhere. |
| D12: check Supabase Auth Site URL + redirect allow-list | **Moot.** DC auth is entirely custom edge functions + a `dc_session` localStorage token. **No Supabase Auth/GoTrue usage anywhere in `src/`.** |

Also: `origin/claude/dc-canonical-domain` already existed (PR #112, `eecc018`), hence
the `-v2` branch name. CLAUDE.md's FAR-119 section still asserted the *opposite*
invariant (`faradaydailychallenge.com` 301 → brand), echoed by stale comments in
`next.config.ts` and `src/app/challenge/layout.tsx`. All three corrected.

## What shipped

- **`src/lib/hosts.ts`** — `DC_CANONICAL_ORIGIN`, host lists, and the pure
  `resolveHostRoute(host, pathname, search)`. The only place in `src/` that builds a
  DC URL. `src/lib/share/manifest.js`'s `CANONICAL_ORIGIN` is now a re-export.
- **`src/proxy.ts`** — edge wiring only, with the composition point for
  `cc-academy-player` marked in a comment.
- **`src/lib/dc-metadata.ts`** + 13 segment layouts — `alternates.canonical` on every
  DC page, `metadataBase` pinned (never Host-derived), `noindex` on the two
  token-bearing URLs.
- **D4** — the brand homepage's three DC links are now absolute canonical URLs.
- **`src/lib/legal/documents.ts`** — the DC Terms schedule declared the **apex**
  (which 308s); now `www`.
- **Share card + League Office composer** — route their displayed host/URL through
  the constant.
- **`package.json`** — dropped `--experimental-default-type=module` from three test
  scripts. The flag was **removed in Node ≥23** and the project runs Node 24, so
  `test:share`, `test:signal-drop` and `test:puzzle-bank` had been silently
  unrunnable. `test:share` is the *existing* guard on `CANONICAL_ORIGIN` and on
  "no payload field ever carries faraday-intelligence.ai" — building a new D14
  guard on top of a dead one would have been theatre. Registered `test:hosts`.

## Decisions taken (flagged in the Phase 0 report, approved)

- **D9 adapted:** the decision lives in `resolveHostRoute`, but `next.config.ts`
  keeps its host-conditioned root rewrite as defence in depth on the one path whose
  breakage takes the game offline. The dead `vercel.json` rewrite was left alone —
  "it's dead" was inferred from a response header, not proven.
- **D14 scoped to URL construction**, not any mention of the string. The literal
  appears legitimately in Privacy Policy prose and (via `DC_CANONICAL_HOST`) as
  share-card display text. The guard was verified to actually fail by injecting a
  violation.
- **`/terms*` + `/privacy` classified shared, not DC** — see CLAUDE.md.
- **`/league-office/*` classified DC** and redirected; its existing
  `robots: noindex` and staff gate were not touched (G6).

## Verification

Full matrix run against a real `next build` + `next start` with spoofed `Host`
headers — every row as specified: DC host 200 with the lobby at `/` (title
`Faraday Daily Challenge`), DC apex no loop, 12 DC paths 308 off the brand host
with query intact, brand `/` still the storefront (`Faraday — Your unfair
advantage`), `/api/cron/rotate` + `/share/icons/*.png` + `/manifest.webmanifest`
never redirected, player-host DC paths 308 while `/` stays the Academy's, preview
and localhost untouched. Canonical tags confirmed in prerendered HTML.

**Gates vs main's baseline:** `next build` exit 0 (was 0). `tsc` 20 errors —
byte-identical set to main (pre-existing `Deno` globals + a `MembershipRow` cast).
`eslint` 73 problems (33 errors, 40 warnings) — identical to main. Tests: **28/29
pass vs main's 24/29**; the only failure is `test:no-codes`, pre-existing and
unrelated (its regex reads ISO timestamps like `T12:00:00Z` as IDF theme codes).
`test:hosts` 81/81.

## Myke's manual checks

1. **Merge, then confirm auto-promotion to Current** without a "Running Checks"
   hang. No required check was found: neither the current production deployment nor
   a fresh preview carries a `checksState` field. *Caveat:* listing installed
   integrations returns **403** to the CLI/MCP token, so this is evidenced, not
   proven — worth an eyeball at Settings → Git → Deployment Protection.
2. **Sign-in round trip** on phone + desktop. Expect to be **signed out once** if you
   were authed on `faraday-intelligence.ai` (per-origin localStorage) — re-auth by
   magic link.
3. **Watch the 05:00 UTC rotation** — `/api/cron/rotate` and
   `/api/cron/sync-day-content` should log a run, not a routing-induced skip.
4. **Tell the `cc-academy-player` session** to rebase and plug into
   `resolveHostRoute` before it merges.
5. Rollback if needed: Vercel Instant Rollback to `dpl_BTSSwYx2EzBwVawwPzWNQoXF962b`.

## Noted, not fixed (out of scope)

- **`/api/cron/rotate` answers 200 to an unauthenticated HEAD**, and no `CRON_SECRET`
  exists in the env list. Separate workstream; D7 keeps it unredirected either way.
- **The inverse leak:** brand pages render on the DC host, because the DC masthead
  links to them under "More Faraday" by design.
- `src/app/page.tsx` still links the Academy at `https://faraday-academy.vercel.app/academy`.
- Pre-existing `tsc`/`eslint`/`test:no-codes` debt, untouched.
