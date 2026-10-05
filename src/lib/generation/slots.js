// CC-DC-GEN-LEASE-AUTOADVANCE-1.0 D2 — the one place generation decides whether
// a slot that was already taken is a FAILURE or a SKIP, and what "progress"
// means for a slice.
//
// Root cause this module exists to kill: the bank is unique per
//   (season_id, puzzle_type, go_live_date)   — dc_staging_season_type_date_uniq
// which is exactly the guarantee the generator wants. But when two slices raced
// the same slot (see lease.js), the loser's insert came back 23505 and the
// worker's catch block ran it through fail(), so:
//   • failed_count counted a slot that IS filled — the panel reported a run as
//     half-broken when the bank was in fact complete;
//   • phase_cursor.failures filled up with `db:23505:dc_staging_season_type_
//     date_uniq`, burying the real faults underneath it;
//   • worst, the zero-progress rule (a full sweep with 0 written and >0 failed
//     ends the run as failed_short) fired on a slice whose every slot had been
//     filled by the OTHER slice — a complete run declared failed_short.
//
// Invariants:
//   S1  23505 on dc_staging_season_type_date_uniq is a benign SKIP: the slot is
//       filled, which is the outcome the slice wanted. It increments
//       `skippedExisting` and is not recorded in phase_cursor.failures.
//   S2  ANY OTHER 23505 (a different unique index — content_hash, a theme row,
//       something added later) stays a failure. "Duplicate key" in general is
//       not benign; only this one constraint means "the slot is already done".
//   S3  A skipped duplicate counts as PROGRESS. pendingAfter subtracts it, and
//       the zero-progress rule does not fire on a slice that only hit
//       duplicates. This is the clause that turns a completed run from
//       failed_short into complete.
//
// Pure: no I/O, no imports. Plain JS for the same reason difficulty.js is.
// Tests: src/lib/generation/lease-autoadvance.test.mjs (npm run test:generation-lease).

/** SQLSTATE for unique_violation. */
export const UNIQUE_VIOLATION = "23505";

/**
 * The GLOBAL one-puzzle-per-(season, type, date) index on
 * dc_puzzle_bank_staging (CC-LO-CONCURRENT-SEASONS-1.0 D6). Losing a race to it
 * is the only duplicate this module forgives.
 */
export const SLOT_UNIQUE_CONSTRAINT = "dc_staging_season_type_date_uniq";

/**
 * S1/S2 — is this PostgREST error "the slot is already filled"?
 * Takes the parsed facts only (`code`, `constraint`), never PostgREST's
 * `details`, which on this table is the whole failing row including the answer
 * key (failure-reasons.js F1).
 *
 * @param {{code?: string|null, constraint?: string|null}|null|undefined} info
 * @returns {boolean}
 */
export function isBenignSlotConflict(info) {
  if (!info || typeof info !== "object") return false;
  if (String(info.code ?? "").trim() !== UNIQUE_VIOLATION) return false;
  return String(info.constraint ?? "").trim() === SLOT_UNIQUE_CONSTRAINT;
}

/** @param {unknown} v @returns {number} */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * S3 — how a slice ends, given what it got through.
 *
 * `duplicateSkips` is counted as filled slots, which is why:
 *   • pendingAfter reaches 0 for a slice whose slots another slice wrote, so
 *     the run COMPLETES instead of looping; and
 *   • the zero-progress clause (written === 0) requires duplicateSkips === 0,
 *     so a duplicate-only slice is never failed_short.
 *
 * The zero-progress threshold itself is unchanged (D4): one full sweep with no
 * progress at all and at least one failure.
 *
 * @param {{
 *   runKind?: string,
 *   pendingCount: number,
 *   written?: number,
 *   duplicateSkips?: number,
 *   failed?: number,
 *   sweptAll?: boolean,
 * }} input
 * @returns {{status: string, pendingAfter: number, done: boolean, failedShort: boolean, note?: string}}
 */
export function sliceOutcome({
  runKind = "full",
  pendingCount = 0,
  written = 0,
  duplicateSkips = 0,
  failed = 0,
  sweptAll = false,
}) {
  const pendingAfter = num(pendingCount) - num(written) - num(duplicateSkips);

  if (pendingAfter <= 0) {
    return {
      status: runKind === "pilot" ? "pilot_complete" : "complete",
      pendingAfter,
      done: true,
      failedShort: false,
    };
  }
  if (sweptAll === true && num(written) === 0 && num(duplicateSkips) === 0 && num(failed) > 0) {
    return {
      status: "failed_short",
      pendingAfter,
      done: true,
      failedShort: true,
      note: `stopped short: ${pendingAfter} slots kept failing — see run phase_cursor and logs`,
    };
  }
  return { status: "generating", pendingAfter, done: false, failedShort: false };
}
