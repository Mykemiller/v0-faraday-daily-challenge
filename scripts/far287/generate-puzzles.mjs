// FAR-287 — Phase 3/4 generator. Reads the approved theme calendar + a cached
// corpus, generates 7 puzzles per themed day with 3 escalating hints, validates
// each, and writes Draft/Unpublished rows to dc_puzzle_bank_staging.
//
// Flags:
//   --dry-run           generate + validate, print samples, WRITE NOTHING (default off)
//   --pilot             only the first 10 themed days (70 records) then stop (Gate 2)
//   --limit N           cap themed days
//   --type "<name>"     only one game type
//   --resume <run_id>   skip (type, go_live_date) already written for that run
//   --themes-only       (no-op here; the calendar is built by build-calendar.mjs)
//   --refresh-corpus    rebuild the corpus snapshot before generating
//
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY,
//   AIRTABLE_API_KEY (for the existing-bank non-repeat check). Fails loud if absent.
//
// Reproducible: consumes exports/far287-calendar.json (seed-stamped). Idempotent:
//   unique(puzzle_type, go_live_date) + content_hash unique; re-runs skip existing.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sbInsert, sbSelect, sbUpdate, anthropicJson, GEN_MODEL, airtableGet } from "./lib/clients.mjs";
import { systemPrompt, userPrompt } from "./lib/prompts.mjs";
import {
  PUZZLE_TYPES, validateContent, answerKeyFrom, checkHints, copyViolations,
  contentHash, subjectFingerprint, parseModelJson,
} from "./lib/puzzle-schema.mjs";
import { buildCorpus, buildSubjectPool, CORPUS_PATH } from "./lib/corpus.mjs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DRY = has("--dry-run");
const PILOT = has("--pilot");
const LIMIT = PILOT ? 10 : Number(val("--limit", 0)) || Infinity;
const ONLY_TYPE = val("--type", null);
const RESUME = val("--resume", null);
const BATCH = Math.max(8, Math.min(12, Number(val("--batch", 10))));

const CAL = JSON.parse(readFileSync("exports/far287-calendar.json", "utf8"));
const days = CAL.calendar.slice(0, LIMIT);
const types = ONLY_TYPE ? [ONLY_TYPE] : PUZZLE_TYPES;

function parseArray(raw) {
  let s = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { const j = JSON.parse(s); return Array.isArray(j) ? j : [j]; } catch { /* salvage */ }
  // salvage: collect balanced top-level objects
  const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && start >= 0) { const o = parseModelJson(s.slice(start, i + 1)); if (o) out.push(o); } }
  }
  return out;
}

// difficulty bag per FAR-287 default 40/40/20 (deterministic per day index)
function difficultyFor(dayIdx, typeIdx) {
  const r = ((dayIdx * 7 + typeIdx) % 10);
  return r < 4 ? "easy" : r < 8 ? "medium" : "hard";
}

async function existingBankFingerprints() {
  // Non-repeat vs the LIVE Airtable bank: subject fingerprints of Approved/Live/Retired.
  // Best-effort — if Airtable read fails, we still dedupe within this run.
  const fps = new Map(); // type -> Set(fingerprint)
  try {
    const base = "appxfti7VuoHYUeu6", table = "tbliJaRmctbIWJC43";
    let cursor, pages = 0;
    do {
      const params = { pageSize: 100, "fields[]": ["Puzzle Type", "Puzzle Content"], returnFieldsByFieldId: "false" };
      if (cursor) params.offset = cursor;
      const data = await airtableGet(base, table, params);
      for (const r of data.records || []) {
        const type = r.fields?.["Puzzle Type"]; const raw = r.fields?.["Puzzle Content"];
        if (!type || typeof raw !== "string") continue;
        let content; try { content = JSON.parse(raw); } catch { continue; }
        (fps.get(type) || fps.set(type, new Set()).get(type)).add(subjectFingerprint(type, content));
      }
      cursor = data.offset; pages++;
    } while (cursor && pages < 10);
  } catch (err) { console.warn(`[non-repeat] Airtable read skipped: ${err.message}`); }
  return fps;
}

