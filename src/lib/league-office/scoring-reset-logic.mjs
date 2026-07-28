// League Office — pure decision helpers for the "reset season scoring" action.
// No I/O, no imports — safe to unit-test under `node --test`. Shared by the
// server action (write.ts) so the tested contract IS the shipped contract.

/** Minimum length for the operator-supplied reason (spec: REQUIRED, min 3). */
export const MIN_REASON_LEN = 3;

/** The action string the client posts and the server switch dispatches on. */
export const RESET_SEASON_ACTION = "scoring.reset_season";

/**
 * Validate the operator reason.
 * @param {unknown} reason
 * @returns {{ ok: boolean, reason: string, message?: string }}
 */
export function validateResetReason(reason) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length < MIN_REASON_LEN)
    return { ok: false, reason: trimmed, message: "A reason of at least 3 characters is required." };
  return { ok: true, reason: trimmed };
}

/**
 * Map a PostgREST/RPC error body to a safe, operator-facing message. The RPC
 * signals failures with bare tokens via RAISE EXCEPTION; anything unrecognized
 * collapses to a generic "nothing changed" so we never leak internals.
 * @param {unknown} body
 * @returns {string}
 */
export function rpcErrorMessage(body) {
  const m = (body && typeof body === "object" && "message" in body
    ? String(/** @type {{message?: unknown}} */ (body).message ?? "")
    : "");
  if (m.includes("no_active_season")) return "No active season to reset.";
  if (m.includes("reason_too_short")) return "A reason of at least 3 characters is required.";
  if (m.includes("too_many_rows")) return "Aborted: the reset would affect more than 50,000 rows — reported, not run.";
  if (m.includes("staff_email_required")) return "Staff identity is missing — sign in again.";
  return "Reset failed — nothing was changed.";
}

/**
 * Build the success toast from the RPC result. `noop` (already-zero) is a
 * success, not an error — it just says nothing changed.
 * @param {{ noop?: boolean, rows_affected?: number, season_name?: string }} res
 * @returns {string}
 */
export function resetSuccessMessage(res) {
  const seasonName = res?.season_name ?? "the active season";
  if (res?.noop) return `Nothing to reset — ${seasonName} scoring is already at zero.`;
  const n = res?.rows_affected ?? 0;
  return `${seasonName} scoring reset to zero — ${n} row${n === 1 ? "" : "s"} zeroed, logged to Audit Log.`;
}
