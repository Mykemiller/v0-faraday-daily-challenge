// CC-DC-GEN-LEASE-AUTOADVANCE-1.0 — the tests for the three rules this ticket
// added: who owns a run (lease.js D1), what a lost slot race means (slots.js
// D2), and when "Continue until done" stops (advance.js D3).
//
// No network, no database, no Anthropic, no clock: every effect is injected.
// The two source-scan tests at the bottom are the join between these pure rules
// and the two files that consume them — they fail if worker.ts or the panel
// stops wiring the rule up, which is the only way these unit tests could pass
// while production still races.
//
// Run: npm run test:generation-lease

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  STALE_LEASE_MS, claimCursor, heartbeatGuard, isClaimable, leaseActive,
  leaseAgeMs, leaseNote, releaseCursor, withLease,
} from "./lease.js";
import {
  SLOT_UNIQUE_CONSTRAINT, UNIQUE_VIOLATION, isBenignSlotConflict, sliceOutcome,
} from "./slots.js";
import {
  IDLE_BACKOFF_MS, MAX_ADVANCE_SLICES, NO_PROGRESS_LIMIT, advanceDecision,
  advanceUntilDone, isActiveStatus, trackProgress,
} from "./advance.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), "utf8");

const NOW = "2026-10-05T18:00:00.000Z";
const ago = (ms) => new Date(Date.parse(NOW) - ms).toISOString();

// ── D1 · the lease ───────────────────────────────────────────────────────────

test("STALE_LEASE_MS is the agreed 180s", () => {
  assert.equal(STALE_LEASE_MS, 180_000);
});

test("a run with no slice_active is claimable", () => {
  assert.equal(isClaimable({ phase_cursor: {}, last_heartbeat_at: ago(1_000) }, { now: NOW }), true);
  assert.equal(isClaimable({ phase_cursor: null, last_heartbeat_at: ago(1_000) }, { now: NOW }), true);
  assert.equal(isClaimable({ last_heartbeat_at: ago(1_000) }, { now: NOW }), true);
  // a cursor that carries other state but not the flag (a resumed run)
  assert.equal(
    isClaimable({ phase_cursor: { themes_done: true, failures: { schema: 2 } }, last_heartbeat_at: ago(5_000) }, { now: NOW }),
    true
  );
});

test("slice_active:false is claimable — that is what a clean release leaves", () => {
  assert.equal(isClaimable({ phase_cursor: { slice_active: false }, last_heartbeat_at: ago(2_000) }, { now: NOW }), true);
});

test("a held lease with a FRESH heartbeat is NOT claimable", () => {
  const run = { phase_cursor: { slice_active: true }, last_heartbeat_at: ago(30_000) };
  assert.equal(isClaimable(run, { now: NOW }), false);
  assert.equal(leaseNote(run), "lease held");
});

test("a held lease whose heartbeat is older than 180s IS claimable (a crashed slice)", () => {
  assert.equal(
    isClaimable({ phase_cursor: { slice_active: true }, last_heartbeat_at: ago(STALE_LEASE_MS + 1) }, { now: NOW }),
    true
  );
  // exactly at the threshold is still held — the rule is strictly older than
  assert.equal(
    isClaimable({ phase_cursor: { slice_active: true }, last_heartbeat_at: ago(STALE_LEASE_MS) }, { now: NOW }),
    false
  );
});

test("a held lease with no heartbeat falls back to started_at, then to claimable", () => {
  assert.equal(
    isClaimable({ phase_cursor: { slice_active: true }, last_heartbeat_at: null, started_at: ago(10_000) }, { now: NOW }),
    false,
    "a run that started 10s ago and holds the lease is alive"
  );
  assert.equal(
    isClaimable({ phase_cursor: { slice_active: true }, last_heartbeat_at: null, started_at: ago(600_000) }, { now: NOW }),
    true
  );
  assert.equal(
    isClaimable({ phase_cursor: { slice_active: true }, last_heartbeat_at: null, started_at: null }, { now: NOW }),
    true,
    "an unprovable lease must never make a run permanently unreachable"
  );
});

test("leaseActive is strict about the flag — jsonb can hold anything", () => {
  for (const v of [true]) assert.equal(leaseActive({ slice_active: v }), true);
  for (const v of ["true", 1, {}, [], null, undefined, false, 0]) assert.equal(leaseActive({ slice_active: v }), false);
  for (const v of [null, undefined, "x", 5, []]) assert.equal(leaseActive(v), false);
});

