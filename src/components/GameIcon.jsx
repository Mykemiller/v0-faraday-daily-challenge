// Daily Challenge game pictograms — the Faraday editorial jewel registry.
// Each game has one desaturated jewel tone (FAR-394) and metaphor, drawn on a
// forest gradient tile with a shared glow filter, 10px grid texture, and ambient
// ellipse. Geometry ported verbatim from
// design-reference/faraday-daily-challenge-lobby.html; the per-game color moved
// from raw neon to a desaturated jewel tone per the editorial-palette pass.
//
// Usage:
//   <GameIconDefs />              once per page (hidden shared <defs>)
//   <GameIcon game="Rackl" />     per tile
//   GAME_ACCENT["Rackl"].glow     hover-glow color (per game)
//
// FAR-394 (editorial palette) — the per-game differentiator is now ONE
// desaturated jewel tone per game (`accent`), a darker companion for secondary
// fills (`deep`), and a subtle glow. Each `accent` clears >=3:1 against the
// darkest forest tile stop (#1C3424) so the pictogram reads without raw neon;
// none competes with Faraday Gold (#C4922A) as a dominant color. The mapping
// keeps each game's hue identity but is a PROPOSED design pass — confirm the
// final values with Myke/design before wide rollout (per the ticket). This
// object is the single source of truth: the pictogram fills, the lobby hover
// glow, and the globals.css --color-game-* mirror all derive from it.
export const GAME_ACCENT = {
  "Rackl":       { accent: "#2F9C8B", deep: "#237A6C", glow: "rgba(47,156,139,.28)" },  // teal
  "Signal Drop": { accent: "#C86A85", deep: "#A9506A", glow: "rgba(200,106,133,.28)" }, // garnet rose
  "The Stack":   { accent: "#A08A3A", deep: "#83712E", glow: "rgba(160,138,58,.28)" },  // citrine/bronze
  "Circuit":     { accent: "#4C90BD", deep: "#3A6E92", glow: "rgba(76,144,189,.28)" },  // sapphire
  "The Brief":   { accent: "#7CA34A", deep: "#61833A", glow: "rgba(124,163,74,.28)" },  // olive
  "Dark Fiber":  { accent: "#9A74C0", deep: "#7A5A9E", glow: "rgba(154,116,192,.28)" }, // amethyst
  "Frequency":   { accent: "#C06A3C", deep: "#9E5430", glow: "rgba(192,106,60,.28)" },  // rust/copper
};

// Backward-compatible alias for the former neon registry. Same shape as before
// (`neon` + `glow`), now pointing at the jewel `accent`, so any straggling
// `GAME_NEON[type].neon` / `.glow` reader keeps working during the palette pass.
export const GAME_NEON = Object.fromEntries(
  Object.entries(GAME_ACCENT).map(([k, v]) => [k, { neon: v.accent, glow: v.glow }])
);

// Shared neon glow filter + 10px grid texture + ambient ellipse (Ch.09b).
// Render exactly once per page; the pictograms reference these by id.
export function GameIconDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <filter id="fdc-neon" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern id="fdc-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke="rgba(248,245,240,.05)" strokeWidth="1" />
        </pattern>
        <radialGradient id="fdc-amb" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="rgba(248,245,240,.10)" />
          <stop offset="100%" stopColor="rgba(248,245,240,0)" />
        </radialGradient>
      </defs>
    </svg>
  );
}

