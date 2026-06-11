// Daily Challenge game pictograms — the locked Ch.09b neon registry.
// Each game has a locked neon color and metaphor, drawn on a forest gradient
// tile with a shared glow filter, 10px grid texture, and ambient ellipse.
// Ported verbatim from design-reference/faraday-daily-challenge-lobby.html.
//
// Usage:
//   <GameIconDefs />            once per page (hidden shared <defs>)
//   <GameIcon game="Rackl" />   per tile
//   GAME_NEON["Rackl"].glow     hover-glow color (per game)

export const GAME_NEON = {
  "Rackl":       { neon: "#00FFC8", glow: "rgba(0,255,200,.3)" },
  "Signal Drop": { neon: "#FF2D78", glow: "rgba(255,45,120,.3)" },
  "The Stack":   { neon: "#FFE600", glow: "rgba(255,230,0,.3)" },
  "Circuit":     { neon: "#00CFFF", glow: "rgba(0,207,255,.3)" },
  "The Brief":   { neon: "#B8FF00", glow: "rgba(184,255,0,.3)" },
  "Dark Fiber":  { neon: "#BF5FFF", glow: "rgba(191,95,255,.3)" },
  "Frequency":   { neon: "#FF6B00", glow: "rgba(255,107,0,.3)" },
};

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
          <rect x="24" y="20" width="62" height="70" rx="6" fill="none" stroke="#00FFC8" strokeWidth="3" />
          <rect x="32" y="29" width="21" height="11" rx="2" fill="#00FFC8" />
          <rect x="57" y="29" width="21" height="11" rx="2" fill="#00A896" />
          <rect x="32" y="44" width="21" height="11" rx="2" fill="#00A896" />
          <rect x="57" y="44" width="21" height="11" rx="2" fill="#00FFC8" />
          <rect x="32" y="59" width="21" height="11" rx="2" fill="#00FFC8" />
          <rect x="57" y="59" width="21" height="11" rx="2" fill="rgba(0,255,200,.25)" />
          <rect x="32" y="74" width="21" height="11" rx="2" fill="rgba(0,255,200,.25)" />
          <rect x="57" y="74" width="21" height="11" rx="2" fill="#00A896" />
        </g>
      );
    case "Signal Drop":
      return (
        <g filter="url(#fdc-neon)">
          <g fill="rgba(255,111,168,.35)">
            <rect x="26" y="18" width="13" height="13" rx="2" />
            <rect x="43" y="18" width="13" height="13" rx="2" />
            <rect x="60" y="18" width="13" height="13" rx="2" />
            <rect x="77" y="18" width="13" height="13" rx="2" />
            <rect x="26" y="35" width="13" height="13" rx="2" />
            <rect x="43" y="35" width="13" height="13" rx="2" />
            <rect x="60" y="35" width="13" height="13" rx="2" />
            <rect x="77" y="35" width="13" height="13" rx="2" />
          </g>
          <g fill="#FF2D78">
            <rect x="26" y="52" width="13" height="13" rx="2" />
            <rect x="43" y="52" width="13" height="13" rx="2" />
            <rect x="60" y="52" width="13" height="13" rx="2" />
            <rect x="77" y="52" width="13" height="13" rx="2" />
          </g>
          <path d="M24 84 q8 -12 16 0 t16 0 t16 0 t16 0" fill="none" stroke="#FF2D78" strokeWidth="3.5" strokeLinecap="round" />
        </g>
      );
    case "The Stack":
      return (
        <g filter="url(#fdc-neon)">
          <rect x="40" y="22" width="30" height="13" rx="3" fill="#FFE600" />
          <rect x="33" y="41" width="44" height="13" rx="3" fill="rgba(255,230,0,.65)" />
          <rect x="26" y="60" width="58" height="13" rx="3" fill="rgba(255,165,0,.55)" />
          <rect x="20" y="79" width="70" height="13" rx="3" fill="rgba(255,165,0,.3)" />
          <path d="M88 84 V30 M88 30 l-6 8 M88 30 l6 8" stroke="#FFE600" strokeWidth="3.5" fill="none" strokeLinecap="round" transform="translate(8,0)" />
        </g>
      );
    case "Circuit":
      return (
        <g filter="url(#fdc-neon)">
          <circle cx="55" cy="34" r="13" fill="none" stroke="#00CFFF" strokeWidth="3.5" />
          <text x="55" y="40" textAnchor="middle" fontFamily="IBM Plex Mono,monospace" fontSize="16" fontWeight="700" fill="#00CFFF">?</text>
          <path d="M48 45 L33 62 M62 45 L77 62" stroke="#00CFFF" strokeWidth="3" strokeLinecap="round" />
          <rect x="22" y="62" width="22" height="14" rx="3" fill="#00CFFF" />
          <rect x="66" y="62" width="22" height="14" rx="3" fill="rgba(0,128,255,.45)" />
          <path d="M30 92 a26 12 0 0 1 50 0" fill="none" stroke="rgba(0,207,255,.55)" strokeWidth="3" strokeLinecap="round" strokeDasharray="5 6" />
        </g>
      );
    case "The Brief":
      return (
        <g filter="url(#fdc-neon)">
          <path d="M32 18 h32 l14 14 v50 h-46 z" fill="none" stroke="#B8FF00" strokeWidth="3" />
          <path d="M64 18 v14 h14" fill="rgba(184,255,0,.4)" stroke="#B8FF00" strokeWidth="3" />
          <line x1="40" y1="44" x2="70" y2="44" stroke="rgba(184,255,0,.4)" strokeWidth="3" strokeLinecap="round" />
          <line x1="40" y1="54" x2="70" y2="54" stroke="#B8FF00" strokeWidth="4" strokeLinecap="round" />
          <line x1="40" y1="64" x2="62" y2="64" stroke="rgba(184,255,0,.4)" strokeWidth="3" strokeLinecap="round" />
          <g>
            <circle cx="38" cy="92" r="4" fill="#B8FF00" />
            <circle cx="50" cy="92" r="4" fill="rgba(122,204,0,.5)" />
            <circle cx="62" cy="92" r="4" fill="rgba(122,204,0,.5)" />
            <circle cx="74" cy="92" r="4" fill="rgba(122,204,0,.5)" />
          </g>
        </g>
      );
    case "Dark Fiber":
      return (
        <g filter="url(#fdc-neon)" fill="none" strokeLinecap="round">
          <path d="M32 30 C 55 30 55 56 78 56" stroke="#BF5FFF" strokeWidth="3.5" />
          <path d="M32 56 C 55 56 55 82 78 82" stroke="rgba(139,47,224,.6)" strokeWidth="3" />
          <path d="M32 82 C 55 82 55 30 78 30" stroke="rgba(139,47,224,.6)" strokeWidth="3" />
          <g fill="#BF5FFF" stroke="none">
            <circle cx="30" cy="30" r="6" />
            <circle cx="30" cy="56" r="6" />
            <circle cx="30" cy="82" r="6" />
          </g>
          <g fill="rgba(191,95,255,.55)" stroke="none">
            <circle cx="80" cy="30" r="6" />
            <circle cx="80" cy="56" r="6" />
            <circle cx="80" cy="82" r="6" />
          </g>
        </g>
      );
    case "Frequency":
      return (
        <g filter="url(#fdc-neon)">
          <path d="M20 52 q9 -22 18 0 t18 0 t18 0 t18 0" fill="none" stroke="#FF6B00" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="66" y1="22" x2="66" y2="68" stroke="rgba(255,61,0,.8)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="66" cy="52" r="5" fill="#FF6B00" />
          <g>
            <circle cx="38" cy="88" r="4" fill="rgba(255,61,0,.5)" />
            <circle cx="50" cy="88" r="4" fill="#FF6B00" />
            <circle cx="62" cy="88" r="4" fill="rgba(255,61,0,.5)" />
            <circle cx="74" cy="88" r="4" fill="rgba(255,61,0,.5)" />
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
