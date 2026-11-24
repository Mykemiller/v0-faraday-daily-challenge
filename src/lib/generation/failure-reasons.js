// CC-DC-GEN-FAILURE-VISIBILITY-1.0 — the one place generation decides WHY a
// puzzle failed, what that reason is CALLED, and how much of the underlying
// error text is allowed to leave this module.
//
// Root cause this module exists to kill: a League Office run could finish with
// 0 rows written and the commissioner had no way to see why. The worker's
// PostgREST helper truncated the error body at 200 chars and the per-item
// handler truncated the already-truncated string again, so the Postgres
// SQLSTATE and the constraint name — the only two facts that identify the
// fault — were routinely cut off before anyone read them. The run row carried
// an `error` string ONLY on failed_short, and the panel rendered counts alone.
//
// Invariants:
//   F1  PostgREST's `details` is NEVER returned, stored or rendered. On a
//       constraint violation Postgres puts the whole offending row in
//       `details` ("Failing row contains (…)"), which for this table means the
//       puzzle content, the hints and the answer key. `code`, `message`,
//       `hint` and the constraint NAME are safe and are what diagnose the
//       fault; `details` adds nothing but an answer leak.
//   F2  Reason KEYS are short, stable and bounded, so counts can be summed
//       across worker slices and compared between runs.
//   F3  Messages are scrubbed (F1) and length-capped before they are persisted
//       into phase_cursor or rendered in the panel.
//
// Pure: no I/O, no imports. Plain JS (not TS) for the same reason
// src/lib/generation/difficulty.js is — the deployed worker, the server-side
// status assembler and the client panel all share one vocabulary.
// Tests: src/lib/generation/failure-reasons.test.mjs (npm run test:generation-failures).

/** Cap for the structured Error message the worker throws and logs (D2). */
export const MAX_ERROR_MESSAGE = 500;
/** Cap for a message persisted in phase_cursor.last_failure / shown in the UI (D3). */
export const MAX_STORED_MESSAGE = 300;

// `"details":"…"` as it appears in a PostgREST body, including escaped quotes.
const DETAILS_JSON = /"details"\s*:\s*"(?:[^"\\]|\\.)*"/g;
// An UNTERMINATED details field — i.e. a body that was cut off inside the row
// dump. Everything from the field onwards goes, since there is no way to know
// where the value would have ended.
const DETAILS_OPEN = /"details"\s*:\s*"[\s\S]*$/;
// Postgres' row dump outside a details field. Greedy to end-of-string on
// purpose: an unparseable body must lose everything from here on, never a
// best-effort prefix of the failing row.
const FAILING_ROW = /Failing row contains[\s\S]*$/i;

/**
 * Remove anything that could carry row content, then cap the length.
 * Applied to EVERY message this module returns (F1/F3).
 *
 * @param {unknown} text
 * @param {number} [max]
 * @returns {string}
 */
export function clampMessage(text, max = MAX_STORED_MESSAGE) {
  const scrubbed = String(text ?? "")
    .replace(DETAILS_JSON, '"details":"[redacted]"')
    .replace(DETAILS_OPEN, '"details":"[redacted]"')
    .replace(FAILING_ROW, "[row redacted]")
    .replace(/\s+/g, " ")
    .trim();
  const limit = Number.isFinite(max) && max > 0 ? Math.trunc(max) : MAX_STORED_MESSAGE;
  return scrubbed.length > limit ? scrubbed.slice(0, limit) : scrubbed;
}

