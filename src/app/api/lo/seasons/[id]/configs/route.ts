// GET /api/lo/seasons/[id]/configs — the version list for a season, ordered by
// version. Backs the detail page's version timeline.

import { guard } from "@/lib/league-office/api-guard";
import { loadConfigs } from "@/lib/league-office/seasons";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard();
  if (!g.ok) return g.response;

  const { id } = await params;
  const configs = await loadConfigs(g.s, id);
  return Response.json({ ok: true, configs });
}
