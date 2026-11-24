// Daily course allowance — app-side tests (FDY-392 UL-2).
//   run: npm run test:usage
//
// The database function usage_consume is mocked: an in-memory ledger with the
// same distinct-item semantics (FDY-353 §3 steps 5–10), so these tests prove the
// player's wiring — subject, item, fail-closed — not the SQL, which FDY-390's
// PGlite suite already covers. Course codes here are deliberately opaque.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RPC_TIMEOUT_MS,
  USAGE_APP,
  VISITOR_COOKIE,
  _resetWarnings,
  clientIp,
  consume,
  ipSubject,
  visitorIdFromCookie,
  type ConsumeDeps,
  type UsageConsumeArgs,
  type UsageRpc,
} from "./limits.ts";
import { COURSE_METRIC, courseLimitNotice, nextUtcMidnight, startCourse } from "../academy/course-start.ts";
import type { Course, ReadResult } from "../academy/types.ts";

const VISITOR = "0b0f6c1e-2f43-4c8e-9a51-3d7e2b9c4a10";
const SIG = "a".repeat(64);
const RESET = "2026-11-25T00:00:00+00:00";
const ENV = { SUPABASE_SERVICE_ROLE_KEY: "test-service-key", USAGE_IP_SALT: "test-salt" };

/** A fake usage_consume: limit 5 per (metric, subject, day), distinct items free on repeat. */
function fakeLedger(limit = 5) {
  const used = new Map<string, number>();
  const items = new Set<string>();
  const calls: UsageConsumeArgs[] = [];
  const rpc: UsageRpc = async (a) => {
    calls.push(a);
    const row = `${a.p_app}|${a.p_metric}|${a.p_subject}`;
    if (a.p_item && items.has(`${row}|${a.p_item}`)) {
      return { allowed: true, reason: "already_counted", reset_at: RESET, used: used.get(row) ?? 0, limit };
    }
    const n = used.get(row) ?? 0;
    if (n + a.p_weight > limit) return { allowed: false, reason: "limit", reset_at: RESET, used: n, limit };
    used.set(row, n + a.p_weight);
    if (a.p_item) items.add(`${row}|${a.p_item}`);
    return { allowed: true, reason: "ok", reset_at: RESET, used: n + a.p_weight, limit };
  };
  return { rpc, calls };
}

function req(cookie: string | null = `${VISITOR_COOKIE}=${VISITOR}.${SIG}`, ip = "203.0.113.7"): Request {
  const headers: Record<string, string> = { "x-forwarded-for": `${ip}, 10.0.0.1` };
  if (cookie) headers.cookie = cookie;
  return new Request("https://www.faraday-player.com/api/academy/start", { method: "POST", headers });
}

function course(code: string, slug = code): ReadResult<Course> {
  return {
    ok: true,
    data: {
      code,
      slug,
      title: `Course ${slug}`,
      level: "foundational",
      author: null,
      group: null,
      reading_minutes: 10,
      narrated: false,
      welcome_message: null,
      access: "open",
      modules: [],
      quiz: [],
      glossary: [],
    } as unknown as Course,
  };
}

const quiet = { log: () => {} };

function deps(rpc: UsageRpc, extra: Partial<ConsumeDeps> = {}): ConsumeDeps {
  return { rpc, env: ENV, ...quiet, ...extra };
}

/** startCourse wired to a fake catalog where every slug "s-<x>" is course "course-<x>". */
function starter(d: ConsumeDeps) {
  return (slug: string, r: Request = req()) =>
    startCourse(slug, r, {
      getCourse: async (s) => course(`course-${s.slice(2)}`, s),
      consume: (opts, rq) => consume(opts, rq, d),
    });
}

// ── the four required cases ──────────────────────────────────────────────────

test("five distinct courses are allowed", async () => {
  const { rpc, calls } = fakeLedger();
  const start = starter(deps(rpc));
  for (const s of ["s-a", "s-b", "s-c", "s-d", "s-e"]) {
    const v = await start(s);
    assert.equal(v.allowed, true, s);
    assert.equal(v.status, 200);
  }
  assert.equal(calls.length, 5);
  assert.deepEqual(
    calls.map((c) => c.p_item),
    ["course-a", "course-b", "course-c", "course-d", "course-e"],
  );
});

