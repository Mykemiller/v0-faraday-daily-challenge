// Unit tests for the pure reset-season-scoring decision helpers.
//   node --test src/lib/league-office/scoring-reset-logic.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_REASON_LEN,
  RESET_SEASON_ACTION,
  validateResetReason,
  rpcErrorMessage,
  resetSuccessMessage,
} from "./scoring-reset-logic.mjs";

test("action string is stable", () => {
  assert.equal(RESET_SEASON_ACTION, "scoring.reset_season");
  assert.equal(MIN_REASON_LEN, 3);
});

test("validateResetReason enforces min-3 chars (trimmed)", () => {
  assert.equal(validateResetReason("").ok, false);
  assert.equal(validateResetReason("  ").ok, false);
  assert.equal(validateResetReason("ab").ok, false);
  assert.equal(validateResetReason("  x ").ok, false); // trims to "x"
  assert.equal(validateResetReason(null).ok, false);
  assert.equal(validateResetReason(42).ok, false);

  const ok = validateResetReason("  end of season wipe  ");
  assert.equal(ok.ok, true);
  assert.equal(ok.reason, "end of season wipe"); // trimmed
  assert.equal(ok.message, undefined);
});

test("rpcErrorMessage maps known RAISE tokens, hides the rest", () => {
  assert.match(rpcErrorMessage({ message: "no_active_season" }), /No active season/);
  assert.match(rpcErrorMessage({ message: "reason_too_short" }), /at least 3 characters/);
  assert.match(rpcErrorMessage({ message: "too_many_rows: 60000" }), /more than 50,000/);
  assert.match(rpcErrorMessage({ message: "staff_email_required" }), /Staff identity/);
  // Unknown / malformed → generic, no internals leaked.
  assert.equal(rpcErrorMessage({ message: "pg boom detail" }), "Reset failed — nothing was changed.");
  assert.equal(rpcErrorMessage(null), "Reset failed — nothing was changed.");
  assert.equal(rpcErrorMessage("nope"), "Reset failed — nothing was changed.");
});

test("resetSuccessMessage: real reset reports season + row count", () => {
  const msg = resetSuccessMessage({ noop: false, rows_affected: 96, season_name: "Season 2 — Post-YOTTA" });
  assert.match(msg, /Season 2 — Post-YOTTA/);
  assert.match(msg, /96 rows zeroed/);
  assert.match(msg, /Audit Log/);
});

test("resetSuccessMessage: singular row phrasing", () => {
  assert.match(resetSuccessMessage({ rows_affected: 1, season_name: "S" }), /1 row zeroed/);
});

test("resetSuccessMessage: idempotent no-op is a success, not an error", () => {
  const msg = resetSuccessMessage({ noop: true, season_name: "Season 2" });
  assert.match(msg, /Nothing to reset/);
  assert.match(msg, /already at zero/);
});

test("resetSuccessMessage: falls back when season name missing", () => {
  assert.match(resetSuccessMessage({ rows_affected: 0 }), /the active season/);
});
