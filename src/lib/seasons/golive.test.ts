// CC-DC-SEASON-GOLIVE-1.0 (D10) — the go-live module's contract.
//   npm run test:season-golive
//
// Four things are asserted:
//   1. statusForWindow is a pure table: before / first day / inside / last day
//      / after, and a closed season NEVER reopens (promote-only, D2).
//   2. activateDueSeasons PATCHes the exact PostgREST filter — status=eq.upcoming
//      plus the window containment — and writes status=active, nothing else.
//   3. goLiveToday does each of its three steps only when that step is due,
//      is a strict no-op on a second consecutive run (D7), and NEVER throws:
//      every dependency failure lands in `skipped` instead.
//   4. approveSeasonPuzzles' D5 gate: the pure plan says "go live" only when
//      the approved dates include today, and generation-write.ts is wired to it.
//
// No network, no database, no Anthropic: `fetch` is stubbed with a tiny
// in-memory PostgREST and the two heavy dependencies (the puzzle-bank facade's
// rotateLiveSet and the day-content sync) are injected.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  activateDueSeasons,
  approvalGoLivePlan,
  chicagoNow,
  dueSeasonsFilter,
  goLiveToday,
  statusForWindow,
  todayCT,
  type GoLiveResult,
} from "./golive.ts";

const T = "2026-10-05";
const H = { apikey: "k", Authorization: "Bearer k", "Content-Type": "application/json" };
const SVC = { base: "https://db.example/rest/v1", headers: H };

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── 1. the rule ──────────────────────────────────────────────────────────────

test("statusForWindow: window containment decides, and closed stays closed", () => {
  const cases: Array<[string, string, string, string | null | undefined, string]> = [
    // starts_on,   ends_on,      today,        currentStatus, expected
    ["2026-10-05", "2027-01-31", "2026-10-04", "upcoming", "upcoming"], // the day before
    ["2026-10-05", "2027-01-31", "2026-10-05", "upcoming", "active"],   // first day — the FDY-43 case
    ["2026-10-05", "2027-01-31", "2026-12-01", "upcoming", "active"],   // mid-window
    ["2026-10-05", "2027-01-31", "2027-01-31", "active", "active"],     // last day is inclusive
    ["2026-10-05", "2027-01-31", "2027-02-01", "active", "closed"],     // the day after
    ["2026-10-05", "2026-10-05", "2026-10-05", "upcoming", "active"],   // one-day season
    // A closed season is terminal: fn_leaderboard_rollover archived its
    // leaderboard when it closed it, so nothing here reopens one even when the
    // window says otherwise.
    ["2026-10-05", "2027-01-31", "2026-12-01", "closed", "closed"],
    ["2026-10-05", "2027-01-31", "2026-10-04", "closed", "closed"],
  ];
  for (const [starts, ends, today, current, expected] of cases) {
    assert.equal(
      statusForWindow(starts, ends, today, current),
      expected,
      `${starts}..${ends} on ${today} (was ${current})`
    );
  }
});

test("statusForWindow: a missing window or day is never 'serving'", () => {
  assert.equal(statusForWindow(null, "2027-01-31", T), "upcoming");
  assert.equal(statusForWindow("2026-10-05", null, T), "upcoming");
  assert.equal(statusForWindow("2026-10-05", "2027-01-31", ""), "upcoming");
  assert.equal(statusForWindow(undefined, undefined, undefined), "upcoming");
});

test("todayCT / chicagoNow read the America/Chicago day, not UTC", () => {
  // 04:30 UTC on Oct 6 is still 23:30 on Oct 5 in Chicago (CDT, UTC−5) — the
  // boundary that made the nightly 05:00 UTC crons "midnight CT" in the first
  // place.
  assert.equal(todayCT(new Date("2026-10-06T04:30:00Z")), "2026-10-05");
  assert.deepEqual(chicagoNow(new Date("2026-10-06T04:30:00Z")), { date: "2026-10-05", hour: 23 });
  assert.deepEqual(chicagoNow(new Date("2026-10-06T05:30:00Z")), { date: "2026-10-06", hour: 0 });
  assert.match(todayCT(), /^\d{4}-\d{2}-\d{2}$/);
});

