// GET /api/challenge/day-content — spoiler-safe day content (FAR-287).
//
// Serves the Hints Today + About Today's Challenge pages from
// dc_daily_page_content for the current CT serve day. Answers and answer
// explanations are STRIPPED here — they are only ever served by
// /api/challenge/answers behind the completion/rollover gate.
//
// Responds 200 with { available: false } when the day hasn't been synced yet
// (e.g. sync not run / bank empty) so the pages degrade gracefully, matching
// the /api/challenge/today "never hard-fail the lobby" posture.

export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

function centralDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export async function GET() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    return Response.json({ error: "Day content service not configured" }, { status: 500 });
  }

  const today = centralDate(new Date());
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_daily_page_content?puzzle_date=eq.${today}&select=puzzle_date,domain_code,about_content,puzzles,generated_at`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    }
  );
  if (!res.ok) {
    console.error("[day-content] Supabase read failed:", res.status);
    return Response.json({ available: false, puzzle_date: today });
  }

  const rows = await res.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return Response.json({ available: false, puzzle_date: today });

  // Spoiler guard: never let answers ride along with hints/about.
  const puzzles = (Array.isArray(row.puzzles) ? row.puzzles : []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ answer, answer_explanation, ...safe }: any) => {
      void answer; void answer_explanation;
      return safe;
    }
  );

  return Response.json(
    {
      available: true,
      puzzle_date: row.puzzle_date,
      domain_code: row.domain_code ?? null,
      about_content: row.about_content ?? {},
      puzzles,
    },
    // Same-for-everyone content that changes once a day — cache briefly at the edge.
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } }
  );
}