/** Short identifier-safe fragment for a reason key (F2). */
function slug(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

/**
 * The constraint NAME out of a Postgres message — the text inside the quotes
 * after the word `constraint`. The name alone is safe (it is schema, not data);
 * it is also the single most useful fact about a 23xxx failure.
 *
 * @param {unknown} message
 * @returns {string|null}
 */
function constraintFrom(message) {
  const m = /constraint\s+["']([^"']+)["']/i.exec(String(message ?? ""));
  return m ? m[1] : null;
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Parse a PostgREST error response into the facts worth keeping.
 *
 * `details` is deliberately absent from the return type — see F1. A body that
 * is not JSON (gateway HTML, a truncated payload) degrades to the scrubbed
 * body text as the message rather than being thrown away.
 *
 * @param {unknown} status HTTP status
 * @param {unknown} bodyText raw response body
 * @returns {{status: number|null, code: string|null, message: string, hint: string|null, constraint: string|null}}
 */
export function parsePostgrestError(status, bodyText) {
  const n = Number(status);
  const httpStatus = Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;

  let parsed = null;
  try {
    parsed = JSON.parse(String(bodyText ?? ""));
  } catch {
    parsed = null;
  }

  let code = null;
  let hint = null;
  let message = "";
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    code = str(parsed.code);
    hint = str(parsed.hint);
    message = str(parsed.message) ?? "";
    // NOTE: parsed.details is read by nothing, here or anywhere downstream.
  }
  if (!message) message = String(bodyText ?? "");

  const safe = clampMessage(message, MAX_ERROR_MESSAGE);
  return {
    status: httpStatus,
    code,
    message: safe,
    hint: hint ? clampMessage(hint, MAX_STORED_MESSAGE) : null,
    constraint: constraintFrom(safe),
  };
}

/**
 * The message the worker's Supabase error carries (D2):
 *   `Supabase <METHOD> <table> <status> <code> <message>`
 * Absent status/code render as `-` so the shape stays readable in a log grep.
 *
 * @param {unknown} method
 * @param {unknown} table
 * @param {{status?: number|null, code?: string|null, message?: string}} info
 * @returns {string}
 */
export function restErrorMessage(method, table, info) {
  const i = info && typeof info === "object" ? info : {};
  const head = [
    "Supabase",
    String(method ?? "GET").toUpperCase(),
    String(table ?? "-"),
    i.status ?? "-",
    i.code ?? "-",
  ].join(" ");
  const body = clampMessage(i.message, MAX_ERROR_MESSAGE);
  return clampMessage(body ? `${head} ${body}` : head, MAX_ERROR_MESSAGE);
}

/**
 * The stable short key for a failure reason (F2). The db key folds in the
 * SQLSTATE and the constraint name, which is what makes two runs' failures
 * comparable at a glance: `db:23514:dc_puzzle_bank_staging_difficulty_canon`.
 *
 * @param {string} kind one of: db, model, schema, hints, copy, subject-repeat,
 *   no-content, skip
 * @param {{code?: string|null, constraint?: string|null, status?: number|null}} [info]
 * @returns {string}
 */
export function failureKey(kind, info) {
  const i = info && typeof info === "object" ? info : {};
  const k = String(kind ?? "").trim().toLowerCase();
  switch (k) {
    case "db":
      return `db:${slug(i.code) || "-"}:${slug(i.constraint) || "-"}`;
    case "model": {
      const n = Number(i.status);
      return `model:${Number.isFinite(n) && n > 0 ? Math.trunc(n) : "error"}`;
    }
    case "schema":
    case "hints":
    case "copy":
    case "subject-repeat":
    case "no-content":
      return k;
    case "skip":
    case "skip:no-spec":
      return "skip:no-spec";
    default:
      return slug(k) || "other";
  }
}

/**
 * Merge two reason→count maps. The worker calls this on every checkpoint with
 * (what the DB already had, what THIS slice has seen so far), so a resumed run
 * accumulates across slices and a repeated checkpoint inside one slice is
 * idempotent rather than double-counting.
 *
 * @param {unknown} prev
 * @param {unknown} adds
 * @returns {Record<string, number>}
 */
export function mergeFailures(prev, adds) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const src of [prev, adds]) {
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    for (const [rawKey, rawCount] of Object.entries(src)) {
      const key = String(rawKey ?? "").trim();
      const n = Number(rawCount);
      if (!key || !Number.isFinite(n) || n <= 0) continue;
      out[key] = (out[key] ?? 0) + Math.trunc(n);
    }
  }
  return out;
}

/**
 * The `phase_cursor.last_failure` record (D3): the key, the message ONLY
 * (scrubbed, ≤300 chars) and when. Never content, hints, answer_key or details.
 *
 * @param {string} key
 * @param {unknown} message
 * @param {string} [at] ISO timestamp
 * @returns {{key: string, message: string, at: string}}
 */
export function lastFailureEntry(key, message, at) {
  return {
    key: String(key || "other"),
    message: clampMessage(message, MAX_STORED_MESSAGE),
    at: typeof at === "string" && at ? at : new Date().toISOString(),
  };
}

/**
 * The single most common reason in a counts map, plus how many OTHER distinct
 * reasons there were — exactly what the panel's one line needs.
 * Ties break alphabetically so the line does not flicker between polls.
 *
 * @param {unknown} counts
 * @returns {{key: string, count: number, others: number}|null}
 */
export function topFailure(counts) {
  const entries = Object.entries(mergeFailures(counts, null));
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { key: entries[0][0], count: entries[0][1], others: entries.length - 1 };
}

/**
 * Read the failure counts off a run's phase_cursor (jsonb — treat as unknown).
 * @param {unknown} phaseCursor
 * @returns {Record<string, number>}
 */
export function failuresFrom(phaseCursor) {
  const pc = phaseCursor && typeof phaseCursor === "object" ? phaseCursor : {};
  return mergeFailures(/** @type {Record<string, unknown>} */ (pc).failures, null);
}

/**
 * Read the last_failure off a run's phase_cursor, re-scrubbed on the way out so
 * a row written by any older build still cannot carry content to the client.
 * @param {unknown} phaseCursor
 * @returns {{key: string, message: string, at: string}|null}
 */
export function lastFailureFrom(phaseCursor) {
  const pc = phaseCursor && typeof phaseCursor === "object" ? phaseCursor : {};
  const lf = /** @type {Record<string, unknown>} */ (pc).last_failure;
  if (!lf || typeof lf !== "object" || Array.isArray(lf)) return null;
  const rec = /** @type {Record<string, unknown>} */ (lf);
  const key = str(rec.key);
  const message = clampMessage(rec.message, MAX_STORED_MESSAGE);
  if (!key && !message) return null;
  return {
    key: key ?? "other",
    message,
    at: str(rec.at) ?? "",
  };
}
