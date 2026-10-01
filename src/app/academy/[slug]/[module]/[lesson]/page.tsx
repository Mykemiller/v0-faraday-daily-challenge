// Faraday Academy — the lesson reader. Fully open: no gate, no locked state.

import type { Metadata } from "next";
import { getCourse } from "@/lib/academy/api";
import { CourseNotFound, LessonNotFound, Offline } from "@/components/academy/states";
import Outline from "@/components/academy/Outline";
import ReaderShell from "@/components/academy/ReaderShell";
import LessonBody from "@/components/academy/LessonBody";
import { locateLesson, parsePosition } from "@/lib/academy/nav";

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

type Params = { params: Promise<{ slug: string; module: string; lesson: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, module, lesson } = await params;
  const mp = parsePosition(module);
  const lp = parsePosition(lesson);
  const result = await getCourse(slug);
  if (!result.ok) return failureMetadata(result.reason, "Lesson");
  if (mp === null || lp === null) return failureMetadata("missing", "Lesson");
  const located = locateLesson(result.data, mp, lp);
  if (!located) return { title: "Lesson not found", robots: { index: false } };

  const title = located.lesson.title ?? `Lesson ${lp}`;
  const description =
    located.lesson.paragraphs[0]?.slice(0, 155) ?? `${title} — ${result.data.title}.`;
  const url = `/academy/${slug}/${mp}/${lp}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "article" },
  };
}

export default async function LessonPage({ params }: Params) {
  const { slug, module, lesson } = await params;
  const mp = parsePosition(module);
  const lp = parsePosition(lesson);

  const result = await getCourse(slug);
  if (!result.ok) {
    return result.reason === "missing" ? <CourseNotFound /> : <Offline retryHref={`/academy/${slug}`} />;
  }
  const course = result.data;

  if (mp === null || lp === null) return <LessonNotFound slug={slug} />;
  const located = locateLesson(course, mp, lp);
  if (!located) return <LessonNotFound slug={slug} />;

  // Drives the "narration not recorded yet" note: only shown when this course has
  // audio elsewhere, so a wholly un-narrated course says nothing about audio.
  const courseHasNarration = course.modules.some((m) => m.lessons.some((l) => l.narration));

  // LearningResource — the lesson is the unit a reader lands on from search.
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: located.lesson.title,
    url: `/academy/${slug}/${mp}/${lp}`,
    inLanguage: "en",
    isAccessibleForFree: true,
    learningResourceType: "Lesson",
    timeRequired: `PT${Math.max(located.lesson.reading_minutes, 1)}M`,
    isPartOf: { "@type": "Course", name: course.title, url: `/academy/${slug}` },
    ...(course.author ? { author: { "@type": "Person", name: course.author.name } } : {}),
  };

  return (
    <div className="mx-auto flex max-w-6xl gap-10 px-5 py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Outline course={course} currentModule={mp} currentLesson={lp} />
      <main id="academy-main" className="min-w-0 flex-1 pb-24 lg:pb-10">
        <ReaderShell course={course} location={located} courseHasNarration={courseHasNarration}>
          <LessonBody
            paragraphs={located.lesson.paragraphs}
            glossary={course.glossary}
            slug={course.slug}
          />
        </ReaderShell>
      </main>
    </div>
  );
}
