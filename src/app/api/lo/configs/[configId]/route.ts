// GET   /api/lo/configs/[configId] — config + slate + both mixes + findings.
// PATCH /api/lo/configs/[configId] — save draft.
//
// CC-LO-SEASON-SCOPE-1.0: `scope` is NO LONGER accepted here. Scope is written
// only by POST /api/lo/seasons/[id]/scope → lo_set_season_scope(). A slate save
// must never be able to replace a season's scope as a side effect.
//
// PATCH semantics (spec §3): the body carries the WHOLE config object including
// games[] / themeMix[] / difficultyMix[]. Child sets are REPLACED, never
// partially written. Rejected when the config is not draft/scheduled, when its
// season is locked, or when the optimistic-concurrency fingerprint has moved.

import { guard, missingReason, readJson, requireReason, respond } from "@/lib/league-office/api-guard";
import { getConfigBundle } from "@/lib/league-office/seasons";
import { saveConfigDraft, type ConfigSavePayload } from "@/lib/league-office/season-write";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  const g = await guard();
  if (!g.ok) return g.response;

  const { configId } = await params;
  const bundle = await getConfigBundle(g.s, configId);
  if (!bundle)
    return Response.json({ ok: false, message: "Config not found." }, { status: 404 });

  return Response.json({ ok: true, ...bundle });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  const g = await guard();
  if (!g.ok) return g.response;

  const { configId } = await params;
  const body = await readJson<Partial<ConfigSavePayload>>(request);

  const reason = requireReason(body);
  if (!reason) return missingReason();

  return respond(
    await saveConfigDraft(g.s, g.email, configId, {
      config: body.config,
      games: body.games,
      themeMix: body.themeMix,
      difficultyMix: body.difficultyMix,
      fingerprint: body.fingerprint,
      acknowledgeCapWarning: body.acknowledgeCapWarning === true,
      reason,
    })
  );
}
