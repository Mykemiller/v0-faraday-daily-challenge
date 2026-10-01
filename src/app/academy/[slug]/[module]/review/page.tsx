// Faraday Academy — module review. Faraday's Take as a pull quote, then the
// knowledge check behind a reveal so the reader commits before seeing the answer.

import type { Metadata } from "next";
import Link from "next/link";
import { getCourse } from "@/lib/academy/api";
import { CourseNotFound, LessonNotFound, Offline } from "@/components/academy/states";
import Outline from "@/components/academy/Outline";
import { DoubleRule } from "@/components/academy/primitives";
import { lessonHref, parsePosition } from "@/lib/academy/nav";

// 300s ISR. Must be a static literal — Next analyses segment config without
// evaluating the module, so an imported constant is rejected at build time.
// Keep in step with ACADEMY_REVALIDATE_SECONDS in src/lib/academy/api.ts.
export const revalidate = 300;

/**
 * A failed read is not always a missing course. Titling an unreachable page
 * "not found" contradicts the body, which correctly says we cannot reach the
 * library — and tells a crawler the course is gone when it is not.
 */
function failureMetadata(reason: "missing" | "offline", subject: string): Metadata {
  return reason === "missing"
    ? { title: `${subject} not found`, robots: { index: false } }
    : { title: `${subject} unavailable`, robots: { index: false } };
}

type Params = { params: Promise<{ slug: string; module: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, module } = await params;
  const mp = parsePosition(module);
  const result = await getCourse(slug);
  if (!result.ok) return failureMetadata(result.reason, "Module review");
  if (mp === null) return failureMetadata("missing", "Module review");
  const m = result.data.modules.find((x) => x.position === mp);
  if (!m) return { title: "Module review", robots: { index: false } };
  const title = `${m.title} — review`;
  const url = `/academy/${slug}/${mp}/review`;
  return {
    title,
    description: `Faraday's take on ${m.title}, plus the knowledge check.`,
    alternates: { canonical: url },
    openGraph: { title, url, type: "article" },
  };
}

export default async function ModuleReviewPage({ params }: Params) {
  const { slug, module } = await params;
  const mp = parsePosition(module);

  const result = await getCourse(slug);
  if (!result.ok) {
    return result.reason === "missing" ? <CourseNotFound /> : <Offline retryHref={`/academy/${slug}`} />;
  }
  const course = result.data;
  if (mp === null) return <LessonNotFound slug={slug} />;
  const m = course.modules.find((x) => x.position === mp);
  if (!m) return <LessonNotFound slug={slug} />;

  const nextModule = course.modules.find((x) => x.position === mp + 1);
  const lastLesson = [...m.lessons].sort((a, b) => b.position - a.position)[0];

  return (
    <div className="mx-auto flex max-w-6xl gap-10 px-5 py-6">
      <Outline course={course} currentModule={mp} />
      <main id="academy-main" className="min-w-0 flex-1 pb-24 lg:pb-10">
        <p className="academy-meta">Module {m.position} · Review</p>
        <h1 className="mt-1 font-serif text-3xl font-bold" style={{ color: "var(--ac-text)" }}>
          {m.title}
        </h1>
        <DoubleRule className="mt-3" />

        {/* Faraday's Take, set as a pull quote — the module's argument in one place. */}
        {m.faradays_take ? (
          <blockquote
            className="mt-8 px-6 py-5"
            style={{ borderLeft: "3px solid var(--ac-accent)", backgroundColor: "var(--ac-panel)" }}
          >
            <p className="academy-meta">Faraday&rsquo;s take</p>
            <p
              className="mt-2 font-serif text-xl leading-relaxed"
              style={{ color: "var(--ac-text)" }}
            >
              {m.faradays_take}
            </p>
          </blockquote>
        ) : null}

        {/* Knowledge check. <details> gives the reveal real keyboard semantics. */}
        {m.knowledge_check.question ? (
          <section className="mt-10" aria-labelledby="knowledge-check">
            <h2
              id="knowledge-check"
              className="font-serif text-xl font-bold"
              style={{ color: "var(--ac-text)" }}
            >
              Knowledge check
            </h2>
            <p className="mt-3 text-base" style={{ color: "var(--ac-text)" }}>
              {m.knowledge_check.question}
            </p>
            {m.knowledge_check.answer ? (
              <details className="mt-4">
                <summary
                  className="cursor-pointer px-4 py-2 text-sm font-medium"
                  style={{ border: "1px solid var(--ac-rule-strong)", color: "var(--ac-text)", width: "fit-content" }}
                >
                  Show the answer
                </summary>
                <div
                  className="mt-3 px-4 py-3"
                  style={{ backgroundColor: "var(--ac-panel-2)", color: "var(--ac-text)" }}
                >
                  <p>{m.knowledge_check.answer}</p>
                </div>
              </details>
            ) : null}
          </section>
        ) : null}

        <nav
          aria-label="Review navigation"
          className="mt-12 flex flex-wrap items-center justify-between gap-3 pt-6"
          style={{ borderTop: "1px solid var(--ac-rule)" }}
        >
          {lastLesson ? (
            <Link
              href={lessonHref(course.slug, m.position, lastLesson.position)}
              className="px-3 py-2 text-sm"
              style={{ border: "1px solid var(--ac-rule-strong)", color: "var(--ac-text)" }}
            >
              <span aria-hidden="true">← </span>Back to the last lesson
            </Link>
          ) : (
            <span />
          )}
          {nextModule && nextModule.lessons[0] ? (
            <Link
              href={lessonHref(course.slug, nextModule.position, nextModule.lessons[0].position)}
              className="px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: "var(--ac-forest)", color: "var(--ac-bg)" }}
            >
              Start module {nextModule.position}
              <span aria-hidden="true"> →</span>
            </Link>
          ) : (
            <Link
              href={`/academy/${course.slug}/quiz`}
              className="px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: "var(--ac-forest)", color: "var(--ac-bg)" }}
            >
              Take the quiz<span aria-hidden="true"> →</span>
            </Link>
          )}
        </nav>
      </main>
    </div>
  );
}
