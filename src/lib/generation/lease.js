// CC-DC-GEN-LEASE-AUTOADVANCE-1.0 D1 — the one place generation decides WHO
// owns a run right now.
//
// Root cause this module exists to kill: every entry point into
// src/lib/generation/worker.ts claimed "the oldest in-flight run" with nothing
// but `completed_at is null and superseded_at is null`. The */10 cron, the
// League Office "Advance now" button and the kick that fires on run creation
// could therefore all be inside the SAME run at the same time, each with its
// own `occupied` snapshot taken once at slice start (worker.ts, phase B). Two
// slices then generated the SAME (season, puzzle_type, go_live_date) slot,
// paid Anthropic for both, and the loser's insert died on
//   unique dc_staging_season_type_date_uniq  (SQLSTATE 23505)
// which the worker scored as a failure. 84% of the failures in the full run
// 2026-10 were that, i.e. the generator competing with itself.
//
// The fix is a LEASE, not a schema change (D1): the flag lives in the run's
// existing `phase_cursor` jsonb as `slice_active`, is set when a slice claims
// the run and cleared when the slice exits. No column, no migration, so it can
// ship under a run that is mid-flight.
//
// Invariants:
//   L1  A run is claimable when `phase_cursor.slice_active` is not exactly
//       true, OR its heartbeat is older than STALE_LEASE_MS. The second clause
//       is what keeps a crashed slice (killed at Vercel's wall, lease never
//       released) from parking a run forever — the worker heartbeats after
//       every batch, so a live slice is never 180s silent.
//   L2  The claim is a compare-and-swap on `last_heartbeat_at`: the PATCH is
//       filtered on the EXACT value the claimer read, so of two slices that
//       read the same row only one can write. The loser sees 0 rows back and
//       goes idle. Plain PostgREST filters only — no jsonb-path predicate whose
//       syntax could 400 a production slice.
//   L3  A run that is already leased is IDLE, never an error. The cron must
//       treat "someone else is working" as the normal, boring case.
//   L4  The release runs in a `finally`, so a slice that THROWS frees the run
//       for the next firing instead of making it wait out STALE_LEASE_MS.
//   L5  A failed release never masks the slice's own outcome (an exception
//       thrown while unwinding would replace the real error).
//
// Pure: no I/O. Every effect in withLease() is injected, which is what makes
// the claim/release contract testable without a database. Plain JS (not TS) for
// the same reason src/lib/generation/difficulty.js is.
// Tests: src/lib/generation/lease-autoadvance.test.mjs (npm run test:generation-lease).

/**
 * How long a lease may go un-heartbeated before another slice may take it.
 * 180s: the worker checkpoints (and heartbeats) after every batch, and a batch
 * is budgeted well under that, so a silent lease is a dead slice — while a
 * Vercel function that was killed at its 300s wall is reclaimed on the next
 * ten-minute cron firing rather than two firings later.
 */
export const STALE_LEASE_MS = 180_000;

/**
 * Is this run's phase_cursor claiming an active slice?
 * Strict `=== true`: a jsonb blob can hold anything, and only the flag this
 * module writes counts as a held lease.
 *
 * @param {unknown} phaseCursor
 * @returns {boolean}
 */
export function leaseActive(phaseCursor) {
  if (!phaseCursor || typeof phaseCursor !== "object" || Array.isArray(phaseCursor)) return false;
  return /** @type {Record<string, unknown>} */ (phaseCursor).slice_active === true;
}

