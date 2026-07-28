"use client";
// ── BrandAnchor (FAR-395) ───────────────────────────────────────────────────
// The canonical gold bolt, anchored top-right of a game frame. Phase-0 finding:
// no game currently has a fixed brand anchor. Drop this inside a
// `position:relative` container (GameFrame does this for you).
import type { CSSProperties } from "react";
import { brandAnchorStyle, boltSvgAttrs, BOLT_PATH, type AnchorPosition } from "@/lib/dc-ui";

export interface BrandAnchorProps {
  /** Bolt color — pass `C.gold`. Defaults to the current brand gold. */
  color?: string;
  size?: number;
  position?: AnchorPosition; // defaults to canonical top-right
  title?: string;
}

export default function BrandAnchor({
  color = "#C4922A",
  size = 16,
  position = "top-right",
  title = "Faraday",
}: BrandAnchorProps) {
  const attrs = boltSvgAttrs(size);
  return (
    <span aria-hidden="true" style={brandAnchorStyle(position) as CSSProperties}>
      <svg width={attrs.width} height={attrs.height} viewBox={attrs.viewBox} role="img" aria-label={title}>
        <title>{title}</title>
        <path d={BOLT_PATH} fill={color} />
      </svg>
    </span>
  );
}