// ── 2. the PostgREST filter ──────────────────────────────────────────────────

test("dueSeasonsFilter is exactly upcoming + window containment", () => {
  assert.equal(
    dueSeasonsFilter(T),
    "seasons?status=eq.upcoming&starts_on=lte.2026-10-05&ends_on=gte.2026-10-05"
  );
});

test("activateDueSeasons PATCHes that filter, sets only status, returns the flipped rows", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method), body: JSON.parse(String(init?.body)) });
    return Response.json([
      { id: "02701ead", name: "Football Season", starts_on: T, ends_on: "2027-01-31" },
    ]);
  }) as typeof fetch;

  const flipped = await activateDueSeasons(SVC, T);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.ok(
    calls[0].url.includes("seasons?status=eq.upcoming&starts_on=lte.2026-10-05&ends_on=gte.2026-10-05"),
    calls[0].url
  );
  // Promote-only: the PATCH body carries the new status and NOTHING else, so
  // this path can never close, demote or otherwise edit a season.
  assert.deepEqual(calls[0].body, { status: "active" });
  assert.deepEqual(flipped.map((f) => f.id), ["02701ead"]);
});

test("activateDueSeasons throws on a refused PATCH (goLiveToday captures it)", async () => {
  globalThis.fetch = (async () => new Response("denied", { status: 403 })) as typeof fetch;
  await assert.rejects(() => activateDueSeasons(SVC, T), /seasons activate failed \(403\)/);
});

// ── a tiny in-memory PostgREST ───────────────────────────────────────────────

type FakeSeason = { id: string; name: string; starts_on: string; ends_on: string; status: string };
type FakeBankRow = { puzzle_type: string; published: string; go_live_date: string };

type FakeDb = {
  seasons: FakeSeason[];
  bank: FakeBankRow[];
  dayContent: Record<string, { games: unknown[] }>;
  audits: Array<Record<string, unknown>>;
  urls: string[];
  fail?: Set<string>;
};

function newDb(partial: Partial<FakeDb> = {}): FakeDb {
  return { seasons: [], bank: [], dayContent: {}, audits: [], urls: [], ...partial };
}

/** Installs a fetch stub that answers the five requests goLiveToday can make. */
function install(db: FakeDb) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop() ?? "";
    const method = String(init?.method ?? "GET").toUpperCase();
    db.urls.push(`${method} ${url.pathname}${url.search}`);
    if (db.fail?.has(table)) return new Response("boom", { status: 500 });
    const p = url.searchParams;

    if (table === "seasons" && method === "PATCH") {
      const body = JSON.parse(String(init?.body)) as { status: string };
      const today = String(p.get("starts_on")).replace("lte.", "");
      const hit = db.seasons.filter(
        (s) => s.status === "upcoming" && s.starts_on <= today && s.ends_on >= today
      );
      for (const s of hit) s.status = body.status;
      return Response.json(hit.map(({ id, name, starts_on, ends_on }) => ({ id, name, starts_on, ends_on })));
    }

    if (table === "lo_audit_log" && method === "POST") {
      db.audits.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 201 });
    }

    if (table === "dc_puzzle_bank_staging") {
      const state = String(p.get("published")).replace("eq.", "");
      const date = String(p.get("go_live_date")).replace("eq.", "");
      const hit = db.bank.filter((b) => b.published === state && b.go_live_date === date);
      return Response.json(hit.slice(0, 1).map((b) => ({ puzzle_type: b.puzzle_type })));
    }

    if (table === "dc_daily_page_content") {
      const date = String(p.get("puzzle_date")).replace("eq.", "");
      const row = db.dayContent[date];
      return Response.json(row ? [{ games: row.games }] : []);
    }

    throw new Error(`unexpected request: ${method} ${url.pathname}${url.search}`);
  }) as typeof fetch;
}

/** Deps that record their calls; rotate promotes every Published row for the
 *  day exactly as fn_dc_rotate_live_set does, and sync rewrites day content. */
