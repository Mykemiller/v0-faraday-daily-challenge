// POST /api/lo/configs/[configId]/promote — season_config_promote().
//
// Validates, supersedes the incumbent, and lands the version as `active` (or
// `scheduled` when effective_from is in the future). The RPC writes its own
// lo_audit_log row, so nothing here logs a second time (spec §3).

import { guard, missingReason, readJson, requireReason, respond } from "@/lib/league-office/api-guard";
import { promoteConfigVersion } from "@/lib/league-office/season-write";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  const g = await guard();
  if (!g.ok) return g.response;

  const { configId } = await params;
  const body = await readJson<{ reason?: string }>(request);

  const reason = requireReason(body);
  if (!reason) return missingReason();

  return respond(await promoteConfigVersion(g.s, g.email, configId, reason));
}
