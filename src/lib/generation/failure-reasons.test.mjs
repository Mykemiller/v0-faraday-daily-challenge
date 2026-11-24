// CC-DC-GEN-FAILURE-VISIBILITY-1.0 — failure-reason parsing/keying contract.
// Run: npm run test:generation-failures
//
// The load-bearing test is "no answer content ever escapes": the real 23514
// body Postgres returns for this table puts the ENTIRE failing row — puzzle
// content, hints, answer_key — inside `details`. SECRETANSWER below stands in
// for that answer. If it ever appears in anything this module returns, the
// commissioner's panel and the run row would be leaking answers.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePostgrestError, failureKey, mergeFailures, restErrorMessage,
  lastFailureEntry, topFailure, clampMessage, failuresFrom, lastFailureFrom,
  MAX_ERROR_MESSAGE, MAX_STORED_MESSAGE,
} from "./failure-reasons.js";

// The real shape, verbatim from pilot 0118d976-ca9a-4f8f-b3c3-f1c9f1ae347a.
const BODY_23514 = JSON.stringify({
  code: "23514",
  details: "Failing row contains (3f2a, 2026-02-02, Signal Drop, SECRETANSWER, …).",
  hint: null,
  message:
    'new row for relation "dc_puzzle_bank_staging" violates check constraint "dc_puzzle_bank_staging_difficulty_canon"',
});

// every string reachable from a value, however nested
function allStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => { out.push(k); allStrings(v, out); });
  else if (value !== null && value !== undefined) out.push(String(value));
  return out;
}

test("parses the real 23514 body: code, message and constraint name", () => {
  const info = parsePostgrestError(400, BODY_23514);
  assert.equal(info.status, 400);
  assert.equal(info.code, "23514");
  assert.equal(info.constraint, "dc_puzzle_bank_staging_difficulty_canon");
  assert.match(info.message, /violates check constraint/);
  assert.equal(info.hint, null);
});

test("`details` is not a field, and SECRETANSWER appears NOWHERE", () => {
  const info = parsePostgrestError(400, BODY_23514);
  assert.ok(!("details" in info), "details must not be part of the returned shape");
  assert.deepEqual(
    Object.keys(info).sort(),
    ["code", "constraint", "hint", "message", "status"],
  );

  // the whole downstream chain, not just the parse
  const key = failureKey("db", info);
  const chain = [
    info,
    key,
    restErrorMessage("POST", "dc_puzzle_bank_staging", info),
    lastFailureEntry(key, restErrorMessage("POST", "dc_puzzle_bank_staging", info)),
    mergeFailures({ [key]: 2 }, { [key]: 1 }),
    topFailure({ [key]: 3 }),
  ];
  for (const s of allStrings(chain)) {
    assert.ok(!s.includes("SECRETANSWER"), `answer content leaked: ${s}`);
    assert.ok(!s.includes("Failing row contains"), `row dump leaked: ${s}`);
  }
});

test("the db key folds in SQLSTATE and constraint name", () => {
  const info = parsePostgrestError(400, BODY_23514);
  assert.equal(failureKey("db", info), "db:23514:dc_puzzle_bank_staging_difficulty_canon");
});

test("a non-JSON body degrades to the scrubbed body text", () => {
  const info = parsePostgrestError(502, "<html><body>502 Bad Gateway</body></html>");
  assert.equal(info.status, 502);
  assert.equal(info.code, null);
  assert.equal(info.constraint, null);
  assert.match(info.message, /502 Bad Gateway/);
  assert.equal(failureKey("db", info), "db:-:-");
});

test("a TRUNCATED json body cannot leak the row dump it was cut off inside", () => {
  // what the old 200-char slice produced: unparseable JSON that still carried
  // the start of the row dump. Cut both AFTER details closes and INSIDE it.
  for (const cut of [120, 60, 45]) {
    const info = parsePostgrestError(400, BODY_23514.slice(0, cut));
    assert.equal(info.code, null, "a truncated body is not valid JSON");
    assert.ok(!info.message.includes("SECRETANSWER"), `leaked at cut ${cut}: ${info.message}`);
    assert.ok(!info.message.includes("Failing row contains"), `leaked at cut ${cut}: ${info.message}`);
    assert.match(info.message, /redacted/);
  }
});

test("empty / garbage inputs do not throw", () => {
  for (const body of [undefined, null, "", "{}", "[]", "null", "[1,2]"]) {
    const info = parsePostgrestError(undefined, body);
    assert.equal(typeof info.message, "string");
    assert.equal(info.status, null);
  }
});

test("parsePostgrestError prefers the json message over raw body text", () => {
  const info = parsePostgrestError(409, JSON.stringify({ code: "23505", message: 'duplicate key value violates unique constraint "uq_bank_slot"' }));
  assert.equal(info.code, "23505");
  assert.equal(info.constraint, "uq_bank_slot");
  assert.equal(failureKey("db", info), "db:23505:uq_bank_slot");
});

