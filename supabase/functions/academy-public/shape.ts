// Faraday Academy — public JSON shaping.
//
// The player never sees internal identifiers it does not need: no domain_code,
// no tower code, no counts of domains or courses, and no totals. course_code is
// carried as an opaque `code` because the AI panel keys on it; the player never
// renders it.

import {
  type CourseBundle,
  type CourseRow,
  type GlossaryRow,
  type LessonRow,
  type ModuleRow,
  type QuizRow,
  findBannedPhrase,
  findCode,
  optionsOf,
} from "./validate.ts";

const WORDS_PER_MINUTE = 220;

export type Narration = { url: string; duration_seconds: number | null };
export type NarrationMap = Map<string, Narration>; // lesson_id -> narration

export type Beta = { free: boolean };

export function readingMinutes(words: number): number {
  return Math.round(words / WORDS_PER_MINUTE);
}

/** Blank-line separated paragraphs, trimmed, empties dropped. */
export function paragraphsOf(body: string | null): string[] {
  if (!body) return [];
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Glossary anchor: slugified term. */
export function slugifyTerm(term: string): string {
  return term
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const AUTHORS: Record<string, { voice: string; name: string }> = {
  Gil: { voice: "gil", name: "Gilbert Faraday" },
  Mach: { voice: "mach", name: "Mach Eigen" },
};

export function authorOf(voice: string): { voice: string; name: string } | null {
  return AUTHORS[voice] ?? null;
}

/**
 * Plain domain name. A course with no primary domain at level Capstone groups
 * under "Capstone" by design — that is the only course allowed to lack a domain.
 */
export function groupOf(course: CourseRow, domainName: string | null): string | null {
  if (domainName) return domainName;
  if (course.level === "Capstone") return "Capstone";
  return null;
}

function courseWordCount(lessons: LessonRow[]): number {
  return lessons.reduce((sum, l) => sum + (l.word_count ?? 0), 0);
}

function isFullyNarrated(lessons: LessonRow[], narration: NarrationMap): boolean {
  return lessons.length > 0 && lessons.every((l) => narration.has(l.id));
}

/** Post-beta price. Never called while beta_mode is true. */
export function priceOf(
  course: CourseRow,
  rules: { price_101_usd: number | null; price_advanced_usd: number | null },
): number | null {
  return course.level === "101" ? rules.price_101_usd : rules.price_advanced_usd;
}

export const SUMMARY_MAX = 160;

/** The only persona names the lobby renders. Anything else is dropped. */
export const PERSONAS: readonly string[] = [
  "Executive", "Engineer", "Investor", "Operator", "Policy", "Consultant",
];

export function personasOf(course: CourseRow): string[] {
  const raw = course.audience_personas;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of raw) {
    const name = typeof p === "string" ? p.trim() : "";
    if (PERSONAS.includes(name) && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * First sentence. Terminators are . ! ? followed by whitespace; a single
 * capital letter before the period is treated as an initial rather than an
 * ending, which is the only abbreviation case that shows up in this copy.
 */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  if (!m) return t;
  const candidate = m[0].trim();
  // "…by J. Smith." — a lone capital before the stop is an initial, not an end.
  if (/\s[A-Z]\.$/.test(candidate) && candidate.length < t.length) {
    const rest = t.slice(candidate.length).match(/^[\s\S]*?[.!?](?=\s|$)/);
    if (rest) return (candidate + rest[0]).trim();
  }
  return candidate;
}

/** Clips on a word boundary and marks the clip with an ellipsis. */
export function clip(text: string, max = SUMMARY_MAX): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.!?-]+$/, "")}…`;
}

/** The lesson a reader meets first: lowest module position, then lowest lesson position. */
function firstLessonBody(b: CourseBundle): string | null {
  const modulePosition = new Map(b.modules.map((m) => [m.id, m.position]));
  const ordered = b.lessons
    .filter((l) => modulePosition.has(l.module_id))
    .sort((a, c) =>
      (modulePosition.get(a.module_id)! - modulePosition.get(c.module_id)!) ||
      (a.position - c.position)
    );
  return ordered[0]?.body ?? null;
}

/**
 * A short, honest card line taken from copy that already exists: the welcome
 * message if there is one, else the opening paragraph of the first lesson.
 * Nothing is generated. A summary that trips the taxonomy-code guard or the
 * house-style guard is dropped to null rather than cleaned up — the lobby
 * renders no description at all, which is better than a laundered one.
 */
export function summaryOf(b: CourseBundle): string | null {
  const welcome = b.course.welcome_message?.trim();
  const source = welcome && welcome.length > 0
    ? welcome
    : paragraphsOf(firstLessonBody(b))[0] ?? "";
  if (!source) return null;

  const summary = clip(firstSentence(source));
  if (!summary) return null;
  if (findCode(summary)) return null;
  if (findBannedPhrase(summary)) return null;
  return summary;
}

export type CatalogEntry = Record<string, unknown>;

export function buildCatalogEntry(
  b: CourseBundle,
  domainName: string | null,
  narration: NarrationMap,
  beta: Beta,
  rules: { price_101_usd: number | null; price_advanced_usd: number | null },
): CatalogEntry {
  const author = authorOf(b.course.voice);
  const entry: CatalogEntry = {
    code: b.course.course_code,
    slug: b.course.public_slug,
    title: b.course.title,
    level: b.course.level,
    author,
    group: groupOf(b.course, domainName),
    reading_minutes: readingMinutes(courseWordCount(b.lessons)),
    narrated: isFullyNarrated(b.lessons, narration),
    summary: summaryOf(b),
    personas: personasOf(b.course),
  };
  // Beta: no price anywhere. Post-beta this path carries the stored price.
  if (!beta.free) entry.price_usd = priceOf(b.course, rules);
  return entry;
}

function buildLesson(l: LessonRow, narration: NarrationMap) {
  const words = l.word_count ?? 0;
  const n = narration.get(l.id) ?? null;
  return {
    id: l.id,
    position: l.position,
    title: l.title,
    paragraphs: paragraphsOf(l.body),
    word_count: words,
    reading_minutes: readingMinutes(words),
    // Per lesson, so a partially narrated course shows audio only where it exists.
    narration: n ? { url: n.url, duration_seconds: n.duration_seconds } : null,
  };
}

function buildModule(m: ModuleRow, lessons: LessonRow[], narration: NarrationMap) {
  return {
    position: m.position,
    title: m.title,
    faradays_take: m.faradays_take,
    knowledge_check: {
      question: m.knowledge_check_question,
      answer: m.knowledge_check_answer,
    },
    lessons: lessons
      .slice()
      .sort((a, c) => a.position - c.position)
      .map((l) => buildLesson(l, narration)),
  };
}

function buildQuizItem(q: QuizRow) {
  const options = optionsOf(q);
  return {
    position: q.position,
    question: q.question,
    options,
    correct_index: options.findIndex((o) => o === q.correct_answer),
    explanation: q.explanation,
  };
}

function buildGlossaryItem(g: GlossaryRow) {
  const term = g.term ?? "";
  return { term, anchor: slugifyTerm(term), definition: g.definition };
}

export function buildCourse(
  b: CourseBundle,
  domainName: string | null,
  narration: NarrationMap,
  beta: Beta,
  rules: { price_101_usd: number | null; price_advanced_usd: number | null },
): Record<string, unknown> {
  const welcome = b.course.welcome_message?.trim();
  const lessonsByModule = new Map<string, LessonRow[]>();
  for (const l of b.lessons) {
    const arr = lessonsByModule.get(l.module_id) ?? [];
    arr.push(l);
    lessonsByModule.set(l.module_id, arr);
  }

  return {
    ...buildCatalogEntry(b, domainName, narration, beta, rules),
    welcome_message: welcome && welcome.length > 0 ? welcome : null,
    access: "open",
    modules: b.modules
      .slice()
      .sort((a, c) => a.position - c.position)
      .map((m) => buildModule(m, lessonsByModule.get(m.id) ?? [], narration)),
    quiz: b.quiz
      .slice()
      .sort((a, c) => a.position - c.position)
      .map(buildQuizItem),
    glossary: b.glossary
      .slice()
      .sort((a, c) => (a.term ?? "").localeCompare(c.term ?? ""))
      .map(buildGlossaryItem),
  };
}
