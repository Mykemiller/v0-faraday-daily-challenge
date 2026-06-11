// GET /api/challenge/today
//
// Returns today's puzzle set for the Daily Challenge lobby:
//   { puzzles: { "Rackl": {...}, "Signal Drop": {...}, ... }, tip: {...} | null }
//
// `puzzles` is keyed by puzzle type and contains only the types that have a
// valid published puzzle in the Airtable Puzzle Bank. The component fills any
// missing type from its built-in mock data, so a partial (or empty) response
// still renders all 7 games.
//
// If Airtable is unreachable or misconfigured, we respond 200 with empty
// puzzles and tip:null rather than erroring — the lobby must never hard-fail.

import { getLivePuzzles, getTipOfTheDay } from "@/lib/airtable-puzzle-bank";

// Read live each request; do not statically prerender at build time.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [puzzles, tip] = await Promise.all([
      getLivePuzzles(),
      getTipOfTheDay(),
    ]);
    return Response.json(
      { puzzles, tip },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch (err) {
    console.error("[/api/challenge/today] falling back to empty set:", err);
    return Response.json({ puzzles: {}, tip: null });
  }
}
