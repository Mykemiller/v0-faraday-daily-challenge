// Per-game accent colors, sampled from the raster icon art (CC-DC-ICON-REFRESH-1.0).
// SUPERSEDES FAR-394's jewel tones (Myke-approved 2026-07-30). `deep` is the 0.78
// companion for secondary fills.
//
// This is the single source of truth. It lives in a pure module (no JSX) so both
// React components (via the re-export in src/components/GameIcon.jsx) and pure
// node-testable code (src/lib/share/manifest.js) can import it. The two mirrors
// that must stay in sync with these values remain: `--color-game-*`/`--color-neon-*`
// in globals.css and the gate's own copy in scripts/contrast-check.mjs.
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
