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
