// FAR-287 / CC-DC-BANK-RESUME-1.0 Phase 1 — staging serve-state invariant.
//
// No dc_puzzle_bank_staging row may be published='Live' unless its go_live_date
// equals the current serve date (America/Chicago). That is the invariant
// fn_dc_rotate_live_set maintains (promote Published+today, retire Live+before);
// staging rotation has never run on a cron, so a stale Live row means someone
// bypassed the rotator — exactly the 2026-07-28 landmine this ticket neutralized.
//
// Run: npm run test:staging-live
// The live-DB assertion needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; without
// them it SKIPS LOUDLY (the pure-logic tests always run). Read-only: one SELECT.

import test from "node:test";
import assert from "node:assert/strict";

// Current serve date in America/Chicago as YYYY-MM-DD (matches the AUTO-128
// rotator's day boundary; en-CA locale formats as ISO).
export function chicagoServeDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now);
}

// Rows that violate the invariant: Live but not dated for the serve day.
export function liveViolations(rows, serveDate) {
  return (rows || []).filter((r) => r.published === "Live" && r.go_live_date !== serveDate);
}

test("chicagoServeDate is YYYY-MM-DD and DST-stable", () => {
  assert.match(chicagoServeDate(), /^\d{4}-\d{2}-\d{2}$/);
  // 05:30Z is 00:30 CDT the same day; 04:30Z is 23:30 CDT the PREVIOUS day.
  assert.equal(chicagoServeDate(new Date("2026-07-28T05:30:00Z")), "2026-07-28");
  assert.equal(chicagoServeDate(new Date("2026-07-28T04:30:00Z")), "2026-07-27");
  // Winter (CST, UTC-6): 05:30Z is still the previous day.
  assert.equal(chicagoServeDate(new Date("2026-01-15T05:30:00Z")), "2026-01-14");
});

test("liveViolations flags stale Live rows only", () => {
  const serve = "2026-07-31";
  const rows = [
    { puzzle_type: "Rackl", published: "Live", go_live_date: "2026-07-28" },      // stale → violation
    { puzzle_type: "Circuit", published: "Live", go_live_date: serve },            // today's set → fine
    { puzzle_type: "The Brief", published: "Unpublished", go_live_date: "2026-07-28" }, // not Live → fine
    { puzzle_type: "Frequency", published: "Published", go_live_date: "2026-08-01" },   // scheduled → fine
    { puzzle_type: "Dark Fiber", published: "Live", go_live_date: "2026-09-01" },  // future-dated Live → violation
  ];
  const v = liveViolations(rows, serve);
  assert.deepEqual(v.map((r) => r.puzzle_type), ["Rackl", "Dark Fiber"]);
  assert.equal(liveViolations([], serve).length, 0);
});

test("live DB: no staging row is Live off the serve date", async (t) => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    t.skip("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — live invariant NOT checked");
    return;
  }
  // A pasted-with-smart-quotes secret produces a cryptic undici ByteString error;
  // fail with something actionable instead.
  assert.ok(/^[\x20-\x7e]+$/.test(key),
    "SUPABASE_SERVICE_ROLE_KEY contains non-ASCII characters (smart quotes from a paste?) — fix the env value");
  const res = await fetch(
    `${url}/rest/v1/dc_puzzle_bank_staging?select=puzzle_type,go_live_date,published&published=eq.Live`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  assert.ok(res.ok, `staging read failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  const violations = liveViolations(rows, chicagoServeDate());
  assert.equal(
    violations.length, 0,
    `staging rows Live off the serve date (rotator bypassed?): ${JSON.stringify(violations)}`,
  );
});
