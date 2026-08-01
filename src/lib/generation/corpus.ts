// Part D — the generation corpus (DEC-7). Airtable is READ-ONLY from this path:
// this module contains the ONLY Airtable access under src/lib/generation, and it
// is GET-only — there is deliberately no create/update/schema helper here, and
// `npm run test:generation-readonly` asserts none ever appears.
//
// Sources (same recipe as scripts/far287/lib/corpus.mjs, minus the disk cache —
// the worker rebuilds per invocation; reads are a few hundred rows):
//   • Tracking Companies + Lexicon — Airtable base appxfti7VuoHYUeu6 (by field ID)
//   • signals + jpas_tiers          — Supabase, service-role PostgREST

import type { Svc } from "@/lib/league-office/service";

const AT_API = "https://api.airtable.com/v0";
const AT_BASE = "appxfti7VuoHYUeu6";
const TC = { table: "tbluDYoK8Nj2DGQ0r", name: "fld2NS9wyE33nur43", domain: "fldfs1k8HWbiDJ2C1", hq: "fldkFF3o4dZuy8ZWb", cls: "fldYhdFhaUIR3Iwbf" };
const LEX = { table: "tblibfOpAa5wh0dA5", term: "fldN6hCB3kIwNFrSJ", def: "fldTryT8sagm5Loqw", cat: "fldWcfQhyO2AfyqiK", status: "fldvVjjrWtNWmNdQM" };
const DOMAIN_REGISTRY = { table: "tbltFtmWgBYPuRLSc", id: "fldljR88WnQlnzj0g", status: "fldM6K6aFEIL5Aqif" };

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

type AtRecord = { id: string; fields: Record<string, unknown> };

