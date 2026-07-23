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
//
// CACHING: this response is served `no-store`. It used to carry
// `public, s-maxage=3600, stale-while-revalidate=86400`, which publicly cached
// the payload at the edge/browser for up to ~25h. That was actively harmful:
// (1) the payload is answer-adjacent and rotates daily, and historically DID
// carry the Signal Drop answer, so a shared/public cache could serve a solved
// game's answer to other players and keep serving a stale set across the
// midnight rotation; (2) after a fix ships, stale-while-revalidate can keep
// serving the pre-fix (leaky) copy for a day. The Airtable read is still cached
// server-side for an hour (`next: { revalidate: 3600 }` in the puzzle-bank
// helper), so `no-store` costs a route execution, not an upstream fetch.

import { getLivePuzzles, getTipOfTheDay } from "@/lib/airtable-puzzle-bank";

// Read live each request; do not statically prerender at build time.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const [puzzles, tip] = await Promise.all([
      getLivePuzzles(),
      getTipOfTheDay(),
    ]);
    return Response.json({ puzzles, tip }, { headers: NO_STORE });
  } catch (err) {
    console.error("[/api/challenge/today] falling back to empty set:", err);
    return Response.json({ puzzles: {}, tip: null }, { headers: NO_STORE });
  }
}
