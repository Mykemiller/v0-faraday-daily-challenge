// Faraday Academy — the design's component sheet, static half.
// Course row · outline item · citation chip · level and duration meta · the
// double rule. Client-only pieces (audio bar, quiz option, diagram and chart
// frames, proposal diff card) live in their own files.

import Link from "next/link";
import type { CatalogCourse } from "@/lib/academy/types";

/** Skip link — first focusable element on every academy page. */
export function SkipToLesson({ targetId = "academy-main" }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:px-4 focus:py-2"
      style={{ backgroundColor: "var(--ac-forest)", color: "var(--ac-bg)" }}
    >
      Skip to the lesson
    </a>
  );
}

/** Forest over gold — Faraday's editorial signature. Decorative only. */
export function DoubleRule({ className = "" }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <div style={{ height: 3, width: 68, backgroundColor: "var(--ac-forest)" }} />
      <div style={{ height: 1, width: 68, backgroundColor: "var(--ac-accent)" }} />
    </div>
  );
}

/** Level in mono — "101", "Capstone". Never a domain or tower code. */
export function LevelChip({ level }: { level: string }) {
  return (
    <span
      className="academy-meta px-1.5 py-0.5"
      style={{ border: "1px solid var(--ac-rule-strong)" }}
    >
      {level}
    </span>
  );
}

export function Meta({ children }: { children: React.ReactNode }) {
  return <span className="academy-meta">{children}</span>;
}

/** Reading time. Mono, because it is data. */
export function ReadingTime({ minutes }: { minutes: number }) {
  return <Meta>{minutes} min read</Meta>;
}

/** Marks a narrated course or lesson. Icon plus words, never colour alone. */
export function NarratedBadge() {
  return (
    <Meta>
      <span aria-hidden="true">▶ </span>
      Narrated
    </Meta>
  );
}

/**
 * "Free during beta". Shown while academy_commercial_rules.beta_mode is true,
 * which is also why no price appears anywhere on the surface.
 */
export function FreeDuringBeta() {
  return (
    <span
      className="academy-meta px-2 py-0.5"
      style={{ backgroundColor: "var(--ac-accent)", color: "#1c3424" }}
    >
      Free during beta
    </span>
  );
}

/** One catalog row. The whole row is the link target. */
export function CourseRow({ course }: { course: CatalogCourse }) {
  return (
    <li>
      <Link
        href={`/academy/${course.slug}`}
        className="block px-4 py-4 transition-colors"
        style={{ borderBottom: "1px solid var(--ac-rule)" }}
      >
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="font-serif text-lg font-bold" style={{ color: "var(--ac-text)" }}>
            {course.title}
          </h3>
          <LevelChip level={course.level} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {course.author ? <Meta>{course.author.name}</Meta> : null}
          <ReadingTime minutes={course.reading_minutes} />
          {course.narrated ? <NarratedBadge /> : null}
        </div>
      </Link>
    </li>
  );
}

/** One line in the outline: a lesson, or a module's review. */
export function OutlineItem({
  href,
  label,
  sublabel,
  current = false,
  visited = false,
}: {
  href: string;
  label: string;
  sublabel?: string;
  current?: boolean;
  visited?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={current ? "page" : undefined}
        className="block px-3 py-2"
        style={{
          borderLeft: current ? "3px solid var(--ac-accent)" : "3px solid transparent",
          backgroundColor: current ? "var(--ac-panel-2)" : "transparent",
          color: "var(--ac-text)",
        }}
      >
        <span className="text-sm">
          {label}
          {/* Visited is marked in words as well as weight, never colour alone. */}
          {visited && !current ? (
            <span className="sr-only"> (read)</span>
          ) : null}
        </span>
        {sublabel ? (
          <span className="academy-meta mt-0.5 block">{sublabel}</span>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * A numbered source in the AI panel. Always carries the retrieval date, because
 * a sourced claim without a date is not checkable.
 */
export function CitationChip({
  index,
  title,
  url,
  retrieved,
}: {
  index: number;
  title: string;
  url: string;
  retrieved?: string | null;
}) {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    host = url;
  }
  return (
    <li className="text-sm">
      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="underline">
        <span className="academy-meta" style={{ color: "inherit" }}>
          [{index}]
        </span>{" "}
        {title}
      </a>
      <span className="academy-meta ml-1">
        {host}
        {retrieved ? ` · retrieved ${retrieved}` : ""}
      </span>
    </li>
  );
}

/** Labels everything the model wrote. Sage ground, never the serif column. */
export function AiMaterialLabel() {
  return (
    <p className="academy-meta font-medium" style={{ color: "var(--ac-sage-text)" }}>
      Supplementary AI material
    </p>
  );
}
