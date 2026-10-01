"use client";
// Faraday Academy — reading progress.
//
// Everyone gets localStorage progress: there is no sign-in wall on any lesson and
// no sign-in prompt for learners. Anonymous progress NEVER reaches the database —
// academy_progress is keyed on auth.users and exists only for signed-in readers.
//
// The remote sync is a real path, not a stub, but it is deliberately quiet: it
// fires only when a Supabase Auth (GoTrue) session is present in this browser. The
// engine's own subscriber auth is a separate OTP system that issues no GoTrue
// token, so today this no-ops on every call. When Supabase Auth is introduced the
// seam already works.

const KEY = "academy_progress_v1";
const SYNC_DEBOUNCE_MS = 2000;

export type LessonProgress = {
  /** 0..1 */
  scroll: number;
  /** seconds */
  audio: number;
};

export type CourseProgress = {
  lastModule: number;
  lastLesson: number;
  lessons: Record<string, LessonProgress>;
  quizScore?: number;
  updatedAt: string;
};

export type ProgressStore = Record<string, CourseProgress>;

function canStore(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false; // Private-mode or blocked storage: the player still works.
  }
}

export function readStore(): ProgressStore {
  if (!canStore()) return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as ProgressStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: ProgressStore): void {
  if (!canStore()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Quota or blocked storage. Progress is a convenience, never a blocker.
  }
}

export function getCourseProgress(slug: string): CourseProgress | null {
  return readStore()[slug] ?? null;
}

/** Where to resume, or null when the reader has not started. */
export function getResume(slug: string): { module: number; lesson: number } | null {
  const p = getCourseProgress(slug);
  if (!p) return null;
  return { module: p.lastModule, lesson: p.lastLesson };
}

export function getLessonProgress(slug: string, lessonId: string): LessonProgress | null {
  return getCourseProgress(slug)?.lessons[lessonId] ?? null;
}

function mutate(slug: string, fn: (c: CourseProgress) => CourseProgress): CourseProgress {
  const store = readStore();
  const existing: CourseProgress = store[slug] ?? {
    lastModule: 1,
    lastLesson: 1,
    lessons: {},
    updatedAt: new Date().toISOString(),
  };
  const next = { ...fn(existing), updatedAt: new Date().toISOString() };
  store[slug] = next;
  writeStore(store);
  return next;
}

export function recordLesson(
  slug: string,
  modulePosition: number,
  lessonPosition: number,
  lessonId: string,
  partial: Partial<LessonProgress>,
): void {
  const next = mutate(slug, (c) => {
    const prev = c.lessons[lessonId] ?? { scroll: 0, audio: 0 };
    return {
      ...c,
      lastModule: modulePosition,
      lastLesson: lessonPosition,
      lessons: {
        ...c.lessons,
        [lessonId]: {
          // Progress only moves forward, so a quick scroll back up does not erase it.
          scroll: Math.max(prev.scroll, partial.scroll ?? prev.scroll),
          audio: Math.max(prev.audio, partial.audio ?? prev.audio),
        },
      },
    };
  });
  queueSync(slug, lessonId, next);
}

export function recordQuizScore(slug: string, score: number): void {
  const next = mutate(slug, (c) => ({ ...c, quizScore: score }));
  queueSync(slug, null, next);
}

// ── remote sync (signed-in readers only) ─────────────────────────────────────

/**
 * GoTrue persists its session under sb-<project-ref>-auth-token. We read the
 * access token rather than taking a dependency on the Supabase client, which the
 * engine does not ship.
 */
function accessToken(): string | null {
  if (!canStore()) return null;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !/^sb-.*-auth-token$/.test(k)) continue;
      const raw = window.localStorage.getItem(k);
      if (!raw) continue;
      const token = JSON.parse(raw)?.access_token;
      if (typeof token === "string" && token.length > 0) return token;
    }
  } catch {
    /* fall through to anonymous */
  }
  return null;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: { slug: string; lessonId: string | null; progress: CourseProgress } | null = null;

function queueSync(slug: string, lessonId: string | null, progress: CourseProgress): void {
  if (!accessToken()) return; // Anonymous: nothing leaves the browser.
  pending = { slug, lessonId, progress };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushSync, SYNC_DEBOUNCE_MS);
}

async function flushSync(): Promise<void> {
  const payload = pending;
  pending = null;
  timer = null;
  const token = accessToken();
  if (!payload || !token) return;
  try {
    await fetch("/api/academy/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        slug: payload.slug,
        lesson_id: payload.lessonId,
        scroll_ratio: payload.lessonId ? payload.progress.lessons[payload.lessonId]?.scroll ?? 0 : null,
        audio_seconds: payload.lessonId ? payload.progress.lessons[payload.lessonId]?.audio ?? 0 : null,
        quiz_score: payload.progress.quizScore ?? null,
      }),
      keepalive: true,
    });
  } catch {
    // Sync is best-effort; localStorage already holds the truth for this reader.
  }
}
