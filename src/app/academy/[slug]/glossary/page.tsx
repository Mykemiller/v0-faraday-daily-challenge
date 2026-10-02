// Faraday Academy — course glossary. Anchors here are the targets the reader's
// in-text term links point at, so every anchor must stay stable.

import type { Metadata } from "next";
import Link from "next/link";
import { getCourse } from "@/lib/academy/api";
import { CourseNotFound, Offline } from "@/components/academy/states";
import { DoubleRule } from "@/components/academy/primitives";

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

/**
 * Empty on purpose: nothing is prerendered at build, but declaring the function
 * opts the route into ISR instead of per-request dynamic rendering. Without it
 * the `revalidate` above is inert — the route renders fresh on every view.
 */
export async function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const result = await getCourse(slug);
  if (!result.ok) return failureMetadata(result.reason, "Glossary");
  const title = `${result.data.title} — glossary`;
  const url = `/academy/${slug}/glossary`;
  return {
    title,
    description: `The terms used in ${result.data.title}, defined.`,
    alternates: { canonical: url },
    openGraph: { title, url, type: "article" },
  };
}

export default async function GlossaryPage({ params }: Params) {
  const { slug } = await params;
  const result = await getCourse(slug);
  if (!result.ok) {
    return result.reason === "missing" ? <CourseNotFound /> : <Offline retryHref={`/academy/${slug}/glossary`} />;
  }
  const course = result.data;

  return (
    <main id="academy-main" className="mx-auto max-w-3xl px-5 py-10">
      <p className="academy-meta">
        <Link href={`/academy/${course.slug}`} style={{ color: "inherit" }}>
          {course.title}
        </Link>
      </p>
      <h1 className="mt-1 font-serif text-3xl font-bold" style={{ color: "var(--ac-text)" }}>
        Glossary
      </h1>
      <DoubleRule className="mt-3" />

      {course.glossary.length === 0 ? (
        <p className="mt-8 text-sm" style={{ color: "var(--ac-muted)" }}>
          This course has no glossary yet.
        </p>
      ) : (
        <dl className="mt-8">
          {course.glossary.map((g) => (
            <div
              key={g.anchor}
              id={g.anchor}
              className="py-5"
              style={{ borderTop: "1px solid var(--ac-rule)", scrollMarginTop: "2rem" }}
            >
              <dt className="font-serif text-lg font-bold" style={{ color: "var(--ac-text)" }}>
                {g.term}
              </dt>
              <dd className="mt-1.5 text-base" style={{ color: "var(--ac-text)" }}>
                {g.definition}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </main>
  );
}
