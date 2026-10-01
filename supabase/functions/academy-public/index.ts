import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Faraday Academy — public read path.
//
//   GET /academy-public/catalog        every servable course, grouped by domain name
//   GET /academy-public/course/:slug   one course, whole
//   GET /academy-public/sitemap        slug + updated_at per servable course
//   GET /academy-public/validate       exclusion list (header secret required)
//
// Lessons are fully open: no auth, no purchase gate, no locked state. Deployed
// with --no-verify-jwt; the service role key never leaves this function. The
// anon key has no access to academy tables, which is why the player reads here
// rather than through a public view.

import {
  type CourseBundle,
  type CourseRow,
  type GlossaryRow,
  type LessonRow,
  type ModuleRow,
  type QuizRow,
  type Exclusion,
  SERVABLE_STATUSES,
  validateCourse,
} from "./validate.ts";
import {
  type Beta,
  type NarrationMap,
  buildCatalogEntry,
  buildCourse,
} from "./shape.ts";

const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=86400";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-academy-validate-secret",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": CACHE_CONTROL },
  });
}

// One 404 for every miss: wrong status, unknown slug, or failed validation. A
// broken course must be indistinguishable from one that was never there.
function notFound(): Response {
  return json({ error: "Not found" }, 404);
}

// PostgREST caps a response at 1000 rows and does it silently. The quiz bank is
// already at 990. Every full-table read here is paged so adding one course can
// never truncate the catalog.
const PAGE = 1000;
async function fetchAll<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const COURSE_COLS =
  "id, course_code, title, level, voice, status, public_slug, primary_domain_id, welcome_message, updated_at";
const MODULE_COLS =
  "id, course_id, position, title, faradays_take, knowledge_check_question, knowledge_check_answer";
const LESSON_COLS = "id, module_id, position, title, body, word_count";
const QUIZ_COLS = "id, course_id, position, question, options, correct_answer, explanation";
const GLOSSARY_COLS = "id, course_id, term, definition";

type Rules = {
  beta_mode: boolean;
  free_layer_enabled: boolean;
  price_101_usd: number | null;
  price_advanced_usd: number | null;
};

async function loadRules(db: SupabaseClient): Promise<{ beta: Beta; rules: Rules }> {
  const { data, error } = await db
    .from("academy_commercial_rules")
    .select("beta_mode, free_layer_enabled, price_101_usd, price_advanced_usd")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`commercial_rules: ${error.message}`);
  // Fail closed: an unreadable rules row must not expose a price.
  const rules: Rules = {
    beta_mode: data?.beta_mode ?? true,
    free_layer_enabled: data?.free_layer_enabled ?? true,
    price_101_usd: data?.price_101_usd ?? null,
    price_advanced_usd: data?.price_advanced_usd ?? null,
  };
  return { beta: { free: rules.beta_mode }, rules };
}

async function loadDomainNames(db: SupabaseClient): Promise<Map<string, string>> {
  const rows = await fetchAll<{ domain_code: string; domain_name: string | null }>(
    db,
    "academy_domains",
    "domain_code, domain_name",
  );
  const m = new Map<string, string>();
  for (const r of rows) if (r.domain_name) m.set(r.domain_code, r.domain_name);
  return m;
}

async function loadNarration(db: SupabaseClient): Promise<NarrationMap> {
  const { data, error } = await db
    .from("academy_course_media")
    .select("lesson_id, r2_url, duration_seconds")
    .eq("media_type", "audio_narration")
    .eq("status", "produced")
    .not("lesson_id", "is", null)
    .not("r2_url", "is", null);
  if (error) throw new Error(`media: ${error.message}`);
  const m: NarrationMap = new Map();
  for (const r of (data ?? []) as Array<{ lesson_id: string; r2_url: string; duration_seconds: number | null }>) {
    m.set(r.lesson_id, { url: r.r2_url, duration_seconds: r.duration_seconds });
  }
  return m;
}

