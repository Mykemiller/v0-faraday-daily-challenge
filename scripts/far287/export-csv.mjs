// FAR-287 — Phase 6 CSV export. Writes exports/puzzle-bank-<run_id>.csv with
// headers matching the Airtable Puzzle Bank field NAMES exactly, for a manual/
// review import path. Reads validation_status='passed' rows.
//
// Usage: node scripts/far287/export-csv.mjs [--run <batch_id>]
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { writeFileSync, mkdirSync } from "node:fs";
import { sbSelect } from "./lib/clients.mjs";

const args = process.argv.slice(2);
const RUN = (() => { const i = args.indexOf("--run"); return i >= 0 ? args[i + 1] : null; })();

// Header order matches Airtable field names exactly. Public ID left blank (rotator-assigned).
const HEADERS = ["Puzzle Type", "Puzzle Name", "Go Live Date", "Status", "Published", "Puzzle Content", "Hint 1", "Hint 2", "Hint 3", "Answer Explanation", "Domain", "Sub-Domain", "Public ID"];
const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

async function main() {
  const filter = RUN ? `generation_batch_id=eq.${RUN}&` : "";
  const rows = await sbSelect("dc_puzzle_bank_staging", `${filter}validation_status=eq.passed&select=puzzle_type,puzzle_name,go_live_date,puzzle_content,hint_1,hint_2,hint_3,answer_explanation,domain,sub_domain&order=go_live_date.asc,puzzle_type.asc&limit=10000`);
  const lines = [HEADERS.map(esc).join(",")];
  for (const r of rows) {
    lines.push([
      r.puzzle_type, r.puzzle_name, r.go_live_date, "Draft", "Unpublished",
      JSON.stringify(r.puzzle_content), r.hint_1, r.hint_2, r.hint_3,
      r.answer_explanation || "", r.domain || "", r.sub_domain || "", "", // Public ID blank
    ].map(esc).join(","));
  }
  mkdirSync("exports", { recursive: true });
  const out = `exports/puzzle-bank-${RUN || "all"}.csv`;
  writeFileSync(out, lines.join("\n") + "\n");
  console.log(`wrote ${rows.length} rows → ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
