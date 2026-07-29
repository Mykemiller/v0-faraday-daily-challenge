// CC-DC-SUPABASE-SERVING-1.0 · Phase 5 — serving parity check.
//
// Runs BOTH puzzle-bank implementations (the real modules, live transport) and
// deep-compares their getLivePuzzles() and getSignalDropAnswer() outputs for
// the current Live set. Run this before flipping DC_PUZZLE_SOURCE=supabase.
//
//   node --experimental-default-type=module scripts/dc-migrate/parity-check.mjs
//
// Env: AIRTABLE_API_KEY + SUPABASE_SERVICE_ROLE_KEY (and the backfill must
// have imported the current Live rows into dc_puzzle_bank_staging).
//
// Comparison is DEEP EQUALITY, not byte equality: puzzle_content goes through
// Postgres jsonb on the supabase path, which canonicalizes object key order
// (and only key order — values are preserved). That reordering is the one
// expected, accepted delta class; any VALUE difference fails the check.
// Pilot run 2026-07-29 (real 7-type Live set, stubbed transport): all 7 types
// deep-equal + getSignalDropAnswer identical.

import assert from "node:assert/strict";

const LIB = new URL("../../src/lib/", import.meta.url);
const airtableBank = await import(new URL("airtable-puzzle-bank.js", LIB));
const supabaseBank = await import(new URL("supabase-puzzle-bank.js", LIB));

console.log("Fetching live set from both sources…");
const [atPuzzles, sbPuzzles] = await Promise.all([
  airtableBank.getLivePuzzles(),
  supabaseBank.getLivePuzzles(),
]);

const types = [...new Set([...Object.keys(atPuzzles), ...Object.keys(sbPuzzles)])].sort();
let failures = 0;
for (const t of types) {
  try {
    assert.deepEqual(sbPuzzles[t], atPuzzles[t]);
    console.log(`  ✓ ${t} — deep-equal (publicId ${sbPuzzles[t]?.__publicId})`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${t} — DELTA:\n${String(e.message).slice(0, 4000)}`);
  }
}

// The Signal Drop answer must be absent from BOTH payloads.
for (const [label, p] of [["airtable", atPuzzles], ["supabase", sbPuzzles]]) {
  const signal = p["Signal Drop"];
  if (!signal) continue;
  for (const f of ["word", "name", "answer", "solution"]) {
    assert.ok(!(f in signal), `${label} payload leaked Signal Drop "${f}"`);
  }
}

// Answer-lookup parity (exact-match against the live Signal Drop public id).
const sbSignal = sbPuzzles["Signal Drop"];
const [atAns, sbAns] = await Promise.all([
  airtableBank.getSignalDropAnswer({ publicId: sbSignal?.__publicId }),
  supabaseBank.getSignalDropAnswer({ publicId: sbSignal?.__publicId }),
]);
try {
  assert.deepEqual(sbAns, atAns);
  console.log(`  ✓ getSignalDropAnswer parity (${atAns?.publicId ?? "none"})`);
} catch (e) {
  failures++;
  console.log(`  ✗ getSignalDropAnswer DELTA:\n${String(e.message).slice(0, 1000)}`);
}

if (Object.keys(atPuzzles).length !== 7)
  console.warn(`⚠ airtable path yielded ${Object.keys(atPuzzles).length}/7 types`);
if (Object.keys(sbPuzzles).length !== 7)
  console.warn(`⚠ supabase path yielded ${Object.keys(sbPuzzles).length}/7 types`);

if (failures) {
  console.error(`\nPARITY FAILED — ${failures} delta(s). Do NOT flip DC_PUZZLE_SOURCE.`);
  process.exit(1);
}
console.log("\nPARITY OK — safe to flip DC_PUZZLE_SOURCE=supabase.");
