"use client";
// ── PuzzleGrid (FAR-395) ────────────────────────────────────────────────────
// Fluid N-column interaction grid (Rackl 4-col, Circuit / Dark Fiber 2-col).
// Cells are minmax(0,1fr) so answer text / letters / terms never overflow their
// track. For the lobby's 110×110 icon tiles, use `iconTileGrid` from @/lib/dc-ui
// directly — that is a different, square grid system on purpose (see grid.ts).
import type { ReactNode, CSSProperties } from "react";
import { puzzleGrid, type SpaceKey } from "@/lib/dc-ui";

export interface PuzzleGridProps {
  children: ReactNode;
  cols: number;
  gap?: SpaceKey;
  style?: CSSProperties;
}

export default function PuzzleGrid({ children, cols, gap = "sm", style }: PuzzleGridProps) {
  return <div style={{ ...(puzzleGrid(cols, gap) as CSSProperties), ...style }}>{children}</div>;
}
