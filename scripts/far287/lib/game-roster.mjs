// The live game roster, from game_catalog (CC-DC-GAME-REGISTRY-1.0).
//
// The FAR-287 scripts used to import a hardcoded PUZZLE_TYPES array. The
// authoritative roster is the catalog, so an eighth game is generated and
// validated without touching these scripts.
//
// Throws rather than falling back to a guessed list: a generation run against
// the wrong roster would write puzzles for games that do not exist, or silently
// skip a game that does.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

export async function liveGameTypes() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("liveGameTypes: SUPABASE_SERVICE_ROLE_KEY is required to read game_catalog");
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/game_catalog?lifecycle_state=eq.live` +
      `&select=runtime_key,display_name,lobby_sort_order&order=lobby_sort_order.asc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!res.ok) throw new Error(`liveGameTypes: game_catalog read failed (${res.status})`);
  const rows = await res.json();
  const types = (Array.isArray(rows) ? rows : [])
    .map((r) => r.runtime_key || r.display_name)
    .filter(Boolean);
  if (types.length === 0) throw new Error("liveGameTypes: game_catalog returned no live games");
  return types;
}
