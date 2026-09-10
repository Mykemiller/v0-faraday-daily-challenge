// CC-LO-CONCURRENT-SEASONS-1.0 — the season-resolver guard.
//   npm run test:season-resolve
//
// Two things are asserted:
//   1. `resolveSeasonFor` calls ONE RPC (fn_season_for_subscriber_row), passes
//      the subscriber through untouched (null for anonymous), and fails soft
//      to null on every failure shape — callers treat null as "no season",
//      which was already their behaviour for an empty active set.
//   2. No runtime module under src/ picks a season by `status=eq.active` /
//      `status === "active"` any more. Seasons may overlap, so that predicate
//      silently returns the most recently started one. The resolver module and
//      the League Office status CHIP are the only permitted mentions; a
//      status-chip render, a subscriber `active` filter and the season-write
//      confirm gate are matched by name and excused below.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { resolveSeasonFor, resolveSeasonIdFor } from "./resolve.ts";

const H = { apikey: "k", Authorization: "Bearer k" };
const realFetch = globalThis.fetch;

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {})) as typeof fetch;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("calls fn_season_for_subscriber_row once with the subscriber (null for anonymous)", async () => {
  const calls: { url: string; body: unknown }[] = [];
  stubFetch((url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json([{ id: "s1", name: "Platform", starts_on: "2026-09-01", ends_on: "2026-09-30", status: "active" }]);
  });
  const s = await resolveSeasonFor(H, "sub-1");
  assert.equal(s?.id, "s1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/fn_season_for_subscriber_row$/);
  assert.deepEqual(calls[0].body, { p_subscriber_id: "sub-1" });

  await resolveSeasonFor(H, null);
  assert.deepEqual(calls[1].body, { p_subscriber_id: null });
  await resolveSeasonFor(H, undefined);
  assert.deepEqual(calls[2].body, { p_subscriber_id: null });
});

test("fails soft to null: no headers, non-2xx, empty set, malformed body, thrown fetch", async () => {
  assert.equal(await resolveSeasonFor(null, "x"), null);
  assert.equal(await resolveSeasonFor(undefined, "x"), null);

  stubFetch(() => new Response("nope", { status: 500 }));
  assert.equal(await resolveSeasonFor(H, "x"), null);

  stubFetch(() => Response.json([]));
  assert.equal(await resolveSeasonFor(H, "x"), null);

  stubFetch(() => Response.json({ not: "an array" }));
  assert.equal(await resolveSeasonFor(H, "x"), null);

  stubFetch(() => new Response("{{{", { status: 200 }));
  assert.equal(await resolveSeasonFor(H, "x"), null);

  stubFetch(() => { throw new Error("boom"); });
  assert.equal(await resolveSeasonFor(H, "x"), null);
  assert.equal(await resolveSeasonIdFor(H, "x"), null);
});

test("resolveSeasonIdFor is the id of the same row", async () => {
  stubFetch(() => Response.json([{ id: "s9" }]));
  assert.equal(await resolveSeasonIdFor(H, "sub"), "s9");
});

// ── the guard ────────────────────────────────────────────────────────────────

const SRC = join(process.cwd(), "src");
const FORBIDDEN: RegExp[] = [
  /seasons\?status=eq\.active/,           // PostgREST "the active season" reads
  /status\s*===?\s*["']active["']/,       // JS-side picks on a seasons list
  /status\s*=\s*'active'.*LIMIT\s+1/i,    // inline SQL in a TS/JS string
];
const EXCUSED = new Set([
  "lib/seasons/resolve.ts",                       // this module's own comment
  "lib/seasons/resolve.test.ts",                  // this file
  "app/league-office/seasons/[id]/page.tsx",      // a StatusChip render, not a pick
  "app/league-office/subscribers/page.tsx",       // dc_subscribers.active filter
  "lib/league-office/season-write.ts",            // scope-change confirm gate on ONE named season
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test("no runtime module picks 'the active season' by status any more", () => {
  const hits: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file);
    if (EXCUSED.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(text)) hits.push(`${rel}  (${re})`);
    }
  }
  assert.deepEqual(hits, [], "resolve the season through lib/seasons/resolve instead:\n" + hits.join("\n"));
});
