"use client";
// ── GameFrame (FAR-395) ─────────────────────────────────────────────────────
// Standard game container: consistent root padding + section gap, `position:
// relative` so the top-right BrandAnchor lands in the same spot in every game.
// Replaces the drifted per-game root wrappers (gaps of 10/12/16/20, no shared
// padding) catalogued in Phase 0.
import type { ReactNode, CSSProperties } from "react";
import { SPACE, type SpaceKey } from "@/lib/dc-ui";
import BrandAnchor from "./BrandAnchor";

export interface GameFrameProps {
  children: ReactNode;
  /** Bolt color — pass `C.gold`. */
  anchorColor?: string;
  /** Set false only for a documented per-game exception (e.g. corner occupied). */
  showAnchor?: boolean;
  gap?: SpaceKey; // canonical root gap; default lg (16)
  pad?: SpaceKey; // canonical root padding; default none (games set their own board padding)
  style?: CSSProperties;
}

export default function GameFrame({
  children,
  anchorColor = "#C4922A",
  showAnchor = true,
  gap = "lg",
  pad = "none",
  style,
}: GameFrameProps) {
  const root: CSSProperties = {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: `${SPACE[gap]}px`,
    padding: `${SPACE[pad]}px`,
    ...style,
  };
  return (
    <div style={root}>
      {showAnchor && <BrandAnchor color={anchorColor} />}
      {children}
    </div>
  );
}
