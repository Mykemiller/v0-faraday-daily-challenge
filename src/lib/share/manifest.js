// CC-DC-SHARE-1.0 — the share manifest: one entry per shareable identity
// (7 games + the Daily Challenge generic mark), keyed by route slug.
//
// This is DATA + tiny lookups only — pure, dependency-free, node-testable.
// Accents come from the existing GAME_ACCENT tokens (single source of truth,
// src/lib/game-accent.js) — never redefined here.
//
// ⚠️ `epoch` is a PINNED constant, never derived at runtime. Phase 0
// (ops/2026-07-30-dc-share-surface-audit.md §3) established the earliest
// Go Live Date in the serving bank is 2026-06-24 for all 7 games; the Supabase
// staging bank only holds pilot rows, so computing the epoch from the active
// serving source post-cutover would silently renumber every share in the wild.
import { GAME_ACCENT } from "../game-accent.js";

// Canonical subscriber origin (PR #112). Share payloads must never emit any
// other host — asserted in buildShare.test.js (AC 4).
export const CANONICAL_ORIGIN = "https://www.faradaydailychallenge.com";
// The bare host, as it appears as the text block's footer line.
export const CANONICAL_HOST = "faradaydailychallenge.com";

export const GENERIC_SLUG = "daily-challenge";

// D2 epoch: day #1 = 2026-06-24 for every game (see header note).
export const SHARE_EPOCH = "2026-06-24";

// Game key (the runtime's display-name join key) → route slug.
export const SLUG_BY_TYPE = {
  "Rackl": "rackl",
  "Signal Drop": "signal-drop",
  "The Stack": "the-stack",
  "Circuit": "circuit",
  "The Brief": "the-brief",
  "Dark Fiber": "dark-fiber",
  "Frequency": "frequency",
};

// slug → { displayName, icon, accent, publicIdPrefix, epoch }.
// `publicIdPrefix` is the Public ID prefix (RACK/SGNL/…), NOT game_catalog.short_code
// — two live systems, never derive one from the other (game-library D8).
export const SHARE_MANIFEST = {
  "rackl": {
    displayName: "Rackl",
    icon: "/share/icons/rackl.png",
    accent: GAME_ACCENT["Rackl"].accent,
    publicIdPrefix: "RACK",
    epoch: SHARE_EPOCH,
  },
  "signal-drop": {
    displayName: "Signal Drop",
    icon: "/share/icons/signal-drop.png",
    accent: GAME_ACCENT["Signal Drop"].accent,
    publicIdPrefix: "SGNL",
    epoch: SHARE_EPOCH,
  },
  "the-stack": {
    displayName: "The Stack",
    icon: "/share/icons/the-stack.png",
    accent: GAME_ACCENT["The Stack"].accent,
    publicIdPrefix: "STAK",
    epoch: SHARE_EPOCH,
  },
  "circuit": {
    displayName: "Circuit",
    icon: "/share/icons/circuit.png",
    accent: GAME_ACCENT["Circuit"].accent,
    publicIdPrefix: "CIRC",
    epoch: SHARE_EPOCH,
  },
  "the-brief": {
    displayName: "The Brief",
    icon: "/share/icons/the-brief.png",
    accent: GAME_ACCENT["The Brief"].accent,
    publicIdPrefix: "BRIF",
    epoch: SHARE_EPOCH,
  },
  "dark-fiber": {
    displayName: "Dark Fiber",
    icon: "/share/icons/dark-fiber.png",
    accent: GAME_ACCENT["Dark Fiber"].accent,
    publicIdPrefix: "FIBR",
    epoch: SHARE_EPOCH,
  },
  "frequency": {
    displayName: "Frequency",
    icon: "/share/icons/frequency.png",
    accent: GAME_ACCENT["Frequency"].accent,
    publicIdPrefix: "FREQ",
    epoch: SHARE_EPOCH,
  },
  // D7 generic: any share not scoped to one game. Accent = brand gold (there is
  // no per-game accent for the DC mark; gold is the scoring/brand color).
  [GENERIC_SLUG]: {
    displayName: "Daily Challenge",
    icon: "/share/icons/daily-challenge.png",
    accent: "#C4922A",
    publicIdPrefix: null,
    epoch: SHARE_EPOCH,
  },
};

// Inverse of SLUG_BY_TYPE — the D6 deep-link reader maps ?g=<slug> back to the
// runtime game key.
export const TYPE_BY_SLUG = Object.fromEntries(
  Object.entries(SLUG_BY_TYPE).map(([type, slug]) => [slug, type])
);

/**
 * Manifest entry for a runtime game key ("Signal Drop"). Unknown/missing type
 * → the generic Daily Challenge entry (D7): a share never breaks on a new or
 * misspelled game, it degrades to the DC mark + lobby link.
 */
export function entryForType(puzzleType) {
  const slug = SLUG_BY_TYPE[puzzleType];
  return SHARE_MANIFEST[slug] || SHARE_MANIFEST[GENERIC_SLUG];
}

/** Route slug for a runtime game key, or the generic slug when unknown. */
export function slugForType(puzzleType) {
  return SLUG_BY_TYPE[puzzleType] || GENERIC_SLUG;
}

/**
 * Icon path for a slug, falling back to the Daily Challenge mark for any
 * unknown slug (AC 7: a missing icon degrades to the DC mark, never breaks).
 */
export function iconForSlug(slug) {
  const entry = SHARE_MANIFEST[slug];
  return (entry && entry.icon) || SHARE_MANIFEST[GENERIC_SLUG].icon;
}
