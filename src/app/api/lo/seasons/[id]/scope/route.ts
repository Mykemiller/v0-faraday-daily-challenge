// GET  /api/lo/seasons/[id]/scope — the season's resolved scope.
// POST /api/lo/seasons/[id]/scope — replace it.
//
// CC-LO-SEASON-SCOPE-1.0 (D9): the ONLY HTTP surface that writes season_scopes.
// PATCH /api/lo/configs/[configId] no longer accepts a `scope` key, and
// season_config_save_bundle raises if handed one.
//
// The reason is mandatory and never defaulted — lo_audit_log.reason is NOT NULL
// and its value IS the audit trail for a change that silently rewrites
// standings.
//
// A scope change on an ACTIVE season returns 409 + { scopeWarning: true } with
// the entering/leaving team lists on the first call. The client shows them and
// re-POSTs with confirm:true. That is deliberately a *pre*-commit check: by the
// time the RPC could report the delta, it has already written.

import { guard, missingReason, readJson, requireReason, respond } from "@/lib/league-office/api-guard";
import { getScopeSummary } from "@/lib/league-office/seasons";
import { updateSeasonScope } from "@/lib/league-office/season-write";
import type { WizardScope } from "@/lib/league-office/season-config-logic";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard();
  if (!g.ok) return g.response;

  const { id } = await params;
  const summary = await getScopeSummary(g.s, id);
  if (!summary)
    return Response.json({ ok: false, message: "Season not found." }, { status: 404 });

  return Response.json({ ok: true, summary });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard();
  if (!g.ok) return g.response;

  const { id } = await params;
  const body = await readJson<{ scope?: WizardScope; reason?: string; confirm?: boolean }>(request);

  const reason = requireReason(body);
  if (!reason) return missingReason();

  if (!body?.scope?.mode)
    return Response.json({ ok: false, message: "A scope is required." }, { status: 422 });

  return respond(
    await updateSeasonScope(g.s, g.email, id, body.scope, reason, body.confirm === true)
  );
}