/** Every servable course, assembled and validated. */
async function loadBundles(
  db: SupabaseClient,
): Promise<{ bundles: CourseBundle[]; exclusions: Exclusion[] }> {
  const courses = (await fetchAll<CourseRow>(db, "academy_courses", COURSE_COLS)).filter((c) =>
    (SERVABLE_STATUSES as readonly string[]).includes(c.status)
  );
  const servableIds = new Set(courses.map((c) => c.id));

  const [modules, lessonsAll, quiz, glossary] = await Promise.all([
    fetchAll<ModuleRow>(db, "academy_course_modules", MODULE_COLS),
    fetchAll<LessonRow>(db, "academy_course_lessons", LESSON_COLS),
    fetchAll<QuizRow>(db, "academy_course_quiz_bank", QUIZ_COLS),
    fetchAll<GlossaryRow>(db, "academy_course_glossary", GLOSSARY_COLS),
  ]);

  const modulesByCourse = new Map<string, ModuleRow[]>();
  const moduleToCourse = new Map<string, string>();
  for (const m of modules) {
    if (!servableIds.has(m.course_id)) continue;
    moduleToCourse.set(m.id, m.course_id);
    const arr = modulesByCourse.get(m.course_id) ?? [];
    arr.push(m);
    modulesByCourse.set(m.course_id, arr);
  }

  // Lessons are keyed by module, so they reach a course only through its modules.
  const lessonsByCourse = new Map<string, LessonRow[]>();
  for (const l of lessonsAll) {
    const courseId = moduleToCourse.get(l.module_id);
    if (!courseId) continue;
    const arr = lessonsByCourse.get(courseId) ?? [];
    arr.push(l);
    lessonsByCourse.set(courseId, arr);
  }

  const byCourse = <T extends { course_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      if (!servableIds.has(r.course_id)) continue;
      const arr = m.get(r.course_id) ?? [];
      arr.push(r);
      m.set(r.course_id, arr);
    }
    return m;
  };
  const quizByCourse = byCourse(quiz);
  const glossaryByCourse = byCourse(glossary);

  const bundles: CourseBundle[] = [];
  const exclusions: Exclusion[] = [];
  for (const course of courses) {
    const bundle: CourseBundle = {
      course,
      modules: modulesByCourse.get(course.id) ?? [],
      lessons: lessonsByCourse.get(course.id) ?? [],
      quiz: quizByCourse.get(course.id) ?? [],
      glossary: glossaryByCourse.get(course.id) ?? [],
    };
    const reasons = validateCourse(bundle);
    if (reasons.length > 0) {
      exclusions.push({ code: course.course_code, slug: course.public_slug, reasons });
      // Server log so an excluded course is visible without hitting /validate.
      console.warn(`academy-public: excluding ${course.course_code}: ${reasons.join("; ")}`);
      continue;
    }
    bundles.push(bundle);
  }
  return { bundles, exclusions };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  // Tolerate both /functions/v1/academy-public/x and /academy-public/x.
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("academy-public");
  const route = i >= 0 ? parts.slice(i + 1) : parts;
  const head = route[0] ?? "";

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    if (head === "catalog") {
      const [{ beta, rules }, domains, narration, loaded] = await Promise.all([
        loadRules(db),
        loadDomainNames(db),
        loadNarration(db),
        loadBundles(db),
      ]);
      const courses = loaded.bundles.map((b) =>
        buildCatalogEntry(
          b,
          b.course.primary_domain_id ? domains.get(b.course.primary_domain_id) ?? null : null,
          narration,
          beta,
          rules,
        )
      );
      return json({ generated_at: new Date().toISOString(), beta, courses });
    }

    if (head === "course") {
      const slug = route[1];
      if (!slug) return notFound();
      const [{ beta, rules }, domains, narration, loaded] = await Promise.all([
        loadRules(db),
        loadDomainNames(db),
        loadNarration(db),
        loadBundles(db),
      ]);
      const b = loaded.bundles.find((x) => x.course.public_slug === slug);
      if (!b) return notFound();
      return json(
        buildCourse(
          b,
          b.course.primary_domain_id ? domains.get(b.course.primary_domain_id) ?? null : null,
          narration,
          beta,
          rules,
        ),
      );
    }

    if (head === "sitemap") {
      const { bundles } = await loadBundles(db);
      return json({
        generated_at: new Date().toISOString(),
        courses: bundles.map((b) => ({
          slug: b.course.public_slug,
          updated_at: b.course.updated_at,
        })),
      });
    }

    if (head === "validate") {
      const secret = Deno.env.get("ACADEMY_VALIDATE_SECRET");
      const given = req.headers.get("x-academy-validate-secret");
      if (!secret || !given || given !== secret) return notFound();
      const { bundles, exclusions } = await loadBundles(db);
      return json({
        generated_at: new Date().toISOString(),
        servable: bundles.length,
        excluded: exclusions.length,
        exclusions,
      });
    }

    return notFound();
  } catch (err) {
    console.error("academy-public error:", err instanceof Error ? err.message : err);
    return json({ error: "Internal error" }, 500);
  }
});