async function airtableGet(tableId: string, params: Record<string, string | string[]>): Promise<{ records?: AtRecord[]; offset?: string }> {
  const key = process.env.AIRTABLE_API_KEY;
  if (!key) throw new Error("AIRTABLE_API_KEY is required for corpus reads");
  const url = new URL(`${AT_API}/${AT_BASE}/${tableId}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
    else url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Airtable GET ${tableId} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function pageAll(tableId: string, fields: string[]): Promise<AtRecord[]> {
  const out: AtRecord[] = [];
  let offset: string | undefined;
  let pages = 0;
  do {
    const params: Record<string, string | string[]> = { pageSize: "100", returnFieldsByFieldId: "true", "fields[]": fields };
    if (offset) params.offset = offset;
    const data = await airtableGet(tableId, params);
    out.push(...(data.records || []));
    offset = data.offset;
    pages++;
  } while (offset && pages < 60);
  return out;
}

const domCode = (s: unknown): string | null => {
  const m = String(s ?? "").match(/^(D\d{1,2})\b/);
  return m ? m[1] : null;
};
const firstName = (v: unknown): string | null => {
  if (Array.isArray(v) && v[0]) {
    const x = v[0] as { name?: string } | string;
    return typeof x === "string" ? x : (x.name ?? null);
  }
  if (v && typeof v === "object" && "name" in (v as object)) return String((v as { name: unknown }).name);
  return v == null ? null : String(v);
};

export type Corpus = {
  companies: { name: string; domain_code: string | null; hq: string | null; classification: string | null }[];
  lexicon: { term: string; def: string; category: string | null }[];
  signals: { subdomain_tags?: string[]; domain_tags?: string[]; company_tags?: string[]; framing?: string | null }[];
  tier_names: Record<string, string>;
  counts: { companies: number; lexicon: number; signals: number };
};

async function sbGet<T>(s: Svc, path: string): Promise<T[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: s.headers, cache: "no-store" });
  if (!r.ok) return [];
  const j = await r.json().catch(() => null);
  return Array.isArray(j) ? (j as T[]) : [];
}

/** Builds the corpus, or throws. A run that would generate from nothing must
 *  fail loudly (Part D acceptance 9) — empty companies AND lexicon means the
 *  corpus reads did not actually happen. */
export async function buildCorpus(s: Svc): Promise<Corpus> {
  const [companyRecords, lexiconRecords, signals, tierRows] = await Promise.all([
    pageAll(TC.table, [TC.name, TC.domain, TC.hq, TC.cls]),
    pageAll(LEX.table, [LEX.term, LEX.def, LEX.cat, LEX.status]),
    sbGet<Corpus["signals"][number]>(s, "signals?select=subdomain_tags,domain_tags,company_tags,framing&order=fired_at.desc&limit=400"),
    sbGet<{ tier_code: string; tier_name: string }>(s, "jpas_tiers?select=tier_code,tier_name"),
  ]);

  const companies = companyRecords
    .map((r) => ({
      name: String(r.fields[TC.name] ?? ""),
      domain_code: domCode(firstName(r.fields[TC.domain])),
      hq: (r.fields[TC.hq] as string) || null,
      classification: (r.fields[TC.cls] as string) || null,
    }))
    .filter((c) => c.name && !/^⚠|coming soon/i.test(c.name));

  const lexicon = lexiconRecords
    .filter((r) => firstName(r.fields[LEX.status]) === "Approved")
    .map((r) => ({
      term: String(r.fields[LEX.term] ?? ""),
      def: String(r.fields[LEX.def] ?? ""),
      category: firstName(r.fields[LEX.cat]),
    }))
    .filter((x) => x.term && x.def);

  if (companies.length === 0 && lexicon.length === 0)
    throw new Error("corpus reads returned nothing — refusing to generate from nothing");

  return {
    companies,
    lexicon,
    signals,
    tier_names: Object.fromEntries(tierRows.map((t) => [t.tier_code, t.tier_name])),
    counts: { companies: companies.length, lexicon: lexicon.length, signals: signals.length },
  };
}

export type ThemedDay = {
  theme_date: string;
  theater_id: string;
  theater_name: string;
  sector_code: string;
  sector_name: string;
  thread_codes: string[];
  thread_names: string[];
  jpas_tier_code: string;
};

/** Pure: ordered candidate subjects for a themed day, most fact-anchored first
 *  (port of scripts/far287/lib/corpus.mjs buildSubjectPool). */
export function buildSubjectPool(corpus: Corpus, day: ThemedDay): string[] {
  const sector = day.sector_code;
  const threads = new Set(day.thread_codes || []);
  const subj: string[] = [];
  for (const c of corpus.companies)
    if (c.domain_code === sector)
      subj.push(`${c.name}${c.hq ? ` (${c.hq})` : ""}${c.classification ? ` — ${c.classification}` : ""}`);
  for (const sig of corpus.signals) {
    const st = new Set(sig.subdomain_tags || []);
    if ([...threads].some((t) => st.has(t)) && sig.framing) subj.push(String(sig.framing).slice(0, 140));
  }
  for (const l of corpus.lexicon) subj.push(`${l.term} — ${String(l.def).slice(0, 120)}`);
  for (const n of day.thread_names || []) subj.push(n);
  return [...new Set(subj)];
}

/** Live Active domain codes from the Domain Registry (validation condition 7).
 *  Returns null on any failure so the caller can fall back to the corpus-derived
 *  set — validation must not brick on an Airtable hiccup. */
export async function fetchActiveDomainCodes(): Promise<string[] | null> {
  try {
    const records = await pageAll(DOMAIN_REGISTRY.table, [DOMAIN_REGISTRY.id, DOMAIN_REGISTRY.status]);
    const codes = records
      .filter((r) => firstName(r.fields[DOMAIN_REGISTRY.status]) === "Active")
      .map((r) => String(r.fields[DOMAIN_REGISTRY.id] ?? ""))
      .filter((c) => /^D\d{1,2}$/.test(c));
    return codes.length ? codes : null;
  } catch {
    return null;
  }
}
