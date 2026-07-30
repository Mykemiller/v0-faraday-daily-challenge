// GET /api/lo/scopes/options — pickers for the wizard's Scope step and the
// editor's Section B. Leagues are the top-level `teams` rows (parent_id is
// null); conferences are the optional layer between a league and its teams.

import { guard } from "@/lib/league-office/api-guard";
import { getScopeOptions } from "@/lib/league-office/seasons";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if (!g.ok) return g.response;

  const options = await getScopeOptions(g.s);
  return Response.json({ ok: true, ...options });
}
