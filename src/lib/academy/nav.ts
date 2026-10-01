// Faraday Academy reader — lesson location and navigation.
// Routes carry module and lesson POSITIONS (1-based), never ids or course codes:
//   /academy/<slug>/1/2

import type { Course, LessonLocation } from "./types";

/** Every lesson in reading order, flattened across modules. */
export function readingOrder(course: Course): Array<{ module: number; lesson: number }> {
  const out: Array<{ module: number; lesson: number }> = [];
  for (const m of [...course.modules].sort((a, b) => a.position - b.position)) {
    for (const l of [...m.lessons].sort((a, b) => a.position - b.position)) {
      out.push({ module: m.position, lesson: l.position });
    }
  }
  return out;
}

/** Null when the position pair does not exist, so the route can render not-found. */
export function locateLesson(
  course: Course,
  modulePosition: number,
  lessonPosition: number,
): LessonLocation | null {
  // Named `mod`, not `module`: assigning to `module` collides with the CommonJS
  // binding and Next rejects it outright.
  const mod = course.modules.find((m) => m.position === modulePosition);
  if (!mod) return null;
  const lesson = mod.lessons.find((l) => l.position === lessonPosition);
  if (!lesson) return null;

  const order = readingOrder(course);
  const index = order.findIndex((o) => o.module === modulePosition && o.lesson === lessonPosition);
  return {
    module: mod,
    lesson,
    ordinal: index + 1,
    total: order.length,
    prev: index > 0 ? order[index - 1] : null,
    next: index >= 0 && index < order.length - 1 ? order[index + 1] : null,
  };
}

export function lessonHref(slug: string, modulePosition: number, lessonPosition: number): string {
  return `/academy/${slug}/${modulePosition}/${lessonPosition}`;
}

export function reviewHref(slug: string, modulePosition: number): string {
  return `/academy/${slug}/${modulePosition}/review`;
}

/** Parses a route segment that must be a positive integer position. */
export function parsePosition(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
