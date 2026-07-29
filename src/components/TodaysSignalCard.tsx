// Faraday Signal card (FAR-385) — a short, dated intelligence item rendered at
// the bottom of the post-solve ScoreCard, following the Faraday's Take pattern
// (FAR-389). ONE shared component; per-game enablement lives in
// SIGNAL_ENABLED_GAMES beside ScoreCard (The Brief pilot; Signal Drop/Rackl
// are CC-FAR385-2).
//
// Tier framing (from the sync-time matcher, src/lib/signal-matcher.ts):
//   matched — "Related Signal"          (structured metadata match / pin)
//   lead    — "Elsewhere in the Sector" (soft framing, best available signal)
//   none / missing data → render NOTHING. No placeholder, no empty frame.
//
// Styling mirrors FaradaysTake's left-rule treatment but keyed to the game's
// FAR-394 jewel accent (passed in — this component never imports GAME_ACCENT,
// staying self-contained across the .jsx/.tsx boundary like FaradaysTake).

import React from "react";

// Brand tokens (mirrors the `C` palette in DailyChallenge.jsx).
const TEXT = "#E8E4DE";
const MUTED = "#9A938C";
const BRIEF_OLIVE = "#7CA34A"; // The Brief's FAR-394 accent — pilot default

export interface TodaysSignalPayload {
  tier?: string | null; // "matched" | "lead" (anything else → no card)
  headline?: string | null;
  body?: string | null;
  source_url?: string | null;
  source_label?: string | null;
  signal_date?: string | null; // YYYY-MM-DD
}

export interface TodaysSignalCardProps {
  signal?: TodaysSignalPayload | null;
  /** The game's FAR-394 jewel accent (GAME_ACCENT[type].accent). */
  accent?: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-07-29" → "Jul 29". Deterministic (no locale, no timezone math);
// anything malformed renders no date rather than garbage.
export function formatSignalDate(dateISO: unknown): string | null {
  if (typeof dateISO !== "string") return null;
  const m = dateISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!month || !day) return null;
  return `${month} ${day}`;
}

// Link text: explicit source_label, else the source URL's hostname.
export function resolveSourceText(
  sourceUrl: string | null | undefined,
  sourceLabel: string | null | undefined
): string | null {
  if (typeof sourceLabel === "string" && sourceLabel.trim()) return sourceLabel.trim();
  if (typeof sourceUrl === "string" && sourceUrl.trim()) {
    try {
      return new URL(sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }
  return null;
}

export default function TodaysSignalCard({ signal, accent }: TodaysSignalCardProps) {
  const tier = signal?.tier;
  const headline = typeof signal?.headline === "string" ? signal.headline.trim() : "";
  const body = typeof signal?.body === "string" ? signal.body.trim() : "";

  // No signal, unknown tier, or missing content → nothing. Never a placeholder.
  if ((tier !== "matched" && tier !== "lead") || !headline || !body) return null;

  const color = accent || BRIEF_OLIVE;
  const heading = tier === "matched" ? "Related Signal" : "Elsewhere in the Sector";
  const dateText = formatSignalDate(signal?.signal_date);
  const sourceUrl =
    typeof signal?.source_url === "string" && /^https?:\/\//i.test(signal.source_url.trim())
      ? signal.source_url.trim()
      : null;
  const sourceText = sourceUrl ? resolveSourceText(sourceUrl, signal?.source_label) : null;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "440px",
        margin: "0 auto",
        borderLeft: `2px solid ${color}59`, // ~35% alpha, matching the Take rule weight
        padding: "2px 0 2px 14px",
        textAlign: "left",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color,
          fontFamily: "'IBM Plex Mono', monospace",
          marginBottom: "6px",
        }}
      >
        {heading}
        {dateText ? ` · ${dateText}` : ""}
      </div>
      <div
        style={{
          fontSize: "14px",
          fontWeight: 700,
          lineHeight: 1.4,
          color: TEXT,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          overflowWrap: "break-word",
        }}
      >
        {headline}
      </div>
      <p
        style={{
          margin: "6px 0 0",
          fontSize: "13px",
          lineHeight: 1.55,
          color: TEXT,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          overflowWrap: "break-word",
        }}
      >
        {body}
      </p>
      {sourceUrl && sourceText && (
        <div style={{ marginTop: "8px" }}>
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "11px",
              color: MUTED,
              fontFamily: "'IBM Plex Mono', monospace",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            }}
          >
            {sourceText} ↗
          </a>
        </div>
      )}
    </div>
  );
}
