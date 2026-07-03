// Day-level content for the Hints Today / About Today's Challenge / Answers
// Today pages (FAR-287).
//
// SERVER-SIDE ONLY. Reads the Airtable Puzzle Bank (and the Academy Courses
// catalog) with the same AIRTABLE_API_KEY the rotator uses — never import this
// into a client component. All page reads go through dc_daily_page_content in
// Supabase; Airtable is touched only by the daily sync job
// (/api/cron/sync-day-content).
//
// Two halves:
//   1. Pure helpers — extractAnswer / buildAboutContent / hint plumbing.
//      No I/O; the shapes mirror the Puzzle Content JSON the game components
//      consume (see PUZZLE_DATA in DailyChallenge.jsx).
//   2. buildDayContentRow(dateISO) — the sync gather step. Fetches the day's
//      Published = "Live" bank rows, pulls Hint 1/2/3 + (optional) Answer
//      Explanation / Domain, resolves the IDF domain and an Academy course,
//      and returns the dc_daily_page_content row to upsert.
//
// Airtable field CONTRACT (by NAME — the sync reads name-keyed fields because
// two of them don't exist yet and so have no stable field id):
//   "Puzzle Type" · "Puzzle Name" · "Public ID" · "Puzzle Content" ·
//   "Hint 1" · "Hint 2" · "Hint 3"                    — exist today
//   "Answer Explanation" (long text)                  — Phase-1 prerequisite,
//   "Domain" / "Sub-Domain" (links to IDF registries) — added by Myke in
//                                                       Airtable (FAR-178);
//                                                       absent → nulls, never
//                                                       a sync failure.

import {
  PUZZLE_BANK_BASE_ID,
  PUZZLE_BANK_TABLE_ID,
  PUZZLE_TYPES,
} from "@/lib/airtable-puzzle-bank";

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

// IDF Domain Registry — resolves the bank's "Domain" linked records to a
// stable domain code ("D2") + display name.
const IDF_DOMAIN_REGISTRY_TABLE_ID =
  process.env.AIRTABLE_IDF_DOMAIN_TABLE_ID || "tbltFtmWgBYPuRLSc";

// Faraday Academy catalog (separate base). Courses are keyed by "School ID",
// which equals the IDF Domain ID (e.g. "D2"). Same Airtable PAT — if its scope
// doesn't cover this base the lookup fails soft (academy: null), never the sync.
const ACADEMY_BASE_ID =
  process.env.ACADEMY_AIRTABLE_BASE_ID || "appzhpKGOI248bCDQ";
const ACADEMY_COURSES_TABLE_ID =
  process.env.ACADEMY_COURSES_TABLE_ID || "tblXOHwZQJIoq7G3H";
// Where a course row has no CTA URL yet, nudges land on the Academy lobby.
export const ACADEMY_LOBBY_URL = "/academy";

export const GENERATOR_VERSION = "far-287-v1";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AcademyCourseRef {
  course_code: string;
  title: string;
  url: string; // course CTA URL, or ACADEMY_LOBBY_URL when the course has none yet
  is_free: boolean;
  school_id: string;
}

export interface DayPuzzleEntry {
  puzzle_type: string;
  public_id: string | null;
  puzzle_name: string | null;
  /** The puzzle's own subject line (Puzzle Content `domain`, e.g. "Power Architecture"). */
  topic: string | null;
  hints: string[]; // Hint 1..3 from the bank, in order, empties dropped
  answer: unknown | null; // structured, per-type — see extractAnswer
  answer_explanation: string | null; // Phase-1 field; null until it exists
  domain_code: string | null; // IDF domain id ("D2"); null until FAR-178
  academy: AcademyCourseRef | null;
}

export interface AboutContent {
  date: string;
  headline: string;
  intro: string;
  domain_code: string | null;
  domain_name: string | null;
  topics: string[];
  games: Array<{ puzzle_type: string; name: string | null; topic: string | null }>;
}

export interface DayContentRow {
  puzzle_date: string;
  domain_code: string | null;
  about_content: AboutContent;
  puzzles: DayPuzzleEntry[];
  generator_version: string;
  synced_at: string;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// Structured correct answer per puzzle type, extracted from the Puzzle Content
// JSON (the exact shapes the game components consume). Returns null when the
// content doesn't carry enough to state an answer — the Answers page then shows
// the explanation alone. Exported for reuse/tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractAnswer(puzzleType: string, content: any): unknown | null {
  if (!content || typeof content !== "object") return null;

  if (puzzleType === "Rackl") {
    const groups = Array.isArray(content.groups) ? content.groups : [];
    const out = groups
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((g: any) => g && g.label && Array.isArray(g.items))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((g: any) => ({ label: String(g.label), items: g.items.map(String) }));
    return out.length ? { kind: "groups", groups: out } : null;
  }

  if (puzzleType === "Signal Drop") {
    const word = str(content.word);
    return word ? { kind: "word", word: word.toUpperCase(), clue: str(content.clue) } : null;
  }

