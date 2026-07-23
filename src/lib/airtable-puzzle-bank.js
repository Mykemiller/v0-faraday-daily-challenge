// Airtable Puzzle Bank client for the Faraday Daily Challenge.
//
// SERVER-SIDE ONLY. This module reads FARADAY_AIRTABLE_API_KEY from the
// environment and sends it as a Bearer token. Never import it into a client
// component or the key will be bundled and leaked — all access must go through
// the /api/challenge/today route handler.
//
// Source of record:
//   Base  appxfti7VuoHYUeu6  ("Faraday Intelligence")
//   Table tbliJaRmctbIWJC43  ("Faraday Puzzle Bank")
//
// The "live set" is the records whose `Published` single-select equals "Live"
// (one row per puzzle type per day). Each row carries a `Puzzle Content` field
// holding the puzzle as a JSON string in the exact shape the game components
// expect.
//
// Publish state machine (Published field): Unpublished → Published → Live →
// Retired. The Daily Puzzle Rotator (AUTO-128, /api/cron/rotate) promotes
// Published rows whose Go Live Date is today (America/Chicago) to Live at
// midnight Central, and retires the previous day's Live rows.

import { toPublicSignalPuzzle, normalizeWord } from "@/lib/signal-drop";

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

// Credential/base/table env names. The June-19 "engine-as-site" migration
// (FAR-119) consolidated all Airtable access in this project under the
// AIRTABLE_* names (see /api/lexicon). This helper predates that migration and
// historically read FARADAY_AIRTABLE_*; we now accept the canonical AIRTABLE_*
// names first and keep the FARADAY_* names as a legacy fallback so the rotator
// works against whichever is provisioned. (AUTO-128 root cause: prod provisions
// AIRTABLE_API_KEY but the helper only read FARADAY_AIRTABLE_API_KEY, so every
// write — and read — threw "not set".)
export const PUZZLE_BANK_BASE_ID =
  process.env.AIRTABLE_BASE_ID || process.env.FARADAY_AIRTABLE_BASE_ID || "appxfti7VuoHYUeu6";
export const PUZZLE_BANK_TABLE_ID =
  process.env.AIRTABLE_TABLE_ID || process.env.FARADAY_AIRTABLE_TABLE_ID || "tbliJaRmctbIWJC43";

// Field IDs (stable even if a curator renames the column). Used for selecting
// and reading fields from the response.
const FIELD = {
  puzzleType: "fldQ6d9fdAdE4bqkT",     // "Puzzle Type"  — e.g. "Rackl", "Signal Drop"
  puzzleName: "fld1Et18F9muU7nWl",     // "Puzzle Name"
  publicId:   "fldZjZgdcZkmjJWYC",     // "Public ID"   — share-facing unique puzzle id
  goLiveDate: "fldemR86qFJXwJe6g",     // "Go Live Date"
  status:     "fld7qyUy5UP7EoUVu",     // "Status"
  published:  "fldLzhFxNWLnvJlvW",     // "Published"  — single-select flag
  content:    "fldBNhNWxcig4j4D8",     // "Puzzle Content" — JSON string
};

// Field NAMES. Airtable's filterByFormula resolves {braces} by field name, not
// by field ID — using an ID here would silently match zero rows.
const FIELD_NAME = {
  published: "Published",
  goLiveDate: "Go Live Date",
};

// Canonical puzzle types, matching the game component keys exactly.
export const PUZZLE_TYPES = [
  "Rackl",
  "Signal Drop",
  "The Stack",
  "Circuit",
  "The Brief",
  "Dark Fiber",
  "Frequency",
];

class AirtableConfigError extends Error {}

function getApiKey() {
  const key = process.env.AIRTABLE_API_KEY || process.env.FARADAY_AIRTABLE_API_KEY;
  if (!key) {
    throw new AirtableConfigError(
      "Airtable API key is not set — set AIRTABLE_API_KEY (or legacy " +
        "FARADAY_AIRTABLE_API_KEY) so the Puzzle Bank can be reached."
    );
  }
  return key;
}

