// CC-DC-LOBBY-EMPTY-STATE-1.0 (D8) — the "what comes next" read.
//   npm run test:lobby-model
//
// Three things are asserted:
//   1. the PostgREST predicate is exactly "has not started yet, soonest first"
//      and filters on `upcoming` — never on the status that overlapping seasons
//      made meaningless (`npm run test:season-resolve` enforces that globally);
//   2. the pick is the earliest PLATFORM-scoped candidate, per
//      CC-LO-SEASON-SCOPE-1.0 D4 (no include rows ⇒ the whole platform);
//   3. every failure shape fails soft to null — the empty-state card drops its
//      "starts …" line rather than the lobby dropping dead.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATE_LIMIT,
  fetchNextSeason,
  isPlatformScoped,
  pickNextSeason,
  seasonScopesFilter,
  upcomingSeasonsFilter,
} from "./next-season.ts";

const H = { apikey: "k", Authorization: "Bearer k" };
const realFetch = globalThis.fetch;

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: string | URL | Request) => handler(String(url))) as typeof fetch;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── the predicate ───────────────────────────────────────────────────────────

test("asks only for seasons that have not started yet, soonest first", () => {
  const f = upcomingSeasonsFilter("2026-10-05");
  assert.match(f, /^seasons\?/);
  assert.match(f, /status=eq\.upcoming/);
  assert.match(f, /starts_on=gt\.2026-10-05/);
  assert.match(f, /order=starts_on\.asc/);
  assert.match(f, new RegExp(`limit=${CANDIDATE_LIMIT}`));
  // The predicate overlapping seasons made meaningless must not appear.
  assert.ok(!/status=eq\.active/.test(f));
  // Strictly future: a season starting TODAY is not "next", it is late.
  assert.ok(!/starts_on=gte/.test(f));
});

test("scopes are read for the candidate ids in one request", () => {
  const f = seasonScopesFilter(["a-1", "b-2"]);
  assert.match(f, /^season_scopes\?season_id=in\.\("a-1","b-2"\)/);
  assert.match(f, /select=season_id,scope_type,is_excluded/);
});

// ── platform scope (CC-LO-SEASON-SCOPE-1.0 D4) ──────────────────────────────

test("no include rows is the whole platform; so is an explicit platform include", () => {
  assert.equal(isPlatformScoped([]), true);
  assert.equal(isPlatformScoped(null), true);
  assert.equal(isPlatformScoped(undefined), true);
  assert.equal(isPlatformScoped([{ scope_type: "platform", is_excluded: false }]), true);
  // Exclusions alone do not narrow the ANNOUNCEMENT — "everyone except Acme"
  // is still a platform season.
  assert.equal(isPlatformScoped([{ scope_type: "team", is_excluded: true }]), true);
  assert.equal(
    isPlatformScoped([
      { scope_type: "platform", is_excluded: false },
      { scope_type: "team", is_excluded: true },
    ]),
    true
  );
});

test("a league- or conference-scoped season is not platform-scoped", () => {
  assert.equal(isPlatformScoped([{ scope_type: "league", is_excluded: false }]), false);
  assert.equal(isPlatformScoped([{ scope_type: "conference", is_excluded: false }]), false);
  assert.equal(
    isPlatformScoped([
      { scope_type: "league", is_excluded: false },
      { scope_type: "team", is_excluded: true },
    ]),
    false
  );
});

// ── the pick ────────────────────────────────────────────────────────────────

test("the earliest platform-scoped candidate wins, whatever order the rows arrive in", () => {
  const candidates = [
    { id: "late", name: "Late Season", starts_on: "2027-03-01" },
    { id: "soon", name: "  Football Season  ", starts_on: "2026-11-02" },
  ];
  assert.deepEqual(pickNextSeason(candidates, []), { name: "Football Season", starts_on: "2026-11-02" });
});

test("a league-scoped season is skipped in favour of the next platform one", () => {
  const candidates = [
    { id: "carve", name: "Deloitte 2027", starts_on: "2026-11-02" },
    { id: "all", name: "Football Season", starts_on: "2026-12-01" },
  ];
  const scopes = [{ season_id: "carve", scope_type: "league", is_excluded: false }];
  assert.deepEqual(pickNextSeason(candidates, scopes), { name: "Football Season", starts_on: "2026-12-01" });
});

test("no platform-scoped candidate → null, not the carve-out", () => {
  const candidates = [{ id: "carve", name: "Deloitte 2027", starts_on: "2026-11-02" }];
  const scopes = [{ season_id: "carve", scope_type: "conference", is_excluded: false }];
  assert.equal(pickNextSeason(candidates, scopes), null);
});

test("an unnamed season still returns its date; junk rows are ignored", () => {
  assert.deepEqual(pickNextSeason([{ id: "x", name: "   ", starts_on: "2026-11-02" }], []), {
    name: null,
    starts_on: "2026-11-02",
  });
  assert.equal(pickNextSeason([{ id: "x", starts_on: null }], []), null);
  assert.equal(pickNextSeason([], []), null);
  assert.equal(pickNextSeason(null, null), null);
});

// ── the read ────────────────────────────────────────────────────────────────

test("two reads: the candidates, then their scopes", async () => {
  const urls: string[] = [];
  stubFetch((url) => {
    urls.push(url);
    if (url.includes("/seasons?")) {
      return Response.json([{ id: "s-next", name: "Football Season", starts_on: "2026-11-02" }]);
    }
    return Response.json([]);
  });
  const next = await fetchNextSeason(H, "2026-10-05");
  assert.deepEqual(next, { name: "Football Season", starts_on: "2026-11-02" });
  assert.equal(urls.length, 2);
  assert.match(urls[0], /\/rest\/v1\/seasons\?.*status=eq\.upcoming/);
  assert.match(urls[1], /\/rest\/v1\/season_scopes\?season_id=in\.\("s-next"\)/);
});

test("no future season → null, and no scope read at all", async () => {
  let calls = 0;
  stubFetch(() => { calls++; return Response.json([]); });
  assert.equal(await fetchNextSeason(H, "2026-10-05"), null);
  assert.equal(calls, 1);
});

test("fails soft to null: no headers, no day, non-2xx, malformed body, thrown fetch", async () => {
  assert.equal(await fetchNextSeason(null, "2026-10-05"), null);
  assert.equal(await fetchNextSeason(undefined, "2026-10-05"), null);
  assert.equal(await fetchNextSeason(H, null), null);
  assert.equal(await fetchNextSeason(H, ""), null);

  stubFetch(() => new Response("nope", { status: 500 }));
  assert.equal(await fetchNextSeason(H, "2026-10-05"), null);

  stubFetch(() => Response.json({ not: "an array" }));
  assert.equal(await fetchNextSeason(H, "2026-10-05"), null);

  stubFetch(() => new Response("{{{", { status: 200 }));
  assert.equal(await fetchNextSeason(H, "2026-10-05"), null);

  stubFetch(() => { throw new Error("boom"); });
  assert.equal(await fetchNextSeason(H, "2026-10-05"), null);
});

test("a failed SCOPE read announces nothing rather than announcing blind", async () => {
  stubFetch((url) =>
    url.includes("/seasons?")
      ? Response.json([{ id: "s-next", name: "Football Season", starts_on: "2026-11-02" }])
      : new Response("nope", { status: 403 })
  );
  assert.equal(await fetchNextSeason(H, "2026-10-05"), null);
});