test("a lesson inside an already-started course is free", async () => {
  const { rpc } = fakeLedger();
  const start = starter(deps(rpc));
  for (const s of ["s-a", "s-b", "s-c", "s-d", "s-e"]) await start(s);
  // Every further lesson of course a — any module, any order — is still open.
  for (let i = 0; i < 10; i++) assert.equal((await start("s-a")).allowed, true);
  // ...and costs nothing: a sixth new course is still the one that is refused.
  assert.equal((await start("s-f")).allowed, false);
});

test("the sixth distinct course is blocked, with a reset time", async () => {
  const { rpc } = fakeLedger();
  const start = starter(deps(rpc));
  for (const s of ["s-a", "s-b", "s-c", "s-d", "s-e"]) await start(s);
  const sixth = await start("s-f");
  assert.equal(sixth.allowed, false);
  assert.equal(sixth.resetAt, RESET);
  assert.equal(sixth.status, 200);
});

test("an RPC failure fails closed", async () => {
  const boom: UsageRpc = async () => {
    throw new Error("connection refused");
  };
  const v = await starter(deps(boom))("s-a");
  assert.equal(v.allowed, false);
  assert.equal(v.resetAt, null);
});

// ── fail-closed edges (D8) ───────────────────────────────────────────────────

test("an RPC that does not answer within the timeout fails closed", async () => {
  let aborted = false;
  const hang: UsageRpc = (_a, signal) =>
    new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      setTimeout(() => resolve({ allowed: true, reason: "ok", reset_at: RESET }), 200);
    });
  const r = await consume({ metric: COURSE_METRIC, item: "course-a" }, req(), deps(hang, { timeoutMs: 20 }));
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "error");
  assert.equal(aborted, true, "the in-flight request is aborted");
  assert.equal(RPC_TIMEOUT_MS, 1500);
});

test("a malformed answer fails closed", async () => {
  for (const bad of [null, "yes", {}, { allowed: "true" }, []]) {
    const r = await consume({ metric: COURSE_METRIC }, req(), deps(async () => bad));
    assert.equal(r.allowed, false, JSON.stringify(bad));
  }
});

test("database-side refusals pass through as not allowed", async () => {
  for (const reason of ["unconfigured", "bad_input", "limit"]) {
    const r = await consume(
      { metric: COURSE_METRIC },
      req(),
      deps(async () => ({ allowed: false, reason, reset_at: RESET })),
    );
    assert.equal(r.allowed, false);
    assert.equal(r.reason, reason);
  }
});

test("no service role key fails closed without calling anything", async () => {
  const r = await consume({ metric: COURSE_METRIC }, req(), { env: {}, ...quiet });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "not_configured");
});

test("the retired Supabase project is refused", async () => {
  const r = await consume(
    { metric: COURSE_METRIC },
    req(),
    { env: { ...ENV, SUPABASE_URL: "https://xgbpmlkanxewtfizloay.supabase.co" }, ...quiet },
  );
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "not_configured");
});

test("an unreachable library fails closed; a missing course is a 404 with no count", async () => {
  const { rpc, calls } = fakeLedger();
  const d = deps(rpc);
  const offline = await startCourse("s-a", req(), {
    getCourse: async () => ({ ok: false, reason: "offline" }),
    consume: (o, r) => consume(o, r, d),
  });
  assert.equal(offline.allowed, false);
  const missing = await startCourse("s-a", req(), {
    getCourse: async () => ({ ok: false, reason: "missing" }),
    consume: (o, r) => consume(o, r, d),
  });
  assert.equal(missing.status, 404);
  const bad = await starter(d)("../etc");
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0);
});

// ── who the reader is ────────────────────────────────────────────────────────

test("reuses the tutor meter's anonymous id as v:<uuid> and passes the hashed IP", async () => {
  const { rpc, calls } = fakeLedger();
  const r = await consume({ metric: COURSE_METRIC, item: "course-a" }, req(), deps(rpc));
  assert.equal(r.setCookie, null, "no second cookie when one already exists");
  const a = calls[0];
  assert.equal(a.p_app, USAGE_APP);
  assert.equal(a.p_app, "FA");
  assert.equal(a.p_metric, "courses");
  assert.equal(a.p_subject, `v:${VISITOR}`);
  assert.match(a.p_subject, /^(p|v|ip):[A-Za-z0-9_-]{8,64}$/);
  assert.equal(a.p_ip_subject, await ipSubject("203.0.113.7", "test-salt"));
  assert.match(a.p_ip_subject ?? "", /^ip:[0-9a-f]{32}$/);
  assert.equal(a.p_weight, 1);
  assert.equal(a.p_dry_run, false);
});

