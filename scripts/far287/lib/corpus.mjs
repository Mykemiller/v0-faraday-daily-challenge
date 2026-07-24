// FAR-287 — corpus cache + per-day subject pools. buildCorpus() snapshots the
// generation inputs ONCE (Supabase + Airtable, env-gated) so the generator never
// hits an external API per puzzle. buildSubjectPool(corpus, day) is pure.
//
// Sources:
//   • Enriched companies  — Airtable Tracking Companies (name, primary Domain, HQ,
//     classification). THE fact-anchored ceiling (~400-469), not the 7,824 roster.
//   • Lexicon             — Airtable Lexicon (Approved term/definition/category).
//   • Signals             — Supabase public.signals (domain/subdomain/company tags,
//     framing) — a rolling ~19-day flavor window, not a backbone.
//   • Tier names          — public.jpas_tiers (internal only).

import { writeFileSync } from "node:fs";
import { sbSelect, airtableGet } from "./clients.mjs";

export const CORPUS_PATH = "scripts/far287/corpus-cache.json";

const AT_BASE = "appxfti7VuoHYUeu6";
const TC = { table: "tbluDYoK8Nj2DGQ0r", name: "fld2NS9wyE33nur43", domain: "fldfs1k8HWbiDJ2C1", hq: "fldkFF3o4dZuy8ZWb", cls: "fldYhdFhaUIR3Iwbf" };
const LEX = { table: "tblibfOpAa5wh0dA5", term: "fldN6hCB3kIwNFrSJ", def: "fldTryT8sagm5Loqw", cat: "fldWcfQhyO2AfyqiK", status: "fldvVjjrWtNWmNdQM" };

const domCode = (s) => { const m = String(s || "").match(/^(D\d{1,2})\b/); return m ? m[1] : null; };
const firstName = (v) => (Array.isArray(v) && v[0] ? (v[0].name || v[0]) : (v && v.name) || v || null);

async function pageAll(baseId, tableId, fields) {
  const out = []; let offset, pages = 0;
  do {
    const params = { pageSize: 100, returnFieldsByFieldId: "true", "fields[]": fields };
    if (offset) params.offset = offset;
    const data = await airtableGet(baseId, tableId, params);
    out.push(...(data.records || [])); offset = data.offset; pages++;
  } while (offset && pages < 60);
  return out;
}

export async function buildCorpus() {
  // enriched companies
  const companies = (await pageAll(AT_BASE, TC.table, [TC.name, TC.domain, TC.hq, TC.cls]))
    .map((r) => ({ name: r.fields[TC.name], domain_code: domCode(firstName(r.fields[TC.domain])),
      hq: r.fields[TC.hq] || null, classification: r.fields[TC.cls] || null }))
    .filter((c) => c.name && !/^⚠|coming soon/i.test(String(c.name)));
  // lexicon (Approved)
  const lexicon = (await pageAll(AT_BASE, LEX.table, [LEX.term, LEX.def, LEX.cat, LEX.status]))
    .filter((r) => firstName(r.fields[LEX.status]) === "Approved")
    .map((r) => ({ term: r.fields[LEX.term], def: r.fields[LEX.def], category: firstName(r.fields[LEX.cat]) }))
    .filter((x) => x.term && x.def);
  // signals (flavor) + tier names
  const signals = (await sbSelect("signals", "select=subdomain_tags,domain_tags,company_tags,framing,faradays_take&order=fired_at.desc&limit=400")).catch?.(() => []) || [];
  const sigs = Array.isArray(signals) ? signals : await sbSelect("signals", "select=subdomain_tags,domain_tags,company_tags,framing,faradays_take&order=fired_at.desc&limit=400");
  const tierRows = await sbSelect("jpas_tiers", "select=tier_code,tier_name");
  const tier_names = Object.fromEntries((tierRows || []).map((t) => [t.tier_code, t.tier_name]));

  const corpus = { built: "cached-snapshot", counts: { companies: companies.length, lexicon: lexicon.length, signals: sigs.length },
    companies, lexicon, signals: sigs, tier_names };
  writeFileSync(CORPUS_PATH, JSON.stringify(corpus));
  console.log(`corpus cached: ${companies.length} companies, ${lexicon.length} lexicon, ${sigs.length} signals`);
  return corpus;
}

// Pure: ordered candidate subjects for a themed day, most fact-anchored first.
export function buildSubjectPool(corpus, day) {
  const sector = day.sector_code, threads = new Set(day.thread_codes || []);
  const subj = [];
  // 1. enriched companies in this Sector (verifiable facts)
  for (const c of corpus.companies || []) if (c.domain_code === sector) subj.push(`${c.name}${c.hq ? ` (${c.hq})` : ""}${c.classification ? ` — ${c.classification}` : ""}`);
  // 2. signals whose sub-domain tags intersect the day's Threads (framing)
  for (const s of corpus.signals || []) {
    const st = new Set([...(s.subdomain_tags || [])]);
    if ([...threads].some((t) => st.has(t)) && s.framing) subj.push(String(s.framing).slice(0, 140));
  }
  // 3. lexicon terms (broad definitional material)
  for (const l of corpus.lexicon || []) subj.push(`${l.term} — ${String(l.def).slice(0, 120)}`);
  // 4. always-available fallback: the Thread names themselves
  for (const n of day.thread_names || []) subj.push(n);
  // de-dupe, keep order
  return [...new Set(subj)];
}
