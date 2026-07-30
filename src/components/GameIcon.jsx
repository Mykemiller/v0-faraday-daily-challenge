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

// Per-game color, sampled from the raster art. SUPERSEDES FAR-394's jewel tones
// (Myke-approved 2026-07-30). `deep` is the 0.78 companion for secondary fills.
//
// What changed underneath: the accent used to BE the pictogram ink drawn on the
// forest tile, so FAR-394's ">=3:1 on forest" rule described the icon itself. The
// pictogram is now baked art; the accent's only remaining jobs are the lobby
// hover glow (at .28 alpha) and the TodaysSignalCard accent prop.
//
// WHY THESE AREN'T ALL THE DOMINANT COLOR: three masters (Signal Drop, Circuit,
// The Brief) are predominantly cyan. Taking each one's modal color collapsed them
// to Δ5–Δ20 of each other and failed the FAR-394 distinguishability guard, and
// Dark Fiber's core violet read 2.56:1 on forest (min 3). So each accent is drawn
// from a DIFFERENT real color already present in its own master — Signal Drop
// takes its red waveform rather than its cyan word, The Brief its magenta
// highlight rows, Dark Fiber its lighter glow halo. No icon was recolored; the
// art is untouched. Gate result: 7/7 contrast, 0 pairs below Δ40 (closest Δ70).
export const GAME_ACCENT = {
  "Rackl":       { accent: "#48FF54", deep: "#38C742", glow: "rgba(72,255,84,.28)"   }, // LED green
  "Signal Drop": { accent: "#FF6B7D", deep: "#C75361", glow: "rgba(255,107,125,.28)" }, // red waveform
  "The Stack":   { accent: "#D6FF18", deep: "#A7C713", glow: "rgba(214,255,24,.28)"  }, // yellow-green bars
  "Circuit":     { accent: "#48FEFE", deep: "#38C6C6", glow: "rgba(72,254,254,.28)"  }, // cyan medallion
  "The Brief":   { accent: "#F58CF5", deep: "#BF6DBF", glow: "rgba(245,140,245,.28)" }, // magenta highlights
  "Dark Fiber":  { accent: "#A855FF", deep: "#8342C7", glow: "rgba(168,85,255,.28)"  }, // violet halo
  "Frequency":   { accent: "#FF7C52", deep: "#C76140", glow: "rgba(255,124,82,.28)"  }, // orange pulse
};

// Backward-compatible alias for the former neon registry. Same shape as before
// (`neon` + `glow`), so any straggling `GAME_NEON[type].neon` reader keeps working.
export const GAME_NEON = Object.fromEntries(
  Object.entries(GAME_ACCENT).map(([k, v]) => [k, { neon: v.accent, glow: v.glow }])
);

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