test("failureKey covers the whole reason vocabulary", () => {
  assert.equal(failureKey("schema"), "schema");
  assert.equal(failureKey("hints"), "hints");
  assert.equal(failureKey("copy"), "copy");
  assert.equal(failureKey("subject-repeat"), "subject-repeat");
  assert.equal(failureKey("no-content"), "no-content");
  assert.equal(failureKey("skip"), "skip:no-spec");
  assert.equal(failureKey("skip:no-spec"), "skip:no-spec");
  assert.equal(failureKey("model", { status: 429 }), "model:429");
  assert.equal(failureKey("model", {}), "model:error");
  assert.equal(failureKey("model", { status: 0 }), "model:error");
  assert.equal(failureKey("db", { code: "23514" }), "db:23514:-");
  assert.equal(failureKey("db", null), "db:-:-");
  assert.equal(failureKey(undefined), "other");
});

test("keys are short and stable — no whitespace, no quotes", () => {
  const key = failureKey("db", { code: "23 514", constraint: 'weird "name" here' });
  assert.doesNotMatch(key, /["'\s]/);
  assert.ok(key.length < 120);
});

test("mergeFailures adds counts across slices", () => {
  assert.deepEqual(
    mergeFailures({ "db:23514:c1": 5, schema: 1 }, { "db:23514:c1": 3, hints: 2 }),
    { "db:23514:c1": 8, schema: 1, hints: 2 },
  );
  assert.deepEqual(mergeFailures(null, { schema: 2 }), { schema: 2 });
  assert.deepEqual(mergeFailures({ schema: 2 }, undefined), { schema: 2 });
  assert.deepEqual(mergeFailures(null, null), {});
  // junk is dropped, never NaN-ed into the map
  assert.deepEqual(mergeFailures({ a: "x", b: 0, c: -3, "": 9 }, { d: "4" }), { d: 4 });
  // the inputs are not mutated
  const prev = { schema: 1 };
  mergeFailures(prev, { schema: 1 });
  assert.deepEqual(prev, { schema: 1 });
});

test("restErrorMessage has the D2 shape and is capped at 500", () => {
  const info = parsePostgrestError(400, BODY_23514);
  const msg = restErrorMessage("post", "dc_puzzle_bank_staging", info);
  assert.match(msg, /^Supabase POST dc_puzzle_bank_staging 400 23514 new row for relation/);
  assert.ok(msg.length <= MAX_ERROR_MESSAGE);

  const long = restErrorMessage("POST", "t", { status: 400, code: "XX000", message: "y".repeat(5000) });
  assert.equal(long.length, MAX_ERROR_MESSAGE);

  assert.equal(restErrorMessage(undefined, undefined, undefined), "Supabase GET - - -");
});

test("lastFailureEntry stores key + message + at, message capped at 300", () => {
  const e = lastFailureEntry("db:23514:c", "z".repeat(900), "2026-10-05T00:00:00.000Z");
  assert.deepEqual(Object.keys(e).sort(), ["at", "key", "message"]);
  assert.equal(e.message.length, MAX_STORED_MESSAGE);
  assert.equal(e.at, "2026-10-05T00:00:00.000Z");
  assert.match(lastFailureEntry("k", "m").at, /^\d{4}-\d{2}-\d{2}T/);
  // a caller that hands it a raw body still cannot persist the row dump
  assert.ok(!lastFailureEntry("k", BODY_23514).message.includes("SECRETANSWER"));
});

test("topFailure picks the most common reason and counts the rest", () => {
  assert.deepEqual(topFailure({ a: 1, b: 7, c: 3 }), { key: "b", count: 7, others: 2 });
  assert.deepEqual(topFailure({ only: 4 }), { key: "only", count: 4, others: 0 });
  assert.equal(topFailure({}), null);
  assert.equal(topFailure(null), null);
  // ties break alphabetically so the panel line does not flicker between polls
  assert.equal(topFailure({ zeta: 2, alpha: 2 }).key, "alpha");
});

test("clampMessage scrubs details/row dumps and collapses whitespace", () => {
  assert.ok(!clampMessage(BODY_23514, 500).includes("SECRETANSWER"));
  assert.match(clampMessage('{"details":"Failing row contains (SECRETANSWER)"}', 500), /\[redacted\]/);
  assert.equal(clampMessage("a\n\n  b"), "a b");
  assert.equal(clampMessage(undefined), "");
  assert.equal(clampMessage("abcdef", 3), "abc");
});

test("phase_cursor readers tolerate jsonb of any shape", () => {
  assert.deepEqual(failuresFrom({ failures: { schema: 2 } }), { schema: 2 });
  assert.deepEqual(failuresFrom({}), {});
  assert.deepEqual(failuresFrom(null), {});
  assert.deepEqual(failuresFrom({ failures: "nope" }), {});

  assert.deepEqual(
    lastFailureFrom({ last_failure: { key: "schema", message: "schema: Rackl g0: label", at: "2026-10-05T00:00:00.000Z" } }),
    { key: "schema", message: "schema: Rackl g0: label", at: "2026-10-05T00:00:00.000Z" },
  );
  assert.equal(lastFailureFrom(null), null);
  assert.equal(lastFailureFrom({}), null);
  assert.equal(lastFailureFrom({ last_failure: [] }), null);
  // a row written by an older build is re-scrubbed on the way OUT
  assert.ok(!lastFailureFrom({ last_failure: { key: "db", message: BODY_23514 } }).message.includes("SECRETANSWER"));
});
