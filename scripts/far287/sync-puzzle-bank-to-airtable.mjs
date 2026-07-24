// FAR-287 — Phase 6 Airtable sync (BUILD ONLY; DRY-RUN BY DEFAULT — never bulk-
// writes Airtable unless --execute is passed AND the write gate is lifted).
//
// Reads dc_puzzle_bank_staging WHERE validation_status='passed' AND
// airtable_record_id IS NULL, and creates rows in the Airtable Puzzle Bank in
// batches of 10, then stamps airtable_record_id + synced_at back in Supabase.
// Idempotent: synced rows (airtable_record_id set) are skipped on re-run.
//
// Everything lands Status=Draft / Published=Unpublished. Public ID is NEVER set.
// "Answer Explanation" / "Domain" / "Sub-Domain" are Phase-1 prerequisites Myke
// adds in Airtable; they are SKIPPED (and logged) unless --with-optional is given.
//
// Usage: node scripts/far287/sync-puzzle-bank-to-airtable.mjs [--execute] [--with-optional] [--limit N]
//   (default is dry-run: prints exactly what WOULD be created, writes nothing.)
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and (only with --execute) AIRTABLE_API_KEY.

import { sbSelect, sbUpdate, airtableCreate } from "./lib/clients.mjs";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");       // dry-run unless explicitly set
const WITH_OPTIONAL = args.includes("--with-optional");
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 ? Number(args[i + 1]) : 0; })();

const BASE = "appxfti7VuoHYUeu6", TABLE = "tbliJaRmctbIWJC43";

function toFields(r) {
  const f = {
    "Puzzle Type": r.puzzle_type,
    "Puzzle Name": r.puzzle_name,
    "Go Live Date": r.go_live_date,
    "Status": "Draft",
    "Published": "Unpublished",
    "Puzzle Content": JSON.stringify(r.puzzle_content),
    "Hint 1": r.hint_1, "Hint 2": r.hint_2, "Hint 3": r.hint_3,
  };
  if (WITH_OPTIONAL) {
    if (r.answer_explanation) f["Answer Explanation"] = r.answer_explanation;
    // Domain / Sub-Domain are linked-record fields; skipped here (need record ids).
  }
  return f; // Public ID intentionally omitted (rotator-assigned).
}

async function main() {
  const q = `validation_status=eq.passed&airtable_record_id=is.null&select=id,puzzle_type,puzzle_name,go_live_date,puzzle_content,hint_1,hint_2,hint_3,answer_explanation&order=go_live_date.asc${LIMIT ? `&limit=${LIMIT}` : ""}`;
  const rows = await sbSelect("dc_puzzle_bank_staging", q);
  if (!WITH_OPTIONAL) console.log(`[skip] "Answer Explanation" / "Domain" / "Sub-Domain" not synced (Phase-1 prerequisites; pass --with-optional once the columns exist).`);
  console.log(`${rows.length} passed rows pending sync. Mode: ${EXECUTE ? "EXECUTE (WRITES AIRTABLE)" : "DRY-RUN (no writes)"}.`);
  if (!rows.length) return;

  if (!EXECUTE) {
    console.log("Sample of what would be created (first 3):");
    for (const r of rows.slice(0, 3)) console.log("  " + JSON.stringify(toFields(r)).slice(0, 200) + "…");
    console.log(`\nDRY-RUN complete. To actually sync (only after the Airtable write gate is lifted):\n  node scripts/far287/sync-puzzle-bank-to-airtable.mjs --execute`);
    return;
  }

  let created = 0;
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10);
    const res = await airtableCreate(BASE, TABLE, batch.map((r) => ({ fields: toFields(r) })));
    const now = new Date().toISOString();
    for (let k = 0; k < batch.length; k++) {
      const recId = res.records?.[k]?.id;
      if (recId) { await sbUpdate("dc_puzzle_bank_staging", `id=eq.${batch[k].id}`, { airtable_record_id: recId, synced_at: now }); created++; }
    }
    process.stdout.write(`\rsynced ${Math.min(i + 10, rows.length)}/${rows.length}   `);
  }
  console.log(`\ncreated ${created} Airtable records (Draft/Unpublished).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
