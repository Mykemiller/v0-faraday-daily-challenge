"use client";
// Faraday Academy — reader chrome around the lesson column.
//
// Owns the three things that need the browser: the progress bar, left/right arrow
// navigation, and writing progress to localStorage. The lesson text itself is
// rendered on the server and arrives as children.

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AudioBar from "./AudioBar";
import { NarrationUnavailable } from "./states";
import { getLessonProgress, recordLesson } from "@/lib/academy/progress";
import { lessonHref } from "@/lib/academy/nav";
import type { Course, LessonLocation } from "@/lib/academy/types";

// The panel pulls in its own renderers, so it stays out of the lesson payload.
const DeeperPanel = lazy(() => import("./DeeperPanel"));

const MAX_SELECTION = 1200;

/**
 * Arrow keys must not hijack typing, dragging a slider, or a panel that owns the
 * keyboard. Anything editable, any range input, and any open dialog opts out.
 */
function typingContext(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.getAttribute("role") === "slider") return true;
  if (el.closest('[role="dialog"]')) return true;
  return false;
}

export default function ReaderShell({
  course,
  location,
  children,
  /** Rendered when the course has narration elsewhere but not on this lesson. */
  courseHasNarration,
}: {
  course: Course;
  location: LessonLocation;
  children: React.ReactNode;
  courseHasNarration: boolean;
}) {
  const router = useRouter();
  const { lesson, module, prev, next, ordinal, total } = location;
  const [scrollPct, setScrollPct] = useState(0);
  const [deeperOpen, setDeeperOpen] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const article = useRef<HTMLDivElement>(null);
  const deeperTrigger = useRef<HTMLButtonElement>(null);

  // Resolved when the audio element knows its duration, not during render —
  // localStorage is not available on the server and this avoids a mount-time
  // setState purely to carry a number the audio bar asks for later anyway.
  const getStartAt = useCallback(
    () => getLessonProgress(course.slug, lesson.id)?.audio ?? 0,
    [course.slug, lesson.id],
  );

  // Scroll ratio through the lesson column, throttled to animation frames.
  useEffect(() => {
    let frame = 0;
    function onScroll() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = article.current;
        if (!el) return;
        const start = el.offsetTop;
        const span = Math.max(el.offsetHeight - window.innerHeight, 1);
        const ratio = Math.min(Math.max((window.scrollY - start) / span, 0), 1);
        setScrollPct(Math.round(ratio * 100));
        recordLesson(course.slug, module.position, lesson.position, lesson.id, { scroll: ratio });
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [course.slug, module.position, lesson.position, lesson.id]);

  // Previous / next on the arrow keys.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (typingContext()) return;
      if (e.key === "ArrowLeft" && prev) {
        e.preventDefault();
        router.push(lessonHref(course.slug, prev.module, prev.lesson));
      } else if (e.key === "ArrowRight" && next) {
        e.preventDefault();
        router.push(lessonHref(course.slug, next.module, next.lesson));
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [course.slug, prev, next, router]);

  // Read the selection at the moment the panel opens. Scoped to the lesson column:
  // a selection from the outline or the footer is not lesson text.
  const openDeeper = useCallback(() => {
    let picked: string | null = null;
    try {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (text && sel && sel.rangeCount > 0 && article.current) {
        const range = sel.getRangeAt(0);
        if (article.current.contains(range.commonAncestorContainer)) {
          picked = text.slice(0, MAX_SELECTION);
        }
      }
    } catch {
      picked = null;
    }
    setSelection(picked);
    setDeeperOpen(true);
  }, []);

  const closeDeeper = useCallback(() => {
    setDeeperOpen(false);
    deeperTrigger.current?.focus();
  }, []);

  const onAudioProgress = useCallback(
    (seconds: number) => {
      recordLesson(course.slug, module.position, lesson.position, lesson.id, { audio: seconds });
    },
    [course.slug, module.position, lesson.position, lesson.id],
  );

  return (
    <div>
      {/* Progress through the course, not just this lesson. */}
      <div
        className="sticky top-0 z-30 h-1 w-full"
        style={{ backgroundColor: "var(--ac-rule)" }}
        role="progressbar"
        aria-label="Progress through this lesson"
        aria-valuenow={scrollPct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full" style={{ width: `${scrollPct}%`, backgroundColor: "var(--ac-accent)" }} />
      </div>

      <p className="academy-meta mt-4">
        Module {module.position} · Lesson {ordinal} of {total} · {lesson.reading_minutes} min
      </p>
      <h1 className="mt-1 font-serif text-3xl font-bold" style={{ color: "var(--ac-text)" }}>
        {lesson.title}
      </h1>

      <div className="mt-4">
        {lesson.narration ? (
          <AudioBar
            narration={lesson.narration}
            courseTitle={course.title}
            lessonTitle={lesson.title ?? `Lesson ${lesson.position}`}
            authorName={course.author?.name}
            getStartAt={getStartAt}
            onProgress={onAudioProgress}
          />
        ) : courseHasNarration ? (
          <NarrationUnavailable />
        ) : null}
      </div>

      <div ref={article} className="mt-8">
        {children}
      </div>

      {/* Supplementary AI material lives below the lesson, never inside it. */}
      <div className="mt-8">
        {!deeperOpen ? (
          <button
            ref={deeperTrigger}
            type="button"
            onClick={openDeeper}
            className="px-4 py-2 text-sm font-medium"
            style={{ border: "1px solid var(--ac-sage-rule)", color: "var(--ac-sage-text)" }}
          >
            Go deeper
            <span className="academy-meta" style={{ color: "inherit" }}>
              {" "}
              · select text first to ask about a passage
            </span>
          </button>
        ) : (
          <Suspense fallback={<p className="academy-meta">Opening…</p>}>
            <DeeperPanel
              courseCode={course.code}
              lessonId={lesson.id}
              selection={selection}
              onClose={closeDeeper}
            />
          </Suspense>
        )}
      </div>

      <nav
        aria-label="Lesson navigation"
        className="mt-12 flex items-center justify-between gap-4 pt-6"
        style={{ borderTop: "1px solid var(--ac-rule)" }}
      >
        {prev ? (
          <Link
            href={lessonHref(course.slug, prev.module, prev.lesson)}
            className="px-3 py-2 text-sm"
            style={{ border: "1px solid var(--ac-rule-strong)", color: "var(--ac-text)" }}
            rel="prev"
          >
            <span aria-hidden="true">← </span>Previous lesson
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={lessonHref(course.slug, next.module, next.lesson)}
            className="px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: "var(--ac-forest)", color: "var(--ac-bg)" }}
            rel="next"
          >
            Next lesson<span aria-hidden="true"> →</span>
          </Link>
        ) : (
          <Link
            href={`/academy/${course.slug}/${module.position}/review`}
            className="px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: "var(--ac-forest)", color: "var(--ac-bg)" }}
          >
            Module review<span aria-hidden="true"> →</span>
          </Link>
        )}
      </nav>
    </div>
  );
}
