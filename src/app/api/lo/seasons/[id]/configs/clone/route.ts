// POST /api/lo/seasons/[id]/configs/clone — season_config_clone().
//
// The ONLY way to change a live season: the active version is read-only, so a
// commissioner clones it to a new draft, edits that, and promotes when ready.
// The RPC deep-copies the config + slate + both mixes in one transaction.

import { guard, missingReason, readJson, requireReason, respond } from "@/lib/league-office/api-guard";
import { cloneConfigVersion } from "@/lib/league-office/season-write";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard();
  if (!g.ok) return g.response;

  const { id } = await params;
  const body = await readJson<{ effectiveFrom?: string; label?: string; reason?: string }>(request);

  const reason = requireReason(body);
  if (!reason) return missingReason();

  return respond(
    await cloneConfigVersion(g.s, g.email, id, {
      effectiveFrom: body.effectiveFrom ?? null,
      label: body.label ?? null,
      reason,
    })
  );
}
