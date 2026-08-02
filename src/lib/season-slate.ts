// Season slate enforcement — which games a season actually serves.
//
// ⚠️ THIS RETIRES D4. Until 2026-08-02 the season slate was ADVISORY: toggling
// `season_games.is_enabled` changed what the League Office displayed, never what
// subscribers received (`/api/challenge/today` selected on publish state alone).
// Myke decided the slate should gate serving, so it now does. The old guarantee
// and its guard (`test:advisory-only`) are replaced by `test:slate-enforced`.
//
// ── The two fail-safes, both load-bearing ───────────────────────────────────
// Serving is the daily-driver path; a slate that resolves to nothing must never
// blank the lobby. Verified against prod 2026-08-02: THREE of six seasons have
// no active season_config at all, so naive enforcement would serve them zero
// games. Hence:
//
//   1. No resolvable slate (no active season, no active config, no enabled
//      rows) → serve EVERYTHING, i.e. exactly the pre-D4-retirement behaviour.
//   2. Any error while resolving → same. The loader never throws.
//
// The consequence worth understanding: enforcement only ever NARROWS a set that
// was successfully resolved. It can never produce an empty lobby from a
// configuration mistake — only from a deliberate, fully-configured season that
// enables no games, which the League Office already refuses to promote.

/** A live-puzzle map keyed by the free-text runtime name ("Rackl", "Circuit"…). */
export type PuzzleMap = Record<string, unknown>;

/**
 * Narrow a live puzzle set to the season's enabled games.
 *
 * `slate` is the list of `game_catalog.runtime_key` values the season enables.
 * null / empty → the map is returned UNCHANGED (fail-safe 1).
 *
 * Keys present in the slate but absent from the live set are simply not there —
 * a configured game with no published puzzle today does not fabricate one.
 */
export function filterToSlate<T extends PuzzleMap>(puzzles: T, slate: string[] | null): T {
  if (!puzzles) return puzzles;
  if (!slate || slate.length === 0) return puzzles;

  const allow = new Set(slate);
  const out: PuzzleMap = {};
  for (const [type, puzzle] of Object.entries(puzzles)) {
    if (allow.has(type)) out[type] = puzzle;
  }
  // Belt and braces: if the intersection is empty, the slate and the live set
  // disagree entirely (a renamed runtime_key, a bank that hasn't rotated). That
  // is a misconfiguration, not an intent to serve nothing — fall back rather
  // than blank the lobby.
  if (Object.keys(out).length === 0) return puzzles;
  return out as T;
}

/**
 * The served game list for a client, given the slate and what is actually live.
 *
 * The lobby renders from this rather than from its hardcoded GAME_CONFIGS, so a
 * disabled game disappears from the grid instead of falling through to mock
 * data. Order follows `order` (the client's canonical lobby order), not the
 * slate's, so enabling a game never reshuffles the grid.
 */
export function servedGameList(
  order: string[],
  slate: string[] | null,
  livePuzzles: PuzzleMap | null
): string[] {
  // No slate → every game the client knows about (today's behaviour).
  if (!slate || slate.length === 0) return order;

  const allow = new Set(slate);
  const inOrder = order.filter((t) => allow.has(t));
  // A slate that matches nothing the client knows → fall back, same reasoning
  // as filterToSlate.
  if (inOrder.length === 0) return order;

  // Games the slate enables but which have no live puzzle today are still shown
  // — they are part of this season, and the tile's own "no puzzle" handling is
  // the honest surface for that. We only use livePuzzles to avoid *hiding* a
  // live game the slate somehow omitted, which fail-safe 1 already covers.
  void livePuzzles;
  return inOrder;
}
