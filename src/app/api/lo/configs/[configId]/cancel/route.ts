// POST /api/lo/configs/[configId]/cancel — state → cancelled.
//
// Abandons a draft or un-schedules a scheduled version. The live version can
// never be cancelled (promote a replacement instead), and history — superseded
// versions — is immutable.

import { guard, missingReason, readJson, requireReason, respond } from "@/lib/league-office/api-guard";
import { cancelConfigVersion } from "@/lib/league-office/season-write";

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

  return respond(await cancelConfigVersion(g.s, g.email, configId, reason));
}