function recordingDeps(db: FakeDb) {
  const rotated: string[] = [];
  const synced: string[] = [];
  return {
    rotated,
    synced,
    deps: {
      rotateLiveSet: async (today: string) => {
        rotated.push(today);
        const due = db.bank.filter((b) => b.published === "Published" && b.go_live_date === today);
        for (const b of due) b.published = "Live";
        for (const b of db.bank) {
          if (b.published === "Live" && b.go_live_date < today) b.published = "Retired";
        }
        return { promoted: due.length, retired: 0, missingTypes: [] };
      },
      syncDayContent: async (date: string) => {
        synced.push(date);
        const live = db.bank.filter((b) => b.published === "Live" && b.go_live_date === date);
        db.dayContent[date] = { games: live.map((b) => ({ puzzle_type: b.puzzle_type })) };
        return { ok: true, puzzleCount: live.length };
      },
    },
  };
}

const SLATE = ["the_brief", "rackl", "dark_fiber", "frequency", "the_stack"];
const published = (date: string): FakeBankRow[] =>
  SLATE.map((t) => ({ puzzle_type: t, published: "Published", go_live_date: date }));
const live = (date: string): FakeBankRow[] =>
  SLATE.map((t) => ({ puzzle_type: t, published: "Live", go_live_date: date }));

// ── 3. goLiveToday ───────────────────────────────────────────────────────────

test("nothing to do: no season due, nothing Published, nothing Live", async () => {
  const db = newDb({
    seasons: [{ id: "s-future", name: "Next", starts_on: "2026-12-01", ends_on: "2027-03-01", status: "upcoming" }],
  });
  install(db);
  const { deps, rotated, synced } = recordingDeps(db);

  const r = await goLiveToday(SVC, { reason: "cron.season-golive", today: T }, deps);

  assert.deepEqual(r.activated, []);
  assert.equal(r.promoted, 0);
  assert.equal(r.synced, false);
  assert.deepEqual(r.skipped, ["no-seasons-due", "no-published-rows-for-today", "no-live-rows-for-today"]);
  assert.deepEqual(rotated, []);
  assert.deepEqual(synced, []);
  assert.deepEqual(db.audits, []);
  // The out-of-window season was not touched.
  assert.equal(db.seasons[0].status, "upcoming");
});

test("season flip only: activates + audits, but rotates and syncs nothing", async () => {
  const db = newDb({
    seasons: [{ id: "02701ead", name: "Football Season", starts_on: T, ends_on: "2027-01-31", status: "upcoming" }],
  });
  install(db);
  const { deps, rotated, synced } = recordingDeps(db);

  const r = await goLiveToday(SVC, { reason: "season.create", actor: "staff@faraday", today: T }, deps);

  assert.deepEqual(r.activated, ["02701ead"]);
  assert.equal(db.seasons[0].status, "active");
  assert.equal(r.promoted, 0);
  assert.equal(r.synced, false);
  assert.deepEqual(rotated, []);
  assert.deepEqual(synced, []);

  // D4: exactly ONE audit row per activated season, reason = the trigger.
  assert.equal(db.audits.length, 1);
  assert.equal(db.audits[0].action, "season.auto_activate");
  assert.equal(db.audits[0].reason, "season.create");
  assert.equal(db.audits[0].staff_email, "staff@faraday");
  assert.equal(db.audits[0].target_type, "season");
  assert.equal(db.audits[0].target_id, "02701ead");
  assert.equal(db.audits[0].reversible, false);
  assert.equal(db.audits[0].domain, "seasons");
});

test("rows promoted: rotation runs and the day content is resynced", async () => {
  // The exact 2026-10-05 shape: season already active, 5 Football rows
  // Published for today, day-content row mirrored at 05:10 with 0 puzzles.
  const db = newDb({
    seasons: [{ id: "02701ead", name: "Football Season", starts_on: T, ends_on: "2027-01-31", status: "active" }],
    bank: published(T),
    dayContent: { [T]: { games: [] } },
  });
  install(db);
  const { deps, rotated, synced } = recordingDeps(db);

  const r = await goLiveToday(SVC, { reason: "season.approve_puzzles", today: T }, deps);

  assert.deepEqual(r.activated, []);
  assert.equal(r.promoted, 5);
  assert.equal(r.synced, true);
  assert.deepEqual(rotated, [T]);
  assert.deepEqual(synced, [T]);
  assert.equal(db.dayContent[T].games.length, 5);
  assert.equal(db.bank.filter((b) => b.published === "Live").length, 5);
  // promoted > 0 short-circuits the "is the day content stale?" probe.
  assert.equal(db.urls.filter((u) => u.includes("dc_daily_page_content")).length, 0);
});

