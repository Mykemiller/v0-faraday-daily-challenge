// GET /api/cron/sync-day-content — FAR-287 day-content sync (transport only).
//
// The mechanism lives in @/lib/day-content-sync (CC-DC-SEASON-GOLIVE-1.0 D3) so
// a same-day go-live can refresh the day IN PROCESS rather than self-calling
// this route over HTTP. What stays here is the cron's transport: the secret,
// the CT-midnight hour guard, and the force/date params — all unchanged, so the
// nightly run behaves exactly as it did.
//
// Mirrors the Puzzle Bank's Live set into Supabase dc_daily_page_content (one
// row per CT serve day) so the Hints Today / About Today's Challenge / Answers
// Today pages never read the bank at request time.
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

import { syncDayContent } from "@/lib/day-content-sync";
// THE CT serve-day boundary, shared with /api/cron/rotate and the go-live
// module so the three can never disagree about which day it is.
import { chicagoNow } from "@/lib/seasons/golive";

export const dynamic = "force-dynamic";

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

  const result = await syncDayContent(dateISO);
  return result.ok ? Response.json(result) : Response.json(result, { status: 500 });
}
