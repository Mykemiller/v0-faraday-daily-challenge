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
// The "live set" is the small set of records whose `Published` single-select is
// set (currently one row per puzzle type). Each row carries a `Puzzle Content`
// field holding the puzzle as a JSON string in the exact shape the game
// components expect.

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

export const PUZZLE_BANK_BASE_ID = process.env.FARADAY_AIRTABLE_BASE_ID || "appxfti7VuoHYUeu6";
export const PUZZLE_BANK_TABLE_ID = process.env.FARADAY_AIRTABLE_TABLE_ID || "tbliJaRmctbIWJC43";

// Field IDs (stable even if a curator renames the column). Used for selecting
// and reading fields from the response.
const FIELD = {
  puzzleType: "fldQ6d9fdAdE4bqkT",     // "Puzzle Type"  — e.g. "Rackl", "Signal Drop"
  puzzleName: "fld1Et18F9muU7nWl",     // "Puzzle Name"
  goLiveDate: "fldemR86qFJXwJe6g",     // "Go Live Date"
  status:     "fld7qyUy5UP7EoUVu",     // "Status"
  published:  "fldLzhFxNWLnvJlvW",     // "Published"  — single-select flag
  content:    "fldBNhNWxcig4j4D8",     // "Puzzle Content" — JSON string
};

// Field NAMES. Airtable's filterByFormula resolves {braces} by field name, not
// by field ID — using an ID here would silently match zero rows.
const FIELD_NAME = {
  published: "Published",
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
  const key = process.env.FARADAY_AIRTABLE_API_KEY;
  if (!key) {
    throw new AirtableConfigError(
      "FARADAY_AIRTABLE_API_KEY is not set — cannot reach the Puzzle Bank."
    );
  }
  return key;
}

// Low-level: fetch records from the table with an optional Airtable filter
// formula. Returns the raw `records` array (each: { id, fields }).
async function fetchRecords({ filterByFormula, fields, maxRecords = 100 } = {}) {
  const url = new URL(`${AIRTABLE_API_BASE}/${PUZZLE_BANK_BASE_ID}/${PUZZLE_BANK_TABLE_ID}`);
  // Return fields keyed by field ID so renames in Airtable don't break us.
  url.searchParams.set("returnFieldsByFieldId", "true");
  url.searchParams.set("maxRecords", String(maxRecords));
  if (filterByFormula) url.searchParams.set("filterByFormula", filterByFormula);
  if (fields) for (const f of fields) url.searchParams.append("fields[]", f);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    // Puzzles change at most daily; let the platform cache for an hour.
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airtable request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.records || [];
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

// Fetch the live puzzle set: the records flagged `Published`, one usable puzzle
// per type. Returns an object keyed by puzzle type, e.g.
//   { "Rackl": {...}, "Signal Drop": {...}, ... }
// Types whose row is missing or whose JSON won't parse are simply omitted, which
// lets the component fall back to its built-in mock for that single game.
export async function getLivePuzzles() {
  const records = await fetchRecords({
    filterByFormula: `NOT({${FIELD_NAME.published}} = "")`,
    fields: [FIELD.puzzleType, FIELD.content],
  });

  const puzzles = {};
  for (const record of records) {
    const type = record.fields?.[FIELD.puzzleType];
    if (!type || !PUZZLE_TYPES.includes(type)) continue;
    // First valid record per type wins; don't clobber with a later empty one.
    if (puzzles[type]) continue;
    const content = parsePuzzleContent(record);
    if (content) puzzles[type] = content;
  }
  return puzzles;
}

// Tip of the Day. There is no Tips table in this base today, so this returns
// null and the component falls back to its built-in tip. Kept as a seam so a
// Tips source can be wired in later without touching the route handler.
export async function getTipOfTheDay() {
  return null;
}
