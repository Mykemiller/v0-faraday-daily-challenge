// FAR-287 / CC-DC-BANK-RESUME-1.0 Phase 2 — pure run-status resolution for
// dc_puzzle_generation_runs. The generator previously stamped a terminal status
// unconditionally at process end, even on a partial or failure-ridden pass;
// status must only go terminal when the scope is actually covered.
//
//   covered     — slots in THIS pass's scope that hold a staged row (skipped-as-
//                 already-written + written this invocation)
//   scopeTarget — slots in this pass's scope (days-in-pass × types-in-pass)
//   runTarget   — the run row's target_count (full 500 × 7 = 3,500)
//   pilot       — the --pilot gate: never 'complete', at most 'pilot_complete'
//
// Any uncovered slot (failed, or never attempted because of --limit/--type)
// keeps the run resumable: status 'generating'.

export function resolveRunStatus({ pilot, covered, scopeTarget, runTarget }) {
  if (covered < scopeTarget) return "generating";
  if (pilot) return "pilot_complete";
  return scopeTarget >= runTarget ? "complete" : "generating";
}

export function isTerminal(status) {
  return status === "complete" || status === "pilot_complete";
}
