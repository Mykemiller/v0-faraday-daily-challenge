#!/usr/bin/env node
// faraday-masthead · check-drift.mjs (FDY-444). Run in each app's CI against its vendored copy:
//   node lib/faraday-masthead/check-drift.mjs [--canonical <path-to-canonical-package-dir-or-VERSION-url>]
// 1. Every file listed in MANIFEST.json exists and matches its sha256 (nobody edited the vendored copy).
// 2. VERSION equals MANIFEST.version.
// 3. With --canonical, VERSION also equals the canonical VERSION (a path, or an https URL to the raw VERSION file).
//    A network failure on the URL form warns but does not fail (CI without egress stays green on checks 1-2).
// Plain Node (no dependencies, no TypeScript). Exit 0 = clean, 1 = drift.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const problems = [];
const read = (rel) => fs.readFileSync(path.join(DIR, rel));
let manifest;
try { manifest = JSON.parse(read("MANIFEST.json").toString("utf8")); }
catch (e) { console.error(`faraday-masthead drift: cannot read MANIFEST.json (${e.message})`); process.exit(1); }

const version = fs.existsSync(path.join(DIR, "VERSION")) ? read("VERSION").toString("utf8").trim() : "(missing)";
if (version !== manifest.version) problems.push(`VERSION is ${version}, MANIFEST says ${manifest.version}`);
for (const [rel, want] of Object.entries(manifest.files || {})) {
  if (!fs.existsSync(path.join(DIR, rel))) { problems.push(`missing ${rel}`); continue; }
  const got = crypto.createHash("sha256").update(read(rel)).digest("hex");
  if (got !== want) problems.push(`${rel} differs from the canonical ${manifest.version} copy`);
}

const i = process.argv.indexOf("--canonical");
if (i > 0 && process.argv[i + 1]) {
  const ref = process.argv[i + 1];
  let canonical = null;
  try {
    if (/^https?:\/\//.test(ref)) {
      const r = await fetch(ref, { signal: AbortSignal.timeout(5000) });
      if (r.ok) canonical = (await r.text()).trim(); else console.warn(`faraday-masthead drift: canonical VERSION fetch returned ${r.status}; skipped`);
    } else {
      const p = fs.statSync(ref).isDirectory() ? path.join(ref, "VERSION") : ref;
      canonical = fs.readFileSync(p, "utf8").trim();
    }
  } catch (e) { console.warn(`faraday-masthead drift: could not read canonical VERSION (${e.message}); skipped`); }
  if (canonical && canonical !== version) problems.push(`vendored ${version}, canonical is ${canonical}: re-vendor`);
}

if (problems.length) { console.error("faraday-masthead drift:\n  " + problems.join("\n  ")); process.exit(1); }
console.log(`faraday-masthead ${version}: vendored copy matches its manifest`);
