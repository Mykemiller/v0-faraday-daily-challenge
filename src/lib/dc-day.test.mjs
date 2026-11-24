// CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 FIX B2 — the client day IS the server day.
//   npm run test:season-scoring

import test from "node:test";
import assert from "node:assert/strict";

import { chicagoDay, hintBudgetKey } from "./dc-day.js";

/** Byte-for-byte the server's `centralDate` (src/app/api/score/route.ts), kept
 *  here as an independent restatement: if either side is edited to drift, this
 *  test is what notices. */
function serverCentralDate(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

test("19:30 CT — the hour the UTC key used to roll a day early", () => {
  // 2026-07-15 19:30 CDT = 2026-07-16 00:30 UTC. The old UTC key said the 16th
  // while the server wrote the 15th: budget reset, hintsUsed 0, penalty evaded.
  const at = new Date("2026-07-16T00:30:00Z");
  assert.equal(at.toISOString().slice(0, 10), "2026-07-16", "premise: UTC says the 16th");
  assert.equal(chicagoDay(at), "2026-07-15");
  assert.equal(chicagoDay(at), serverCentralDate(at));
});

test("00:30 CT — the morning that used to be charged for last night's hints", () => {
  // 2026-07-16 00:30 CDT = 2026-07-16 05:30 UTC. Same UTC day as 19:30 the
  // evening before, so the old key handed this session the evening's spend.
  const at = new Date("2026-07-16T05:30:00Z");
  assert.equal(chicagoDay(at), "2026-07-16");
  assert.equal(chicagoDay(at), serverCentralDate(at));
  // …and it is NOT the same key as 19:30 the previous evening any more.
  assert.notEqual(
    hintBudgetKey("Rackl", new Date("2026-07-16T00:30:00Z")),
    hintBudgetKey("Rackl", at)
  );
});

test("client and server agree at every hour of a CDT and a CST day", () => {
  for (const base of ["2026-07-15", "2026-01-15"]) {
    for (let h = 0; h < 24; h++) {
      const at = new Date(`${base}T${String(h).padStart(2, "0")}:30:00Z`);
      assert.equal(chicagoDay(at), serverCentralDate(at), `${base} ${h}:30Z`);
    }
  }
});

test("the DST boundaries themselves", () => {
  // Spring forward 2026-03-08 02:00 CST → 03:00 CDT; fall back 2026-11-01.
  for (const iso of [
    "2026-03-08T07:59:00Z", "2026-03-08T08:01:00Z",
    "2026-11-01T06:59:00Z", "2026-11-01T07:01:00Z",
  ])
    assert.equal(chicagoDay(new Date(iso)), serverCentralDate(new Date(iso)), iso);
});

test("the FAR-198 key SHAPE is unchanged — only the day value moved", () => {
  const at = new Date("2026-07-16T00:30:00Z");
  assert.equal(hintBudgetKey("Rackl", at), "faraday_hints_2026-07-15_Rackl");
  assert.equal(hintBudgetKey("Signal Drop", at), "faraday_hints_2026-07-15_Signal Drop");
  assert.match(hintBudgetKey("Rackl", at), /^faraday_hints_\d{4}-\d{2}-\d{2}_Rackl$/);
});

test("the day is read at CALL time, so a tab left open overnight rolls over", () => {
  // The bug was `const TODAY = …` at module scope. A function cannot freeze.
  assert.equal(chicagoDay(new Date("2026-07-15T12:00:00Z")), "2026-07-15");
  assert.equal(chicagoDay(new Date("2026-07-17T12:00:00Z")), "2026-07-17");
  assert.equal(typeof chicagoDay(), "string");
  assert.match(chicagoDay(), /^\d{4}-\d{2}-\d{2}$/);
  // A non-Date argument falls back to now rather than throwing.
  assert.match(chicagoDay("nonsense"), /^\d{4}-\d{2}-\d{2}$/);
});