test("leaseAgeMs reads either timestamp and degrades to null", () => {
  assert.equal(leaseAgeMs({ last_heartbeat_at: ago(4_000) }, NOW), 4_000);
  assert.equal(leaseAgeMs({ started_at: ago(7_000) }, NOW), 7_000);
  assert.equal(leaseAgeMs({ last_heartbeat_at: "not a date" }, NOW), null);
  assert.equal(leaseAgeMs({}, NOW), null);
});

test("the claim/release cursors preserve everything else in phase_cursor", () => {
  const cursor = { themes_done: true, pilot_date: "2026-11-02", failures: { schema: 3 } };
  assert.deepEqual(claimCursor(cursor), { ...cursor, slice_active: true });
  assert.deepEqual(releaseCursor({ ...cursor, slice_active: true }), { ...cursor, slice_active: false });
  assert.deepEqual(claimCursor(null), { slice_active: true });
  assert.deepEqual(releaseCursor(undefined), { slice_active: false });
  // and they do not mutate the input
  const original = { a: 1 };
  claimCursor(original);
  assert.deepEqual(original, { a: 1 });
});

test("the claim's compare-and-swap filter is plain PostgREST, URL-encoded", () => {
  assert.equal(heartbeatGuard(null), "last_heartbeat_at=is.null");
  assert.equal(heartbeatGuard(undefined), "last_heartbeat_at=is.null");
  assert.equal(heartbeatGuard(""), "last_heartbeat_at=is.null");
  // the `+00:00` offset must not reach the wire as a literal plus (= a space)
  const guard = heartbeatGuard("2026-10-05T18:00:00.123456+00:00");
  assert.match(guard, /^last_heartbeat_at=eq\./);
  assert.ok(!guard.includes("+"), "a raw + in a query value decodes as a space");
  assert.equal(decodeURIComponent(guard.slice("last_heartbeat_at=eq.".length)), "2026-10-05T18:00:00.123456+00:00");
  // no jsonb-path predicate: a syntax surprise here 400s a production slice
  assert.ok(!guard.includes("->"));
});

test("withLease releases the lease on a NORMAL exit", async () => {
  const calls = [];
  const out = await withLease({
    claim: async () => { calls.push("claim"); return true; },
    work: async () => { calls.push("work"); return { runId: "r1", written: 9 }; },
    release: async () => { calls.push("release"); },
    onUnavailable: () => { throw new Error("must not be reached"); },
  });
  assert.deepEqual(calls, ["claim", "work", "release"]);
  assert.deepEqual(out, { runId: "r1", written: 9 });
});

test("withLease releases the lease on a THROWN exit, and the error still propagates", async () => {
  const calls = [];
  await assert.rejects(
    () => withLease({
      claim: async () => { calls.push("claim"); return true; },
      work: async () => { calls.push("work"); throw new Error("no corpus theme row available"); },
      release: async () => { calls.push("release"); },
      onUnavailable: () => ({ idle: true }),
    }),
    /no corpus theme row available/
  );
  assert.deepEqual(calls, ["claim", "work", "release"]);
});

test("a run whose lease is held never runs work, and is IDLE rather than an error", async () => {
  let worked = 0;
  let released = 0;
  const out = await withLease({
    claim: async () => false,
    work: async () => { worked++; return {}; },
    release: async () => { released++; },
    onUnavailable: () => ({ idle: true, note: "lease held" }),
  });
  assert.equal(worked, 0, "the loser of the claim must not generate anything");
  assert.equal(released, 0, "and must not release a lease it does not hold");
  assert.deepEqual(out, { idle: true, note: "lease held" });
});

test("a release that fails is reported, never allowed to mask the slice's outcome", async () => {
  const seen = [];
  const out = await withLease({
    claim: async () => true,
    work: async () => ({ status: "complete" }),
    release: async () => { throw new Error("PATCH 503"); },
    onUnavailable: () => ({ idle: true }),
    onReleaseError: (err) => seen.push(String(err)),
  });
  assert.deepEqual(out, { status: "complete" });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /PATCH 503/);

  // …and the same when the slice itself threw: the ORIGINAL error must survive
  await assert.rejects(
    () => withLease({
      claim: async () => true,
      work: async () => { throw new Error("model 529"); },
      release: async () => { throw new Error("PATCH 503"); },
      onUnavailable: () => ({ idle: true }),
      onReleaseError: () => {},
    }),
    /model 529/
  );
});

// ── D2 · a lost slot race is a skip, not a failure ───────────────────────────

