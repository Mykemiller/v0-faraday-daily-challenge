"use client";

// Daily Challenge game icons — the neon-on-forest raster set.
//
// The icons were hand-drawn inline SVG (Ch.09b geometry, recolored to FAR-394
// jewel tones) until the 2026-07-30 art refresh replaced them with authored
// 1280² masters. The art is now a build artifact, not code: see
// scripts/build-game-icons.mjs for how public/icons/games/* is produced.
// Do not hand-edit the PNGs — re-run the generator.
//
// Usage:
//   <GameIcon game="Rackl" />       per tile, slug resolved from the registry
//   <GameIcon slug="rackl" />       when the caller already has the slug
//
// CC-DC-GAME-REGISTRY-1.0: the route slug and the accent colours used to live in
// hardcoded maps here and in src/lib/game-accent.js (now deleted). Both are
// game_catalog columns — route_slug and accent_hex/accent_deep_hex/
// accent_glow_rgba — read through the registry context. Share-card icon paths
// derive from the same slug (src/lib/share/manifest.js).
//
// What changed underneath (CC-DC-ICON-REFRESH-1.0): the accent used to BE the
// pictogram ink drawn on the forest tile. The pictogram is now baked art; the
// accent's remaining jobs are the lobby hover glow (at .28 alpha) and the
// TodaysSignalCard accent prop.

import { useGameRegistry } from "@/components/GameRegistryContext";

/**
 * A single game's icon tile. The tile chrome (radius, hairline, forest fallback)
 * stays in CSS so the art can be swapped without touching layout. The container's
 * 20% radius is deliberately rounder than the art's baked ~8.6% corner, so
 * overflow:hidden clips away the master's opaque #1a1a1a corners.
 * An unknown game renders the empty forest tile rather than throwing — the
 * graceful-degradation rule that lets a catalog row exist before its art does.
 * @param {{ game?: string, slug?: string, size?: number }} props
 */
export default function GameIcon({ game, slug: slugProp, size = 64 }) {
  const reg = useGameRegistry();
  const slug = slugProp || reg.byKey[game]?.route_slug || null;
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