function Pictogram({ game }) {
  switch (game) {
    case "Rackl":
      return (
        <g filter="url(#fdc-neon)">
          <rect x="24" y="20" width="62" height="70" rx="6" fill="none" stroke="#2F9C8B" strokeWidth="3" />
          <rect x="32" y="29" width="21" height="11" rx="2" fill="#2F9C8B" />
          <rect x="57" y="29" width="21" height="11" rx="2" fill="#237A6C" />
          <rect x="32" y="44" width="21" height="11" rx="2" fill="#237A6C" />
          <rect x="57" y="44" width="21" height="11" rx="2" fill="#2F9C8B" />
          <rect x="32" y="59" width="21" height="11" rx="2" fill="#2F9C8B" />
          <rect x="57" y="59" width="21" height="11" rx="2" fill="rgba(47,156,139,.30)" />
          <rect x="32" y="74" width="21" height="11" rx="2" fill="rgba(47,156,139,.30)" />
          <rect x="57" y="74" width="21" height="11" rx="2" fill="#237A6C" />
        </g>
      );
    case "Signal Drop":
      return (
        <g filter="url(#fdc-neon)">
          <g fill="rgba(200,106,133,.38)">
            <rect x="26" y="18" width="13" height="13" rx="2" />
            <rect x="43" y="18" width="13" height="13" rx="2" />
            <rect x="60" y="18" width="13" height="13" rx="2" />
            <rect x="77" y="18" width="13" height="13" rx="2" />
            <rect x="26" y="35" width="13" height="13" rx="2" />
            <rect x="43" y="35" width="13" height="13" rx="2" />
            <rect x="60" y="35" width="13" height="13" rx="2" />
            <rect x="77" y="35" width="13" height="13" rx="2" />
          </g>
          <g fill="#C86A85">
            <rect x="26" y="52" width="13" height="13" rx="2" />
            <rect x="43" y="52" width="13" height="13" rx="2" />
            <rect x="60" y="52" width="13" height="13" rx="2" />
            <rect x="77" y="52" width="13" height="13" rx="2" />
          </g>
          <path d="M24 84 q8 -12 16 0 t16 0 t16 0 t16 0" fill="none" stroke="#C86A85" strokeWidth="3.5" strokeLinecap="round" />
        </g>
      );
    case "The Stack":
      return (
        <g filter="url(#fdc-neon)">
          <rect x="40" y="22" width="30" height="13" rx="3" fill="#A08A3A" />
          <rect x="33" y="41" width="44" height="13" rx="3" fill="rgba(160,138,58,.70)" />
          <rect x="26" y="60" width="58" height="13" rx="3" fill="rgba(160,138,58,.50)" />
          <rect x="20" y="79" width="70" height="13" rx="3" fill="rgba(160,138,58,.30)" />
          <path d="M88 84 V30 M88 30 l-6 8 M88 30 l6 8" stroke="#A08A3A" strokeWidth="3.5" fill="none" strokeLinecap="round" transform="translate(8,0)" />
        </g>
      );
    case "Circuit":
      return (
        <g filter="url(#fdc-neon)">
          <circle cx="55" cy="34" r="13" fill="none" stroke="#4C90BD" strokeWidth="3.5" />
          <text x="55" y="40" textAnchor="middle" fontFamily="IBM Plex Mono,monospace" fontSize="16" fontWeight="700" fill="#4C90BD">?</text>
          <path d="M48 45 L33 62 M62 45 L77 62" stroke="#4C90BD" strokeWidth="3" strokeLinecap="round" />
          <rect x="22" y="62" width="22" height="14" rx="3" fill="#4C90BD" />
          <rect x="66" y="62" width="22" height="14" rx="3" fill="rgba(58,110,146,.55)" />
          <path d="M30 92 a26 12 0 0 1 50 0" fill="none" stroke="rgba(76,144,189,.55)" strokeWidth="3" strokeLinecap="round" strokeDasharray="5 6" />
        </g>
      );
    case "The Brief":
      return (
        <g filter="url(#fdc-neon)">
          <path d="M32 18 h32 l14 14 v50 h-46 z" fill="none" stroke="#7CA34A" strokeWidth="3" />
          <path d="M64 18 v14 h14" fill="rgba(124,163,74,.45)" stroke="#7CA34A" strokeWidth="3" />
          <line x1="40" y1="44" x2="70" y2="44" stroke="rgba(124,163,74,.45)" strokeWidth="3" strokeLinecap="round" />
          <line x1="40" y1="54" x2="70" y2="54" stroke="#7CA34A" strokeWidth="4" strokeLinecap="round" />
          <line x1="40" y1="64" x2="62" y2="64" stroke="rgba(124,163,74,.45)" strokeWidth="3" strokeLinecap="round" />
          <g>
            <circle cx="38" cy="92" r="4" fill="#7CA34A" />
            <circle cx="50" cy="92" r="4" fill="rgba(97,131,58,.6)" />
            <circle cx="62" cy="92" r="4" fill="rgba(97,131,58,.6)" />
            <circle cx="74" cy="92" r="4" fill="rgba(97,131,58,.6)" />
          </g>
        </g>
      );
    case "Dark Fiber":
      return (
        <g filter="url(#fdc-neon)" fill="none" strokeLinecap="round">
          <path d="M32 30 C 55 30 55 56 78 56" stroke="#9A74C0" strokeWidth="3.5" />
          <path d="M32 56 C 55 56 55 82 78 82" stroke="rgba(122,90,158,.65)" strokeWidth="3" />
          <path d="M32 82 C 55 82 55 30 78 30" stroke="rgba(122,90,158,.65)" strokeWidth="3" />
          <g fill="#9A74C0" stroke="none">
            <circle cx="30" cy="30" r="6" />
            <circle cx="30" cy="56" r="6" />
            <circle cx="30" cy="82" r="6" />
          </g>
          <g fill="rgba(154,116,192,.55)" stroke="none">
            <circle cx="80" cy="30" r="6" />
            <circle cx="80" cy="56" r="6" />
            <circle cx="80" cy="82" r="6" />
          </g>
        </g>
      );
    case "Frequency":
      return (
        <g filter="url(#fdc-neon)">
          <path d="M20 52 q9 -22 18 0 t18 0 t18 0 t18 0" fill="none" stroke="#C06A3C" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="66" y1="22" x2="66" y2="68" stroke="rgba(158,84,48,.85)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="66" cy="52" r="5" fill="#C06A3C" />
          <g>
            <circle cx="38" cy="88" r="4" fill="rgba(158,84,48,.6)" />
            <circle cx="50" cy="88" r="4" fill="#C06A3C" />
            <circle cx="62" cy="88" r="4" fill="rgba(158,84,48,.6)" />
            <circle cx="74" cy="88" r="4" fill="rgba(158,84,48,.6)" />
          </g>
        </g>
      );
    default:
      return null;
  }
}

/**
 * A single game's neon pictogram on its forest gradient tile.
 * @param {{ game: string, size?: number }} props
 */
export default function GameIcon({ game, size = 64 }) {
  return (
    <span
      className="icon-tile"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
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
      <svg width={size} height={size} viewBox="0 0 110 110">
        <rect width="110" height="110" fill="url(#fdc-grid)" />
        <rect width="110" height="110" fill="url(#fdc-amb)" />
        <Pictogram game={game} />
      </svg>
    </span>
  );
}
