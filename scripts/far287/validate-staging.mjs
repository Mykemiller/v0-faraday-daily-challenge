// FAR-287 — Phase 5 validation + QA report over dc_puzzle_bank_staging.
// Runs the 9-point contract on every row, the round-trip render test, flips
// validation_status to 'passed'/'failed' (+ validation_errors), and writes a QA
// report. Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//
// Usage: node scripts/far287/validate-staging.mjs [--run <batch_id>] [--write]
//   --write   persist validation_status/errors back to Supabase (default: report only)

import { writeFileSync, mkdirSync } from "node:fs";
import { sbSelect, sbUpdate } from "./lib/clients.mjs";
import { validateContent, extractAnswer, answerKeyFrom, checkHints, copyViolations, PUZZLE_TYPES } from "./lib/puzzle-schema.mjs";

const args = process.argv.slice(2);
const RUN = (() => { const i = args.indexOf("--run"); return i >= 0 ? args[i + 1] : null; })();
const WRITE = args.includes("--write");
const WIN_START = "2026-08-01", WIN_END = "2027-12-13";

async function main() {
  const filter = RUN ? `generation_batch_id=eq.${RUN}&` : "";
  const rows = await sbSelect("dc_puzzle_bank_staging", `${filter}select=id,theme_date,puzzle_type,go_live_date,status,published,puzzle_content,hint_1,hint_2,hint_3,answer_key,answer_explanation,domain,sub_domain,theater_id,jpas_tier_code,content_hash,subject_fingerprint,airtable_record_id&limit=10000`);
  const themes = await sbSelect("dc_daily_theme", "select=theme_date,theater_id,sector_code,thread_codes,jpas_tier_code&limit=10000");
  const themeBy = Object.fromEntries((themes || []).map((t) => [t.theme_date, t]));
  const validTiers = new Set((await sbSelect("jpas_tiers", "select=tier_code")).map((t) => t.tier_code));
  const validSub = new Set((await sbSelect("faraday_subdomains", "select=subdomain_code")).map((s) => s.subdomain_code));

  const perDate = {}; const seenHash = new Map(); const seenTypeDate = new Set(); const perTypeFp = {};
  for (const r of rows) { (perDate[r.theme_date] ??= []).push(r.puzzle_type); }

  const results = []; let pass = 0, fail = 0;
  for (const r of rows) {
    const e = [];
    const c = r.puzzle_content;
    // 1 schema
    const v = validateContent(r.puzzle_type, c); if (!v.ok) e.push("schema: " + v.errors.join("; "));
    // 2 hints
    const hv = checkHints(r.hint_1, r.hint_2, r.hint_3, r.answer_key); if (!hv.ok) e.push("hints: " + hv.errors.join("; "));
    // 3 answer_key derivable + matches
    const ak = answerKeyFrom(r.puzzle_type, c);
    if (!ak) e.push("answer_key: not derivable"); else if (ak !== r.answer_key) e.push("answer_key: mismatch vs stored");
    // 4 hash/fingerprint uniqueness
    if (seenHash.has(r.content_hash)) e.push("content_hash: duplicate"); else seenHash.set(r.content_hash, r.id);
    const fpKey = `${r.puzzle_type}`; (perTypeFp[fpKey] ??= new Map());
    if (perTypeFp[fpKey].has(r.subject_fingerprint)) e.push("subject_fingerprint: repeat for type"); else perTypeFp[fpKey].set(r.subject_fingerprint, r.theme_date);
    // 5 go_live uniqueness per type + window
    const td = `${r.puzzle_type}|${r.go_live_date}`; if (seenTypeDate.has(td)) e.push("go_live_date: duplicate per type"); else seenTypeDate.add(td);
    if (r.go_live_date < WIN_START || r.go_live_date > WIN_END) e.push("go_live_date: outside window");
    if (r.go_live_date !== r.theme_date) e.push("go_live_date != theme_date");
    // 6 draft/unpublished, no public id
    if (r.status !== "Draft") e.push("status != Draft");
    if (r.published !== "Unpublished") e.push("published != Unpublished");
    if (r.airtable_record_id) e.push("has airtable_record_id (should be unset pre-sync)");
    // 7 taxonomy resolves + matches theme
    const th = themeBy[r.theme_date];
    if (!th) e.push("no dc_daily_theme row for date");
    else {
      if (r.theater_id !== th.theater_id) e.push("theater_id != theme");
      if (r.domain !== th.sector_code) e.push("domain(sector) != theme");
      if (r.jpas_tier_code !== th.jpas_tier_code) e.push("jpas_tier != theme");
      if (r.sub_domain && !(th.thread_codes || []).includes(r.sub_domain)) e.push("sub_domain not in theme threads");
    }
    if (!validTiers.has(r.jpas_tier_code)) e.push("jpas_tier not in jpas_tiers");
    if (r.sub_domain && !validSub.has(r.sub_domain)) e.push("sub_domain not in faraday_subdomains");
    // 9 copy compliance
    for (const [f, txt] of [["name", c?.name], ["explanation", r.answer_explanation], ["hint_1", r.hint_1], ["hint_2", r.hint_2], ["hint_3", r.hint_3]]) {
      const cv = copyViolations(txt); if (cv.length) e.push(`copy[${f}]: ${cv.join(",")}`);
    }
    // round-trip render test
    if (!extractAnswer(r.puzzle_type, c)) e.push("round-trip: extractAnswer null");

    const status = e.length ? "failed" : "passed";
    if (status === "passed") pass++; else fail++;
    results.push({ id: r.id, date: r.theme_date, type: r.puzzle_type, status, errors: e });
  }
  // 8 exactly 7 per themed date
  const partialDays = Object.entries(perDate).filter(([, ts]) => new Set(ts).size !== 7 || ts.length !== 7).map(([d]) => d);

  // persist
  if (WRITE) {
    for (const r of results) await sbUpdate("dc_puzzle_bank_staging", `id=eq.${r.id}`, { validation_status: r.status, validation_errors: r.errors.length ? r.errors : null });
    console.log(`persisted validation_status for ${results.length} rows`);
  }

  // QA report
  const byType = {}, byDiff = {}, byCov = {};
  for (const r of rows) { byType[r.puzzle_type] = (byType[r.puzzle_type] || 0) + 1; }
  mkdirSync("exports", { recursive: true });
  const failList = results.filter((r) => r.status === "failed");
  const md = [`# FAR-287 — QA report${RUN ? ` (run ${RUN})` : ""}`, "",
    `- Rows: **${rows.length}**  ·  passed **${pass}**  ·  failed **${fail}**`,
    `- Dates with != 7 puzzles: **${partialDays.length}**${partialDays.length ? " — " + partialDays.slice(0, 20).join(", ") : ""}`,
    `- Per type: ${PUZZLE_TYPES.map((t) => `${t}:${byType[t] || 0}`).join(" · ")}`,
    "", "## Failures (first 60)", "",
    ...failList.slice(0, 60).map((r) => `- ${r.date} ${r.type}: ${r.errors.join("; ")}`)];
  writeFileSync(`exports/far287-qa${RUN ? "-" + RUN : ""}.md`, md.join("\n") + "\n");
  console.log(`rows ${rows.length} · pass ${pass} · fail ${fail} · partial-days ${partialDays.length}`);
  console.log(`report: exports/far287-qa${RUN ? "-" + RUN : ""}.md`);
  if (fail || partialDays.length) process.exitCode = 2;
}
main().catch((e) => { console.error(e); process.exit(1); });