async function main() {
  console.log(`FAR-287 generate — model=${GEN_MODEL} dry=${DRY} pilot=${PILOT} days=${days.length} types=${types.join(",")} batch=${BATCH}`);
  if (has("--refresh-corpus") || !existsSync(CORPUS_PATH)) { console.log("building corpus cache…"); await buildCorpus(); }
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));

  // run bookkeeping
  const runId = RESUME || randomUUID();
  if (!DRY && !RESUME) await sbInsert("dc_puzzle_generation_runs",
    [{ id: runId, target_count: days.length * types.length, rotation_seed: CAL.seed, registry_version: CAL.registry_version, status: "running", params: { pilot: PILOT, model: GEN_MODEL } }]);

  const bankFps = await existingBankFingerprints();
  const runFps = new Map(); // type -> Set
  const seenHash = new Set();
  const already = new Set(); // `${type}|${date}` already in staging (resume/idempotency)
  if (!DRY) {
    const rows = await sbSelect("dc_puzzle_bank_staging", `select=puzzle_type,go_live_date&generation_batch_id=eq.${runId}`).catch(() => []);
    for (const r of rows || []) already.add(`${r.puzzle_type}|${r.go_live_date}`);
  }

  let written = 0, failed = 0; const failures = []; const samples = [];

  for (const type of types) {
    const fpSet = runFps.get(type) || runFps.set(type, new Set()).get(type);
    const bankSet = bankFps.get(type) || new Set();
    // build the batch of items for this type across days
    const items = [];
    days.forEach((day, di) => {
      if (already.has(`${type}|${day.theme_date}`)) return;
      const pool = buildSubjectPool(corpus, day); // ordered candidate subjects
      const subject = pool.length ? pool[(di + types.indexOf(type)) % pool.length] : day.sector_name;
      items.push({ day, di, subject,
        theme: { theater_name: day.theater_name, sector_name: day.sector_name, thread_names: day.thread_names,
          tier_name: (corpus.tier_names || {})[day.jpas_tier_code] || day.jpas_tier_code },
        difficulty: difficultyFor(di, types.indexOf(type)),
        threadScope: day.thread_names.join("; ") });
    });

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      let arr = [];
      try {
        const raw = await anthropicJson({ system: systemPrompt(type), user: userPrompt(type, batch), maxTokens: 4096 });
        arr = parseArray(raw);
      } catch (err) { batch.forEach((it) => { failed++; failures.push({ type, date: it.day.theme_date, error: `model: ${err.message}` }); }); continue; }

      for (let k = 0; k < batch.length; k++) {
        const it = batch[k]; const el = arr[k];
        const content = el?.puzzle, hints = el?.hints || [], expl = el?.answer_explanation || null;
        const fail = (msg) => { failed++; failures.push({ type, date: it.day.theme_date, error: msg }); };
        if (!content) { fail("no content parsed"); continue; }
        const v = validateContent(type, content); if (!v.ok) { fail("schema: " + v.errors.join("; ")); continue; }
        const answerKey = answerKeyFrom(type, content);
        const hv = checkHints(hints[0], hints[1], hints[2], answerKey); if (!hv.ok) { fail("hints: " + hv.errors.join("; ")); continue; }
        for (const s of [content.name, expl, ...hints]) { const cv = copyViolations(s); if (cv.length) { fail("copy: " + cv.join("; ")); break; } }
        if (failures.at(-1)?.date === it.day.theme_date && failures.at(-1)?.error.startsWith("copy")) continue;
        const fp = subjectFingerprint(type, content);
        if (fpSet.has(fp) || bankSet.has(fp)) { fail("subject repeat within window"); continue; }
        const hash = contentHash(content, answerKey);
        if (seenHash.has(hash)) { fail("content_hash collision"); continue; }
        fpSet.add(fp); seenHash.add(hash);

        const row = {
          theme_date: it.day.theme_date, puzzle_type: type,
          puzzle_name: content.name || `${it.day.sector_name} ${type}`, go_live_date: it.day.theme_date,
          status: "Draft", published: "Unpublished", puzzle_content: content,
          hint_1: hints[0], hint_2: hints[1], hint_3: hints[2],
          answer_key: answerKey, answer_explanation: expl,
          domain: it.day.sector_code, sub_domain: (it.day.thread_codes || [])[0] || null,
          theater_id: it.day.theater_id, jpas_tier_code: it.day.jpas_tier_code,
          difficulty: el.difficulty || it.difficulty, subject_fingerprint: fp,
          source_refs: { subject: it.subject, thread_codes: it.day.thread_codes },
          content_hash: hash, generation_batch_id: runId, generator_model: GEN_MODEL,
          validation_status: "passed",
        };
        if (DRY) { if (samples.length < 7) samples.push(row); written++; }
        else { try { await sbInsert("dc_puzzle_bank_staging", [row], "on_conflict=content_hash"); written++; }
               catch (err) { fail("db: " + err.message); } }
      }
      process.stdout.write(`\r${type}: ${Math.min(i + BATCH, items.length)}/${items.length} (written ${written}, failed ${failed})   `);
    }
    process.stdout.write("\n");
  }

  if (!DRY) await sbUpdate("dc_puzzle_generation_runs", `id=eq.${runId}`,
    { completed_at: new Date().toISOString(), written_count: written, failed_count: failed, status: PILOT ? "pilot_complete" : "complete" });

  mkdirSync("exports", { recursive: true });
  writeFileSync(`exports/far287-gen-report-${runId}.json`, JSON.stringify({ runId, model: GEN_MODEL, written, failed, failures, dry: DRY, pilot: PILOT }, null, 2));
  console.log(`\nrun ${runId}: written ${written}, failed ${failed}. report: exports/far287-gen-report-${runId}.json`);
  if (DRY) console.log(`DRY-RUN samples:\n` + samples.map((s) => `  ${s.go_live_date} ${s.puzzle_type} — ${s.puzzle_name} [${s.difficulty}] ans=${String(s.answer_key).slice(0, 40)}`).join("\n"));
  if (PILOT) console.log(`\n*** PILOT GATE: review the ${written} records above/in staging, then run the full generation. ***`);
}
main().catch((e) => { console.error(e); process.exit(1); });
