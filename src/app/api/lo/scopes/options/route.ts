// GET /api/lo/scopes/options — pickers for the wizard's Scope step and the
// editor's Section B. Part B: leagues come from the real `leagues` table and
// conferences from `conferences` (the teams-as-leagues reading is retired).

import { guard } from "@/lib/league-office/api-guard";
import { getScopeOptions } from "@/lib/league-office/seasons";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await guard();
  if (!g.ok) return g.response;

  const options = await getScopeOptions(g.s);
  return Response.json({ ok: true, ...options });
}
