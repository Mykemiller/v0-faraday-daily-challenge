// Part D acceptance 9 — "Generation performs ZERO Airtable writes. Assert that
// no Airtable write method is reachable from this code path. Corpus reads are
// expected and must be present."
//
// Source-scan guard in the spirit of advisory-only.test.mjs: instead of trusting
// review to keep DEC-7 true, it fails the suite the moment an Airtable write
// (or a second Airtable access point) appears under src/lib/generation.
// Run: npm run test:generation-readonly

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE).filter((f) => /\.(ts|js|mjs)$/.test(f) && !f.includes(".test."));
const read = (f) => readFileSync(join(HERE, f), "utf8");

test("corpus.ts is the ONLY module that touches Airtable", () => {
  const touching = files.filter((f) => /api\.airtable\.com/.test(read(f)));
  assert.deepEqual(touching, ["corpus.ts"]);
});

test("the Airtable access is GET-only — no request method is ever set on it", () => {
  const src = read("corpus.ts");
  // corpus.ts's fetches pass only headers/cache; a `method:` anywhere in the
  // module means someone added a write (or a helper a write could reach).
  assert.doesNotMatch(src, /method\s*:/, "corpus.ts must never set a request method");
  assert.doesNotMatch(src, /airtablePatch|airtableCreate|typecast/i, "no Airtable write helper may exist here");
});

test("the corpus READ is present and the worker actually uses it", () => {
  assert.match(read("corpus.ts"), /api\.airtable\.com/);
  assert.match(read("corpus.ts"), /export async function buildCorpus/);
  const worker = read("worker.ts");
  assert.match(worker, /buildCorpus\(/, "a run that makes no corpus read is generating from nothing");
  // (comments may NAME Airtable; the API host is what must never appear)
  assert.doesNotMatch(worker, /api\.airtable\.com/, "the worker itself must not talk to Airtable");
});

test("the worker never writes public_id or Published state (DEC-6)", () => {
  const worker = read("worker.ts");
  assert.doesNotMatch(worker, /public_id\s*:/, "the assign-on-publish trigger is the only Public ID minter");
  assert.match(worker, /published:\s*"Unpublished"/, "generated rows land Unpublished");
  assert.doesNotMatch(worker, /published:\s*"(Published|Live|Retired)"/);
});
