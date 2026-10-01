#!/usr/bin/env node
// Faraday Academy — copy-rule scan over RENDERED HTML.
//
// The no-codes build guard checks source; this checks what a reader actually
// receives, which is where authored content and model output land. It crawls the
// academy surface of a deployment and applies the UI copy rules:
//   · no domain or tower codes
//   · no statement of how many domains / sub-domains / towers / schools / courses exist
//   · no banned phrases
//   · no price figures (while beta_mode is true)
//
//   node scripts/academy-copy-scan.mjs <base-url> [--slugs a,b,c]
//
// Exits non-zero on any violation. Until academy-public is deployed the academy
// pages render their offline state, so a clean run proves the CHROME is clean and
// nothing more — the scan is only meaningful over real content once it is live.

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) {
  console.error("usage: node scripts/academy-copy-scan.mjs <base-url> [--slugs a,b,c]");
  process.exit(2);
}
const slugArg = process.argv.find((a) => a.startsWith("--slugs="));
const slugs = slugArg ? slugArg.slice("--slugs=".length).split(",").filter(Boolean) : [];

const RULES = [
  { name: "domain code", re: /\bD\d{1,2}(?:\.\d+)?\b/g },
  { name: "tower code", re: /\bT-?\d{3}\b/g },
  {
    name: "curriculum count",
    re: /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds|thousands)\s+(?:active\s+|total\s+|distinct\s+|different\s+)?(?:domains|sub-?domains|towers|schools|courses)\b/gi,
  },
  { name: "price figure", re: /\$\s?\d|\b\d+(?:\.\d{2})?\s*(?:dollars|usd)\b/gi },
  {
    name: "banned phrase",
    re: /\b(?:empowering|leveraging|cutting-edge|best-in-class|revolutionary|unlocking potential|game-changing|paradigm shift|state-of-the-art|world-class|next-generation|synergy|supercharge|transformative)\b|in today's fast-paced world|Great question!|I hope that helps|We're excited to announce|Faraday's methodology|our approach|the Faraday framework/gi,
  },
];

// Strip the parts of a document that are not reader-visible copy: scripts (which
// carry the RSC flight payload and bundle text), styles, and tag attributes.
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
}

function routesFor(slug) {
  return [
    `/academy/${slug}`,
    `/academy/${slug}/1/1`,
    `/academy/${slug}/1/review`,
    `/academy/${slug}/quiz`,
    `/academy/${slug}/glossary`,
  ];
}

const routes = ["/academy", "/academy/sitemap.xml", ...slugs.flatMap(routesFor)];

let failures = 0;
let scanned = 0;

for (const route of routes) {
  let res, html;
  try {
    res = await fetch(`${base}${route}`, { headers: { "User-Agent": "academy-copy-scan" } });
    html = await res.text();
  } catch (err) {
    console.error(`✖ ${route} — fetch failed: ${err.message}`);
    failures++;
    continue;
  }
  if (!res.ok) {
    console.error(`✖ ${route} — HTTP ${res.status}`);
    failures++;
    continue;
  }
  scanned++;
  const text = visibleText(html);
  const hits = [];
  for (const rule of RULES) {
    const found = [...text.matchAll(rule.re)].map((m) => m[0].trim());
    if (found.length > 0) hits.push(`${rule.name}: ${[...new Set(found)].slice(0, 6).join(", ")}`);
  }
  if (hits.length > 0) {
    failures++;
    console.error(`✖ ${route}`);
    for (const h of hits) console.error(`    ${h}`);
  } else {
    console.log(`✔ ${route}`);
  }
}

console.log(`\n${scanned} pages scanned, ${failures} with findings.`);
process.exit(failures > 0 ? 1 : 0);