// Low-level: fetch records from the table with an optional Airtable filter
// formula. Returns the raw `records` array (each: { id, fields }).
async function fetchRecords({ filterByFormula, fields, maxRecords = 100, noStore = false } = {}) {
  const url = new URL(`${AIRTABLE_API_BASE}/${PUZZLE_BANK_BASE_ID}/${PUZZLE_BANK_TABLE_ID}`);
  // Return fields keyed by field ID so renames in Airtable don't break us.
  url.searchParams.set("returnFieldsByFieldId", "true");
  url.searchParams.set("maxRecords", String(maxRecords));
  if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
  if (fields) for (const f of fields) url.searchParams.append("fields[]", f);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    // Puzzles change at most daily; let the platform cache for an hour.
    // The rotator passes noStore so its reads always see current state.
    ...(noStore ? { cache: "no-store" } : { next: { revalidate: 3600 } }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airtable request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.records || [];
}

// Low-level: PATCH the Published state on a set of records. Airtable caps
// writes at 10 records per request, so updates are chunked. typecast lets
// Airtable accept the option name even if the select choice was renamed.
async function setPublishedState(recordIds, state) {
  const url = `${AIRTABLE_API_BASE}/${PUZZLE_BANK_BASE_ID}/${PUZZLE_BANK_TABLE_ID}`;
  for (let i = 0; i < recordIds.length; i += 10) {
    const chunk = recordIds.slice(i, i + 10);
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        typecast: true,
        records: chunk.map((id) => ({ id, fields: { [FIELD.published]: state } })),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Airtable update failed (${res.status}): ${body.slice(0, 300)}`);
    }
  }
}

// Parse one record's Puzzle Content JSON. Returns the parsed object, or null if
// the field is empty or not valid JSON (so one bad row never breaks the lobby).
function parsePuzzleContent(record) {
  const raw = record.fields?.[FIELD.content];
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Fetch the live puzzle set: the records with Published = "Live", one usable
// puzzle per type. Returns an object keyed by puzzle type, e.g.
//   { "Rackl": {...}, "Signal Drop": {...}, ... }
// Each puzzle object also carries `__publicId` — the bank's "Public ID" (the
// share-facing unique id; null when the curator hasn't set it yet) — so the
// share card can deep-link the shared result to the exact puzzle.
// Types whose row is missing or whose JSON won't parse are simply omitted, which
// lets the component fall back to its built-in mock for that single game.
export async function getLivePuzzles() {
  const records = await fetchRecords({
    filterByFormula: `{${FIELD_NAME.published}} = "Live"`,
    fields: [FIELD.puzzleType, FIELD.content, FIELD.publicId],
  });

  const puzzles = {};
  for (const record of records) {
    const type = record.fields?.[FIELD.puzzleType];
    if (!type || !PUZZLE_TYPES.includes(type)) continue;
    // First valid record per type wins; don't clobber with a later empty one.
    if (puzzles[type]) continue;
    const content = parsePuzzleContent(record);
    if (!content) continue;
    const rawId = record.fields?.[FIELD.publicId];
    const publicId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
    // Signal Drop's `word` (and its mirror `name`) IS the answer. Never ship it
    // to the browser pre-solve — strip it here, the single choke point between
    // Airtable and the client. Guesses are validated server-side via
    // /api/challenge/guess (which reads the answer through getSignalDropAnswer).
    // Every other type still ships its full content today (see FAR follow-up).
    const clientContent =
      type === "Signal Drop" ? toPublicSignalPuzzle(content) : content;
    puzzles[type] = { ...clientContent, __publicId: publicId };
  }
  return puzzles;
}

// SERVER-SIDE ONLY. Return the plaintext answer for today's live Signal Drop
// puzzle, so /api/challenge/guess can validate a guess without the answer ever
// reaching the client. When `publicId` is given, the exact live record is
// matched (so a guess is scored against the puzzle the player is actually
// looking at); otherwise the current live Signal Drop is used. Returns
// { word, publicId, wordLength } or null when no live Signal Drop exists.
export async function getSignalDropAnswer({ publicId } = {}) {
  const records = await fetchRecords({
    filterByFormula: `{${FIELD_NAME.published}} = "Live"`,
    fields: [FIELD.puzzleType, FIELD.content, FIELD.publicId],
  });
  const wanted = typeof publicId === "string" && publicId.trim() ? publicId.trim() : null;
  let fallback = null;
  for (const record of records) {
    if (record.fields?.[FIELD.puzzleType] !== "Signal Drop") continue;
    const content = parsePuzzleContent(record);
    const word = normalizeWord(content?.word);
    if (!word) continue;
    const rawId = record.fields?.[FIELD.publicId];
    const pid = typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
    const entry = { word, publicId: pid, wordLength: word.length };
    if (wanted && pid === wanted) return entry; // exact match wins
    if (!fallback) fallback = entry;
  }
  return fallback;
}

// Tip of the Day. There is no Tips table in this base today, so this returns
// null and the component falls back to its built-in tip. Kept as a seam so a
// Tips source can be wired in later without touching the route handler.
export async function getTipOfTheDay() {
  return null;
}

// Error thrown by rotateLiveSet that carries the failing step and the record
// ids it was acting on, so the cron route can log exactly what broke instead of
// a truncated "Rotation failed: …".
export class RotationError extends Error {
  constructor(step, recordIds, cause) {
    super(`Rotation step "${step}" failed: ${cause?.message || cause}`);
    this.name = "RotationError";
    this.step = step;
    this.recordIds = recordIds;
    this.cause = cause;
  }
}

// Daily rotation (AUTO-128). For the given serve day (YYYY-MM-DD in
// America/Chicago):
//   1. Promote: Published = "Published" AND Go Live Date = today      → "Live"
//   2. Retire:  Published = "Live"      AND Go Live Date < today      → "Retired"
//
// Promotion runs first so a failure partway never leaves the bank with no Live
// rows — worst case is a brief overlap that the hourly cache smooths over.
//
// Idempotency: both filters are self-correcting. Re-running the same day finds
// no "Published"-and-today rows to promote (they are already "Live") and no
// "Live"-and-before-today rows to retire (the prior set is already "Retired"),
// so a second run is a no-op — never a double-promote.
//
// Retire uses Go Live Date < today (strictly before), not ≠ today, so it can
// only ever retire the PRIOR live set — never today's rows, and never a
// future-dated row that was promoted early.
//
// Returns a summary the cron route reports for the health log.
export async function rotateLiveSet(todayISO) {
  const dateIsToday = `IS_SAME({${FIELD_NAME.goLiveDate}}, "${todayISO}", "day")`;
  // DATETIME_DIFF(goLiveDate, today, "days") < 0  ⇒ strictly before today,
  // day-granular so a row's time-of-day can't flip the comparison.
  const dateBeforeToday = `DATETIME_DIFF({${FIELD_NAME.goLiveDate}}, "${todayISO}", "days") < 0`;

  // 1. Promote today's approved-and-published set to Live.
  const toPromote = await fetchRecords({
    filterByFormula: `AND({${FIELD_NAME.published}} = "Published", ${dateIsToday})`,
    fields: [FIELD.puzzleType],
    noStore: true,
  });
  const promoteIds = toPromote.map((r) => r.id);
  try {
    await setPublishedState(promoteIds, "Live");
  } catch (cause) {
    throw new RotationError("promote", promoteIds, cause);
  }

  // 2. Retire the prior live set (Live rows dated strictly before today).
  const toRetire = await fetchRecords({
    filterByFormula: `AND({${FIELD_NAME.published}} = "Live", ${dateBeforeToday})`,
    fields: [FIELD.puzzleType],
    noStore: true,
  });
  const retireIds = toRetire.map((r) => r.id);
  try {
    await setPublishedState(retireIds, "Retired");
  } catch (cause) {
    throw new RotationError("retire", retireIds, cause);
  }

  const liveTypes = toPromote
    .map((r) => r.fields?.[FIELD.puzzleType])
    .filter((t) => PUZZLE_TYPES.includes(t));
  return {
    promoted: toPromote.length,
    retired: toRetire.length,
    promotedIds: promoteIds,
    retiredIds: retireIds,
    liveTypes,
    missingTypes: PUZZLE_TYPES.filter((t) => !liveTypes.includes(t)),
  };
}
