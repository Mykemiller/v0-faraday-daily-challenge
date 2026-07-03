// GET /api/cron/sync-day-content — FAR-287 day-content sync.
//
// Mirrors the Airtable Puzzle Bank's Live set into Supabase
// dc_daily_page_content (one row per CT serve day) so the Hints Today / About
// Today's Challenge / Answers Today pages never read Airtable at request time.
//
// Vercel cron fires at 05:10 and 06:10 UTC (vercel.json) — ten minutes after
// the AUTO-128 rotator flips the Live set, so the sync always sees the new day.
// Exactly one of those is 00:10 America/Chicago; the other is a no-op via the
// same midnight guard the rotator uses. Idempotent: the upsert keys on
// puzzle_date (resolution=merge-duplicates), so a re-run rewrites the same row.
//
// Manual runs: ?force=1 bypasses the hour guard (still requires the secret when
// CRON_SECRET is set); ?date=YYYY-MM-DD (with force) backfills/re-syncs a
// specific day from whatever is currently Live — useful right after a manual
// rotation.
//
// Requires AIRTABLE_API_KEY (bank read) and SUPABASE_SERVICE_ROLE_KEY (upsert).

import { buildDayContentRow } from "@/lib/day-content";

export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

// Current date (YYYY-MM-DD) and hour in America/Chicago, DST-aware — same
// boundary as /api/cron/rotate.
function chicagoNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return Response.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
  }

  const params = new URL(request.url).searchParams;
  const force = params.get("force") === "1";
  const { date: today, hour } = chicagoNow();
  if (!force && hour !== 0) {
    return Response.json({ ok: true, skipped: true, reason: `Not midnight in America/Chicago (hour=${hour})` });
  }

  // Optional explicit date (force-only, so crons can't drift off the CT day).
  const dateParam = params.get("date");
  const dateISO =
    force && dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  try {
    const row = await buildDayContentRow(dateISO);

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_daily_page_content?on_conflict=puzzle_date`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal,resolution=merge-duplicates",
        },
        body: JSON.stringify(row),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Supabase upsert failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const summary = {
      ok: true,
      puzzle_date: row.puzzle_date,
      puzzleCount: row.puzzles.length,
      types: row.puzzles.map((p) => p.puzzle_type),
      domain_code: row.domain_code,
      withExplanation: row.puzzles.filter((p) => p.answer_explanation).length,
      withAcademy: row.puzzles.filter((p) => p.academy).length,
    };
    console.log("[sync-day-content]", JSON.stringify(summary));
    return Response.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-day-content] failed:", JSON.stringify({ dateISO, error: message }));
    return Response.json({ ok: false, dateISO, error: message }, { status: 500 });
  }
}
