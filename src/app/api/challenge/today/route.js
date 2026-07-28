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

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

// CT calendar date (matches the sync's puzzle_date + the AUTO-128 rotator).
function centralDate(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Faraday's Take (FAR-389): read today's take per puzzle type from
// dc_daily_page_content — the canonical day-content store the sync populates
// from the Airtable "Faraday Take" field (a dedicated editorial field, SEPARATE
// from "Answer Explanation"; D12: dc_daily_page_content is THE read path so
// Airtable is never in the take's hot path). Returns { [puzzleType]: { take,
// byline } }. Fails soft to {} on any missing config / table / row so the lobby
// never hard-fails on the take — the win screen then shows the explanation
// fallback derived client-side from each puzzle's own content.
async function fetchTodaysTakes() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return {};
  try {
    const today = centralDate(new Date());
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_daily_page_content?puzzle_date=eq.${today}&select=puzzles`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!res.ok) return {};
    const rows = await res.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    const puzzles = row && Array.isArray(row.puzzles) ? row.puzzles : [];
    const out = {};
    for (const p of puzzles) {
      if (!p || typeof p.puzzle_type !== "string") continue;
      const take =
        typeof p.faradays_take === "string" && p.faradays_take.trim()
          ? p.faradays_take.trim()
          : null;
      if (!take) continue; // no authored take → fall back to the explanation (D14)
      const byline =
        typeof p.take_byline === "string" && p.take_byline.trim()
          ? p.take_byline.trim()
          : null; // null → the component defaults the byline by game type (D13)
      out[p.puzzle_type] = { take, byline };
    }
    return out;
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const [puzzles, tip, takes] = await Promise.all([
      getLivePuzzles(),
      getTipOfTheDay(),
      fetchTodaysTakes(),
    ]);
    // Attach the take to each puzzle by type (spoiler-safe: it is rendered only
    // on the completion screen, after the player has solved that puzzle).
    for (const [type, entry] of Object.entries(takes)) {
      if (puzzles && puzzles[type]) {
        puzzles[type].faradays_take = entry.take;
        puzzles[type].take_byline = entry.byline;
      }
    }
    return Response.json({ puzzles, tip }, { headers: NO_STORE });
  } catch (err) {
    console.error("[/api/challenge/today] falling back to empty set:", err);
    return Response.json({ puzzles: {}, tip: null }, { headers: NO_STORE });
  }
}
