// GET /api/lo/configs/[configId]/validate — season_config_validate().
//
// THE authority on promotability: `error` rows block promotion, `warning` rows
// are shown and allowed (spec §4). The editor also runs a pure local mirror of
// these rules for live feedback, but this endpoint — and the identical check
// inside season_config_promote() — is what actually decides.

import { guard } from "@/lib/league-office/api-guard";
import { validateConfig } from "@/lib/league-office/seasons";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  const g = await guard();
  if (!g.ok) return g.response;

  const { configId } = await params;
  const findings = await validateConfig(g.s, configId);

  return Response.json({
    ok: true,
    findings,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    canPromote: !findings.some((f) => f.severity === "error"),
  });
}
