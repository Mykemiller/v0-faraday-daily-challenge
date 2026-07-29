// CC-DC-SUPABASE-SERVING-1.0 · Phase 4 — backfill the Airtable Puzzle Bank
// into dc_puzzle_bank_staging (D7).
//
// Copies every bank row (base appxfti7VuoHYUeu6 / table tbliJaRmctbIWJC43)
// into staging PRESERVING its Public ID and published state, so score-card
// share links minted against Airtable keep resolving after cutover.
//
//   node scripts/dc-migrate/backfill-airtable-to-staging.mjs            # dry run (default)
//   node scripts/dc-migrate/backfill-airtable-to-staging.mjs --apply    # write to staging
//
// Env: AIRTABLE_API_KEY (legacy FARADAY_AIRTABLE_API_KEY honored),
//      SUPABASE_URL (defaults to prod), SUPABASE_SERVICE_ROLE_KEY (apply +
//      reconcile; the dry run works without it, Airtable-only).
//
// theme_date resolution (decided, see migration 20260729000001): historical
// rows predate the FAR-287 theme calendar (dc_daily_theme starts 2026-08-01),
// and synthetic theme rows were rejected because theme_title/theme_blurb are
// subscriber-facing editorial copy. Imported rows carry theme_date = NULL —
// the migration relaxed the column for rows with airtable_record_id set, and
// the dc_staging_import_or_complete CHECK keeps it required for generated rows.
//
// Idempotent: keyed on airtable_record_id (unique partial index). A re-run
// inserts only new bank rows, PATCHes rows whose content/state/public-id
// changed in Airtable since the last run, and skips the rest. content_hash is
// stable per (record id, content) so it doubles as the change detector.
//
// Also reports the max Public ID numeric suffix — the Phase-1 sequence
// (dc_public_id_seq) was seeded at 365 from the 2026-07-29 measurement; if the
// reported max ever reaches that, re-seed before cutover (the script prints
// the exact setval statement).

import { createHash } from "node:crypto";

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";
const BANK_BASE_ID = "appxfti7VuoHYUeu6";
const BANK_TABLE_ID = "tbliJaRmctbIWJC43";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";
const STAGING_TABLE = "dc_puzzle_bank_staging";

// Phase-1 sequence seed (see migration 20260729000001_dc_supabase_serving.sql).
const SEQUENCE_SEEDED_AT = 365;

// Fixed cohort id: every imported row shares one generation_batch_id so the
// import is queryable/reversible as a unit.
const IMPORT_BATCH_ID = "00000000-0000-4000-a000-202607290001";
const IMPORT_GENERATOR = "airtable-import-v1";

const PUZZLE_TYPES = ["Rackl", "Signal Drop", "The Stack", "Circuit", "The Brief", "Dark Fiber", "Frequency"];
const PUBLISHED_STATES = ["Unpublished", "Published", "Live", "Retired"];

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

