// POST /api/lo/scopes/preview — what WOULD this rule set resolve to?
//
// Read-only: fn_season_scope_preview writes nothing. Drives the live preview in
// the wizard's Scope step and the config editor's Section B, so the commissioner
// sees the resolved team list before committing.
//
// `seasonId` is null in the create wizard — the season row does not exist yet,
// so conference membership cannot be resolved per-season and every team falls
// back to teams.conference_id. The UI says so.

import { guard, readJson } from "@/lib/league-office/api-guard";
import { previewScope } from "@/lib/league-office/seasons";
import { buildScopeRows, type WizardScope } from "@/lib/league-office/season-config-logic";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const g = await guard();
  if (!g.ok) return g.response;

  const body = await readJson<{ seasonId?: string | null; scope?: WizardScope }>(request);
  if (!body?.scope?.mode)
    return Response.json({ ok: false, message: "A scope is required." }, { status: 422 });

  const summary = await previewScope(
    g.s,
    body.seasonId ?? null,
    buildScopeRows(body.scope)
  );

  if (!summary)
    return Response.json(
      { ok: false, message: "That scope could not be resolved — one of the picks may no longer exist." },
      { status: 409 }
    );

  return Response.json({ ok: true, summary });
}
