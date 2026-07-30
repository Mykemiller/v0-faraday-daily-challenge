// GET   /api/lo/seasons/[id] — season detail + every config version.
// PATCH /api/lo/seasons/[id] — name/dates/status, and the lock/unlock/close ops.
//
// A locked season refuses detail edits here (not just in the UI); lock/unlock
// itself stays available so the freeze is always reversible by a commissioner.

import { guard, missingReason, readJson, requireReason, respond } from "@/lib/league-office/api-guard";
import { getSeasonConfigDetail, resolveScopeTeamCount } from "@/lib/league-office/seasons";
import { updateSeason, updateSeasonScope, type WizardScope } from "@/lib/league-office/season-write";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard();
  if (!g.ok) return g.response;

  const { id } = await params;
  const detail = await getSeasonConfigDetail(g.s, id);
  if (!detail.season)
    return Response.json({ ok: false, message: "Season not found." }, { status: 404 });

  const scopeTeamCount = await resolveScopeTeamCount(g.s, detail.scopes);
  return Response.json({ ok: true, ...detail, scopeTeamCount });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard();
  if (!g.ok) return g.response;

  const { id } = await params;
  const body = await readJson<{
    patch?: Record<string, unknown>;
    op?: "lock" | "unlock" | "close";
    scope?: WizardScope;
    reason?: string;
  }>(request);

  const reason = requireReason(body);
  if (!reason) return missingReason();

  // A scope-only edit (Section B) is its own audited action.
  if (body.scope && !body.patch && !body.op)
    return respond(await updateSeasonScope(g.s, g.email, id, body.scope, reason));

  return respond(await updateSeason(g.s, g.email, id, { patch: body.patch, op: body.op, reason }));
}
