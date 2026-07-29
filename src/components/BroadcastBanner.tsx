"use client";

// Daily Challenge — League Office announcement banner.
//
// Mounts in the player app shell, above the game surface. Shows the single most
// recent live broadcast this player hasn't dismissed; renders NOTHING for
// logged-out visitors (no token → no fetch, no dismissal write).
//
// ⚠️ The body is rendered with dangerouslySetInnerHTML. That is safe here and
// ONLY here because lo_broadcasts.body_html is the OUTPUT of the server-side
// allowlist sanitizer (src/lib/league-office/sanitize-html.ts), applied at write
// time in executeAction("broadcast.send") — the raw authored payload is never
// stored and never reaches this component. Do not point this at any other source.
//
// Palette-agnostic per the FAR-395 convention: color comes in via `tokens` (the
// `C` object in DailyChallenge.jsx), layout is local.

import { useCallback, useEffect, useState } from "react";

export type BroadcastSeverity = "info" | "warning" | "celebration";

export type PlayerBroadcast = {
  id: string;
  bodyHtml: string;
  bodyText: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  severity: BroadcastSeverity;
};

export type BannerTokens = {
  forest: string;
  gold: string;
  white: string;
  sage: string;
  amber: string;
  bg: string;
};

const FALLBACK_TOKENS: BannerTokens = {
  forest: "#1C3424",
  gold: "#C4922A",
  white: "#F8F5F0",
  sage: "#8CA68A",
  amber: "#F59E0B",
  bg: "#0D110E",
};

/** Severity changes the accent rule + glyph only — body text stays full-contrast
 *  warm white on forest in all three, so no severity can degrade readability. */
function accentFor(severity: BroadcastSeverity, t: BannerTokens): { accent: string; glyph: string } {
  if (severity === "warning") return { accent: t.amber, glyph: "▲" };
  if (severity === "celebration") return { accent: t.gold, glyph: "★" };
  return { accent: t.sage, glyph: "◈" };
}

export default function BroadcastBanner({
  sessionToken,
  tokens,
}: {
  sessionToken?: string | null;
  tokens?: Partial<BannerTokens>;
}) {
  const [broadcast, setBroadcast] = useState<PlayerBroadcast | null>(null);

  useEffect(() => {
    // Anonymous / signed-out: never call the API. (The render below also gates
    // on sessionToken, so signing out hides any banner already fetched.)
    if (!sessionToken) return;
    let cancelled = false;
    fetch(`/api/broadcast?token=${encodeURIComponent(sessionToken)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setBroadcast(j?.broadcast ?? null);
      })
      .catch(() => {
        /* an announcement must never break the game */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  const dismiss = useCallback(() => {
    if (!broadcast || !sessionToken) return;
    const id = broadcast.id;
    setBroadcast(null); // optimistic — dismissal is permanent either way
    fetch("/api/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: sessionToken, broadcastId: id }),
    }).catch(() => {});
  }, [broadcast, sessionToken]);

  if (!broadcast || !sessionToken) return null;
  return <BroadcastBannerView broadcast={broadcast} tokens={tokens} onDismiss={dismiss} />;
}

/**
 * The banner's presentation, with no data fetching — so the League Office
 * composer's live preview renders EXACTLY what players see by using this same
 * component. Pass `onDismiss` undefined to render the ✕ inert (preview).
 */
export function BroadcastBannerView({
  broadcast,
  tokens,
  onDismiss,
}: {
  broadcast: PlayerBroadcast;
  tokens?: Partial<BannerTokens>;
  onDismiss?: () => void;
}) {
  const t: BannerTokens = { ...FALLBACK_TOKENS, ...(tokens ?? {}) };
  const { accent, glyph } = accentFor(broadcast.severity, t);
  const hasCta = Boolean(broadcast.ctaLabel && broadcast.ctaUrl);

  return (
    <div
      role="status"
      aria-label="League Office announcement"
      style={{
        background: t.forest,
        borderBottom: `1px solid rgba(248,245,240,0.10)`,
        borderLeft: `4px solid ${accent}`,
      }}
    >
      <style>{`
        .dc-bcast-body { color: ${t.white}; font-size: 13.5px; line-height: 1.55; }
        .dc-bcast-body p { margin: 0 0 6px; }
        .dc-bcast-body p:last-child { margin-bottom: 0; }
        .dc-bcast-body ul, .dc-bcast-body ol { margin: 6px 0; padding-left: 20px; }
        .dc-bcast-body li { margin: 2px 0; }
        .dc-bcast-body strong, .dc-bcast-body b { color: ${t.white}; font-weight: 700; }
        .dc-bcast-body a { color: ${t.gold}; text-decoration: underline; }
      `}</style>
      <div
        style={{
          maxWidth: "820px",
          margin: "0 auto",
          padding: "12px 20px",
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
        }}
      >
        <span aria-hidden style={{ color: accent, fontSize: "13px", lineHeight: "1.55", flex: "none" }}>
          {glyph}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Sanitized server-side at write time — see the file header. */}
          <div className="dc-bcast-body" dangerouslySetInnerHTML={{ __html: broadcast.bodyHtml }} />
          {hasCta && (
            <a
              href={broadcast.ctaUrl as string}
              target="_blank"
              rel="noopener noreferrer nofollow"
              style={{
                display: "inline-block",
                marginTop: "10px",
                background: accent,
                color: t.bg,
                borderRadius: "6px",
                padding: "6px 14px",
                fontSize: "12.5px",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              {broadcast.ctaLabel}
            </a>
          )}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          disabled={!onDismiss}
          aria-label="Dismiss announcement"
          title="Dismiss"
          style={{
            flex: "none",
            background: "none",
            border: "none",
            color: t.sage,
            cursor: onDismiss ? "pointer" : "default",
            fontSize: "15px",
            lineHeight: 1,
            padding: "2px 4px",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
