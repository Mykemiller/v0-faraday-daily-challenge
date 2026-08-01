// POST /api/lo/generation/worker — staff-triggered generation slice, so the
// commissioner watching the panel doesn't have to wait for the 10-minute cron.
// Same engine as /api/cron/generation-worker; the run's checkpointed state in
// the database is the only coordination between the two.

import { requireStaff } from "@/lib/league-office/service";
import { runGenerationSlice } from "@/lib/generation/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const staff = await requireStaff();
  if (!staff.ok) {
    const code = staff.reason === "not-staff" ? 403 : staff.reason === "unconfigured" ? 500 : 401;
    return Response.json({ ok: false, message: `Not authorized (${staff.reason}).` }, { status: code });
  }
  try {
    const report = await runGenerationSlice(staff.s, { budgetMs: 250_000 });
    return Response.json({ ok: true, report });
  } catch (err) {
    console.error(JSON.stringify({ at: "lo-generation-worker", error: String(err) }));
    return Response.json({ ok: false, message: String(err).slice(0, 300) }, { status: 500 });
  }
}
