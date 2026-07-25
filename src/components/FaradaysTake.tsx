// Faraday's Take (FAR-389) — one short editorial verdict per puzzle, shown on the
// completion screen above the score. ONE shared component consumed by all 7
// games (via ScoreCard), never reimplemented per game (D17).
//
// Rendering (locked):
//   D15  Real italic — IBM Plex Serif Italic via the --font-take seam. Not a CSS
//        `oblique` fake. (Tiempos Text is licensed and unavailable in-repo; the
//        seam lets this repoint to Tiempos in one place once files are licensed.)
//   D16  Soft cap ~320 chars — wrap, never truncate. Two sentences is the
//        editorial target, not a hard limit.
//   D14  No take → render NOTHING. Never an empty italic block, a byline with no
//        text, or placeholder copy.
//   D13  Byline defaults to Gilbert Faraday when none is provided.

import React from "react";

export const DEFAULT_TAKE_BYLINE = "Gilbert Faraday";

// Brand tokens (mirrors the `C` palette in DailyChallenge.jsx — kept literal so
// this component is self-contained across the .jsx / .tsx boundary).
const GOLD = "#C4922A";
const TEXT = "#E8E4DE";
const MUTED = "#9A938C";

export interface FaradaysTakeProps {
  take?: string | null;
  byline?: string | null;
}

export default function FaradaysTake({ take, byline }: FaradaysTakeProps) {
  const body = typeof take === "string" ? take.trim() : "";
  if (!body) return null; // D14 — no take, no block

  const who =
    typeof byline === "string" && byline.trim() ? byline.trim() : DEFAULT_TAKE_BYLINE;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "440px",
        margin: "0 auto",
        borderLeft: `2px solid rgba(196,146,42,0.35)`,
        padding: "2px 0 2px 14px",
        textAlign: "left",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: GOLD,
          fontFamily: "'IBM Plex Mono', monospace",
          marginBottom: "6px",
        }}
      >
        Faraday&rsquo;s Take
      </div>
      <p
        style={{
          margin: 0,
          // D15/D16: true italic serif via the swappable seam, wraps freely.
          fontFamily: "var(--font-take, 'IBM Plex Serif', Georgia, serif)",
          fontStyle: "italic",
          fontSize: "15px",
          lineHeight: 1.55,
          color: TEXT,
          overflowWrap: "break-word",
        }}
      >
        {body}
      </p>
      <div
        style={{
          marginTop: "8px",
          fontSize: "11px",
          color: MUTED,
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        &mdash; {who}
      </div>
    </div>
  );
}
