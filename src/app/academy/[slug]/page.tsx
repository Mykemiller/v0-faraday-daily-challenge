// Faraday Academy — course home.

import type { Metadata } from "next";
import Link from "next/link";
import { getCourse } from "@/lib/academy/api";
import { CourseNotFound, Offline } from "@/components/academy/states";
import {
  DoubleRule,
  FreeDuringBeta,
  LevelChip,
  Meta,
  NarratedBadge,
  ReadingTime,
} from "@/components/academy/primitives";
import ResumeLink from "@/components/academy/ResumeLink";
import { lessonHref, reviewHref } from "@/lib/academy/nav";

// 300s ISR. Must be a static literal — Next analyses segment config without
// evaluating the module, so an imported constant is rejected at build time.
// Keep in step with ACADEMY_REVALIDATE_SECONDS in src/lib/academy/api.ts.
export const revalidate = 300;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const result = await getCourse(slug);
  if (!result.ok) return { title: "Course not found", robots: { index: false } };
  const c = result.data;
  const description =
    c.welcome_message?.slice(0, 155) ??
    `${c.title} — ${c.reading_minutes} minutes of reading${c.author ? `, by ${c.author.name}` : ""}. Free during beta.`;
  return {
    title: c.title,
    description,
    alternates: { canonical: `/academy/${c.slug}` },
    openGraph: { title: c.title, description, url: `/academy/${c.slug}`, type: "article" },
  };
}

export default async function CourseHomePage({ params }: Params) {
  const { slug } = await params;
  const result = await getCourse(slug);
  if (!result.ok) {
    return result.reason === "missing" ? <CourseNotFound /> : <Offline retryHref={`/academy/${slug}`} />;
  }
  const course = result.data;
  const modules = [...course.modules].sort((a, b) => a.position - b.position);
  const firstModule = modules[0];
  const firstLesson = firstModule?.lessons?.[0];

  // Course structured data. No price while beta is on, and never a course code.
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: course.title,
    description: course.welcome_message ?? `${course.title} — Faraday Academy.`,
    url: `/academy/${course.slug}`,
    inLanguage: "en",
    isAccessibleForFree: true,
    provider: { "@type": "Organization", name: "Faraday" },
    ...(course.author ? { author: { "@type": "Person", name: course.author.name } } : {}),
    ...(course.group ? { about: course.group } : {}),
    hasCourseInstance: {
      "@type": "CourseInstance",
      courseMode: "online",
      courseWorkload: `PT${Math.max(course.reading_minutes, 1)}M`,
    },
  };

  return (
    <main id="academy-main" className="mx-auto max-w-3xl px-5 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <p className="academy-meta">
        <Link href="/academy" style={{ color: "inherit" }}>
          Catalog
        </Link>
        {course.group ? ` · ${course.group}` : ""}
      </p>

      <h1 className="mt-2 font-serif text-4xl font-bold" style={{ color: "var(--ac-text)" }}>
        {course.title}
      </h1>
      <DoubleRule className="mt-3" />

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <LevelChip level={course.level} />
        {course.author ? <Meta>{course.author.name}</Meta> : null}
        <ReadingTime minutes={course.reading_minutes} />
        {course.narrated ? <NarratedBadge /> : null}
        <FreeDuringBeta />
      </div>

      {/* The welcome block is omitted entirely when there is no message. */}
      {course.welcome_message ? (
        <div
          className="mt-8 px-5 py-4"
          style={{ backgroundColor: "var(--ac-panel)", borderLeft: "3px solid var(--ac-accent)" }}
        >
          <p className="font-serif text-lg" style={{ color: "var(--ac-text)" }}>
            {course.welcome_message}
          </p>
        </div>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3">
        {firstLesson ? (
          <Link
            href={lessonHref(course.slug, firstModule.position, firstLesson.position)}
            className="inline-block px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: "var(--ac-accent)", color: "#1c3424" }}
          >
            Start reading
          </Link>
        ) : null}
        <ResumeLink slug={course.slug} />
      </div>

      <h2 className="mt-12 font-serif text-2xl font-bold" style={{ color: "var(--ac-text)" }}>
        What&rsquo;s inside
      </h2>
      <ol className="mt-4">
        {modules.map((m) => (
          <li key={m.position} className="py-4" style={{ borderTop: "1px solid var(--ac-rule)" }}>
            <p className="academy-meta">Module {m.position}</p>
            <h3 className="font-serif text-lg font-bold" style={{ color: "var(--ac-text)" }}>
              {m.title}
            </h3>
            <ul className="mt-2 space-y-1">
              {[...m.lessons]
                .sort((a, b) => a.position - b.position)
                .map((l) => (
                  <li key={l.id} className="text-sm">
                    <Link
                      href={lessonHref(course.slug, m.position, l.position)}
                      style={{ color: "var(--ac-text)" }}
                    >
                      {l.title}
                    </Link>
                    <Meta>
                      {" · "}
                      {l.reading_minutes} min{l.narration ? " · narrated" : ""}
                    </Meta>
                  </li>
                ))}
              <li className="text-sm">
                <Link href={reviewHref(course.slug, m.position)} style={{ color: "var(--ac-accent-text)" }}>
                  Module review
                </Link>
              </li>
            </ul>
          </li>
        ))}
      </ol>

      <div
        className="mt-10 flex flex-wrap gap-3 pt-6"
        style={{ borderTop: "1px solid var(--ac-rule)" }}
      >
        <Link
          href={`/academy/${course.slug}/quiz`}
          className="px-4 py-2 text-sm"
          style={{ border: "1px solid var(--ac-rule-strong)", color: "var(--ac-text)" }}
        >
          Take the quiz
        </Link>
        <Link
          href={`/academy/${course.slug}/glossary`}
          className="px-4 py-2 text-sm"
          style={{ border: "1px solid var(--ac-rule-strong)", color: "var(--ac-text)" }}
        >
          Glossary
        </Link>
      </div>
    </main>
  );
}
