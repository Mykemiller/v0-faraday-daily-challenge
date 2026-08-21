// ── Game registry loader (server-only) ──────────────────────────────────────
//
// Reads game_catalog through the service role. Mirrors the fail-soft contract
// of season-slate-server.ts: NEVER THROWS. On any failure it returns an empty
// registry, and callers fall back to whatever they can render without it — a
// lobby that cannot reach the catalog shows no tiles rather than a stack trace.
//
// Adding an eighth game means inserting a catalog row. Nothing here changes.

import { GAME_REGISTRY_COLUMNS, inLobbyOrder, type GameRow } from './game-registry';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

function svcHeaders(): Record<string, string> | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function fetchGames(filter: string): Promise<GameRow[]> {
  const h = svcHeaders();
  if (!h) return [];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/game_catalog?${filter}&select=${GAME_REGISTRY_COLUMNS}`,
      { headers: h, cache: 'no-store' }
    );
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? (j as GameRow[]) : [];
  } catch {
    return [];
  }
}

/** The live games, in locked lobby order. The player-facing registry. */
export async function loadLiveGames(): Promise<GameRow[]> {
  return inLobbyOrder(await fetchGames('lifecycle_state=eq.live'));
}

/** Every catalog row, including concepts. For League Office surfaces. */
export async function loadAllGames(): Promise<GameRow[]> {
  return await fetchGames('order=sort_order.asc');
}