test("23505 on the slot's unique index is benign", () => {
  assert.equal(isBenignSlotConflict({ code: UNIQUE_VIOLATION, constraint: SLOT_UNIQUE_CONSTRAINT }), true);
  assert.equal(SLOT_UNIQUE_CONSTRAINT, "dc_staging_season_type_date_uniq");
  assert.equal(UNIQUE_VIOLATION, "23505");
});

test("23505 on ANY OTHER constraint is still a failure", () => {
  assert.equal(isBenignSlotConflict({ code: "23505", constraint: "dc_puzzle_bank_staging_content_hash_key" }), false);
  assert.equal(isBenignSlotConflict({ code: "23505", constraint: "dc_daily_theme_season_date_uniq" }), false);
  assert.equal(isBenignSlotConflict({ code: "23505", constraint: null }), false);
  assert.equal(isBenignSlotConflict({ code: "23505" }), false);
});

test("a non-23505 error on the slot index is still a failure", () => {
  assert.equal(isBenignSlotConflict({ code: "23514", constraint: SLOT_UNIQUE_CONSTRAINT }), false);
  assert.equal(isBenignSlotConflict({ code: null, constraint: SLOT_UNIQUE_CONSTRAINT }), false);
  assert.equal(isBenignSlotConflict(null), false);
  assert.equal(isBenignSlotConflict(undefined), false);
  assert.equal(isBenignSlotConflict("23505"), false);
});

test("a duplicate-only slice is COMPLETE — the zero-progress rule must not fire", () => {
  // the slice attempted all 7 slots and every one came back 23505 on the slot
  // index: another slice had already filled them. Nothing was written, nothing
  // failed, and the run is done.
  const out = sliceOutcome({ runKind: "full", pendingCount: 7, written: 0, duplicateSkips: 7, failed: 0, sweptAll: true });
  assert.equal(out.status, "complete");
  assert.equal(out.failedShort, false);
  assert.equal(out.pendingAfter, 0);
});

test("a duplicate-only slice that ALSO saw real failures still is not failed_short", () => {
  // 4 of 10 slots were already filled, 6 failed on schema. written === 0, but
  // progress was made, so the run keeps going rather than being declared dead.
  const out = sliceOutcome({ runKind: "full", pendingCount: 10, written: 0, duplicateSkips: 4, failed: 6, sweptAll: true });
  assert.equal(out.status, "generating");
  assert.equal(out.failedShort, false);
  assert.equal(out.pendingAfter, 6);
});

test("a genuine zero-progress sweep still ends the run failed_short", () => {
  const out = sliceOutcome({ runKind: "full", pendingCount: 12, written: 0, duplicateSkips: 0, failed: 12, sweptAll: true });
  assert.equal(out.status, "failed_short");
  assert.equal(out.failedShort, true);
  assert.equal(out.pendingAfter, 12);
  assert.match(out.note, /12 slots kept failing/);
});

test("the zero-progress rule still needs a FULL sweep and at least one failure", () => {
  // the budget guard stopped the slice early — not a sweep
  assert.equal(sliceOutcome({ pendingCount: 12, written: 0, failed: 5, sweptAll: false }).status, "generating");
  // nothing failed either (every batch was skipped for want of a prompt spec)
  assert.equal(sliceOutcome({ pendingCount: 12, written: 0, failed: 0, sweptAll: true }).status, "generating");
  // partial progress is progress
  assert.equal(sliceOutcome({ pendingCount: 12, written: 3, failed: 9, sweptAll: true }).status, "generating");
});

test("a finished run reports the run_kind's own terminal status", () => {
  assert.equal(sliceOutcome({ runKind: "pilot", pendingCount: 7, written: 7, sweptAll: true }).status, "pilot_complete");
  assert.equal(sliceOutcome({ runKind: "full", pendingCount: 7, written: 7, sweptAll: true }).status, "complete");
  assert.equal(sliceOutcome({ runKind: "pilot", pendingCount: 0 }).status, "pilot_complete");
  assert.equal(sliceOutcome({ runKind: "full", pendingCount: 0 }).status, "complete");
});

