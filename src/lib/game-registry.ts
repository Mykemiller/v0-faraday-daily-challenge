// ── The game registry: typed surface ────────────────────────────────────────
//
// `game_catalog` is the single source of truth for a game's identity and
// presentation. The runtime lookups live in game-registry-core.js (plain JS, so
// node tests and the share manifest can import them); this module adds the
// types and re-exports everything.
//
// The loader lives in game-registry-server.ts.

export * from './game-registry-core.js';

export type GridFit = 'square' | 'fluid' | 'list' | 'prose';

export interface GameRow {
  id: string;
  game_key: string;
  display_name: string;
  runtime_key: string | null;
  short_code: string | null;
  public_id_prefix: string | null;
  lifecycle_state: 'new_idea' | 'in_test' | 'live' | 'retired';
  is_publishable: boolean;
  route_slug: string | null;
  accent_hex: string | null;
  accent_deep_hex: string | null;
  accent_glow_rgba: string | null;
  lobby_sort_order: number | null;
  lobby_description: string | null;
  lobby_time_estimate: string | null;
  lobby_format_chip: string | null;
  par_seconds: number | null;
  take_voice: string | null;
  grid_fit: string | null;
  signal_enabled: boolean;
  is_core: boolean;
  share_epoch: string | null;
  sort_order: number | null;
  description: string | null;
}
