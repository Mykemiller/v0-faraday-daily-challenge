// CC-DC-CANONICAL-DOMAIN-1.0 Phase 3 — the host map, and the guard that keeps it
// the only thing naming the domain.
//
// Run: npm run test:hosts
//
// Two jobs here. The first is a table over resolveHostRoute: the host decision is
// the one piece of this app whose mistakes are invisible until a page answers on
// the wrong brand in production. The second is the D14 guard — a future
// host-routing change (notably the cc-academy-player rebase) must not be able to
// quietly move the Daily Challenge off its domain.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DC_CANONICAL_HOST,
  DC_CANONICAL_ORIGIN,
  canonicalDcPath,
  dcCanonicalUrl,
  isBrandHost,
  isDcHost,
  isDcPagePath,
  isNeverRedirected,
  isPlayerHost,
  resolveHostRoute,
  type HostRoute,
} from "./hosts.ts";

const DC = "www.faradaydailychallenge.com";
const DC_APEX = "faradaydailychallenge.com";
const BRAND = "www.faraday-intelligence.ai";
const BRAND_APEX = "faraday-intelligence.ai";
const PLAYER = "www.faraday-player.com";
const PLAYER_APEX = "faraday-player.com";
const PREVIEW = "v0-faraday-daily-challenge-n2u5-mfuoneozu-project-foundry.vercel.app";

/** Shorthand for the expected shapes, so the table below reads as a spec. */
const next = (): HostRoute => ({ kind: "next" });
const rewrite = (to: string): HostRoute => ({ kind: "rewrite", to });
const to308 = (to: string): HostRoute => ({ kind: "redirect", to, status: 308 });

// ─────────────────────────────────────────────────────────────────────────────
// The canonical constant
// ─────────────────────────────────────────────────────────────────────────────

