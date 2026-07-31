"use client";

// CC-DC-SHARE-1.0 — the ONE share affordance (D4). Every surface that lets a
// subscriber share renders this component; nothing else in the app may call
// navigator.share or clipboard.writeText (AC 1 greps for exactly that).
//
// Dual payload (D1): the canonical text block from buildShare is the guaranteed
// path; the server-rendered card PNG (/api/share/card) is attached on platforms
// that accept files. Degradation ladder (D8) — never a dead button:
//   1. navigator.share with the card file
//   2. navigator.share text + url
//   3. clipboard.writeText(text\nurl) + "Copied ✓" feedback
//   4. a visible read-only textarea for manual copy
//
// Spoiler posture (D5): this component builds the payload EXCLUSIVELY through
// buildShare — callers pass the buildShare input (outcome shapes, never
// answers) and this component adds nothing of its own to the text/url.

import { useState, useRef } from "react";
import { buildShare } from "@/lib/share/buildShare";

/**
 * @param {{
 *   share: Parameters<typeof buildShare>[0],
 *   label?: string,
 *   busyLabel?: string,
 *   sharedLabel?: string,
 *   copiedLabel?: string,
 *   withImage?: boolean,
 *   className?: string,
 *   style?: import("react").CSSProperties,
 *   onShared?: () => void,
 * }} props
 */
export default function ShareButton({
  share, // buildShare input — see src/lib/share/buildShare.js
  label = "↑ Share",
  busyLabel = "…",
  sharedLabel = "Shared ✓",
  copiedLabel = "Copied ✓",
  withImage = true, // rung 1 on/off (generic text shares can skip the card fetch)
  className,
  style,
  onShared, // fired once a rung succeeds (not on cancel)
}) {
  const [display, setDisplay] = useState(null); // null = idle → show `label`
  const [manualText, setManualText] = useState(null); // rung 4
  const busyRef = useRef(false);

  function settle(text) {
    setDisplay(text);
    onShared?.();
    setTimeout(() => setDisplay(null), 2500);
  }

  async function handleClick() {
    if (busyRef.current) return;
    busyRef.current = true;
    setDisplay(busyLabel);
    setManualText(null);

    const p = buildShare(share);
    const full = `${p.text}\n${p.url}`;

    try {
      // Rung 1 — Web Share with the rendered card attached.
      if (withImage && typeof navigator !== "undefined" && navigator.canShare) {
        let file = null;
        try {
          const res = await fetch(p.imageUrl);
          if (res.ok) {
            const blob = await res.blob();
            file = new File([blob], p.imageFilename, { type: "image/png" });
          }
        } catch {
          /* card fetch failed → text rungs (AC 7: never blocks the share) */
        }
        if (file && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: p.title, text: full });
          settle(sharedLabel);
          return;
        }
      }
      // Rung 2 — Web Share, text + url.
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: p.title, text: p.text, url: p.url });
        settle(sharedLabel);
        return;
      }
      // Rung 3 — clipboard.
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(full);
        settle(copiedLabel);
        return;
      }
      // Rung 4 — manual copy.
      setDisplay(null);
      setManualText(full);
    } catch (e) {
      if (e && e.name === "AbortError") {
        setDisplay(null); // user closed the share sheet — back to idle
      } else {
        // A rung threw (e.g. share sheet failure, clipboard permission):
        // try the clipboard once more, else surface the manual textarea.
        try {
          await navigator.clipboard.writeText(full);
          settle(copiedLabel);
        } catch {
          setDisplay(null);
          setManualText(full);
        }
      }
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: "8px", maxWidth: "100%" }}>
      <button type="button" onClick={handleClick} className={className} style={style}>
        {display ?? label}
      </button>
      {manualText !== null && (
        <textarea
          readOnly
          value={manualText}
          rows={Math.min(6, manualText.split("\n").length + 1)}
          aria-label="Share text — select and copy"
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.target.select()}
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "11px",
            lineHeight: 1.5,
            padding: "8px 10px",
            borderRadius: "6px",
            border: "1px solid rgba(154,147,140,0.45)",
            background: "rgba(255,255,255,0.04)",
            color: "inherit",
            width: "260px",
            maxWidth: "100%",
            resize: "none",
          }}
        />
      )}
    </span>
  );
}
