// Daily Challenge game icons — the neon-on-forest raster set.
//
// The icons were hand-drawn inline SVG (Ch.09b geometry, recolored to FAR-394
// jewel tones) until the 2026-07-30 art refresh replaced them with authored
// 1280² masters. The art is now a build artifact, not code: see
// scripts/build-game-icons.mjs for how public/icons/games/* is produced.
// Do not hand-edit the PNGs — re-run the generator.
//
// Usage:
//   <GameIcon game="Rackl" />       per tile
//   GAME_ACCENT["Rackl"].glow       hover-glow color (per game)
//   gameShareIconSrc("Rackl")       labeled 640² frame for the share card

// Route slug per game key. Three masters carry a shorter baked label than the
// game key ("SIGNAL", "FIBER", "THE CIRCUIT"); the slug follows the app's route.
const GAME_SLUG = {
  "Rackl": "rackl",
  "Signal Drop": "signal-drop",
  "The Stack": "the-stack",
  "Circuit": "circuit",
  "The Brief": "the-brief",
  "Dark Fiber": "dark-fiber",
  "Frequency": "frequency",
};

// Per-game accent colors. The values (and the full rationale for why they aren't
// each icon's dominant color) moved to the pure module src/lib/game-accent.js so
// the share manifest (CC-DC-SHARE-1.0) and node-run tests can import them without
// JSX. Re-exported here so every existing `from "@/components/GameIcon"` importer
// keeps working — this file remains the conventional import point for components.
//
// What changed underneath (CC-DC-ICON-REFRESH-1.0): the accent used to BE the
// pictogram ink drawn on the forest tile. The pictogram is now baked art; the
// accent's remaining jobs are the lobby hover glow (at .28 alpha) and the
// TodaysSignalCard accent prop.
export { GAME_ACCENT, GAME_NEON } from "../lib/game-accent";

/**
 * The labeled 640² share frame (dark field + tile + baked game name). Used by the
 * share card, where the baked label is the point. Returns "" for an unknown game.
 * @param {string} game
 */
export function gameShareIconSrc(game) {
  const slug = GAME_SLUG[game];
  return slug ? `/icons/games/${slug}-share.png` : "";
}

/**
 * A single game's icon tile. The tile chrome (radius, hairline, forest fallback)
 * stays in CSS so the art can be swapped without touching layout. The container's
 * 20% radius is deliberately rounder than the art's baked ~8.6% corner, so
 * overflow:hidden clips away the master's opaque #1a1a1a corners.
 * @param {{ game: string, size?: number }} props
 */
export default function GameIcon({ game, size = 64 }) {
  const slug = GAME_SLUG[game];
  return (
    <span
      className="icon-tile"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        // border-box so the hairline eats into the tile rather than adding 2px —
        // otherwise the art renders (size-2)×size and the square goes oblong.
        boxSizing: "border-box",
        flex: "none",
        borderRadius: Math.round(size * 0.2),
        border: "1px solid rgba(255,255,255,.09)",
        background: "linear-gradient(160deg, #234530, #1C3424)",
        display: "grid",
        placeItems: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {slug && (
        // Fixed-size static tile: next/image adds an optimizer request and a
        // layout wrapper for no gain at ≤64px, and these ship pre-sized.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/icons/games/${slug}-tile-256.png`}
          srcSet={`/icons/games/${slug}-tile-128.png 128w, /icons/games/${slug}-tile-256.png 256w`}
          sizes={`${size}px`}
          alt=""
          width={size}
          height={size}
          decoding="async"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      )}
    </span>
  );
}
