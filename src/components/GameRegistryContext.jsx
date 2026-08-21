"use client";

// ── Game registry context (CC-DC-GAME-REGISTRY-1.0) ─────────────────────────
//
// The client half of the registry. A server component loads game_catalog and
// hands the rows down; everything below reads games from here instead of from a
// hardcoded map. Adding an eighth game changes nothing in this file.
//
// The default is an EMPTY registry rather than a copy of the seven launch games.
// That is deliberate: a stale hardcoded fallback is exactly the failure this CC
// exists to remove — it would keep rendering a game that had been retired, and
// hide a broken catalog read instead of surfacing it.

import { createContext, useContext, useMemo } from "react";
import { accentOf, bySlug, byRuntimeKey, inLobbyOrder, keyOf } from "@/lib/game-registry";
import { buildShareRegistry } from "@/lib/share/manifest";

const GameRegistryContext = createContext(null);

function buildValue(games) {
  const rows = Array.isArray(games) ? games : [];
  const ordered = inLobbyOrder(rows);
  return {
    games: ordered,
    byKey: byRuntimeKey(ordered),
    bySlug: bySlug(ordered),
    share: buildShareRegistry(ordered),
    /** Runtime keys in locked lobby order — replaces every hardcoded name array. */
    keys: ordered.map(keyOf),
    accentFor(runtimeKey) {
      return accentOf(byRuntimeKey(ordered)[runtimeKey]);
    },
  };
}

const EMPTY_VALUE = buildValue([]);

export function GameRegistryProvider({ games, children }) {
  const value = useMemo(() => buildValue(games), [games]);
  return <GameRegistryContext.Provider value={value}>{children}</GameRegistryContext.Provider>;
}

/** Never throws when used outside a provider — returns the empty registry so a
 *  surface degrades to "no games" rather than crashing. */
export function useGameRegistry() {
  return useContext(GameRegistryContext) || EMPTY_VALUE;
}
