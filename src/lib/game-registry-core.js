// ── The game registry: runtime half (plain JS) ──────────────────────────────
//
// Pure lookups over game_catalog rows, with safe fallbacks. NO I/O and NO types,
// deliberately: this file is imported by node-run tests and by the share
// manifest, both of which load plain JS. The typed surface (GameRow, GridFit)
// re-exports everything from here in game-registry.ts.
//
// ⚠️ Adding an eighth game must never require editing this file. Every lookup
// takes the registry as an argument and degrades gracefully on a miss — an
// unknown game renders in neutral colours rather than crashing a surface.
//
// The join key is `runtime_key` (D3), not the display name. They happen to be
// identical for the seven launch games, which is exactly why the old
// display-name maps looked correct right up until a rename.

/** Neutral identity for a game the registry does not know about. Chosen to be
 *  visibly plain rather than to imitate any real game's accent. */
export const FALLBACK_ACCENT = {
  accent: '#B2A898',
  deep: '#8A8275',
  glow: 'rgba(178,168,152,.28)',
};

export const DEFAULT_PAR_SECONDS = 90;
export const DEFAULT_GRID_FIT = 'fluid';

/** The columns every registry read needs. One list, so a new column is added in
 *  one place and every caller gets it. */
export const GAME_REGISTRY_COLUMNS = [
  'id', 'game_key', 'display_name', 'runtime_key', 'short_code', 'public_id_prefix',
  'lifecycle_state', 'is_publishable', 'route_slug', 'accent_hex', 'accent_deep_hex',
  'accent_glow_rgba', 'lobby_sort_order', 'lobby_description', 'lobby_time_estimate',
  'lobby_format_chip', 'par_seconds', 'take_voice', 'grid_fit', 'signal_enabled',
  'is_core', 'share_epoch', 'sort_order', 'description',
].join(',');

/** The key the serving path joins on. Falls back to the display name so a row
 *  mid-setup still resolves rather than vanishing. */
export function keyOf(game) {
  return game.runtime_key || game.display_name;
}

/**
 * @param {any[]} games
 * @returns {Record<string, any>}
 */
export function byRuntimeKey(games) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const g of games) out[keyOf(g)] = g;
  return out;
}

/**
 * @param {any[]} games
 * @returns {Record<string, any>}
 */
export function bySlug(games) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const g of games) if (g.route_slug) out[g.route_slug] = g;
  return out;
}

/** Lobby order. `lobby_sort_order` is the player-facing LOCKED order and is
 *  deliberately NOT `sort_order` (the League Office catalog order). */
export function inLobbyOrder(games) {
  return [...games].sort((a, b) => {
    const av = a.lobby_sort_order ?? Number.MAX_SAFE_INTEGER;
    const bv = b.lobby_sort_order ?? Number.MAX_SAFE_INTEGER;
    return av === bv ? a.display_name.localeCompare(b.display_name) : av - bv;
  });
}

export function accentOf(game) {
  if (!game || !game.accent_hex) return { ...FALLBACK_ACCENT };
  return {
    accent: game.accent_hex,
    deep: game.accent_deep_hex || FALLBACK_ACCENT.deep,
    glow: game.accent_glow_rgba || FALLBACK_ACCENT.glow,
  };
}

/** Share/lobby icon path. Derived from the slug — never stored, so a renamed
 *  slug can never disagree with its asset. */
export function shareIconPath(game) {
  return game && game.route_slug ? `/share/icons/${game.route_slug}.png` : null;
}

export function parSecondsOf(game) {
  return (game && game.par_seconds) ?? DEFAULT_PAR_SECONDS;
}

export function gridFitOf(game) {
  const v = game && game.grid_fit;
  return v === 'square' || v === 'fluid' || v === 'list' || v === 'prose' ? v : DEFAULT_GRID_FIT;
}

/** D7. Null when the game can be published; otherwise a specific, human reason
 *  naming every missing field — never a bare "not ready". */
export function publishabilityReason(game) {
  const missing = [];
  if (!game.public_id_prefix) missing.push('Public ID prefix');
  if (!game.short_code) missing.push('short code');
  if (!game.runtime_key) missing.push('runtime key');
  if (missing.length === 0) return null;
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `Needs a ${list} on its catalog row before it can be published.`;
}

export function isSelectableForSeason(game) {
  return (
    (game.lifecycle_state === 'live' || game.lifecycle_state === 'in_test') &&
    game.is_publishable
  );
}
