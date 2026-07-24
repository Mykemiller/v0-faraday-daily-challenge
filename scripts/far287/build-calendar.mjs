// FAR-287 — Build the seed-reproducible 500-day theme calendar.
//
// Pure/deterministic (seeded PRNG, no network). Reads the cached taxonomy
// snapshot (scripts/far287/idf-taxonomy-snapshot.json) and emits:
//   exports/far287-calendar.json   — 500 day rows (full tuple + public copy)
//   exports/far287-calendar.csv
//   docs/far287-calendar-review.md — balance + constraint verification (review gate)
//
// Rotation rules (FAR-287 §"Rotation rules", with Myke's Phase-0 rulings):
//   • Draw Theater → Sector (carries Theater tag) → Thread(s) → JPAS tier.
//   • Balanced: no Theater > 1.3× mean; every Sector ≥ 12, EXCEPT single-Theater
//     Sectors (D16, D18) whose floor is 9 (ruling: relax floor to 9).
//   • No Theater repeat within 4 days; no Sector repeat within 14 days.
//   • No exact (Theater, Sector, tier) triple repeat ever (guaranteed: unique select).
//   • Candidate Threads excluded (already absent from snapshot pairs).
//   • Down-weight Whitespace coverage (prefer Dedicated > Broad-only > Whitespace).
//   • Seed persisted so the calendar is reproducible.
//
// Usage: node scripts/far287/build-calendar.mjs [--seed <str>] [--start YYYY-MM-DD]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

// ── config ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const SEED = getArg("--seed", "far287-v1");
const START = getArg("--start", "2026-08-01"); // day after global MAX Go Live Date (2026-07-31)
const DAYS = 500;
const REGISTRY_VERSION = "IDF 4.0";
const RELAXED_FLOOR_SECTORS = new Set(["D16", "D18"]); // single-Theater → floor 9
const SECTOR_FLOOR = 12, RELAXED_FLOOR = 9;
const COVERAGE_RANK = { Dedicated: 3, "Broad-only": 2, Whitespace: 1 };

