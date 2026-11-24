// Faraday Academy — "starting a course" counts against the daily course allowance
// (FDY-392 UL-2, FDY-353 D3: distinct items per day).
//
// Every lesson load asks this once. The item is the course's stable identity, so
// the first lesson of a course takes one of today's courses and every later
// lesson of that same course — any module, any order, any tab — comes back
// `already_counted` from the database at no cost.
//
// The item is the course CODE, resolved here on the server from the slug: the
// public course shape carries no database id, and the code is its stable unique
// key (a slug can be renamed). The code never reaches a reader — this module only
// passes it to the ledger.
//
// Pure apart from its injected dependencies, so it is unit-tested without a
// network (src/lib/usage/limits.test.ts).

import type { ConsumeResult } from "../usage/limits.ts";
import type { Course, ReadResult } from "./types.ts";

export const COURSE_METRIC = "courses";

export type StartVerdict = {
  allowed: boolean;
  /** ISO instant the allowance resets (next UTC midnight); null if unknown. */
  resetAt: string | null;
  setCookie: string | null;
  /** HTTP status for the route: 404 only for a course that does not exist. */
  status: number;
};

export type StartDeps = {
  getCourse: (slug: string) => Promise<ReadResult<Course>>;
  consume: (
    opts: { metric: string; item?: string | null; weight?: number },
    req: Request,
  ) => Promise<ConsumeResult>;
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,127}$/i;

export async function startCourse(slug: unknown, req: Request, deps: StartDeps): Promise<StartVerdict> {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return { allowed: false, resetAt: null, setCookie: null, status: 400 };
  }
  const course = await deps.getCourse(slug);
  if (!course.ok) {
    // A missing course never renders a lesson, so there is nothing to gate. An
    // unreachable library fails closed like any other error (D8).
    return { allowed: false, resetAt: null, setCookie: null, status: course.reason === "missing" ? 404 : 200 };
  }
  const result = await deps.consume({ metric: COURSE_METRIC, item: course.data.code }, req);
  return { allowed: result.allowed, resetAt: result.resetAt, setCookie: result.setCookie, status: 200 };
}

/** Next UTC midnight — the ledger's day boundary (D6) — for when no reset time came back. */
export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/**
 * The D12 notice, with the reset in the reader's own local time. No numbers, no
 * upsell. `timeZone` is only for tests; the browser's own zone is the default.
 */
export function courseLimitNotice(resetAt: string | null, now: Date, timeZone?: string): string {
  const parsed = resetAt ? new Date(resetAt) : null;
  const at = parsed && !Number.isNaN(parsed.getTime()) ? parsed : nextUtcMidnight(now);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(at);
  return `You’ve started today’s set of courses. More open up at ${time}.`;
}
