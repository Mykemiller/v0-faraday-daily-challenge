// Faraday Academy player — the shapes the academy-public edge function returns.
// The player renders only what is here. Internal taxonomy identifiers are not in
// this file because they are never sent: no domain code, no tower code, no
// totals, no counts of domains or courses.

export type AuthorVoice = "gil" | "mach";

export type Author = {
  voice: AuthorVoice;
  name: string;
};

export type CourseLevel = "101" | "201" | "301" | "401" | "X" | "Capstone";

/** One row in the catalog. `code` is an opaque id for AI calls — never rendered. */
export type CatalogCourse = {
  code: string;
  slug: string;
  title: string;
  level: CourseLevel;
  author: Author | null;
  /** The plain domain name, or "Capstone". */
  group: string | null;
  reading_minutes: number;
  narrated: boolean;
  /** Present only after beta ends. Never rendered while beta.free is true. */
  price_usd?: number | null;
  /**
   * One sentence lifted from the course's own copy, never generated, and null
   * where none could be taken safely. Optional: a catalog served by an older
   * deployment of the function does not carry it.
   */
  summary?: string | null;
  /** Audience lenses. Optional for the same reason as `summary`. */
  personas?: string[];
};

export type Catalog = {
  generated_at: string;
  beta: { free: boolean };
  courses: CatalogCourse[];
};

export type Narration = {
  url: string;
  duration_seconds: number | null;
};

export type Lesson = {
  id: string;
  position: number;
  title: string | null;
  paragraphs: string[];
  word_count: number;
  reading_minutes: number;
  /** Null where narration has not been produced for this lesson yet. */
  narration: Narration | null;
};

export type KnowledgeCheck = {
  question: string | null;
  answer: string | null;
};

export type Module = {
  position: number;
  title: string | null;
  faradays_take: string | null;
  knowledge_check: KnowledgeCheck;
  lessons: Lesson[];
};

export type QuizItem = {
  position: number;
  question: string | null;
  options: string[];
  correct_index: number;
  explanation: string | null;
};

export type GlossaryEntry = {
  term: string;
  anchor: string;
  definition: string | null;
};

export type Course = CatalogCourse & {
  welcome_message: string | null;
  access: "open";
  modules: Module[];
  quiz: QuizItem[];
  glossary: GlossaryEntry[];
};

export type SitemapEntry = {
  slug: string;
  updated_at: string | null;
};

export type Sitemap = {
  generated_at: string;
  courses: SitemapEntry[];
};

/**
 * Why a read did not produce data. The player has a designed state for each:
 * `missing` renders "course not found", `offline` renders the offline state.
 * There is no locked or paywalled failure — lessons are fully open.
 */
export type ReadFailure = "missing" | "offline";

export type ReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ReadFailure };

/** A lesson located within its course, for the reader and its navigation. */
export type LessonLocation = {
  module: Module;
  lesson: Lesson;
  /** 1-based index across the whole course, for the progress bar. */
  ordinal: number;
  total: number;
  prev: { module: number; lesson: number } | null;
  next: { module: number; lesson: number } | null;
};
