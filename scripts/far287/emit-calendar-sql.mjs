// Emit batched INSERT SQL for dc_daily_theme from exports/far287-calendar.json.
// Usage: node scripts/far287/emit-calendar-sql.mjs <run_id> <outDir> [batchSize]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [runId, outDir, batchSizeArg] = process.argv.slice(2);
if (!runId || !outDir) { console.error("need <run_id> <outDir>"); process.exit(1); }
const BATCH = Number(batchSizeArg || 100);

const cal = JSON.parse(readFileSync("exports/far287-calendar.json", "utf8")).calendar;
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const arr = (a) => "ARRAY[" + a.map(q).join(",") + "]::text[]";

const cols = "(theme_date,theater_id,theater_name,sector_code,sector_name,thread_codes,thread_names,jpas_tier_code,theme_title,theme_blurb,maturity_grade,coverage_grade,rotation_seed,registry_version,generation_run_id)";
let files = 0;
for (let i = 0; i < cal.length; i += BATCH) {
  const rows = cal.slice(i, i + BATCH).map((d) => "(" + [
    q(d.theme_date), q(d.theater_id), q(d.theater_name), q(d.sector_code), q(d.sector_name),
    arr(d.thread_codes), arr(d.thread_names), q(d.jpas_tier_code), q(d.theme_title), q(d.theme_blurb),
    q(d.maturity_grade), q(d.coverage_grade), q(d.rotation_seed), q(d.registry_version), q(runId) + "::uuid",
  ].join(",") + ")").join(",\n");
  const sql = `insert into public.dc_daily_theme ${cols} values\n${rows}\non conflict (theme_date) do nothing;\n`;
  const n = String(++files).padStart(2, "0");
  writeFileSync(join(outDir, `dc_daily_theme_batch_${n}.sql`), sql);
}
console.log(`wrote ${files} batch file(s) of up to ${BATCH} rows to ${outDir}`);
