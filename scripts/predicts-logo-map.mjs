#!/usr/bin/env node
// Faraday Predicts UI 3.0 (FDY-273) — build-time company → theSVG logo map.
//
//   npm run predicts:logos            (writes src/lib/predicts-logos.json)
//   PREDICTS_API_URL=… npm run predicts:logos
//
// Source: theSVG (thesvg.org, MIT tooling) via its own metadata index on the
// jsDelivr mirror, src/data/icons.json (slug, title, variants). The documented
// per-icon endpoint thesvg.org/api/icons/{slug} returned 404 for every slug on
// 2026-11-08, so the index is used instead — same data, one request.
//
// Matching (avoid false hits like LG Electronics → "LG"):
//   1. candidate slugs: kebab of the name; the name minus Inc/Corp/Ltd/LLC/
//      Electronics/Energy/… suffixes; the first word.
//   2. the icon's title must contain EVERY significant token of the company
//      name (case-insensitive), and the company name must contain every token
//      of the title.
//   3. variant: light (drawn for light backgrounds) → color → default → mono.
// The marks belong to their owners; they are shown nominatively to identify the
// subject of a forecast and are never recoloured. No other logo source.

import { writeFileSync } from "node:fs";

const API = process.env.PREDICTS_API_URL ||
  "https://ycadmmngkdhvpcsrcuaq.supabase.co/functions/v1/predicts-public";
const INDEX = "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/src/data/icons.json";
const OUT = new URL("../src/lib/predicts-logos.json", import.meta.url);

const SUFFIX = /\s+(inc\.?|corp\.?|corporation|ltd\.?|llc|electronics|energy|holdings|group|technologies|platforms)$/i;
const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const tokens = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);

export function matchIcon(name, icons) {
  const bySlug = new Map(icons.map((i) => [i.slug, i]));
  const cands = [kebab(name), kebab(name.replace(SUFFIX, "")), kebab(name.split(" ")[0])];
  for (const c of cands) {
    const icon = bySlug.get(c) ?? bySlug.get(c.replace(/-/g, ""));
    if (!icon) continue;
    const nt = tokens(name), tt = tokens(icon.title);
    const covered = nt.every((t) => tt.includes(t)) && tt.every((t) => nt.includes(t));
    if (!covered) continue;
    const v = icon.variants ?? {};
    const path = v.light ?? v.color ?? v.default ?? v.mono;
    if (path) return path;
  }
  return null;
}

async function main() {
  const [idx, cos] = await Promise.all([
    fetch(INDEX).then((r) => r.json()),
    fetch(`${API}?view=companies`).then((r) => r.json()),
  ]);
  const map = {};
  for (const c of cos.companies ?? []) {
    const path = matchIcon(c.name, idx);
    if (path) map[c.slug] = path;
  }
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`mapped ${Object.keys(sorted).length} of ${(cos.companies ?? []).length} companies`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