  if (puzzleType === "The Stack") {
    const items = Array.isArray(content.items) ? content.items : null;
    const order = Array.isArray(content.correctOrder) ? content.correctOrder : null;
    if (!items || !order) return null;
    const ranked = order
      .map((idx: number, pos: number) => ({
        rank: pos + 1,
        item: items[idx] != null ? String(items[idx]) : null,
        value:
          Array.isArray(content.values) && content.values[idx] != null
            ? String(content.values[idx])
            : null,
      }))
      .filter((r: { item: string | null }) => r.item != null);
    return ranked.length
      ? { kind: "ranking", metric: str(content.metric), ranked }
      : null;
  }

  if (puzzleType === "Dark Fiber") {
    const pairs = Array.isArray(content.pairs) ? content.pairs : [];
    const out = pairs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((p: any) => p && p.term && p.def)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => ({ term: String(p.term), def: String(p.def) }));
    return out.length ? { kind: "pairs", pairs: out } : null;
  }

  // Question-based games: Circuit (true/false), The Brief & Frequency (MCQ).
  if (puzzleType === "Circuit" || puzzleType === "The Brief" || puzzleType === "Frequency") {
    const questions = Array.isArray(content.questions) ? content.questions : [];
    const out = questions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((q: any) => {
        if (!q || !q.q) return null;
        let answer: string | null = null;
        if (typeof q.a === "boolean") answer = q.a ? "True" : "False";
        else if (Array.isArray(q.options) && typeof q.correct === "number" && q.options[q.correct] != null)
          answer = String(q.options[q.correct]);
        if (answer == null) return null;
        return { q: String(q.q), answer, explanation: str(q.explanation) };
      })
      .filter(Boolean);
    return out.length ? { kind: "questions", questions: out } : null;
  }

  return null;
}

// Day-level About blob — deterministic (idempotent re-sync), no personalization,
// deliberately NO stats. Domain-aware once FAR-178 populates the bank's Domain;
// until then it frames the day from each puzzle's own topic line.
export function buildAboutContent(
  dateISO: string,
  puzzles: DayPuzzleEntry[],
  domain: { code: string | null; name: string | null }
): AboutContent {
  const topics = [...new Set(puzzles.map((p) => p.topic).filter((t): t is string => !!t))];
  const intro = domain.name
    ? `Today's seven games all orbit ${domain.name} — the IDF domain Faraday is watching right now. Every puzzle draws from the same live intelligence that powers the rest of Faraday.`
    : topics.length
      ? `Today's games draw from ${topics.length === 1 ? topics[0] : `${topics.slice(0, -1).join(", ")} and ${topics[topics.length - 1]}`} — all pulled from the live Faraday intelligence corpus.`
      : "Seven games, one daily set — all pulled from the live Faraday intelligence corpus.";
  return {
    date: dateISO,
    headline: domain.name ? `Today's theme: ${domain.name}` : "Today's Daily Challenge",
    intro,
    domain_code: domain.code,
    domain_name: domain.name,
    topics,
    games: puzzles.map((p) => ({ puzzle_type: p.puzzle_type, name: p.puzzle_name, topic: p.topic })),
  };
}

// ── Airtable gather (sync job only) ──────────────────────────────────────────

class AirtableConfigError extends Error {}

// Same env contract as airtable-puzzle-bank.js (AIRTABLE_API_KEY canonical,
// FARADAY_ legacy fallback) — that module keeps its key lookup private.
function getApiKey(): string {
  const key = process.env.AIRTABLE_API_KEY || process.env.FARADAY_AIRTABLE_API_KEY;
  if (!key) {
    throw new AirtableConfigError(
      "Airtable API key is not set — set AIRTABLE_API_KEY so the day-content sync can reach the Puzzle Bank."
    );
  }
  return key;
}

type AirtableRecord = { id: string; fields: Record<string, unknown> };

async function airtableGet(path: string, params?: URLSearchParams): Promise<Response> {
  const url = `${AIRTABLE_API_BASE}/${path}${params ? `?${params}` : ""}`;
  return fetch(url, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    cache: "no-store", // sync must always see current bank state
  });
}

async function fetchRecordsByName(
  baseId: string,
  tableId: string,
  filterByFormula: string,
  maxRecords = 100
): Promise<AirtableRecord[]> {
  const params = new URLSearchParams({
    maxRecords: String(maxRecords),
    filterByFormula,
  });
  const res = await airtableGet(`${baseId}/${tableId}`, params);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airtable request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.records || [];
}

// Resolve one IDF Domain Registry linked record → { code, name }.
async function fetchDomainRecord(
  recordId: string
): Promise<{ code: string | null; name: string | null }> {
  const res = await airtableGet(`${PUZZLE_BANK_BASE_ID}/${IDF_DOMAIN_REGISTRY_TABLE_ID}/${recordId}`);
  if (!res.ok) return { code: null, name: null };
  const data = await res.json().catch(() => null);
  return {
    code: str(data?.fields?.["Domain ID"]),
    name: str(data?.fields?.["Domain Name"]),
  };
}

