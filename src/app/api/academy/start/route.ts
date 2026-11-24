// Faraday Academy — record that a reader has started a course today (FDY-392).
//
//   POST /api/academy/start  { slug }  ->  { allowed: boolean, reset_at: string | null }
//
// Called by the lesson page's CourseStartGate on every lesson load. Server-side
// only: the service-role call to usage_consume happens in src/lib/usage/limits.ts
// and the browser never sees a key. Lives under /api/academy/ so it answers on
// the player's own domain (src/lib/academy/player-host.ts passes that prefix).
//
// The answer carries no counts and no reason: the reader only needs to know
// whether to show the lesson and, if not, when more courses open up.

import { getCourse } from "@/lib/academy/api";
import { startCourse } from "@/lib/academy/course-start";
import { consume } from "@/lib/usage/limits";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let slug: unknown = null;
  try {
    const body = (await request.json()) as { slug?: unknown };
    slug = body?.slug;
  } catch {
    // Falls through to startCourse's 400.
  }

  const verdict = await startCourse(slug, request, {
    getCourse,
    consume: (opts, req) => consume(opts, req),
  });

  const res = Response.json(
    { allowed: verdict.allowed, reset_at: verdict.resetAt },
    { status: verdict.status, headers: { "Cache-Control": "no-store" } },
  );
  if (verdict.setCookie) res.headers.append("Set-Cookie", verdict.setCookie);
  return res;
}