test("the worker's per-item bookkeeping: a duplicate touches skippedExisting, never failed_count", () => {
  // A faithful replay of worker.ts's insert handler over one batch: 2 slots
  // already filled by a concurrent slice, 1 schema failure, 0 written.
  const outcomes = [
    { err: { code: "23505", constraint: SLOT_UNIQUE_CONSTRAINT } },
    { err: { code: "23505", constraint: SLOT_UNIQUE_CONSTRAINT } },
    { err: { code: "23514", constraint: "dc_puzzle_bank_staging_difficulty_canon" } },
  ];
  const baseFailed = 0;
  let written = 0;
  let failed = 0;
  let duplicateSkips = 0;
  const failures = {};
  for (const o of outcomes) {
    if (isBenignSlotConflict(o.err)) { duplicateSkips++; continue; }
    failed++;
    const key = `db:${o.err.code}:${o.err.constraint}`;
    failures[key] = (failures[key] ?? 0) + 1;
  }
  assert.equal(duplicateSkips, 2);
  assert.equal(failed, 1, "only the CHECK violation is a failure");
  assert.equal(baseFailed + failed, 1, "failed_count counts slots that produced no row");
  assert.deepEqual(Object.keys(failures), ["db:23514:dc_puzzle_bank_staging_difficulty_canon"]);
  assert.ok(
    !Object.keys(failures).some((k) => k.includes(SLOT_UNIQUE_CONSTRAINT)),
    "a benign duplicate must never be recorded in phase_cursor.failures"
  );

  // 3 pending slots, 2 of them now filled: 1 left, run keeps going, NOT failed_short
  const out = sliceOutcome({ runKind: "full", pendingCount: 3, written, duplicateSkips, failed, sweptAll: true });
  assert.equal(out.status, "generating");
  assert.equal(out.pendingAfter, 1);

  // and had all 3 been duplicates, the run would be complete
  const allDupes = sliceOutcome({ runKind: "full", pendingCount: 3, written: 0, duplicateSkips: 3, failed: 0, sweptAll: true });
  assert.equal(allDupes.status, "complete");
});

// ── D3 · Continue until done ─────────────────────────────────────────────────

test("the loop's constants are the agreed ones", () => {
  assert.equal(MAX_ADVANCE_SLICES, 60);
  assert.equal(NO_PROGRESS_LIMIT, 3);
  assert.ok(IDLE_BACKOFF_MS > 0);
});

test("only generating/queued runs may be advanced", () => {
  for (const s of ["generating", "queued"]) assert.equal(isActiveStatus(s), true);
  for (const s of ["complete", "pilot_complete", "failed_short", "superseded", "", null, undefined])
    assert.equal(isActiveStatus(s), false);
});

test("advanceDecision reports the FIRST stop condition that applies", () => {
  assert.deepEqual(advanceDecision({ status: "generating", slices: 1, noProgress: 0 }), { continue: true, reason: null });
  assert.deepEqual(advanceDecision({ status: "complete" }), { continue: false, reason: "finished" });
  assert.deepEqual(advanceDecision({ status: "failed_short" }), { continue: false, reason: "finished" });
  assert.deepEqual(advanceDecision({ status: "generating", noProgress: NO_PROGRESS_LIMIT }), { continue: false, reason: "no-progress" });
  assert.deepEqual(advanceDecision({ status: "generating", slices: MAX_ADVANCE_SLICES }), { continue: false, reason: "slice-cap" });
  assert.deepEqual(advanceDecision({ status: "generating", postFailed: true }), { continue: false, reason: "error" });
  // Stop outranks everything, including a run that looks fine
  assert.deepEqual(advanceDecision({ status: "generating", stopRequested: true }), { continue: false, reason: "stopped" });
  assert.deepEqual(advanceDecision({ status: "complete", stopRequested: true }), { continue: false, reason: "stopped" });
});

test("trackProgress resets on a write and accumulates otherwise", () => {
  assert.equal(trackProgress(10, 14, 2), 0);
  assert.equal(trackProgress(10, 10, 0), 1);
  assert.equal(trackProgress(10, 10, 2), 3);
  assert.equal(trackProgress(10, 9, 1), 2, "a written_count that went backwards is not progress");
});

/** A fake run the loop can drive: each slice writes `per` puzzles until target. */
function fakeRun({ target = 20, per = 5, kind = "full" } = {}) {
  const state = { written: 0, status: "generating", slices: 0, inFlight: 0, maxInFlight: 0 };
  return {
    state,
    slice: async () => {
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await new Promise((r) => setTimeout(r, 1));
      state.slices += 1;
      state.written = Math.min(target, state.written + per);
      if (state.written >= target) state.status = kind === "pilot" ? "pilot_complete" : "complete";
      state.inFlight -= 1;
      return { ok: true };
    },
    readRun: async () => ({ status: state.status, written: state.written }),
  };
}

