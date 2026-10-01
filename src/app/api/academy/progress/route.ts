// Faraday Academy — signed-in progress sync.
//
// Anonymous readers never reach this route: the client only calls it when a
// Supabase Auth session exists. The caller's own access token is forwarded to
// PostgREST, so academy_progress RLS decides what may be written — this route
// holds no service-role key and can never write another reader's row.
//
// Today this is a live but unexercised path: auth.users is empty and the engine's
// subscriber auth issues no GoTrue token.

import { SUPABASE_URL } from "@/lib/supabase";

type Body = {
  slug?: unknown;
  lesson_id?: unknown;
  scroll_ratio?: unknown;
  audio_seconds?: unknown;
  quiz_score?: unknown;
};

function clampRatio(v: unknown): number {
  const n = typeof v === "number" ? v : 0;
  return Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), 1);
}
function nonNegative(v: unknown): number {
  const n = typeof v === "number" ? v : 0;
  return Math.max(Number.isFinite(n) ? n : 0, 0);
}

export async function POST(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug : null;
  const lessonId = typeof body.lesson_id === "string" ? body.lesson_id : null;
  if (!slug || !lessonId) {
    // A quiz-only sync carries no lesson, and course-level score has no row of its
    // own in academy_progress; nothing to do.
    return Response.json({ ok: true, skipped: true });
  }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) return Response.json({ ok: true, skipped: true });

  // The lesson's course_id is resolved from the token's own readable view of the
  // lesson tree; if that is not visible to this user, the upsert simply fails RLS.
  const payload = {
    lesson_id: lessonId,
    scroll_ratio: clampRatio(body.scroll_ratio),
    audio_seconds: nonNegative(body.audio_seconds),
    quiz_score: typeof body.quiz_score === "number" ? Math.max(0, Math.trunc(body.quiz_score)) : null,
    updated_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/academy_progress?on_conflict=user_id,lesson_id`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: auth,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return Response.json({ ok: false }, { status: 202 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 202 });
  }
}