// Pick the day's Academy course for a domain: free-with-URL first (per FAR-287:
// "prefer Is Free for the first recommendation shown"), then free, then any
// with a URL, then any. Fails soft to null on any Airtable error.
export function pickAcademyCourse(records: AirtableRecord[], schoolId: string): AcademyCourseRef | null {
  const courses = records
    .map((r) => ({
      course_code: str(r.fields["Course Code"]),
      title: str(r.fields["Title"]),
      url: str(r.fields["URL"]),
      is_free: r.fields["Is Free"] === true,
    }))
    .filter((c): c is { course_code: string; title: string; url: string | null; is_free: boolean } =>
      !!(c.course_code && c.title)
    );
  if (!courses.length) return null;
  const score = (c: { url: string | null; is_free: boolean }) =>
    (c.is_free ? 2 : 0) + (c.url ? 1 : 0);
  const best = [...courses].sort((a, b) => score(b) - score(a))[0];
  return {
    course_code: best.course_code,
    title: best.title,
    url: best.url || ACADEMY_LOBBY_URL,
    is_free: best.is_free,
    school_id: schoolId,
  };
}

async function fetchAcademyCourse(schoolId: string): Promise<AcademyCourseRef | null> {
  try {
    const records = await fetchRecordsByName(
      ACADEMY_BASE_ID,
      ACADEMY_COURSES_TABLE_ID,
      `{School ID} = "${schoolId}"`,
      50
    );
    return pickAcademyCourse(records, schoolId);
  } catch (err) {
    // The PAT may not cover the Academy base yet — a missing nudge is fine,
    // a failed sync is not.
    console.error(`[day-content] Academy course lookup failed for ${schoolId}:`, err);
    return null;
  }
}

// Gather everything for one serve day and shape the dc_daily_page_content row.
// Idempotent: same bank state in → same row out (modulo synced_at).
export async function buildDayContentRow(dateISO: string): Promise<DayContentRow> {
  const records = await fetchRecordsByName(
    PUZZLE_BANK_BASE_ID,
    PUZZLE_BANK_TABLE_ID,
    `{Published} = "Live"`
  );

  // Memoize linked-record + course lookups — the whole day usually shares one domain.
  const domainCache = new Map<string, Promise<{ code: string | null; name: string | null }>>();
  const courseCache = new Map<string, Promise<AcademyCourseRef | null>>();

  const puzzles: DayPuzzleEntry[] = [];
  const seenTypes = new Set<string>();

  for (const record of records) {
    const type = str(record.fields["Puzzle Type"]);
    if (!type || !PUZZLE_TYPES.includes(type) || seenTypes.has(type)) continue;
    seenTypes.add(type);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let content: any = null;
    const raw = record.fields["Puzzle Content"];
    if (typeof raw === "string") {
      try { content = JSON.parse(raw); } catch { content = null; }
    }

    // "Domain" is a linked-record field (may not exist yet — FAR-178).
    const domainLinks = record.fields["Domain"];
    let domainCode: string | null = null;
    if (Array.isArray(domainLinks) && typeof domainLinks[0] === "string") {
      const recId = domainLinks[0];
      if (!domainCache.has(recId)) domainCache.set(recId, fetchDomainRecord(recId));
      domainCode = (await domainCache.get(recId)!).code;
    }

    let academy: AcademyCourseRef | null = null;
    if (domainCode) {
      if (!courseCache.has(domainCode)) courseCache.set(domainCode, fetchAcademyCourse(domainCode));
      academy = await courseCache.get(domainCode)!;
    }

    puzzles.push({
      puzzle_type: type,
      public_id: str(record.fields["Public ID"]),
      puzzle_name: str(record.fields["Puzzle Name"]) || str(content?.name),
      topic: str(content?.domain),
      hints: [record.fields["Hint 1"], record.fields["Hint 2"], record.fields["Hint 3"]]
        .map(str)
        .filter((h): h is string => !!h),
      answer: extractAnswer(type, content),
      answer_explanation: str(record.fields["Answer Explanation"]),
      domain_code: domainCode,
      academy,
    });
  }

  // Keep a stable lobby-ish order for rendering.
  puzzles.sort((a, b) => PUZZLE_TYPES.indexOf(a.puzzle_type) - PUZZLE_TYPES.indexOf(b.puzzle_type));

  // Day-level domain: the one every (or the plurality of) puzzles share.
  const codes = puzzles.map((p) => p.domain_code).filter((c): c is string => !!c);
  const dayDomainCode = codes.length
    ? [...codes].sort((a, b) =>
        codes.filter((c) => c === b).length - codes.filter((c) => c === a).length
      )[0]
    : null;
  let dayDomainName: string | null = null;
  if (dayDomainCode) {
    for (const p of await Promise.all(domainCache.values())) {
      if (p.code === dayDomainCode) { dayDomainName = p.name; break; }
    }
  }

  return {
    puzzle_date: dateISO,
    domain_code: dayDomainCode,
    about_content: buildAboutContent(dateISO, puzzles, { code: dayDomainCode, name: dayDomainName }),
    puzzles,
    generator_version: GENERATOR_VERSION,
    synced_at: new Date().toISOString(),
  };
}