test("the loop advances until the run's status leaves generating — one slice at a time", async () => {
  const run = fakeRun({ target: 20, per: 5 });
  const ticks = [];
  const result = await advanceUntilDone({
    ...run,
    start: { status: "generating", written: 0 },
    onTick: (t) => ticks.push(t.slice),
    sleep: async () => {},
  });
  assert.equal(result.reason, "finished");
  assert.equal(result.status, "complete");
  assert.equal(result.slices, 4, "20 puzzles at 5 a slice");
  assert.equal(result.written, 20);
  assert.deepEqual(ticks, [1, 2, 3, 4], "live progress is reported before each slice");
  assert.equal(run.state.maxInFlight, 1, "A1 — never two slices in flight");
});

test("the loop stops after 3 consecutive slices that write nothing", async () => {
  let slices = 0;
  const result = await advanceUntilDone({
    start: { status: "generating", written: 11 },
    slice: async () => { slices++; return { ok: true }; },
    readRun: async () => ({ status: "generating", written: 11 }),
    sleep: async () => {},
  });
  assert.equal(result.reason, "no-progress");
  assert.equal(slices, NO_PROGRESS_LIMIT);
  assert.equal(result.slices, NO_PROGRESS_LIMIT);
});

test("a slice that writes something resets the no-progress budget", async () => {
  // nothing, nothing, one puzzle, nothing, nothing, nothing -> 6 slices
  const writes = [0, 0, 1, 0, 0, 0];
  let i = 0;
  let written = 0;
  const result = await advanceUntilDone({
    start: { status: "generating", written: 0 },
    slice: async () => { written += writes[i] ?? 0; i++; return { ok: true }; },
    readRun: async () => ({ status: "generating", written }),
    sleep: async () => {},
  });
  assert.equal(result.reason, "no-progress");
  assert.equal(result.slices, 6);
  assert.equal(result.written, 1);
});

test("the loop stops at the 60-slice ceiling even on a run that keeps progressing", async () => {
  let written = 0;
  const result = await advanceUntilDone({
    start: { status: "generating", written: 0 },
    slice: async () => { written += 1; return { ok: true }; },
    readRun: async () => ({ status: "generating", written }),
    sleep: async () => {},
  });
  assert.equal(result.reason, "slice-cap");
  assert.equal(result.slices, MAX_ADVANCE_SLICES);
  assert.equal(result.written, MAX_ADVANCE_SLICES);
});

test("a failed POST stops the loop", async () => {
  let slices = 0;
  for (const bad of [{ ok: false }, null, undefined]) {
    slices = 0;
    const result = await advanceUntilDone({
      start: { status: "generating", written: 0 },
      slice: async () => { slices++; return slices === 2 ? bad : { ok: true }; },
      readRun: async () => ({ status: "generating", written: slices }),
      sleep: async () => {},
    });
    assert.equal(result.reason, "error");
    assert.equal(slices, 2, "the loop stops on the failing slice, it does not retry");
  }
});

test("Stop is honoured BETWEEN slices — the one in flight is allowed to finish", async () => {
  let slices = 0;
  let stop = false;
  let finishedAfterStop = 0;
  const result = await advanceUntilDone({
    start: { status: "generating", written: 0 },
    shouldStop: () => stop,
    slice: async () => {
      slices++;
      if (slices === 2) stop = true; // pressed mid-slice
      await new Promise((r) => setTimeout(r, 1));
      if (stop) finishedAfterStop++;
      return { ok: true };
    },
    readRun: async () => ({ status: "generating", written: slices }),
    sleep: async () => {},
  });
  assert.equal(result.reason, "stopped");
  assert.equal(slices, 2, "no slice is fired after Stop");
  assert.equal(finishedAfterStop, 1, "the slice already in flight ran to completion and checkpointed");
});

test("an idle slice (another slice holds the lease) backs off and is not an error", async () => {
  const slept = [];
  let slices = 0;
  const result = await advanceUntilDone({
    start: { status: "generating", written: 4 },
    slice: async () => { slices++; return { ok: true, idle: true }; },
    readRun: async () => ({ status: "generating", written: 4 }),
    sleep: async (ms) => { slept.push(ms); },
  });
  assert.equal(result.reason, "no-progress", "a lease held three times running is still no progress");
  assert.deepEqual(slept, [IDLE_BACKOFF_MS, IDLE_BACKOFF_MS, IDLE_BACKOFF_MS]);
  assert.equal(slices, 3);
});

