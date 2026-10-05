// GET /api/cron/season-golive — CC-DC-SEASON-GOLIVE-1.0 (D6), the BACKSTOP.
//
// Every in-app path that can make today's answer change (season create, season
// window edit, puzzle approval) now calls goLiveToday itself. This cron exists
// for the cases those paths cannot cover: a season row created or edited
// outside the League Office, an approval whose go-live step failed transiently,
// a deploy that happened mid-day, or the midnight boundary being crossed while
// nobody was clicking anything.
//
// DELIBERATELY NO HOUR GUARD. /api/cron/rotate and /api/cron/sync-day-content
// run at 05:00/06:00 UTC behind a CT-midnight guard and those stay exactly as
// they are — the whole bug class this workstream fixes is "the only writer runs
// once a night". This one runs at :15 every hour and is a cheap no-op (three
// SELECT-shaped reads) whenever there is nothing to do.
//
// Idempotent by construction (see goLiveToday): a run that finds nothing due,
// nothing Published for today and a populated day-content row writes nothing.
//
// Requires CRON_SECRET (same contract as every other cron) and
// SUPABASE_SERVICE_ROLE_KEY.

import { goLiveSvc, goLiveToday } from "@/lib/seasons/golive";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Vercel sends `Authorization: Bearer ${CRON_SECRET}` on cron invocations.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const s = goLiveSvc();
  if (!s) {
    return Response.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
  }

  // Never throws — every failure comes back inside `skipped`.
  const result = await goLiveToday(s, { reason: "cron.season-golive", actor: "cron" });
  console.log("[season-golive] cron run:", JSON.stringify(result));
  return Response.json({ ok: true, ...result });
}
