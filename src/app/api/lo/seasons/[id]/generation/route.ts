// GET /api/lo/seasons/[id]/generation — the Part D generation status payload:
// GENERATABLE checklist (pilot + full), warnings, per-game targets, run history,
// stall + bank-minimum alarms, and the pilot review table. Staff-only, like
// every /api/lo reader. Mutations do NOT live here — they go through the Tier 2
// funnel at /api/league-office/action (season.generate_* / season.approve_*).

import { requireStaff } from "@/lib/league-office/service";
import { getGenerationStatus } from "@/lib/league-office/generation-status";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await requireStaff();
  if (!staff.ok) {
    const code = staff.reason === "not-staff" ? 403 : staff.reason === "unconfigured" ? 500 : 401;
    return Response.json({ ok: false, message: `Not authorized (${staff.reason}).` }, { status: code });
  }
  const { id } = await params;
  const status = await getGenerationStatus(staff.s, id);
  if (!status.season) return Response.json({ ok: false, message: "Season not found." }, { status: 404 });
  return Response.json({ ok: true, status });
}