// ── seeded PRNG (mulberry32 seeded via a string hash) ──────────────────────────
function xmur3(str) { let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; }; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function rngFrom(seedStr) { const s = xmur3(seedStr); return mulberry32(s()); }
const rand = rngFrom(SEED);
const randint = (n) => Math.floor(rand() * n);
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = randint(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ── date helper (UTC-safe, no Date.now) ────────────────────────────────────────
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// ── load snapshot ───────────────────────────────────────────────────────────────
const snap = JSON.parse(readFileSync(join(HERE, "idf-taxonomy-snapshot.json"), "utf8"));
const theaterName = Object.fromEntries(snap.theaters.map((t) => [t.id, t.name]));
const theaterTagline = Object.fromEntries(snap.theaters.map((t) => [t.id, t.tagline]));
const sectorName = snap.sectors;
const tiers = snap.jpas_tiers.map((t) => t.code);
const threadByCode = Object.fromEntries(snap.threads.map((t) => [t.code, t]));
const pairs = snap.pairs; // {theater_id, sector_code, threads[], best_coverage}
const pairKey = (t, s) => `${t}|${s}`;
const pairMap = Object.fromEntries(pairs.map((p) => [pairKey(p.theater_id, p.sector_code), p]));

const THEATERS = snap.theaters.map((t) => t.id);
const SECTORS = [...new Set(pairs.map((p) => p.sector_code))];
const sectorTheaters = {}; for (const p of pairs) (sectorTheaters[p.sector_code] ??= []).push(p.theater_id);
const floorFor = (s) => (RELAXED_FLOOR_SECTORS.has(s) ? RELAXED_FLOOR : SECTOR_FLOOR);
const sectorCapacity = (s) => sectorTheaters[s].length * tiers.length;

// ── Phase A: select 500 unique (theater, sector, tier) triples, balanced ────────
const mean = DAYS / THEATERS.length;
const THEATER_CAP = Math.floor(mean * 1.3); // 92

// theater targets: T-007 takes its full (small) pool; spread the rest evenly under cap/capacity
const theaterCapacity = {}; for (const t of THEATERS) theaterCapacity[t] = pairs.filter((p) => p.theater_id === t).length * tiers.length;
function computeTargets() {
  const tgt = {}; let remaining = DAYS;
  // give smallest-capacity theaters their full capacity first (they can't reach mean)
  const order = [...THEATERS].sort((a, b) => theaterCapacity[a] - theaterCapacity[b]);
  let left = THEATERS.length;
  for (const t of order) {
    const fairShare = Math.round(remaining / left);
    const cap = Math.min(THEATER_CAP, theaterCapacity[t]);
    tgt[t] = Math.min(fairShare, cap);
    remaining -= tgt[t]; left--;
  }
  // distribute any rounding remainder to theaters with headroom
  let idx = 0; const cyc = [...THEATERS].sort((a, b) => theaterCapacity[b] - theaterCapacity[a]);
  while (remaining !== 0) {
    const t = cyc[idx % cyc.length]; idx++;
    const cap = Math.min(THEATER_CAP, theaterCapacity[t]);
    if (remaining > 0 && tgt[t] < cap) { tgt[t]++; remaining--; }
    else if (remaining < 0 && tgt[t] > 0) { tgt[t]--; remaining++; }
    if (idx > 10000) break;
  }
  return tgt;
}
const target = computeTargets();

const selected = []; // {theater, sector, tier}
const usedTriple = new Set();
const tcount = Object.fromEntries(THEATERS.map((t) => [t, 0]));
const scount = Object.fromEntries(SECTORS.map((s) => [s, 0]));

// available tiers per pair (shuffled for seeded variety)
const pairTiers = {}; for (const p of pairs) pairTiers[pairKey(p.theater_id, p.sector_code)] = shuffle(tiers);
function takeTriple(theater, sector) {
  const key = pairKey(theater, sector);
  for (const tier of pairTiers[key]) {
    const trip = `${theater}|${sector}|${tier}`;
    if (!usedTriple.has(trip)) {
      usedTriple.add(trip);
      selected.push({ theater, sector, tier });
      tcount[theater]++; scount[sector]++;
      return true;
    }
  }
  return false;
}
// theaters for a sector, ordered by preference: under target, lowest count, higher coverage
function theatersForSector(sector, allowCap) {
  return sectorTheaters[sector]
    .filter((t) => (allowCap ? tcount[t] < THEATER_CAP : tcount[t] < target[t]))
    .filter((t) => pairTiers[pairKey(t, sector)].some((tier) => !usedTriple.has(`${t}|${sector}|${tier}`)))
    .sort((a, b) => tcount[a] - tcount[b]
      || COVERAGE_RANK[pairMap[pairKey(b, sector)].best_coverage] - COVERAGE_RANK[pairMap[pairKey(a, sector)].best_coverage]);
}

// Phase A1 — satisfy sector floors (hardest-capacity sectors first)
for (const sector of [...SECTORS].sort((a, b) => sectorCapacity(a) - sectorCapacity(b))) {
  while (scount[sector] < floorFor(sector)) {
    let ts = theatersForSector(sector, false);
    if (!ts.length) ts = theatersForSector(sector, true); // relax target→cap if needed
    if (!ts.length) break; // sector exhausted (shouldn't happen; capacity ≥ floor)
    takeTriple(ts[0], sector);
  }
}
// Phase A2 — fill to 500: pick most-under-target theater, then its lowest-count sector, prefer coverage
while (selected.length < DAYS) {
  const theatersByDeficit = THEATERS
    .filter((t) => tcount[t] < target[t])
    .sort((a, b) => (target[b] - tcount[b]) - (target[a] - tcount[a]));
  let placed = false;
  for (const t of theatersByDeficit) {
    const secs = pairs.filter((p) => p.theater_id === t)
      .filter((p) => pairTiers[pairKey(t, p.sector_code)].some((tier) => !usedTriple.has(`${t}|${p.sector_code}|${tier}`)))
      .sort((a, b) => scount[a.sector_code] - scount[b.sector_code]
        || COVERAGE_RANK[b.best_coverage] - COVERAGE_RANK[a.best_coverage]);
    if (secs.length) { takeTriple(t, secs[0].sector_code); placed = true; break; }
  }
  if (!placed) { // targets full but <500 (rounding) — relax to cap anywhere
    const any = pairs.filter((p) => tcount[p.theater_id] < THEATER_CAP
      && pairTiers[pairKey(p.theater_id, p.sector_code)].some((tier) => !usedTriple.has(`${p.theater_id}|${p.sector_code}|${tier}`)))
      .sort((a, b) => tcount[a.theater_id] - tcount[b.theater_id]);
    if (!any.length) throw new Error(`Selection stuck at ${selected.length}/${DAYS}`);
    takeTriple(any[0].theater_id, any[0].sector_code); placed = true;
  }
}

// ── Phase B: sequence the 500 triples onto dates (theater gap≥4, sector gap≥14) ─
const THEATER_GAP = 4, SECTOR_GAP = 14;
function sequence(triples, restartSeed) {
  const localRand = rngFrom(SEED + "|seq|" + restartSeed);
  const pool = triples.slice();
  const remByTheater = {}; const remBySector = {};
  for (const x of pool) { remByTheater[x.theater] = (remByTheater[x.theater] || 0) + 1; remBySector[x.sector] = (remBySector[x.sector] || 0) + 1; }
  const order = [];
  const lastTheater = {}, lastSector = {};
  const remaining = pool.slice();
  for (let day = 0; day < DAYS; day++) {
    const eligible = remaining.filter((x) =>
      (lastTheater[x.theater] === undefined || day - lastTheater[x.theater] >= THEATER_GAP) &&
      (lastSector[x.sector] === undefined || day - lastSector[x.sector] >= SECTOR_GAP));
    if (!eligible.length) return null; // dead-end → restart
    // most-remaining-first (place abundant theaters/sectors early to avoid end pileups)
    let best = null, bestKey = -1;
    for (const x of eligible) {
      const k = remByTheater[x.theater] * 1000 + remBySector[x.sector] + localRand() * 0.5;
      if (k > bestKey) { bestKey = k; best = x; }
    }
    order.push(best);
    lastTheater[best.theater] = day; lastSector[best.sector] = day;
    remByTheater[best.theater]--; remBySector[best.sector]--;
    remaining.splice(remaining.indexOf(best), 1);
  }
  return order;
}
let sequenced = null;
for (let r = 0; r < 4000 && !sequenced; r++) sequenced = sequence(selected, r);
if (!sequenced) throw new Error("Sequencing failed after 4000 restarts");

// ── assign Threads + copy per day ──────────────────────────────────────────────
function pickThreads(theater, sector) {
  const p = pairMap[pairKey(theater, sector)];
  const ranked = p.threads.slice().sort((a, b) =>
    COVERAGE_RANK[threadByCode[b].coverage_grade] - COVERAGE_RANK[threadByCode[a].coverage_grade] || (rand() - 0.5));
  const n = Math.min(ranked.length, 1 + randint(3)); // 1..3
  return ranked.slice(0, n);
}
// Count-agnostic, public-label copy. No totals, no Theme/Domain/Sub-Domain, no IDs.
function buildTitle(sn, tn) { return `${tn}: ${sn}`; }
function buildBlurb(sn, tn, tagline, threadNames) {
  const lead = threadNames.length === 1 ? threadNames[0]
    : threadNames.slice(0, -1).join(", ") + " and " + threadNames[threadNames.length - 1];
  // Theater names already begin with "The" — no leading article. No noun follows
  // the thread name(s) so proper names ending in a digit ("Scope 1-3") never read
  // as a count.
  return `${tagline} Today ${tn} turns to the ${sn} sector — tracking ${lead}.`;
}

const startDay = START;
const calendar = sequenced.map((x, i) => {
  const date = addDaysISO(startDay, i);
  const threadCodes = pickThreads(x.theater, x.sector);
  const threadNames = threadCodes.map((c) => threadByCode[c].display_name);
  const cov = threadCodes.map((c) => threadByCode[c].coverage_grade)
    .reduce((a, b) => (COVERAGE_RANK[b] > COVERAGE_RANK[a] ? b : a), "Whitespace");
  const sn = sectorName[x.sector], tn = theaterName[x.theater];
  return {
    theme_date: date,
    theater_id: x.theater, theater_name: tn,
    sector_code: x.sector, sector_name: sn,
    thread_codes: threadCodes, thread_names: threadNames,
    jpas_tier_code: x.tier,
    theme_title: buildTitle(sn, tn),
    theme_blurb: buildBlurb(sn, tn, theaterTagline[x.theater], threadNames),
    maturity_grade: "Established",
    coverage_grade: cov,
    rotation_seed: SEED,
    registry_version: REGISTRY_VERSION,
  };
});

// ── verify all constraints ──────────────────────────────────────────────────────
const problems = [];
const seenTriple = new Set();
let minTheaterGap = Infinity, minSectorGap = Infinity;
const lastT = {}, lastS = {};
calendar.forEach((d, i) => {
  const trip = `${d.theater_id}|${d.sector_code}|${d.jpas_tier_code}`;
  if (seenTriple.has(trip)) problems.push(`dup triple ${trip} @${d.theme_date}`);
  seenTriple.add(trip);
  if (lastT[d.theater_id] !== undefined) minTheaterGap = Math.min(minTheaterGap, i - lastT[d.theater_id]);
  if (lastS[d.sector_code] !== undefined) minSectorGap = Math.min(minSectorGap, i - lastS[d.sector_code]);
  lastT[d.theater_id] = i; lastS[d.sector_code] = i;
  // thread validity
  const p = pairMap[pairKey(d.theater_id, d.sector_code)];
  if (!p) problems.push(`invalid pair ${d.theater_id}/${d.sector_code} @${d.theme_date}`);
  else for (const c of d.thread_codes) if (!p.threads.includes(c)) problems.push(`thread ${c} not in pair @${d.theme_date}`);
  if (d.thread_codes.length < 1 || d.thread_codes.length > 3) problems.push(`bad thread count @${d.theme_date}`);
});
if (minTheaterGap < THEATER_GAP) problems.push(`theater gap ${minTheaterGap} < ${THEATER_GAP}`);
if (minSectorGap < SECTOR_GAP) problems.push(`sector gap ${minSectorGap} < ${SECTOR_GAP}`);

const theaterDist = {}; const sectorDist = {}; const tierDist = {}; const covDist = {};
for (const d of calendar) {
  theaterDist[d.theater_id] = (theaterDist[d.theater_id] || 0) + 1;
  sectorDist[d.sector_code] = (sectorDist[d.sector_code] || 0) + 1;
  tierDist[d.jpas_tier_code] = (tierDist[d.jpas_tier_code] || 0) + 1;
  covDist[d.coverage_grade] = (covDist[d.coverage_grade] || 0) + 1;
}
const maxTheater = Math.max(...Object.values(theaterDist));
if (maxTheater > THEATER_CAP) problems.push(`theater max ${maxTheater} > cap ${THEATER_CAP}`);
for (const s of SECTORS) if ((sectorDist[s] || 0) < floorFor(s)) problems.push(`sector ${s} = ${sectorDist[s] || 0} < floor ${floorFor(s)}`);

// ── copy compliance (automated, per Phase 5 §9) ─────────────────────────────────
// A standalone quantity (preceded by start/space, not part of a hyphenated/decimal
// token like "1-3") immediately qualifying theater/sector/thread → a real count phrase.
const COUNT_WORDS = /(^|\s)(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|\d+)\s+(theater|sector|thread)s?\b/i;
const BANNED_WORDS = /\b(theme|domain|sub-domain|subdomain)s?\b/i;
const ID_PAT = /\b(T-\d{3}|D\d{1,2}\.\d+)\b/;
const copyFails = [];
for (const d of calendar) {
  for (const [field, txt] of [["title", d.theme_title], ["blurb", d.theme_blurb]]) {
    if (COUNT_WORDS.test(txt)) copyFails.push(`${d.theme_date} ${field}: count phrase`);
    if (BANNED_WORDS.test(txt)) copyFails.push(`${d.theme_date} ${field}: banned word`);
    if (ID_PAT.test(txt)) copyFails.push(`${d.theme_date} ${field}: raw ID`);
  }
}

// ── write outputs ───────────────────────────────────────────────────────────────
mkdirSync(join(REPO, "exports"), { recursive: true });
writeFileSync(join(REPO, "exports/far287-calendar.json"),
  JSON.stringify({ seed: SEED, start: START, days: DAYS, registry_version: REGISTRY_VERSION,
    targets: target, generated_at_placeholder: "set-on-load", calendar }, null, 2) + "\n");

const csvEsc = (v) => `"${String(v).replace(/"/g, '""')}"`;
const csvHeader = ["theme_date","theater_id","theater_name","sector_code","sector_name","thread_codes","thread_names","jpas_tier_code","theme_title","theme_blurb","maturity_grade","coverage_grade"];
const csv = [csvHeader.join(",")].concat(calendar.map((d) => [
  d.theme_date, d.theater_id, d.theater_name, d.sector_code, d.sector_name,
  d.thread_codes.join("; "), d.thread_names.join("; "), d.jpas_tier_code,
  d.theme_title, d.theme_blurb, d.maturity_grade, d.coverage_grade,
].map(csvEsc).join(","))).join("\n") + "\n";
writeFileSync(join(REPO, "exports/far287-calendar.csv"), csv);

// review markdown
const distRow = (obj, keys) => keys.map((k) => `${k}:${obj[k] || 0}`).join(" · ");
const md = [];
md.push(`# FAR-287 — 500-day Theme Calendar (review)\n`);
md.push(`> **Review gate.** Generated by \`scripts/far287/build-calendar.mjs\`. Reproducible: seed \`${SEED}\`, start \`${START}\`, registry \`${REGISTRY_VERSION}\`. Do NOT generate puzzles until this calendar is approved.\n`);
md.push(`- **Days:** ${DAYS} (${calendar[0].theme_date} → ${calendar[DAYS - 1].theme_date})`);
md.push(`- **Constraint check:** ${problems.length ? "❌ " + problems.length + " problem(s)" : "✅ all pass"} — min Theater gap ${minTheaterGap} (need ≥${THEATER_GAP}); min Sector gap ${minSectorGap} (need ≥${SECTOR_GAP}); unique triples ${seenTriple.size}/${DAYS}.`);
md.push(`- **Copy compliance:** ${copyFails.length ? "❌ " + copyFails.length : "✅ 0"} violations (no counts, no Theme/Domain/Sub-Domain, no raw IDs).`);
if (problems.length) md.push("\n**Problems:**\n" + problems.map((p) => `- ${p}`).join("\n"));
md.push(`\n## Theater balance (mean ${mean.toFixed(1)}, 1.3× cap ${THEATER_CAP})\n`);
md.push("| Theater | Name | Target | Actual | ×mean |\n|---|---|---|---|---|");
for (const t of THEATERS) md.push(`| ${t} | ${theaterName[t]} | ${target[t]} | ${theaterDist[t] || 0} | ${((theaterDist[t] || 0) / mean).toFixed(2)} |`);
md.push(`\n## Sector distribution (floor 12; D16/D18 floor 9)\n`);
md.push("| Sector | Name | Count | Floor | ok |\n|---|---|---|---|---|");
for (const s of SECTORS.sort((a, b) => (sectorDist[b] || 0) - (sectorDist[a] || 0)))
  md.push(`| ${s} | ${sectorName[s]} | ${sectorDist[s] || 0} | ${floorFor(s)} | ${(sectorDist[s] || 0) >= floorFor(s) ? "✅" : "❌"} |`);
md.push(`\n## JPAS tier distribution (internal only)\n\n${distRow(tierDist, tiers)}\n`);
md.push(`## Coverage mix (down-weight Whitespace)\n\n${distRow(covDist, ["Dedicated", "Broad-only", "Whitespace"])}\n`);
md.push(`## Maturity\n\nEstablished: ${calendar.length} (Candidate Threads excluded)\n`);
md.push(`## First 21 days\n`);
md.push("| Date | Theater | Sector | Threads | Tier | Title |\n|---|---|---|---|---|---|");
for (const d of calendar.slice(0, 21))
  md.push(`| ${d.theme_date} | ${d.theater_id} | ${d.sector_code} | ${d.thread_codes.join(", ")} | ${d.jpas_tier_code} | ${d.theme_title} |`);
md.push(`\n## Last 14 days\n`);
md.push("| Date | Theater | Sector | Threads | Tier | Title |\n|---|---|---|---|---|---|");
for (const d of calendar.slice(-14))
  md.push(`| ${d.theme_date} | ${d.theater_id} | ${d.sector_code} | ${d.thread_codes.join(", ")} | ${d.jpas_tier_code} | ${d.theme_title} |`);
md.push(`\n## Sample blurbs\n`);
for (const d of [calendar[0], calendar[100], calendar[250], calendar[499]])
  md.push(`- **${d.theme_date}** — _${d.theme_title}_ — ${d.theme_blurb}`);
writeFileSync(join(REPO, "docs/far287-calendar-review.md"), md.join("\n") + "\n");

// ── console summary ─────────────────────────────────────────────────────────────
console.log(`seed=${SEED} start=${START} days=${DAYS}`);
console.log(`constraints: ${problems.length ? "FAIL " + JSON.stringify(problems) : "PASS"}  (theaterGap≥${THEATER_GAP} got ${minTheaterGap}; sectorGap≥${SECTOR_GAP} got ${minSectorGap})`);
console.log(`copy compliance: ${copyFails.length ? "FAIL " + copyFails.slice(0,5).join("; ") : "PASS"}`);
console.log(`theater dist:`, theaterDist);
console.log(`sector floors:`, SECTORS.every((s) => (sectorDist[s] || 0) >= floorFor(s)) ? "all met" : "MISSING");
console.log(`tier dist:`, tierDist);
console.log(`coverage:`, covDist);
console.log(`outputs: exports/far287-calendar.json, exports/far287-calendar.csv, docs/far287-calendar-review.md`);
