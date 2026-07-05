// League Office — Tier 2 audited action endpoint. One POST per staff override.
// Staff is verified from the httpOnly lo_session cookie (set by the client gate);
// the mutation + its mandatory-reason audit row happen atomically in
// executeAction(). Non-staff never reach the mutation.

import { requireStaff } from "@/lib/league-office/service";
import { executeAction, type ActionInput } from "@/lib/league-office/write";

export async function POST(request: Request) {
  const staff = await requireStaff();
  if (!staff.ok) {
    const code = staff.reason === "not-staff" ? 403 : staff.reason === "unconfigured" ? 500 : 401;
    return Response.json({ ok: false, message: `Not authorized (${staff.reason}).` }, { status: code });
  }

  let body: ActionInput;
  try {
    body = (await request.json()) as ActionInput;
  } catch {
    return Response.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }
  if (!body?.action) return Response.json({ ok: false, message: "Missing action." }, { status: 400 });
  if (!body.reason?.trim()) return Response.json({ ok: false, message: "A reason is required." }, { status: 422 });

  const result = await executeAction(staff.s, staff.email, body);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