test("a run row that has vanished from the payload is treated as finished", async () => {
  const result = await advanceUntilDone({
    start: { status: "generating", written: 0 },
    slice: async () => ({ ok: true }),
    readRun: async () => null,
    sleep: async () => {},
  });
  assert.equal(result.reason, "finished");
  assert.equal(result.status, "complete");
  assert.equal(result.slices, 1);
});

test("the loop will fire a first slice for a run that is still queued", async () => {
  let slices = 0;
  const result = await advanceUntilDone({
    start: {}, // no status known yet — the run was created a moment ago
    slice: async () => { slices++; return { ok: true }; },
    readRun: async () => ({ status: "complete", written: 7 }),
    sleep: async () => {},
  });
  assert.equal(slices, 1);
  assert.equal(result.reason, "finished");
  assert.equal(result.written, 7);
});

// ── the join: the rules above are actually wired into the two consumers ──────

test("worker.ts claims the run under a lease and releases it in a finally", () => {
  const src = read("worker.ts");
  assert.match(src, /from "\.\/lease"/);
  assert.match(src, /withLease<SliceReport>\(\{/, "the slice must run inside the lease, not beside it");
  assert.match(src, /isClaimable\(run,/);
  assert.match(src, /heartbeatGuard\(run\.last_heartbeat_at\)/, "the claim must be a compare-and-swap");
  assert.match(src, /claimCursor\(run\.phase_cursor\)/);
  assert.match(src, /releaseCursor\(lease\.cursor\)/, "the release must preserve the slice's own progress");
  // the claim HAS to bump the heartbeat (it is the compare-and-swap), so the
  // release has to put the earned value back or a run that throws on every
  // slice would be re-heartbeated every 10 minutes and never look stalled
  assert.match(
    src,
    /last_heartbeat_at: lease\.heartbeatAt/,
    "the release must restore the heartbeat the slice actually earned (isStalled is the only alarm for a run that cannot progress)"
  );
  assert.match(src, /lease\.heartbeatAt = beat/, "only a real checkpoint may advance the earned heartbeat");
  assert.match(src, /idle: true, note: "lease held"/, "a held lease is idle, never an error");
  // the release lives in withLease's finally — that is what the unit tests above
  // pin — so the worker must not have grown its own escape hatch
  assert.doesNotMatch(src, /slice_active:\s*false/, "only lease.js may clear the flag");
  // D1: no schema change
  assert.doesNotMatch(src, /slice_active=eq|alter table|ALTER TABLE/, "the lease lives in phase_cursor, not a new column");
  assert.match(src, /last_heartbeat_at&order=started_at\.asc&limit=1/, "the claim query must read the heartbeat it swaps on");
});

test("worker.ts routes a benign slot conflict to a skip, before fail()", () => {
  const src = read("worker.ts");
  assert.match(src, /from "\.\/slots"/);
  const catchBlock = src.slice(src.indexOf("const e = err instanceof SupabaseRestError"));
  const skipAt = catchBlock.indexOf("isBenignSlotConflict");
  const failAt = catchBlock.indexOf('fail("db"');
  assert.ok(skipAt >= 0 && failAt >= 0, "both branches must exist");
  assert.ok(skipAt < failAt, "the duplicate check must come BEFORE fail(), or 23505 still counts as a failure");
  assert.match(catchBlock, /duplicateSkips\+\+/);
  // the skip must not touch the failure bookkeeping
  const skipBranch = catchBlock.slice(skipAt, failAt);
  assert.doesNotMatch(skipBranch, /noteFailure|countFailure|failed\+\+/);
  // and the zero-progress rule must be fed the duplicate count
  assert.match(src, /sliceOutcome\(\{[\s\S]*?duplicateSkips,[\s\S]*?\}\)/);
});

test("the panel's primary control is Continue until done, with Stop and live progress", () => {
  const src = read("../../components/league-office/season/GenerationPanel.tsx");
  assert.match(src, /from "@\/lib\/generation\/advance"/);
  assert.match(src, /advanceUntilDone\(\{/);
  assert.match(src, /Continue until done/);
  assert.match(src, />Stop</);
  assert.match(src, /slice \{loop\.slice\}/, "the loop must show which slice it is on");
  assert.doesNotMatch(src, /Advance now/, "the old single-shot label is gone");
  assert.match(src, /Advance one slice/, "…but the single-slice behaviour stays reachable");
  assert.match(src, /loopingRef/, "the loop must be unable to start twice");
});
