import test from "node:test";
import assert from "node:assert/strict";
import { resolveRunStatus, isTerminal } from "./run-bookkeeping.mjs";

const RUN_TARGET = 3500;

test("pilot pass fully covered → pilot_complete, never complete", () => {
  const s = resolveRunStatus({ pilot: true, covered: 49, scopeTarget: 49, runTarget: RUN_TARGET });
  assert.equal(s, "pilot_complete");
  assert.ok(isTerminal(s));
});

test("pilot pass with failures stays generating (resumable)", () => {
  assert.equal(
    resolveRunStatus({ pilot: true, covered: 46, scopeTarget: 49, runTarget: RUN_TARGET }),
    "generating",
  );
});

test("full pass with failures stays generating", () => {
  assert.equal(
    resolveRunStatus({ pilot: false, covered: 3488, scopeTarget: 3500, runTarget: RUN_TARGET }),
    "generating",
  );
});

test("full pass fully covered → complete", () => {
  const s = resolveRunStatus({ pilot: false, covered: 3500, scopeTarget: 3500, runTarget: RUN_TARGET });
  assert.equal(s, "complete");
  assert.ok(isTerminal(s));
});

test("a --limit/--type partial pass can cover its scope without completing the run", () => {
  // e.g. --limit 100: scope 700 slots, all covered — the run is NOT complete.
  assert.equal(
    resolveRunStatus({ pilot: false, covered: 700, scopeTarget: 700, runTarget: RUN_TARGET }),
    "generating",
  );
});

test("resume pass that mops up the tail completes the run", () => {
  // Final pass: full scope, covered = skips (already written) + freshly written.
  assert.equal(
    resolveRunStatus({ pilot: false, covered: 3500, scopeTarget: 3500, runTarget: RUN_TARGET }),
    "complete",
  );
});
