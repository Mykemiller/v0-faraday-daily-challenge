// CC-DC-GEN-LEASE-AUTOADVANCE-1.0 D3 — "Continue until done": the rule for
// advancing a generation run slice after slice until it finishes.
//
// Why this is a module and not an inline loop in the panel: the only thing that
// makes an auto-advance loop safe is its STOP conditions, and a stop condition
// buried in a React callback is a stop condition nobody can test. Every effect
// here is injected, so advanceUntilDone() is exercised with fakes in
// src/lib/generation/lease-autoadvance.test.mjs — no network, no DB, no clock.
//
// Invariants:
//   A1  SEQUENTIAL. One slice at a time: the POST is awaited in full, then the
//       run is re-read, and only then may the next slice start. Firing slices
//       concurrently is the very race lease.js exists to stop — the loop must
//       not reintroduce it from the browser.
//   A2  It stops, always, on the FIRST of:
//         • the run's status is no longer generating/queued (it finished, or it
//           ended failed_short)
//         • NO_PROGRESS_LIMIT consecutive slices with no increase in
//           written_count (a stuck run must not be driven forever)
//         • MAX_ADVANCE_SLICES slices
//         • the operator pressed Stop
//         • a POST failed
//   A3  Stop is honoured BETWEEN slices, not mid-slice (A1). A slice already in
//       flight is allowed to finish and checkpoint.
//   A4  The loop is a convenience, never the mechanism. Closing the tab just
//       reverts the run to the ten-minute cron; nothing is left in a state that
//       needs the browser back.
//
// Pure: no I/O, no imports. Plain JS for the same reason difficulty.js is.
// Tests: src/lib/generation/lease-autoadvance.test.mjs (npm run test:generation-lease).

/** Hard ceiling on slices driven from one button press. */
export const MAX_ADVANCE_SLICES = 60;
/** Consecutive slices that may write nothing before the loop gives up. */
export const NO_PROGRESS_LIMIT = 3;
/** Pause after a slice that reported idle (another slice holds the lease). */
export const IDLE_BACKOFF_MS = 4_000;

/** Run statuses the loop is allowed to keep advancing. */
const ACTIVE_STATUSES = new Set(["generating", "queued"]);

/**
 * @param {unknown} status
 * @returns {boolean}
 */
export function isActiveStatus(status) {
  return ACTIVE_STATUSES.has(String(status ?? "").trim());
}

/**
 * A2 — may another slice be fired? The order of the clauses is the order the
 * reasons are reported in, which is also their order of importance: an operator
 * pressing Stop outranks everything, and a transport failure outranks a
 * judgement about progress.
 *
 * @param {{
 *   slices?: number,
 *   noProgress?: number,
 *   status?: unknown,
 *   stopRequested?: boolean,
 *   postFailed?: boolean,
 *   maxSlices?: number,
 *   noProgressLimit?: number,
 * }} state
 * @returns {{continue: boolean, reason: string|null}}
 */
export function advanceDecision(state = {}) {
  const slices = Number(state.slices) || 0;
  const noProgress = Number(state.noProgress) || 0;
  const maxSlices = Number.isFinite(state.maxSlices) ? Number(state.maxSlices) : MAX_ADVANCE_SLICES;
  const limit = Number.isFinite(state.noProgressLimit) ? Number(state.noProgressLimit) : NO_PROGRESS_LIMIT;

  if (state.stopRequested === true) return { continue: false, reason: "stopped" };
  if (state.postFailed === true) return { continue: false, reason: "error" };
  if (!isActiveStatus(state.status)) return { continue: false, reason: "finished" };
  if (noProgress >= limit) return { continue: false, reason: "no-progress" };
  if (slices >= maxSlices) return { continue: false, reason: "slice-cap" };
  return { continue: true, reason: null };
}

/**
 * The consecutive-no-progress counter. written_count is the honest measure
 * (worker.ts derives it from rows actually in staging), so "did it go up" is
 * the whole test — a slice that only skipped duplicate slots legitimately
 * writes nothing, and three of those in a row means nothing is left to do, in
 * which case the status check will have stopped the loop first.
 *
 * @param {number} prevWritten
 * @param {number} nextWritten
 * @param {number} noProgress
 * @returns {number}
 */
export function trackProgress(prevWritten, nextWritten, noProgress) {
  const prev = Number(prevWritten) || 0;
  const next = Number(nextWritten) || 0;
  return next > prev ? 0 : (Number(noProgress) || 0) + 1;
}

/**
 * A1–A4 — drive slices until a stop condition. Returns how it ended.
 *
 * @param {{
 *   slice: () => Promise<{ok?: boolean, idle?: boolean}|null|undefined>,
 *   readRun: () => Promise<{status?: unknown, written?: number}|null|undefined>,
 *   onTick?: (tick: {slice: number, written: number, status: unknown}) => void,
 *   shouldStop?: () => boolean,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   start?: {status?: unknown, written?: number},
 *   maxSlices?: number,
 *   noProgressLimit?: number,
 * }} io
 * @returns {Promise<{slices: number, written: number, status: unknown, reason: string|null}>}
 */
export async function advanceUntilDone(io) {
  const shouldStop = io.shouldStop ?? (() => false);
  const sleep = io.sleep ?? (() => Promise.resolve());
  const start = io.start ?? {};
  let slices = 0;
  let noProgress = 0;
  // A run created moments ago may not be in the panel's last payload yet;
  // "queued" is the honest default, and the first re-read corrects it.
  let status = start.status ?? "queued";
  let written = Number(start.written) || 0;
  let postFailed = false;

  for (;;) {
    const decision = advanceDecision({
      slices, noProgress, status, postFailed,
      stopRequested: shouldStop() === true,
      maxSlices: io.maxSlices,
      noProgressLimit: io.noProgressLimit,
    });
    if (!decision.continue) return { slices, written, status, reason: decision.reason };

    slices += 1;
    if (io.onTick) io.onTick({ slice: slices, written, status });

    // A1: awaited in full — nothing below starts until this slice has returned.
    const result = await io.slice();
    if (!result || result.ok === false) {
      postFailed = true;
      continue; // the decision above turns this into reason "error"
    }
    // A lease held by the cron is not an error (lease.js L3); back off so three
    // attempts do not burn through the no-progress budget in one second.
    if (result.idle === true) await sleep(IDLE_BACKOFF_MS);

    const run = await io.readRun();
    const nextWritten = Number(run && run.written);
    const resolved = Number.isFinite(nextWritten) ? nextWritten : written;
    noProgress = trackProgress(written, resolved, noProgress);
    written = resolved;
    // No row for the run any more (filtered out because it completed) is itself
    // a terminal answer.
    status = run ? run.status : "complete";
  }
}
