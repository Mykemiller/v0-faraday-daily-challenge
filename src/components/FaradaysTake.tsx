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
//   D13  Byline defaults BY GAME TYPE (resolveTakeByline): the data/market games
//        speak as Gilbert Faraday, the scenario/prediction games as Mach Eigen;
//        an explicit `byline` override wins over both.
//
// Fallback (FAR-389 acceptance criterion):
//   When there is no authored Take, we do NOT render a blank or a generic
//   "Nice work!" — we surface the puzzle's own explanation text (via `fallback`)
//   in PLAIN (non-italic, unsigned) styling, visually distinct from the voiced
//   Take. Only when there is neither a take NOR a fallback do we render nothing.

import React from "react";
import { resolveTakeByline, GILBERT_FARADAY } from "@/lib/faradays-take";

export const DEFAULT_TAKE_BYLINE = GILBERT_FARADAY;

// Brand tokens (mirrors the `C` palette in DailyChallenge.jsx — kept literal so
// this component is self-contained across the .jsx / .tsx boundary).
const GOLD = "#C4922A";
const TEXT = "#E8E4DE";
const MUTED = "#9A938C";

const RULE = "2px solid rgba(196,146,42,0.35)";

export interface FaradaysTakeProps {
  take?: string | null;
  byline?: string | null;
  /** Puzzle type — drives the default byline voice when no override is given. */
  puzzleType?: string | null;
  /** Plain explanation surfaced when there is no authored take (unsigned). */
  fallback?: string | null;
}

export default function FaradaysTake({ take, byline, puzzleType, fallback }: FaradaysTakeProps) {
  const body = typeof take === "string" ? take.trim() : "";

  // No authored take → surface the plain explanation fallback (non-italic,
  // unsigned). Nothing to surface → render nothing (never a blank slot).
  if (!body) {
    const fb = typeof fallback === "string" ? fallback.trim() : "";
    if (!fb) return null;
    return (
      <div
        style={{
          width: "100%",
          maxWidth: "440px",
          margin: "0 auto",
          borderLeft: RULE,
          padding: "2px 0 2px 14px",
          textAlign: "left",
        }}
      >
        <p
          style={{
            margin: 0,
            // Deliberately NOT the italic-serif Take voice — plain sans, so the
            // stopgap explanation never reads as an authored, signed verdict.
            fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
            fontStyle: "normal",
            fontSize: "14px",
            lineHeight: 1.55,
            color: TEXT,
            overflowWrap: "break-word",
          }}
        >
          {fb}
        </p>
      </div>
    );
  }

  const who = resolveTakeByline(puzzleType, byline);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "440px",
        margin: "0 auto",
        borderLeft: RULE,
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
