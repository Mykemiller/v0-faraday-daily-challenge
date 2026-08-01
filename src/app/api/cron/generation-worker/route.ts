// GET /api/cron/generation-worker — every 10 minutes (vercel.json).
//
// Advances the oldest in-flight generation run by one bounded slice. Idle when
// no run is queued/generating — the League Office "Generate" actions create the
// run rows; this cron is what makes them finish unattended. A killed or crashed
// slice loses at most one batch: the worker checkpoints phase_cursor, counters
// and last_heartbeat_at after every batch, and the next firing resumes from the
// database (Part D worker contract).
//
// Auth: CRON_SECRET Bearer, same pattern as the other cron routes.

import { svc } from "@/lib/league-office/service";
import { runGenerationSlice } from "@/lib/generation/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`)
    return new Response("Unauthorized", { status: 401 });

  const s = svc();
  if (!s)
    return Response.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });

  try {
    const report = await runGenerationSlice(s, { budgetMs: 250_000 });
    if (!report.idle) console.log(`[generation-worker] ${JSON.stringify(report)}`);
    return Response.json({ ok: true, report });
  } catch (err) {
    console.error(JSON.stringify({ at: "cron-generation-worker", error: String(err) }));
    return Response.json({ ok: false, error: String(err).slice(0, 300) }, { status: 500 });
  }
}
