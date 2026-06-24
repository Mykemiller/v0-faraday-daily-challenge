// Standalone SVG-string builder for the locked Ch.09b game pictograms, used to
// rasterise a game's neon icon onto the share-card <canvas> (see
// buildShareIconBlob in DailyChallenge.jsx). The on-screen lobby/header icons
// come from GameIcon.jsx (JSX); this mirrors the SAME path data as a serialised
// string so it can be loaded via an <img src="data:image/svg+xml,…">. Keep the
// two in sync if the locked pictograms ever change.

// Per-game neon pictogram markup (kebab-case attrs for raw SVG), drawn in the
// 110×110 viewBox and lit by the shared #g glow filter.
const PICTOGRAMS = {
  Rackl: `<g filter="url(#g)">
    <rect x="24" y="20" width="62" height="70" rx="6" fill="none" stroke="#00FFC8" stroke-width="3"/>
    <rect x="32" y="29" width="21" height="11" rx="2" fill="#00FFC8"/><rect x="57" y="29" width="21" height="11" rx="2" fill="#00A896"/>
    <rect x="32" y="44" width="21" height="11" rx="2" fill="#00A896"/><rect x="57" y="44" width="21" height="11" rx="2" fill="#00FFC8"/>
    <rect x="32" y="59" width="21" height="11" rx="2" fill="#00FFC8"/><rect x="57" y="59" width="21" height="11" rx="2" fill="rgba(0,255,200,.25)"/>
    <rect x="32" y="74" width="21" height="11" rx="2" fill="rgba(0,255,200,.25)"/><rect x="57" y="74" width="21" height="11" rx="2" fill="#00A896"/>
  </g>`,
  "Signal Drop": `<g filter="url(#g)">
    <g fill="rgba(255,111,168,.35)">
      <rect x="26" y="18" width="13" height="13" rx="2"/><rect x="43" y="18" width="13" height="13" rx="2"/><rect x="60" y="18" width="13" height="13" rx="2"/><rect x="77" y="18" width="13" height="13" rx="2"/>
      <rect x="26" y="35" width="13" height="13" rx="2"/><rect x="43" y="35" width="13" height="13" rx="2"/><rect x="60" y="35" width="13" height="13" rx="2"/><rect x="77" y="35" width="13" height="13" rx="2"/>
    </g>
    <g fill="#FF2D78"><rect x="26" y="52" width="13" height="13" rx="2"/><rect x="43" y="52" width="13" height="13" rx="2"/><rect x="60" y="52" width="13" height="13" rx="2"/><rect x="77" y="52" width="13" height="13" rx="2"/></g>
    <path d="M24 84 q8 -12 16 0 t16 0 t16 0 t16 0" fill="none" stroke="#FF2D78" stroke-width="3.5" stroke-linecap="round"/>
  </g>`,
  "The Stack": `<g filter="url(#g)">
    <rect x="40" y="22" width="30" height="13" rx="3" fill="#FFE600"/>
    <rect x="33" y="41" width="44" height="13" rx="3" fill="rgba(255,230,0,.65)"/>
    <rect x="26" y="60" width="58" height="13" rx="3" fill="rgba(255,165,0,.55)"/>
    <rect x="20" y="79" width="70" height="13" rx="3" fill="rgba(255,165,0,.3)"/>
    <path d="M88 84 V30 M88 30 l-6 8 M88 30 l6 8" stroke="#FFE600" stroke-width="3.5" fill="none" stroke-linecap="round" transform="translate(8,0)"/>
  </g>`,
  Circuit: `<g filter="url(#g)">
    <circle cx="55" cy="34" r="13" fill="none" stroke="#00CFFF" stroke-width="3.5"/>
    <text x="55" y="40" text-anchor="middle" font-family="monospace" font-size="16" font-weight="700" fill="#00CFFF">?</text>
    <path d="M48 45 L33 62 M62 45 L77 62" stroke="#00CFFF" stroke-width="3" stroke-linecap="round"/>
    <rect x="22" y="62" width="22" height="14" rx="3" fill="#00CFFF"/><rect x="66" y="62" width="22" height="14" rx="3" fill="rgba(0,128,255,.45)"/>
    <path d="M30 92 a26 12 0 0 1 50 0" fill="none" stroke="rgba(0,207,255,.55)" stroke-width="3" stroke-linecap="round" stroke-dasharray="5 6"/>
  </g>`,
  "The Brief": `<g filter="url(#g)">
    <path d="M32 18 h32 l14 14 v50 h-46 z" fill="none" stroke="#B8FF00" stroke-width="3"/>
    <path d="M64 18 v14 h14" fill="rgba(184,255,0,.4)" stroke="#B8FF00" stroke-width="3"/>
    <line x1="40" y1="44" x2="70" y2="44" stroke="rgba(184,255,0,.4)" stroke-width="3" stroke-linecap="round"/>
    <line x1="40" y1="54" x2="70" y2="54" stroke="#B8FF00" stroke-width="4" stroke-linecap="round"/>
    <line x1="40" y1="64" x2="62" y2="64" stroke="rgba(184,255,0,.4)" stroke-width="3" stroke-linecap="round"/>
    <circle cx="38" cy="92" r="4" fill="#B8FF00"/><circle cx="50" cy="92" r="4" fill="rgba(122,204,0,.5)"/><circle cx="62" cy="92" r="4" fill="rgba(122,204,0,.5)"/><circle cx="74" cy="92" r="4" fill="rgba(122,204,0,.5)"/>
  </g>`,
  "Dark Fiber": `<g filter="url(#g)" fill="none" stroke-linecap="round">
    <path d="M32 30 C 55 30 55 56 78 56" stroke="#BF5FFF" stroke-width="3.5"/>
    <path d="M32 56 C 55 56 55 82 78 82" stroke="rgba(139,47,224,.6)" stroke-width="3"/>
    <path d="M32 82 C 55 82 55 30 78 30" stroke="rgba(139,47,224,.6)" stroke-width="3"/>
    <g fill="#BF5FFF" stroke="none"><circle cx="30" cy="30" r="6"/><circle cx="30" cy="56" r="6"/><circle cx="30" cy="82" r="6"/></g>
    <g fill="rgba(191,95,255,.55)" stroke="none"><circle cx="80" cy="30" r="6"/><circle cx="80" cy="56" r="6"/><circle cx="80" cy="82" r="6"/></g>
  </g>`,
  Frequency: `<g filter="url(#g)">
    <path d="M20 52 q9 -22 18 0 t18 0 t18 0 t18 0" fill="none" stroke="#FF6B00" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="66" y1="22" x2="66" y2="68" stroke="rgba(255,61,0,.8)" stroke-width="3" stroke-linecap="round"/>
    <circle cx="66" cy="52" r="5" fill="#FF6B00"/>
    <circle cx="38" cy="88" r="4" fill="rgba(255,61,0,.5)"/><circle cx="50" cy="88" r="4" fill="#FF6B00"/><circle cx="62" cy="88" r="4" fill="rgba(255,61,0,.5)"/><circle cx="74" cy="88" r="4" fill="rgba(255,61,0,.5)"/>
  </g>`,
};

// A complete, self-contained SVG document string for one game's neon icon on
// its forest tile — safe to use as an <img> data URL (no external refs, so the
// canvas stays untainted and toBlob works). Returns "" for an unknown game.
export function gameIconSvgString(game, size = 170) {
  const pictogram = PICTOGRAMS[game];
  if (!pictogram) return "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 110 110">
  <defs>
    <filter id="g" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="rgba(248,245,240,.05)" stroke-width="1"/></pattern>
    <radialGradient id="amb" cx="50%" cy="42%" r="60%"><stop offset="0%" stop-color="rgba(248,245,240,.10)"/><stop offset="100%" stop-color="rgba(248,245,240,0)"/></radialGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#234530"/><stop offset="100%" stop-color="#1C3424"/></linearGradient>
  </defs>
  <rect width="110" height="110" rx="22" fill="url(#tile)"/>
  <rect width="110" height="110" rx="22" fill="url(#grid)"/>
  <rect width="110" height="110" rx="22" fill="url(#amb)"/>
  ${pictogram}
</svg>`;
}
