// GET /api/games — the public game roster (CC-DC-GAME-REGISTRY-1.0).
//
// Name + slug only. Deliberately NOT the whole catalog row: nothing here should
// leak scoring config, lifecycle notes, or anything answer-adjacent. Surfaces
// that need presentation data (accents, blurbs) are server-rendered and read the
// registry directly.
//
// Exists so client components rendered on many pages — the standalone header
// nav, chiefly — can list the games without every page threading a prop.

import { NextResponse } from "next/server";
import { loadLiveGames } from "@/lib/game-registry-server";
import { keyOf } from "@/lib/game-registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const games = await loadLiveGames();
  return NextResponse.json(
    { games: games.map((g) => ({ key: keyOf(g), slug: g.route_slug })) },
    // Short shared cache: the roster changes when a game is promoted or
    // retired, which is rare, but a stale menu for an hour would be wrong.
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
  );
}
