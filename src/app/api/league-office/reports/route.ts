// League Office — message report queue status endpoint (CC-DC-MESSAGING-1.0).
// Staff-only, same requireStaff fence as every League Office reader/writer
// (including the kill-switch behavior documented in CLAUDE.md). Minimal and
// read-mostly by design: the only mutation is moving a report between statuses.
// No bulk actions, no auto-moderation. Report rows are never deleted.

import { requireStaff } from "@/lib/league-office/service";

const STATUSES = new Set(["open", "reviewed", "actioned", "dismissed"]);

export async function POST(request: Request) {
  const staff = await requireStaff();
  if (!staff.ok) {
    const code = staff.reason === "not-staff" ? 403 : staff.reason === "unconfigured" ? 500 : 401;
    return Response.json({ ok: false, message: `Not authorized (${staff.reason}).` }, { status: code });
  }

  let body: { reportId?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }
  const reportId = typeof body.reportId === "string" ? body.reportId : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!/^[0-9a-fA-F-]{16,}$/.test(reportId) || !STATUSES.has(status)) {
    return Response.json({ ok: false, message: "Invalid report or status." }, { status: 400 });
  }

  const r = await fetch(
    `${staff.s.base}/dc_message_reports?id=eq.${encodeURIComponent(reportId)}`,
    {
      method: "PATCH",
      headers: staff.s.headers,
      body: JSON.stringify({
        status,
        // Re-opening clears the review stamp; any resolved status sets it.
        reviewed_at: status === "open" ? null : new Date().toISOString(),
        reviewed_by: status === "open" ? null : staff.email,
      }),
    }
  );
  if (!r.ok) return Response.json({ ok: false, message: "Update failed." }, { status: 500 });
  return Response.json({ ok: true });
}