const need = (v, name) => { if (!v) throw new Error(`env ${name} is required`); return v; };
const airtableKey = () => need(process.env.AIRTABLE_API_KEY || process.env.FARADAY_AIRTABLE_API_KEY, "AIRTABLE_API_KEY");
const serviceKey = () => need(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");

const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

// ── Airtable: page every bank row (name-keyed fields, same contract as day-content.ts)
async function fetchAllBankRecords() {
  const out = [];
  let offset;
  do {
    const url = new URL(`${AIRTABLE_API_BASE}/${BANK_BASE_ID}/${BANK_TABLE_ID}`);
    url.searchParams.set("pageSize", "100");
    for (const f of ["Puzzle Type", "Puzzle Name", "Public ID", "Go Live Date", "Status", "Published", "Puzzle Content", "Hint 1", "Hint 2", "Hint 3"]) {
      url.searchParams.append("fields[]", f);
    }
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${airtableKey()}` } });
    if (!res.ok) throw new Error(`Airtable GET failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    out.push(...(data.records || []));
    offset = data.offset;
  } while (offset && out.length < LIMIT);
  return out.slice(0, LIMIT === Infinity ? undefined : LIMIT);
}

// ── Map one Airtable record → one staging row (or a skip with a reason)
function mapRecord(record) {
  const f = record.fields || {};
  const type = str(f["Puzzle Type"]);
  const rawContent = str(f["Puzzle Content"]);
  const publicId = str(f["Public ID"]);
  const published = str(f["Published"]) || "Unpublished";

  if (!type || !PUZZLE_TYPES.includes(type)) return { skip: `unknown puzzle_type "${type}"` };
  if (!PUBLISHED_STATES.includes(published)) return { skip: `unknown published state "${published}"` };
  if (!rawContent) return { skip: "no Puzzle Content" };
  let content;
  try { content = JSON.parse(rawContent); } catch { return { skip: "Puzzle Content is not valid JSON" }; }
  if (!content || typeof content !== "object") return { skip: "Puzzle Content is not an object" };

  const name = str(f["Puzzle Name"]) || str(content.name) || publicId || record.id;
  const word = type === "Signal Drop" ? str(content.word) : null;

  return {
    row: {
      theme_date: null, // pre-theme-calendar rows; see header note
      puzzle_type: type,
      puzzle_name: name,
      go_live_date: str(f["Go Live Date"]), // null for drafts (the trigger requires it only at publish)
      status: str(f["Status"]) || "Draft",
      published,
      public_id: publicId, // preserved verbatim; the trigger never re-mints a non-null id
      puzzle_content: content,
      hint_1: str(f["Hint 1"]),
      hint_2: str(f["Hint 2"]),
      hint_3: str(f["Hint 3"]),
      answer_key: word ? word.toUpperCase() : null,
      answer_explanation: null, // field does not exist in Airtable yet (FAR-287 Phase-1 prereq)
      domain: null,
      sub_domain: null,
      subject_fingerprint: (str(content.name) || name).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      source_refs: { airtable: { base: BANK_BASE_ID, table: BANK_TABLE_ID, record: record.id } },
      content_hash: sha256Hex(`airtable:${record.id}\n${rawContent}\n${published}\n${publicId || ""}`),
      generation_batch_id: IMPORT_BATCH_ID,
      generator_model: IMPORT_GENERATOR,
      generated_at: record.createdTime || new Date().toISOString(),
      validation_status: "imported",
      airtable_record_id: record.id,
      synced_at: new Date().toISOString(),
    },
  };
}

// ── Supabase reconcile helpers
async function sbFetch(path, init = {}) {
  const key = serviceKey();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${init.method || "GET"} ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

async function fetchExistingImports() {
  const rows = await sbFetch(
    `${STAGING_TABLE}?airtable_record_id=not.is.null&select=airtable_record_id,content_hash,published,public_id&limit=2000`
  );
  return new Map(rows.map((r) => [r.airtable_record_id, r]));
}

// ── Main
const records = await fetchAllBankRecords();
console.log(`Fetched ${records.length} Airtable bank records.`);

const mapped = [];
const skips = [];
for (const record of records) {
  const result = mapRecord(record);
  if (result.skip) skips.push({ id: record.id, name: str(record.fields?.["Puzzle Name"]), reason: result.skip });
  else mapped.push(result.row);
}

// Public ID integrity + sequence safety
const suffixes = mapped
  .map((r) => r.public_id)
  .filter(Boolean)
  .map((id) => Number((id.match(/(\d{5})$/) || [])[1]))
  .filter(Number.isFinite);
const maxSuffix = suffixes.length ? Math.max(...suffixes) : 0;

const byState = {};
for (const r of mapped) byState[r.published] = (byState[r.published] || 0) + 1;

console.log(`\nMappable: ${mapped.length} · skipped: ${skips.length}`);
console.log(`By published state:`, byState);
console.log(`Rows with a Public ID: ${suffixes.length} · max numeric suffix: ${String(maxSuffix).padStart(5, "0")}`);
if (maxSuffix >= SEQUENCE_SEEDED_AT) {
  console.warn(
    `\n⚠ dc_public_id_seq was seeded at ${SEQUENCE_SEEDED_AT} but Airtable now has suffix ${maxSuffix}.` +
      `\n  Re-seed BEFORE approving/publishing anything in staging:` +
      `\n    select setval('public.dc_public_id_seq', ${maxSuffix + 1}, false);`
  );
}
for (const s of skips) console.log(`  skip ${s.id} (${s.name ?? "unnamed"}): ${s.reason}`);

// Duplicate (type, go_live_date) guard — the staging unique constraint would
// reject the second row; surface it here instead of dying mid-insert.
const seenTypeDate = new Map();
for (const r of mapped) {
  if (!r.go_live_date) continue;
  const k = `${r.puzzle_type}|${r.go_live_date}`;
  if (seenTypeDate.has(k)) console.warn(`⚠ duplicate (type, go_live_date): ${k} — ${seenTypeDate.get(k)} and ${r.airtable_record_id}`);
  else seenTypeDate.set(k, r.airtable_record_id);
}

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. Sample row:\n${JSON.stringify({ ...mapped[0], puzzle_content: "…" }, null, 2)}`);
  console.log(`\nRe-run with --apply to write to ${SUPABASE_URL}/${STAGING_TABLE}.`);
  process.exit(0);
}

// ── Apply: insert new, patch changed, skip unchanged (keyed on airtable_record_id)
const existing = await fetchExistingImports();
const toInsert = [];
const toPatch = [];
let unchanged = 0;
for (const row of mapped) {
  const prev = existing.get(row.airtable_record_id);
  if (!prev) toInsert.push(row);
  else if (prev.content_hash !== row.content_hash || prev.published !== row.published || prev.public_id !== row.public_id)
    toPatch.push(row);
  else unchanged++;
}
console.log(`\nAPPLY: insert ${toInsert.length} · update ${toPatch.length} · unchanged ${unchanged}`);

for (let i = 0; i < toInsert.length; i += 50) {
  const chunk = toInsert.slice(i, i + 50);
  await sbFetch(STAGING_TABLE, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(chunk),
  });
  console.log(`  inserted ${Math.min(i + 50, toInsert.length)}/${toInsert.length}`);
}

for (const row of toPatch) {
  const { airtable_record_id, ...patch } = row;
  await sbFetch(`${STAGING_TABLE}?airtable_record_id=eq.${encodeURIComponent(airtable_record_id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}
if (toPatch.length) console.log(`  patched ${toPatch.length}`);

// Post-check: counts by state + public-id coverage in staging.
const check = await sbFetch(
  `${STAGING_TABLE}?airtable_record_id=not.is.null&select=published,public_id&limit=2000`
);
const stateCounts = {};
let withId = 0;
for (const r of check) {
  stateCounts[r.published] = (stateCounts[r.published] || 0) + 1;
  if (r.public_id) withId++;
}
console.log(`\nStaging now holds ${check.length} imported rows (${withId} with a Public ID):`, stateCounts);
console.log("Done.");