test("the canonical origin is the www DC host over https", () => {
  // www, not the apex: the apex 308s at the Vercel edge, and a canonical must
  // name the URL that actually answers.
  assert.equal(DC_CANONICAL_ORIGIN, "https://www.faradaydailychallenge.com");
  assert.equal(DC_CANONICAL_HOST, "faradaydailychallenge.com");
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveHostRoute — the table
// ─────────────────────────────────────────────────────────────────────────────

const CASES: {
  name: string;
  host: string | null;
  path: string;
  search?: string;
  want: HostRoute;
}[] = [
  // ── The canonical DC host: behaviour must be identical to pre-1.0 (G5) ────
  { name: "DC root serves the lobby by rewrite, never a redirect",
    host: DC, path: "/", want: rewrite("/challenge") },
  { name: "DC host serves every other DC path as itself",
    host: DC, path: "/challenge/hints", want: next() },
  { name: "DC host serves the leaderboard as itself",
    host: DC, path: "/leaderboard", want: next() },
  { name: "DC host does not redirect its own API",
    host: DC, path: "/api/challenge/today", want: next() },
  { name: "DC host serves brand pages it links to under More Faraday",
    host: DC, path: "/about", want: next() },

  // ── The DC apex must never redirect to itself ────────────────────────────
  { name: "DC apex root rewrites rather than looping",
    host: DC_APEX, path: "/", want: rewrite("/challenge") },
  { name: "DC apex DC path does not loop",
    host: DC_APEX, path: "/challenge/answers", want: next() },

  // ── Brand host: the storefront keeps its own pages ───────────────────────
  { name: "brand root is the storefront homepage, untouched",
    host: BRAND, path: "/", want: next() },
  { name: "brand host keeps its own storefront pages",
    host: BRAND, path: "/intelligent-alert", want: next() },
  { name: "brand host keeps /about",
    host: BRAND, path: "/about", want: next() },
  { name: "brand host keeps the shared master Terms",
    host: BRAND, path: "/terms", want: next() },
  { name: "brand host keeps a storefront Terms schedule",
    host: BRAND, path: "/terms/daily-challenge", want: next() },
  { name: "brand host keeps the shared Privacy Policy",
    host: BRAND, path: "/privacy", want: next() },
  { name: "brand host keeps the Academy redirect page",
    host: BRAND, path: "/academy", want: next() },
  { name: "brand host keeps secret-gated internal tooling",
    host: BRAND, path: "/internal/clerk-program", want: next() },

  // ── Brand host: every DC page goes home, query intact ────────────────────
  { name: "brand /daily-challenge?game=Rackl → canonical lobby, query intact",
    host: BRAND, path: "/daily-challenge", search: "?game=Rackl",
    want: to308(`${DC_CANONICAL_ORIGIN}/?game=Rackl`) },
  { name: "brand /challenge collapses to the canonical lobby URL",
    host: BRAND, path: "/challenge", want: to308(`${DC_CANONICAL_ORIGIN}/`) },
  { name: "brand /daily-challenge (no query) collapses to the lobby",
    host: BRAND, path: "/daily-challenge", want: to308(`${DC_CANONICAL_ORIGIN}/`) },
  { name: "brand /daily-challenge/hints maps onto the /challenge tree",
    host: BRAND, path: "/daily-challenge/hints",
    want: to308(`${DC_CANONICAL_ORIGIN}/challenge/hints`) },
  { name: "brand /challenge/hints keeps its path",
    host: BRAND, path: "/challenge/hints",
    want: to308(`${DC_CANONICAL_ORIGIN}/challenge/hints`) },
  { name: "brand /challenge/signals (Faraday's Take) goes home",
    host: BRAND, path: "/challenge/signals",
    want: to308(`${DC_CANONICAL_ORIGIN}/challenge/signals`) },
  { name: "brand /leaderboard goes home with its view param",
    host: BRAND, path: "/leaderboard", search: "?view=teams",
    want: to308(`${DC_CANONICAL_ORIGIN}/leaderboard?view=teams`) },
  { name: "brand team page goes home",
    host: BRAND, path: "/leaderboard/team/6f9619ff-8b86-4d01-b42d-00c04fc964ff",
    want: to308(`${DC_CANONICAL_ORIGIN}/leaderboard/team/6f9619ff-8b86-4d01-b42d-00c04fc964ff`) },
  { name: "brand /auth goes home with its token",
    host: BRAND, path: "/auth", search: "?token=abc123",
    want: to308(`${DC_CANONICAL_ORIGIN}/auth?token=abc123`) },
  { name: "brand /free-agency goes home",
    host: BRAND, path: "/free-agency", want: to308(`${DC_CANONICAL_ORIGIN}/free-agency`) },
  { name: "brand /account goes home",
    host: BRAND, path: "/account", want: to308(`${DC_CANONICAL_ORIGIN}/account`) },
  { name: "brand /messages goes home",
    host: BRAND, path: "/messages", want: to308(`${DC_CANONICAL_ORIGIN}/messages`) },
  { name: "brand /share hub goes home",
    host: BRAND, path: "/share", want: to308(`${DC_CANONICAL_ORIGIN}/share`) },
  { name: "brand /help/hints goes home",
    host: BRAND, path: "/help/hints", want: to308(`${DC_CANONICAL_ORIGIN}/help/hints`) },
  { name: "brand /league-office goes home",
    host: BRAND, path: "/league-office", want: to308(`${DC_CANONICAL_ORIGIN}/league-office`) },
  { name: "brand apex DC path also goes home",
    host: BRAND_APEX, path: "/challenge", want: to308(`${DC_CANONICAL_ORIGIN}/`) },

  // ── D7: APIs, crons, assets are never redirected, from any host ──────────
  { name: "brand /api/challenge/today is never redirected",
    host: BRAND, path: "/api/challenge/today", want: next() },
  { name: "brand /api/cron/rotate is never redirected (a 308 would break the cron)",
    host: BRAND, path: "/api/cron/rotate", want: next() },
  { name: "brand /api/cron/sync-day-content is never redirected",
    host: BRAND, path: "/api/cron/sync-day-content", want: next() },
  { name: "brand /api/share/card is never redirected",
    host: BRAND, path: "/api/share/card", search: "?game=rackl", want: next() },
  { name: "brand /manifest.webmanifest is never redirected",
    host: BRAND, path: "/manifest.webmanifest", want: next() },
  { name: "brand /_next chunk is never redirected",
    host: BRAND, path: "/_next/static/chunks/main.js", want: next() },
  { name: "brand /favicon.ico is never redirected",
    host: BRAND, path: "/favicon.ico", want: next() },

  // ── The asset-under-a-DC-prefix trap: /public/share/icons/*.png ──────────
  { name: "a share-card icon under the /share prefix is an asset, not a page",
    host: BRAND, path: "/share/icons/daily-challenge.png", want: next() },
  { name: "a share font under the /share prefix is an asset, not a page",
    host: BRAND, path: "/share/fonts/IBMPlexMono-Medium.ttf", want: next() },
  { name: "an icon png at the root is an asset",
    host: BRAND, path: "/icon-192.png", want: next() },

  // ── Player host: DC paths go home; the Academy keeps everything else ─────
  { name: "player host DC path goes home rather than hitting an Academy 404",
    host: PLAYER, path: "/daily-challenge", search: "?game=Rackl",
    want: to308(`${DC_CANONICAL_ORIGIN}/?game=Rackl`) },
  { name: "player host /challenge/hints goes home",
    host: PLAYER, path: "/challenge/hints",
    want: to308(`${DC_CANONICAL_ORIGIN}/challenge/hints`) },
  { name: "player host /leaderboard goes home",
    host: PLAYER, path: "/leaderboard", want: to308(`${DC_CANONICAL_ORIGIN}/leaderboard`) },
  { name: "player apex DC path goes home",
    host: PLAYER_APEX, path: "/challenge", want: to308(`${DC_CANONICAL_ORIGIN}/`) },
  { name: "player host root is the Academy's — not ours to touch",
    host: PLAYER, path: "/", want: next() },
  { name: "player host course path is the Academy's",
    host: PLAYER, path: "/cooling/1/2", want: next() },
  { name: "player host /academy path is the Academy's",
    host: PLAYER, path: "/academy/cooling", want: next() },
  { name: "player host /api/academy is the Academy's",
    host: PLAYER, path: "/api/academy/progress", want: next() },
  { name: "player host /api/revalidate is the Academy's",
    host: PLAYER, path: "/api/revalidate", want: next() },

  // ── D8: previews and local dev render everything in place ────────────────
  { name: "preview URL renders the DC root directly",
    host: PREVIEW, path: "/", want: next() },
  { name: "preview URL renders a DC page directly",
    host: PREVIEW, path: "/challenge/hints", want: next() },
  { name: "preview URL renders /daily-challenge directly",
    host: PREVIEW, path: "/daily-challenge", search: "?game=Rackl", want: next() },
  { name: "localhost renders everything in place",
    host: "localhost:3000", path: "/daily-challenge", want: next() },
  { name: "127.0.0.1 renders everything in place",
    host: "127.0.0.1:3000", path: "/challenge", want: next() },

  // ── Host normalisation ───────────────────────────────────────────────────
  { name: "an uppercase DC host still rewrites the root",
    host: "WWW.FaradayDailyChallenge.COM", path: "/", want: rewrite("/challenge") },
  { name: "a DC host with :443 still rewrites the root",
    host: "www.faradaydailychallenge.com:443", path: "/", want: rewrite("/challenge") },
  { name: "a mixed-case brand host still redirects a DC page",
    host: "WWW.Faraday-Intelligence.AI", path: "/challenge",
    want: to308(`${DC_CANONICAL_ORIGIN}/`) },
  { name: "a brand host with a port still redirects a DC page",
    host: "www.faraday-intelligence.ai:443", path: "/leaderboard",
    want: to308(`${DC_CANONICAL_ORIGIN}/leaderboard`) },
  { name: "a padded host header is tolerated",
    host: "  www.faradaydailychallenge.com  ", path: "/", want: rewrite("/challenge") },

  // ── Degenerate input must never throw or redirect ────────────────────────
  { name: "a missing Host header falls through",
    host: null, path: "/challenge", want: next() },
  { name: "an empty Host header falls through",
    host: "", path: "/challenge", want: next() },
  { name: "an unrelated host falls through",
    host: "example.com", path: "/challenge", want: next() },

  // ── Near-miss hosts must NOT be treated as ours ──────────────────────────
  { name: "a lookalike subdomain is not the DC host",
    host: "evil.faradaydailychallenge.com.attacker.test", path: "/", want: next() },
  { name: "a DC-named subdomain we do not serve is not the DC host",
    host: "staging.faradaydailychallenge.com", path: "/", want: next() },
];

for (const c of CASES) {
  test(c.name, () => {
    assert.deepEqual(
      resolveHostRoute(c.host, c.path, c.search ?? ""),
      c.want,
      `${c.host ?? "(no host)"}${c.path}${c.search ?? ""}`,
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Invariants over the whole table
// ─────────────────────────────────────────────────────────────────────────────

test("no redirect ever targets a non-canonical origin", () => {
  for (const c of CASES) {
    const r = resolveHostRoute(c.host, c.path, c.search ?? "");
    if (r.kind === "redirect") {
      assert.ok(
        r.to.startsWith(`${DC_CANONICAL_ORIGIN}/`),
        `${c.name}: redirects to ${r.to}`,
      );
    }
  }
});

test("every redirect is a 308 — permanent and method-preserving", () => {
  for (const c of CASES) {
    const r = resolveHostRoute(c.host, c.path, c.search ?? "");
    if (r.kind === "redirect") assert.equal(r.status, 308);
  }
});

test("a DC host is never handed a redirect, so it can never loop", () => {
  const paths = ["/", "/challenge", "/daily-challenge", "/leaderboard", "/auth",
    "/api/challenge/today", "/about", "/terms", "/share/icons/x.png"];
  for (const host of [DC, DC_APEX]) {
    for (const path of paths) {
      assert.notEqual(
        resolveHostRoute(host, path).kind,
        "redirect",
        `${host}${path} must not redirect`,
      );
    }
  }
});

test("a never-redirect path is inert on every host", () => {
  const inert = ["/api/cron/rotate", "/api/cron/sync-day-content", "/api/challenge/today",
    "/_next/static/chunks/x.js", "/manifest.webmanifest", "/favicon.ico",
    "/share/icons/daily-challenge.png", "/icon.svg", "/apple-icon.png"];
  for (const host of [DC, DC_APEX, BRAND, BRAND_APEX, PLAYER, PLAYER_APEX, PREVIEW, "localhost:3000"]) {
    for (const path of inert) {
      assert.notEqual(
        resolveHostRoute(host, path).kind,
        "redirect",
        `${host}${path} must never redirect`,
      );
    }
  }
});

test("the lobby renders at the DC root with no redirect hop", () => {
  // Acceptance #1: the bare domain must answer 200, not bounce.
  assert.deepEqual(resolveHostRoute(DC, "/"), { kind: "rewrite", to: "/challenge" });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

test("host predicates agree with the host lists", () => {
  assert.ok(isDcHost(DC) && isDcHost(DC_APEX) && isDcHost("WWW.FARADAYDAILYCHALLENGE.COM:443"));
  assert.ok(!isDcHost(BRAND) && !isDcHost(PLAYER) && !isDcHost(null));
  assert.ok(isBrandHost(BRAND) && isBrandHost(BRAND_APEX) && !isBrandHost(DC));
  assert.ok(isPlayerHost(PLAYER) && isPlayerHost(PLAYER_APEX) && !isPlayerHost(DC));
});

test("isDcPagePath claims DC pages and disclaims everything else", () => {
  for (const p of ["/challenge", "/challenge/hints", "/daily-challenge", "/leaderboard",
    "/leaderboard/team/abc", "/free-agency", "/auth", "/account", "/account/notifications",
    "/notifications", "/messages", "/share", "/help/tips", "/league-office/seasons"]) {
    assert.ok(isDcPagePath(p), `${p} should be a DC page`);
  }
  for (const p of ["/", "/about", "/who-is-faraday", "/merch", "/terms", "/terms/daily-challenge",
    "/privacy", "/academy", "/library", "/signal-room", "/internal/clerk-program",
    "/api/challenge/today", "/share/icons/x.png", "/_next/static/x.js"]) {
    assert.ok(!isDcPagePath(p), `${p} should not be a DC page`);
  }
});

test("a prefix match requires a path boundary, not a substring", () => {
  // "/sharex" must not be captured by the "/share" prefix.
  assert.ok(!isDcPagePath("/sharex"));
  assert.ok(!isDcPagePath("/authorize"));
  assert.ok(!isDcPagePath("/accountant"));
  assert.ok(!isDcPagePath("/challenger"));
  assert.ok(isDcPagePath("/share"));
  assert.ok(isDcPagePath("/share/preview"));
});

test("isNeverRedirected covers APIs, build output and any file extension", () => {
  for (const p of ["/api/x", "/api/cron/rotate", "/_next/static/x.js", "/manifest.webmanifest",
    "/favicon.ico", "/robots.txt", "/sitemap.xml", "/a/b/c.png", "/x.woff2", "/faraday-home.html"]) {
    assert.ok(isNeverRedirected(p), `${p} should never redirect`);
  }
  for (const p of ["/", "/challenge", "/help/tips", "/leaderboard/team/abc"]) {
    assert.ok(!isNeverRedirected(p), `${p} is a page`);
  }
});

test("canonicalDcPath collapses the lobby aliases and preserves the rest", () => {
  assert.equal(canonicalDcPath("/challenge"), "/");
  assert.equal(canonicalDcPath("/daily-challenge"), "/");
  assert.equal(canonicalDcPath("/daily-challenge/hints"), "/challenge/hints");
  assert.equal(canonicalDcPath("/challenge/hints"), "/challenge/hints");
  assert.equal(canonicalDcPath("/leaderboard"), "/leaderboard");
});

test("dcCanonicalUrl builds absolute canonical URLs with the query intact", () => {
  assert.equal(dcCanonicalUrl("/daily-challenge", "?game=Rackl"),
    "https://www.faradaydailychallenge.com/?game=Rackl");
  assert.equal(dcCanonicalUrl("/leaderboard"),
    "https://www.faradaydailychallenge.com/leaderboard");
});

// ─────────────────────────────────────────────────────────────────────────────
// D14 — the guard
// ─────────────────────────────────────────────────────────────────────────────

/** Every file under src/, minus tests and this module's own home. */
function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) continue;
      if (/\.test\.(ts|tsx|js|jsx|mjs)$/.test(entry)) continue;
      out.push(p);
    }
  };
  walk("src");
  return out;
}

const HOSTS_MODULE = join("src", "lib", "hosts.ts");

test("D14: only src/lib/hosts.ts builds a URL on the DC domain", () => {
  // Scoped to URL CONSTRUCTION, not any mention of the name. The leak this
  // guards against is a second hardcoded origin drifting out of sync — not the
  // Privacy Policy naming the domain in prose, or the share card rendering it as
  // display text (that one reads DC_CANONICAL_HOST from here).
  const urlLiteral = /(https?:)?\/\/(www\.)?faradaydailychallenge\.com/;
  const offenders = srcFiles()
    .filter((f) => f !== HOSTS_MODULE)
    .filter((f) => {
      const src = readFileSync(f, "utf8");
      return src
        .split("\n")
        .some((line) => !line.trimStart().startsWith("//") && urlLiteral.test(line));
    });
  assert.deepEqual(
    offenders,
    [],
    `These files build a DC URL by hand. Import DC_CANONICAL_ORIGIN from @/lib/hosts instead:\n  ${offenders.join("\n  ")}`,
  );
});

test("D14: no DC code path derives its origin from a Vercel or Academy env var", () => {
  // VERCEL_PROJECT_PRODUCTION_URL follows Vercel's "primary domain" setting, and
  // Vercel reports the DC domain as this project's production URL — so it looks
  // right until someone changes the primary domain. NEXT_PUBLIC_SITE_ORIGIN
  // belongs to the Academy's player domain.
  const banned = /process\.env\.(VERCEL_PROJECT_PRODUCTION_URL|VERCEL_URL|NEXT_PUBLIC_SITE_ORIGIN|NEXT_PUBLIC_SITE_URL)\b/;
  const offenders = srcFiles()
    .filter((f) => !f.startsWith(join("src", "lib", "academy"))) // the Academy owns its own origin
    .filter((f) => banned.test(readFileSync(f, "utf8")));
  assert.deepEqual(
    offenders,
    [],
    `DC URLs must come from DC_CANONICAL_ORIGIN, not the environment:\n  ${offenders.join("\n  ")}`,
  );
});

test("D14: the host decision is not duplicated outside the host map", () => {
  // A second host router is how this layer drifted before. next.config.ts keeps
  // its host-conditioned root rewrite as deliberate defence in depth (it agrees
  // with resolveHostRoute by construction), but nothing under src/ may make its
  // own host decision.
  const hostHeaderRead = /headers\(\)\.get\(\s*["'](host|x-forwarded-host)["']\s*\)/;
  const offenders = srcFiles()
    .filter((f) => f !== HOSTS_MODULE && f !== join("src", "proxy.ts"))
    .filter((f) => hostHeaderRead.test(readFileSync(f, "utf8")));
  assert.deepEqual(
    offenders,
    [],
    `Reading the Host header to decide a URL defeats the host map (and opts the route out of static rendering):\n  ${offenders.join("\n  ")}`,
  );
});

test("D14: the share module's canonical origin comes from the host map", () => {
  const src = readFileSync(join("src", "lib", "share", "manifest.js"), "utf8");
  assert.match(src, /from\s+["']\.\.\/hosts\.ts["']/);
  assert.match(src, /export const CANONICAL_ORIGIN = DC_CANONICAL_ORIGIN;/);
});
