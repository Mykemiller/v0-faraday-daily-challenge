// CC-DC-SHARE-1.0 — the share manifest, now built from the game registry
// (CC-DC-GAME-REGISTRY-1.0 D10).
//
// This used to be a hand-written table of seven games carrying their own slugs,
// icons, accents and Public ID prefixes. All of that is `game_catalog` data now;
// this module turns registry rows into the shape the share/card/unfurl code
// already expects. Adding an eighth game requires no edit here.
//
// Still DATA + tiny lookups only — pure, dependency-free, node-testable. The
// caller loads the registry (server-side) and passes the rows in.
//
// ⚠️ `epoch` is PINNED PER GAME (game_catalog.share_epoch), never derived at
// runtime. Phase 0 of the share CC established 2026-06-24 as day #1 for all
// seven launch games; computing it from the serving bank would silently
// renumber every share already in the wild. A new game carries its own epoch.
//
// ⚠️ `publicIdPrefix` is game_catalog.public_id_prefix (the four-letter code), NOT
// short_code. Two live systems — never derive one from the other.

import { accentOf, keyOf, shareIconPath } from "../game-registry-core.js";

// Canonical subscriber origin (PR #112). Share payloads must never emit any
// other host — asserted in buildShare.test.js (AC 4).
export const CANONICAL_ORIGIN = "https://www.faradaydailychallenge.com";
// The bare host, as it appears as the text block's footer line.
export const CANONICAL_HOST = "faradaydailychallenge.com";

export const GENERIC_SLUG = "daily-challenge";

// D7 generic: any share not scoped to one game. Accent = brand gold (there is
// no per-game accent for the DC mark; gold is the scoring/brand color). This is
// the one entry that is NOT a game and so is not registry-driven.
export const GENERIC_ENTRY = Object.freeze({
  displayName: "Daily Challenge",
  icon: "/share/icons/daily-challenge.png",
  accent: "#C4922A",
  publicIdPrefix: null,
  epoch: null,
});

/**
 * @typedef {{ displayName: string, icon: string, accent: string,
 *             publicIdPrefix: string|null, epoch: string|null }} ShareEntry
 */

/**
 * Build the share lookups for a set of registry rows.
 *
 * @param {Array<object>} games  game_catalog rows (see lib/game-registry.ts)
 * @returns {{
 *   manifest: Record<string, ShareEntry>,
 *   slugByType: Record<string, string>,
 *   typeBySlug: Record<string, string>,
 *   entryForType: (type: string) => ShareEntry,
 *   slugForType: (type: string) => string,
 *   iconForSlug: (slug: string) => string,
 *   isGameType: (type: string) => boolean,
 * }}
 */
export function buildShareRegistry(games) {
  const rows = Array.isArray(games) ? games : [];

  const manifest = { [GENERIC_SLUG]: GENERIC_ENTRY };
  const slugByType = {};
  const typeBySlug = {};

  for (const g of rows) {
    if (!g || !g.route_slug) continue;
    const type = keyOf(g);
    const slug = g.route_slug;
    slugByType[type] = slug;
    typeBySlug[slug] = type;
    manifest[slug] = {
      displayName: g.display_name,
      icon: shareIconPath(g) || GENERIC_ENTRY.icon,
      accent: accentOf(g).accent,
      publicIdPrefix: g.public_id_prefix || null,
      epoch: g.share_epoch || null,
    };
  }

  return {
    manifest,
    slugByType,
    typeBySlug,
    /** Unknown/missing type → the generic Daily Challenge entry (D7): a share
     *  never breaks on a new or misspelled game, it degrades to the DC mark. */
    entryForType(type) {
      return manifest[slugByType[type]] || GENERIC_ENTRY;
    },
    slugForType(type) {
      return slugByType[type] || GENERIC_SLUG;
    },
    /** Falls back to the Daily Challenge mark for any unknown slug (AC 7). */
    iconForSlug(slug) {
      const entry = manifest[slug];
      return (entry && entry.icon) || GENERIC_ENTRY.icon;
    },
    isGameType(type) {
      return typeof type === "string" && Object.prototype.hasOwnProperty.call(slugByType, type);
    },
  };
}

/** An empty registry — every lookup degrades to the generic mark. Used when the
 *  catalog is unreachable, so share/unfurl paths still render. */
export const EMPTY_SHARE_REGISTRY = buildShareRegistry([]);
