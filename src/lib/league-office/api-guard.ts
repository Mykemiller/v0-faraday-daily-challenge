// League Office — shared API guard for the /api/lo/* season-config surface.
//
// Every route re-verifies staff independently (the client gate is convenience,
// this is the fence — same rule as service.ts). Kept in one place so a new route
// cannot accidentally ship without the check, and so the failure codes stay
// consistent: 401 no session · 403 not staff · 500 unconfigured.

import { requireStaff, type Svc } from "./service";
import type { WriteResult } from "./season-write";

export type Guarded = { ok: true; s: Svc; email: string } | { ok: false; response: Response };

export async function guard(): Promise<Guarded> {
  const staff = await requireStaff();
  if (staff.ok) return { ok: true, s: staff.s, email: staff.email };

  const status = staff.reason === "not-staff" ? 403 : staff.reason === "unconfigured" ? 500 : 401;
  return {
    ok: false,
    response: Response.json(
      { ok: false, message: `Not authorized (${staff.reason}).` },
      { status }
    ),
  };
}

/** Parse a JSON body, tolerating an empty one. */
export async function readJson<T extends Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const j = await request.json();
    return (j && typeof j === "object" ? j : {}) as T;
  } catch {
    return {} as T;
  }
}

/** Every mutation carries a mandatory reason — it is what makes the audit trail
 *  worth reading. Enforced here so no route can forget it. */
export function requireReason(body: { reason?: unknown }): string | null {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  return reason || null;
}

export const missingReason = () =>
  Response.json({ ok: false, message: "A reason is required." }, { status: 422 });

/** Map a WriteResult onto an HTTP response, preserving the writer's status. */
export function respond(result: WriteResult<Record<string, unknown>>): Response {
  if (result.ok)
    return Response.json({ ok: true, message: result.message, ...(result.data ?? {}) });
  return Response.json(
    { ok: false, message: result.message, ...(result.data ?? {}) },
    { status: result.status }
  );
}
