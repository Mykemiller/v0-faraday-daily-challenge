// Faraday Academy — course quiz. Open to everyone, like every other screen.

import type { Metadata } from "next";
import Link from "next/link";
import { getCourse } from "@/lib/academy/api";
import { CourseNotFound, Offline } from "@/components/academy/states";
import { DoubleRule } from "@/components/academy/primitives";
import Quiz from "@/components/academy/Quiz";

// 300s ISR. Must be a static literal — Next analyses segment config without
// evaluating the module, so an imported constant is rejected at build time.
// Keep in step with ACADEMY_REVALIDATE_SECONDS in src/lib/academy/api.ts.
export const revalidate = 300;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const result = await getCourse(slug);
  if (!result.ok) return { title: "Quiz", robots: { index: false } };
  const title = `${result.data.title} — quiz`;
  const url = `/academy/${slug}/quiz`;
  return {
    title,
    description: `Check what stuck from ${result.data.title}.`,
    alternates: { canonical: url },
    openGraph: { title, url, type: "article" },
  };
}

export default async function QuizPage({ params }: Params) {
  const { slug } = await params;
  const result = await getCourse(slug);
  if (!result.ok) {
    return result.reason === "missing" ? <CourseNotFound /> : <Offline retryHref={`/academy/${slug}/quiz`} />;
  }
  const course = result.data;

  return (
    <main id="academy-main" className="mx-auto max-w-2xl px-5 py-10">
      <p className="academy-meta">
        <Link href={`/academy/${course.slug}`} style={{ color: "inherit" }}>
          {course.title}
        </Link>
      </p>
      <h1 className="mt-1 font-serif text-3xl font-bold" style={{ color: "var(--ac-text)" }}>
        Quiz
      </h1>
      <DoubleRule className="mt-3" />
      <p className="mt-4 text-sm" style={{ color: "var(--ac-muted)" }}>
        Answers are checked as you go, and each one explains itself.
      </p>

      <Quiz quiz={course.quiz} slug={course.slug} />
    </main>
  );
}
