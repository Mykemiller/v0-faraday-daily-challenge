// League Office — DataTable. A grid-based "table" (not <table>) so entire rows
// can be clickable <Link>s with clean hover. Mono uppercase header, 1px cream
// row dividers, warm-panel hover — the console's shared list surface.
//
// Server-safe: no client hooks. Hover is CSS (.lo-row in globals.css).

import Link from "next/link";
import { EmptyState } from "./primitives";

export type Column<T> = {
  head: string;
  /** grid track width, e.g. "1.5fr" | "120px". */
  width?: string;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
};

export function DataTable<T>({
  columns,
  rows,
  rowHref,
  empty = "Nothing here yet.",
  getKey,
}: {
  columns: Column<T>[];
  rows: T[];
  rowHref?: (row: T) => string;
  empty?: React.ReactNode;
  getKey: (row: T, i: number) => string;
}) {
  const template = columns.map((c) => c.width ?? "1fr").join(" ");

  if (!rows.length) return <EmptyState>{empty}</EmptyState>;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--color-cream-border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* header */}
      <div
        className="font-mono"
        style={{
          display: "grid",
          gridTemplateColumns: template,
          gap: 12,
          padding: "10px 16px",
          fontSize: 10,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: "#8d8375",
          borderBottom: "1px solid var(--color-cream-border)",
          background: "var(--color-warm-panel)",
        }}
      >
        {columns.map((c, i) => (
          <div key={i} style={{ textAlign: c.align ?? "left" }}>
            {c.head}
          </div>
        ))}
      </div>
      {/* rows */}
      {rows.map((row, i) => {
        const cells = (
          <div
            className="lo-row"
            style={{
              display: "grid",
              gridTemplateColumns: template,
              gap: 12,
              padding: "12px 16px",
              fontSize: 13,
              alignItems: "center",
              borderTop: i === 0 ? "none" : "1px solid var(--color-cream-line)",
              color: "#141210",
            }}
          >
            {columns.map((c, ci) => (
              <div key={ci} style={{ textAlign: c.align ?? "left", minWidth: 0 }}>
                {c.cell(row)}
              </div>
            ))}
          </div>
        );
        const href = rowHref?.(row);
        return href ? (
          <Link key={getKey(row, i)} href={href} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
            {cells}
          </Link>
        ) : (
          <div key={getKey(row, i)}>{cells}</div>
        );
      })}
    </div>
  );
}
