// Pure-logic tests for the academy-public read path.
// Fixtures mirror shapes measured against the live database on 2026-09-30:
// every lesson body uses blank-line paragraph breaks (4-15 paragraphs, 601-958
// words, no bullets, no markdown headings), and 131 of 792 glossary terms carry
// a parenthetical gloss.
//   run: deno test supabase/functions/academy-public/shape.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authorOf,
  buildCatalogEntry,
  buildCourse,
  groupOf,
  paragraphsOf,
  priceOf,
  readingMinutes,
  slugifyTerm,
} from "./shape.ts";
import { type CourseBundle, type CourseRow, validateCourse } from "./validate.ts";

const RULES = { price_101_usd: 4.99, price_advanced_usd: 9.99 };

function course(over: Partial<CourseRow> = {}): CourseRow {
  return {
    id: "c1",
    course_code: "FA-D1-101",
    title: "Cooling and Water Foundations for AI Infrastructure",
    level: "101",
    voice: "Gil",
    status: "approved",
    public_slug: "cooling-and-water-foundations-for-ai-infrastructure",
    primary_domain_id: "D1",
    welcome_message: null,
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

/** A structurally whole course: 4 modules x 2 lessons, 10 quiz, 8 glossary. */
function bundle(over: Partial<CourseBundle> = {}): CourseBundle {
  const modules = [1, 2, 3, 4].map((p) => ({
    id: `m${p}`,
    course_id: "c1",
    position: p,
    title: `Module ${p}`,
    faradays_take: "The economics decide this, not the engineering.",
    knowledge_check_question: "What sets the ceiling?",
    knowledge_check_answer: "The interconnection queue.",
  }));
  const lessons = modules.flatMap((m) =>
    [1, 2].map((p) => ({
      id: `${m.id}-l${p}`,
      module_id: m.id,
      position: p,
      title: `Lesson ${p}`,
      body: "First paragraph.\n\nSecond paragraph.\n\n  Third with padding.  ",
      word_count: 770,
    }))
  );
  const quiz = Array.from({ length: 10 }, (_, i) => ({
    id: `q${i + 1}`,
    course_id: "c1",
    position: i + 1,
    question: `Question ${i + 1}?`,
    options: ["Alpha", "Beta", "Gamma", "Delta"],
    correct_answer: "Gamma",
    explanation: "Because the load factor dominates.",
  }));
  const glossary = Array.from({ length: 8 }, (_, i) => ({
    id: `g${i + 1}`,
    course_id: "c1",
    term: `Term ${i + 1}`,
    definition: `Definition ${i + 1}.`,
  }));
  return { course: course(), modules, lessons, quiz, glossary, ...over };
}

const narrationAll = new Map(
  bundle().lessons.map((l) => [l.id, { url: `https://media.faraday-academy.com/${l.id}.mp3`, duration_seconds: 322.15 }]),
);

Deno.test("paragraphs split on blank lines and trim", () => {
  assertEquals(paragraphsOf("First paragraph.\n\nSecond paragraph.\n\n  Third with padding.  "), [
    "First paragraph.",
    "Second paragraph.",
    "Third with padding.",
  ]);
  // A single newline is not a paragraph break — real bodies never rely on it.
  assertEquals(paragraphsOf("One line\nstill same paragraph"), ["One line\nstill same paragraph"]);
  assertEquals(paragraphsOf(null), []);
  assertEquals(paragraphsOf("\n\n   \n\n"), []);
});

Deno.test("reading minutes round at 220 wpm", () => {
  assertEquals(readingMinutes(770), 4);
  assertEquals(readingMinutes(6160), 28);
  assertEquals(readingMinutes(0), 0);
});

Deno.test("anchors slugify real glossary terms without collision", () => {
  assertEquals(slugifyTerm("DCIM (Data Center Infrastructure Management)"), "dcim-data-center-infrastructure-management");
  assertEquals(slugifyTerm("N-minus-one (N-1)"), "n-minus-one-n-1");
  assertEquals(slugifyTerm("Technology errors and omissions (tech E&O)"), "technology-errors-and-omissions-tech-e-o");
  assertEquals(slugifyTerm("Scope 1, 2, and 3 emissions"), "scope-1-2-and-3-emissions");
  assertEquals(slugifyTerm("Advanced Manufacturing Investment Credit (Section 48D)"), "advanced-manufacturing-investment-credit-section-48d");
});

Deno.test("author maps voice to byline; unmapped voice has none", () => {
  assertEquals(authorOf("Gil"), { voice: "gil", name: "Gilbert Faraday" });
  assertEquals(authorOf("Mach"), { voice: "mach", name: "Mach Eigen" });
  assertEquals(authorOf("Both"), null);
});

Deno.test("group is the plain domain name; Capstone groups itself", () => {
  assertEquals(groupOf(course(), "Power and Interconnection"), "Power and Interconnection");
  // The Capstone is the only course allowed to carry no primary domain.
  assertEquals(groupOf(course({ level: "Capstone", primary_domain_id: null }), null), "Capstone");
  // A non-Capstone course with no domain has no group to render.
  assertEquals(groupOf(course({ level: "201", primary_domain_id: null }), null), null);
});

Deno.test("catalog entry omits price during beta and carries it after", () => {
  const beta = buildCatalogEntry(bundle(), "Power and Interconnection", narrationAll, { free: true }, RULES);
  assertEquals("price_usd" in beta, false);
  assertEquals(beta.narrated, true);
  assertEquals(beta.reading_minutes, 28); // 8 lessons x 770 words / 220
  assertEquals(beta.code, "FA-D1-101");
  assertEquals(beta.group, "Power and Interconnection");

  const post = buildCatalogEntry(bundle(), "Power and Interconnection", narrationAll, { free: false }, RULES);
  assertEquals(post.price_usd, 4.99);
  const adv = buildCatalogEntry(
    { ...bundle(), course: course({ level: "301" }) },
    "Power and Interconnection", narrationAll, { free: false }, RULES,
  );
  assertEquals(adv.price_usd, 9.99);
  assertEquals(priceOf(course({ level: "101" }), RULES), 4.99);
});

Deno.test("narrated is true only when every lesson has audio", () => {
  const partial = new Map(narrationAll);
  partial.delete("m4-l2");
  const entry = buildCatalogEntry(bundle(), "D", partial, { free: true }, RULES);
  assertEquals(entry.narrated, false);
  const none = buildCatalogEntry(bundle(), "D", new Map(), { free: true }, RULES);
  assertEquals(none.narrated, false);
});

Deno.test("course payload: access open, per-lesson narration, correct_index", () => {
  const partial = new Map(narrationAll);
  partial.delete("m1-l2");
  const out = buildCourse(bundle(), "Power and Interconnection", partial, { free: true }, RULES) as any;

  assertEquals(out.access, "open");
  assertEquals(out.welcome_message, null); // empty welcome collapses to null
  assertEquals(out.modules.length, 4);
  assertEquals(out.modules[0].lessons.length, 2);
  assertEquals(out.modules[0].knowledge_check.question, "What sets the ceiling?");
  assertEquals(out.modules[0].lessons[0].paragraphs.length, 3);
  assertEquals(out.modules[0].lessons[0].reading_minutes, 4);
  // Partially narrated course: audio only where it exists.
  assertEquals(out.modules[0].lessons[0].narration?.duration_seconds, 322.15);
  assertEquals(out.modules[0].lessons[1].narration, null);
  assertEquals(out.quiz.length, 10);
  assertEquals(out.quiz[0].correct_index, 2); // "Gamma"
  assertEquals(out.glossary.length, 8);
  assertEquals(out.glossary[0].anchor, "term-1");
  // Internal identifiers that must never ship.
  assertEquals("primary_domain_id" in out, false);
  assertEquals("status" in out, false);
});

Deno.test("welcome message survives when present", () => {
  const out = buildCourse(
    { ...bundle(), course: course({ welcome_message: "  Welcome in.  " }) },
    "D", narrationAll, { free: true }, RULES,
  ) as any;
  assertEquals(out.welcome_message, "Welcome in.");
});

Deno.test("validator passes a whole course", () => {
  assertEquals(validateCourse(bundle()), []);
});

Deno.test("validator catches each exclusion reason", () => {
  const noSlug = validateCourse({ ...bundle(), course: course({ public_slug: null }) });
  assertEquals(noSlug.includes("missing public_slug"), true);

  const badVoice = validateCourse({ ...bundle(), course: course({ voice: "Both" }) });
  assertEquals(badVoice.some((r) => r.includes("no public byline")), true);

  const shortModules = validateCourse({ ...bundle(), modules: bundle().modules.slice(0, 3) });
  assertEquals(shortModules.some((r) => r.startsWith("module count 3")), true);

  const shortLessons = validateCourse({ ...bundle(), lessons: bundle().lessons.slice(0, 7) });
  assertEquals(shortLessons.some((r) => r.startsWith("lesson count 7")), true);

  const shortQuiz = validateCourse({ ...bundle(), quiz: bundle().quiz.slice(0, 9) });
  assertEquals(shortQuiz.some((r) => r.startsWith("quiz count 9")), true);

  const shortGlossary = validateCourse({ ...bundle(), glossary: bundle().glossary.slice(0, 7) });
  assertEquals(shortGlossary.some((r) => r.startsWith("glossary count 7")), true);

  // correct_answer matching no option, and matching two.
  const q0 = bundle().quiz.map((q, i) => (i === 0 ? { ...q, correct_answer: "Omega" } : q));
  assertEquals(validateCourse({ ...bundle(), quiz: q0 }).some((r) => r.includes("matches 0 options")), true);
  const q2 = bundle().quiz.map((q, i) => (i === 0 ? { ...q, options: ["Gamma", "Gamma", "B", "C"] } : q));
  assertEquals(validateCourse({ ...bundle(), quiz: q2 }).some((r) => r.includes("matches 2 options")), true);
});

Deno.test("validator catches taxonomy codes anywhere a learner reads", () => {
  const inBody = bundle().lessons.map((l, i) => (i === 0 ? { ...l, body: "See D2.11 for more." } : l));
  assertEquals(validateCourse({ ...bundle(), lessons: inBody }).some((r) => r.includes('"D2.11"')), true);

  const inTake = bundle().modules.map((m, i) => (i === 0 ? { ...m, faradays_take: "Tower T-001 covers it." } : m));
  assertEquals(validateCourse({ ...bundle(), modules: inTake }).some((r) => r.includes('"T-001"')), true);

  const inTitle = validateCourse({ ...bundle(), course: course({ title: "Intro to D7" }) });
  assertEquals(inTitle.some((r) => r.includes('"D7"')), true);

  const inOption = bundle().quiz.map((q, i) => (i === 0 ? { ...q, options: ["Alpha", "Beta", "Gamma", "D12"] } : q));
  assertEquals(validateCourse({ ...bundle(), quiz: inOption }).some((r) => r.includes('"D12"')), true);

  // Real terms that merely look like codes must NOT trip the guard.
  const safe = bundle().glossary.map((g, i) =>
    i === 0
      ? { ...g, term: "N-minus-one (N-1)", definition: "Section 48D and Scope 1, 2, and 3 emissions." }
      : g
  );
  assertEquals(validateCourse({ ...bundle(), glossary: safe }), []);
});