test("without USAGE_IP_SALT the IP check is skipped and logged once", async () => {
  _resetWarnings();
  const { rpc, calls } = fakeLedger();
  const lines: string[] = [];
  const d: ConsumeDeps = { rpc, env: { SUPABASE_SERVICE_ROLE_KEY: "k" }, log: (m) => lines.push(m) };
  await consume({ metric: COURSE_METRIC, item: "course-a" }, req(), d);
  await consume({ metric: COURSE_METRIC, item: "course-b" }, req(), d);
  assert.equal(calls[0].p_ip_subject, null);
  assert.equal(lines.filter((l) => l.includes("USAGE_IP_SALT")).length, 1);
});

test("a signed cookie is verified when the secret is present", async () => {
  const secret = "cookie-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const raw = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(VISITOR));
  const good = Array.from(new Uint8Array(raw)).map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await visitorIdFromCookie(`${VISITOR}.${good}`, secret), VISITOR);
  assert.equal(await visitorIdFromCookie(`${VISITOR}.${SIG}`, secret), null);
  assert.equal(await visitorIdFromCookie(`${VISITOR}.${SIG}`, undefined), VISITOR);
  assert.equal(await visitorIdFromCookie("not-a-uuid.abc", undefined), null);
});

test("a reader with no cookie gets the one shared cookie minted, never a second", async () => {
  const { rpc, calls } = fakeLedger();
  const minted = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const r = await consume(
    { metric: COURSE_METRIC, item: "course-a" },
    req(null),
    deps(rpc, { mintVisitor: async () => ({ id: minted, setCookie: `${VISITOR_COOKIE}=x; Path=/` }) }),
  );
  assert.equal(r.allowed, true);
  assert.equal(calls[0].p_subject, `v:${minted}`);
  assert.ok(r.setCookie?.startsWith(`${VISITOR_COOKIE}=`));
});

test("locally minted cookies use the tutor meter's exact cookie name", async () => {
  const { rpc, calls } = fakeLedger();
  const r = await consume(
    { metric: COURSE_METRIC },
    req(null),
    { rpc, env: { ...ENV, ACADEMY_COOKIE_SECRET: "s" }, ...quiet },
  );
  assert.ok(r.setCookie?.startsWith(`${VISITOR_COOKIE}=`));
  assert.match(r.setCookie ?? "", /HttpOnly; Secure; SameSite=Lax/);
  // The minted value must round-trip through the same verifier the next request uses.
  const value = decodeURIComponent((r.setCookie ?? "").split(";")[0].split("=")[1]);
  assert.equal(`v:${await visitorIdFromCookie(value, "s")}`, calls[0].p_subject);
});

test("no visitor id and no way to mint one fails closed", async () => {
  const { rpc, calls } = fakeLedger();
  const r = await consume({ metric: COURSE_METRIC }, req(null), deps(rpc, { mintVisitor: async () => null }));
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "no_subject");
  assert.equal(calls.length, 0);
});

test("client IP is the first x-forwarded-for hop", () => {
  assert.equal(clientIp(req(null, "198.51.100.4")), "198.51.100.4");
  assert.equal(clientIp(new Request("https://x/", { headers: { "x-real-ip": "192.0.2.9" } })), "192.0.2.9");
  assert.equal(clientIp(new Request("https://x/")), null);
});

// ── the notice ───────────────────────────────────────────────────────────────

test("the notice has no numbers beyond the time, and no upsell", () => {
  const text = courseLimitNotice(RESET, new Date("2026-11-24T20:00:00Z"), "America/Chicago");
  assert.match(text, /^You’ve started today’s set of courses\. More open up at .+\.$/);
  assert.match(text, /6:00/, "UTC midnight in Chicago");
  assert.doesNotMatch(text, /limit|quota|upgrade|price|\$/i);
  // With no reset time (an error), it falls back to the next UTC midnight.
  assert.equal(nextUtcMidnight(new Date("2026-11-24T23:59:00Z")).toISOString(), "2026-11-25T00:00:00.000Z");
  assert.match(courseLimitNotice(null, new Date("2026-11-24T20:00:00Z"), "UTC"), /12:00/);
});
