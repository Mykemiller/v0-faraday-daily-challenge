// GET /api/lo/game-catalog — the extensible puzzle library behind the slate
// editor. The Game Slate section renders WHATEVER this returns, so adding an
// 8th row to game_catalog makes it appear with zero code change (spec §7).

import { guard } from "@/lib/league-office/api-guard";
import { loadGameCatalog } from "@/lib/league-office/seasons";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const g = await guard();
  if (!g.ok) return g.response;

  const includeRetired = new URL(request.url).searchParams.get("all") === "1";
  const catalog = await loadGameCatalog(g.s);

  return Response.json({
    ok: true,
    catalog: includeRetired ? catalog : catalog.filter((c) => c.is_active && !c.retired_on),
  });
}
