"use client";
// Faraday Academy — the course outline.
//
// One source of truth, two presentations: a persistent rail from the lg breakpoint
// up, and a bottom sheet below it. The sheet traps focus, closes on Esc, and
// returns focus to the button that opened it.

import { useEffect, useRef, useState } from "react";
import { OutlineItem } from "./primitives";
import { lessonHref, reviewHref } from "@/lib/academy/nav";
import type { Course } from "@/lib/academy/types";

function OutlineList({
  course,
  currentModule,
  currentLesson,
  onNavigate,
}: {
  course: Course;
  currentModule?: number;
  currentLesson?: number;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Course outline" onClick={onNavigate}>
      <ol className="space-y-4">
        {[...course.modules]
          .sort((a, b) => a.position - b.position)
          .map((m) => (
            <li key={m.position}>
              <p className="academy-meta px-3">Module {m.position}</p>
              <p
                className="px-3 font-serif text-sm font-bold"
                style={{ color: "var(--ac-text)" }}
              >
                {m.title}
              </p>
              <ol className="mt-1">
                {[...m.lessons]
                  .sort((a, b) => a.position - b.position)
                  .map((l) => (
                    <OutlineItem
                      key={l.id}
                      href={lessonHref(course.slug, m.position, l.position)}
                      label={l.title ?? `Lesson ${l.position}`}
                      sublabel={`${l.reading_minutes} min${l.narration ? " · narrated" : ""}`}
                      current={m.position === currentModule && l.position === currentLesson}
                    />
                  ))}
                <OutlineItem
                  href={reviewHref(course.slug, m.position)}
                  label="Module review"
                  current={m.position === currentModule && currentLesson === undefined}
                />
              </ol>
            </li>
          ))}
      </ol>
    </nav>
  );
}

export default function Outline({
  course,
  currentModule,
  currentLesson,
}: {
  course: Course;
  currentModule?: number;
  currentLesson?: number;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  // Esc closes and focus returns to the trigger; Tab cycles inside the sheet.
  useEffect(() => {
    if (!open) return;
    const panel = sheet.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        trigger.current?.focus();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      {/* Desktop: the rail is always there, so it is plain page furniture. */}
      <aside
        className="hidden lg:block lg:w-72 lg:shrink-0"
        style={{ borderRight: "1px solid var(--ac-rule)" }}
      >
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pb-8">
          <OutlineList course={course} currentModule={currentModule} currentLesson={currentLesson} />
        </div>
      </aside>

      {/* Phone: a button that opens the sheet. */}
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className="academy-meta fixed bottom-4 left-1/2 z-40 -translate-x-1/2 px-4 py-2.5 lg:hidden"
        style={{ backgroundColor: "var(--ac-forest)", color: "var(--ac-bg)" }}
      >
        Outline
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close the outline"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(15, 26, 19, 0.55)" }}
          />
          <div
            ref={sheet}
            role="dialog"
            aria-modal="true"
            aria-label="Course outline"
            className="academy-sheet absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto px-2 pb-6 pt-3"
            style={{ backgroundColor: "var(--ac-bg)", borderTop: "3px solid var(--ac-accent)" }}
          >
            <div className="flex items-center justify-between px-3 pb-3">
              <p className="font-serif font-bold" style={{ color: "var(--ac-text)" }}>
                {course.title}
              </p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                }}
                className="px-2 py-1 text-sm"
                style={{ border: "1px solid var(--ac-rule-strong)", color: "var(--ac-text)" }}
              >
                Close
              </button>
            </div>
            <OutlineList
              course={course}
              currentModule={currentModule}
              currentLesson={currentLesson}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