test("already Live but the day-content row is EMPTY: sync runs without a rotation (B6)", async () => {
  const db = newDb({
    seasons: [{ id: "02701ead", name: "Football Season", starts_on: T, ends_on: "2027-01-31", status: "active" }],
    bank: live(T),
    dayContent: { [T]: { games: [] } },
  });
  install(db);
  const { deps, rotated, synced } = recordingDeps(db);

  const r = await goLiveToday(SVC, { reason: "cron.season-golive", today: T }, deps);

  assert.equal(r.promoted, 0);
  assert.ok(r.skipped.includes("no-published-rows-for-today"));
  assert.deepEqual(rotated, []);
  assert.deepEqual(synced, [T]);
  assert.equal(r.synced, true);
  assert.equal(db.dayContent[T].games.length, 5);
});

test("already Live and the day-content row is MISSING: sync runs", async () => {
  const db = newDb({ bank: live(T) });
  install(db);
  const { deps, synced } = recordingDeps(db);

  const r = await goLiveToday(SVC, { reason: "cron.season-golive", today: T }, deps);

  assert.equal(r.synced, true);
  assert.deepEqual(synced, [T]);
});

test("D7 idempotency: the second consecutive run is a strict no-op", async () => {
  const db = newDb({
    seasons: [{ id: "02701ead", name: "Football Season", starts_on: T, ends_on: "2027-01-31", status: "upcoming" }],
    bank: published(T),
    dayContent: { [T]: { games: [] } },
  });
  install(db);
  const { deps, rotated, synced } = recordingDeps(db);

  const first = await goLiveToday(SVC, { reason: "season.create", today: T }, deps);
  assert.deepEqual(first.activated, ["02701ead"]);
  assert.equal(first.promoted, 5);
  assert.equal(first.synced, true);

  const second = await goLiveToday(SVC, { reason: "cron.season-golive", today: T }, deps);
  assert.deepEqual(second.activated, [], "no season flips twice");
  assert.equal(second.promoted, 0, "nothing is Published for today any more");
  assert.equal(second.synced, false, "day content already describes today's puzzles");
  assert.deepEqual(second.skipped, [
    "no-seasons-due",
    "no-published-rows-for-today",
    "day-content-already-current (5)",
  ]);
  // The side-effecting dependencies ran exactly once across both runs.
  assert.deepEqual(rotated, [T]);
  assert.deepEqual(synced, [T]);
  assert.equal(db.audits.length, 1, "no second audit row");
  assert.equal(db.dayContent[T].games.length, 5);
});