/** @param {unknown} value @returns {number|null} */
function millis(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * How long since this run last said anything. Falls back to started_at so a
 * queued run that has never heartbeated still has an age.
 *
 * @param {{last_heartbeat_at?: string|null, started_at?: string|null}} run
 * @param {string|number} now
 * @returns {number|null} null when neither timestamp is readable
 */
export function leaseAgeMs(run, now) {
  const nowMs = millis(now);
  const r = run && typeof run === "object" ? run : {};
  const thenMs = millis(r.last_heartbeat_at) ?? millis(r.started_at);
  if (nowMs === null || thenMs === null) return null;
  return nowMs - thenMs;
}

/**
 * L1 — may this slice claim this run?
 *
 * @param {{phase_cursor?: unknown, last_heartbeat_at?: string|null, started_at?: string|null}} run
 * @param {{now?: string|number, staleMs?: number}} [opts]
 * @returns {boolean}
 */
export function isClaimable(run, opts = {}) {
  if (!run || typeof run !== "object") return false;
  if (!leaseActive(run.phase_cursor)) return true;
  const staleMs = Number.isFinite(opts.staleMs) ? Number(opts.staleMs) : STALE_LEASE_MS;
  const age = leaseAgeMs(run, opts.now ?? Date.now());
  // A held lease with no readable timestamp cannot be shown to be alive; the
  // run would otherwise be unreachable forever, which is the worse failure.
  if (age === null) return true;
  return age > staleMs;
}

/**
 * Why a run was not claimable — for the slice report's `note` only.
 * @param {{phase_cursor?: unknown}} run
 * @returns {string}
 */
export function leaseNote(run) {
  return leaseActive(run && run.phase_cursor) ? "lease held" : "not claimable";
}

/**
 * The phase_cursor to write when claiming. Everything the run already recorded
 * is preserved — the cursor is how a resumed run knows where it was.
 *
 * @param {unknown} phaseCursor
 * @returns {Record<string, unknown>}
 */
export function claimCursor(phaseCursor) {
  const pc = phaseCursor && typeof phaseCursor === "object" && !Array.isArray(phaseCursor)
    ? /** @type {Record<string, unknown>} */ (phaseCursor)
    : {};
  return { ...pc, slice_active: true };
}

/**
 * The phase_cursor to write when releasing. Written over the cursor the slice
 * LAST checkpointed, never over the one it started from, so releasing the lease
 * cannot roll back the slice's own progress.
 *
 * @param {unknown} phaseCursor
 * @returns {Record<string, unknown>}
 */
export function releaseCursor(phaseCursor) {
  const pc = phaseCursor && typeof phaseCursor === "object" && !Array.isArray(phaseCursor)
    ? /** @type {Record<string, unknown>} */ (phaseCursor)
    : {};
  return { ...pc, slice_active: false };
}

/**
 * L2 — the compare-and-swap fragment for the claiming PATCH's query string.
 * `last_heartbeat_at` is a plain timestamptz column, so this is ordinary
 * PostgREST (`eq.` / `is.null`) and cannot be a syntax surprise in production.
 * The value is URL-encoded because an ISO timestamp's `+00:00` offset would
 * otherwise decode as a space.
 *
 * @param {string|null|undefined} lastHeartbeatAt the value the claimer READ
 * @returns {string}
 */
export function heartbeatGuard(lastHeartbeatAt) {
  if (typeof lastHeartbeatAt !== "string" || !lastHeartbeatAt) return "last_heartbeat_at=is.null";
  return `last_heartbeat_at=eq.${encodeURIComponent(lastHeartbeatAt)}`;
}

/**
 * L3/L4/L5 — run `work` under the lease: claim, work, release, always.
 *
 * Deliberately generic and effect-free: `claim`, `work`, `release` and the
 * reporters are injected, so the property that matters (the lease is released
 * on a normal exit AND on a thrown exit, and `work` never runs without a
 * successful claim) is a unit test rather than a code review.
 *
 * @template T
 * @param {{
 *   claim: () => Promise<boolean>|boolean,
 *   work: () => Promise<T>|T,
 *   release: () => Promise<unknown>|unknown,
 *   onUnavailable: () => T,
 *   onReleaseError?: (err: unknown) => void,
 * }} io
 * @returns {Promise<T>}
 */
export async function withLease(io) {
  const claimed = await io.claim();
  if (!claimed) return io.onUnavailable();
  try {
    return await io.work();
  } finally {
    try {
      await io.release();
    } catch (err) {
      // L5: the slice's result — or its exception — is the news. A release that
      // could not be written leaves a lease that STALE_LEASE_MS reclaims.
      if (io.onReleaseError) io.onReleaseError(err);
    }
  }
}