test("never throws: every dependency failing is captured in `skipped`", async () => {
  // (a) every read/write refused by PostgREST.
  const db = newDb({ fail: new Set(["seasons", "dc_puzzle_bank_staging", "dc_daily_page_content"]) });
  install(db);
  const { deps } = recordingDeps(db);
  const a = await goLiveToday(SVC, { reason: "cron.season-golive", today: T }, deps);
  assert.deepEqual(a.activated, []);
  assert.equal(a.promoted, 0);
  assert.equal(a.synced, false);
  assert.equal(a.skipped.length, 3);
  assert.match(a.skipped[0], /^activate-failed: seasons activate failed \(500\)/);
  assert.match(a.skipped[1], /^rotate-failed: read .*dc_puzzle_bank_staging failed \(500\)/);
  assert.match(a.skipped[2], /^sync-failed: read .*dc_puzzle_bank_staging failed \(500\)/);

  // (b) fetch itself throwing (DNS, abort, offline).
  const thrown = newDb();
  install(thrown);
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  const b = await goLiveToday(SVC, { reason: "cron.season-golive", today: T }, deps);
  assert.deepEqual(b.skipped.map((x) => x.split(":")[0]), ["activate-failed", "rotate-failed", "sync-failed"]);

  // (c) the injected dependencies themselves throwing.
  const db2 = newDb({ bank: published(T) });
  install(db2);
  const c = await goLiveToday(
    SVC,
    { reason: "season.approve_puzzles", today: T },
    {
      rotateLiveSet: async () => {
        throw new Error("fn_dc_rotate_live_set 500");
      },
      syncDayContent: async () => {
        throw new Error("Supabase upsert failed (409)");
      },
    }
  );
  assert.equal(c.promoted, 0);
  assert.equal(c.synced, false);
  assert.ok(c.skipped.some((x) => x.startsWith("rotate-failed: fn_dc_rotate_live_set 500")), c.skipped.join("|"));
  // Nothing was promoted, so the Live probe decides — the rows are still
  // Published, so there is nothing Live and the sync is skipped, not failed.
  assert.ok(c.skipped.includes("no-live-rows-for-today"), c.skipped.join("|"));

  // (d) the sync reporting a soft failure rather than throwing.
  const db3 = newDb({ bank: live(T) });
  install(db3);
  const d = await goLiveToday(
    SVC,
    { reason: "cron.season-golive", today: T },
    { syncDayContent: async () => ({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" }) }
  );
  assert.equal(d.synced, false);
  assert.ok(d.skipped.includes("sync-failed: SUPABASE_SERVICE_ROLE_KEY not set"), d.skipped.join("|"));

  // (e) no credentials at all: reported, not thrown, and nothing is attempted.
  const e: GoLiveResult = await goLiveToday(null, { reason: "cron.season-golive", today: T }, deps);
  assert.deepEqual(e.skipped, ["no-service-credentials"]);
  assert.equal(e.today, T);
});

// ── 4. the D5 approve gate ───────────────────────────────────────────────────

test("approvalGoLivePlan goes live only when the approved dates include today", () => {
  assert.deepEqual(approvalGoLivePlan([T, "2026-10-06", "2026-10-07"], T), { goLive: true });
  assert.deepEqual(approvalGoLivePlan(["2026-10-01", T], T), { goLive: true });

  assert.deepEqual(approvalGoLivePlan(["2026-10-12", "2026-10-20"], T), {
    goLive: false,
    firstServeDay: "2026-10-12",
  });
  // Unsorted input still reports the EARLIEST future day.
  assert.deepEqual(approvalGoLivePlan(["2026-10-20", "2026-10-12"], T), {
    goLive: false,
    firstServeDay: "2026-10-12",
  });
  // A pure backfill has no future date — fall back to the earliest overall.
  assert.deepEqual(approvalGoLivePlan(["2026-10-01", "2026-10-02"], T), {
    goLive: false,
    firstServeDay: "2026-10-01",
  });
  assert.deepEqual(approvalGoLivePlan([], T), { goLive: false, firstServeDay: null });
});

test("approveSeasonPuzzles is wired to the gate (D5)", () => {
  // generation-write.ts has runtime imports that node --test cannot resolve
  // (aliased + extensionless), so the WIRING is asserted on the source and the
  // DECISION is asserted on the real function above.
  const src = readFileSync(
    join(process.cwd(), "src/lib/league-office/generation-write.ts"),
    "utf8"
  );
  const body = src.slice(src.indexOf("export async function approveSeasonPuzzles"));
  assert.match(src, /import \{[^}]*approvalGoLivePlan[^}]*goLiveToday[^}]*\} from "@\/lib\/seasons\/golive"/);
  assert.match(body, /const plan = approvalGoLivePlan\(dates, today\)/);
  // The go-live is INSIDE the plan.goLive branch — never unconditional.
  assert.match(body, /if \(plan\.goLive\) \{\s*const g = await goLiveToday\(s, \{ reason: "season\.approve_puzzles"/);
  assert.match(body, /first serve day is \$\{plan\.firstServeDay\}/);
  // It runs only after the approve RPC succeeded.
  assert.ok(
    body.indexOf("if (!r.ok) return") < body.indexOf("goLiveToday"),
    "goLiveToday must run only after a successful approve"
  );
});
