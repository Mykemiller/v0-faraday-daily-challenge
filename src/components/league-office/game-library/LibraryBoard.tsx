"use client";

// League Office — Game Library status board + per-game detail drawer.
//
// D1 is rendered here, not just enforced: the lifecycle badge and the "Seasons"
// column are SEPARATE columns, because a game is one lifecycle state AND zero-or-
// more season assignments at the same time. All 7 live games are Live *and* on 4
// seasons — collapsing those into a single "status" would lose that.

import { useMemo, useState } from "react";
import { StatusChip } from "@/components/league-office/primitives";
import {
  LIFECYCLE_LABEL,
  LIFECYCLE_TONE,
  LIFECYCLE_STATES,
  type LifecycleState,
} from "@/lib/league-office/game-library-logic";
import { GameDrawer, type DrawerEntry } from "./GameDrawer";

export type BoardRow = DrawerEntry & {
  bankDepthUnavailable: boolean;
};

const HEAD: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "#8d8375",
};

const TEMPLATE = "1.6fr 100px 104px 1.3fr 92px 106px 74px";
/** The fixed tracks alone total 476px; below this the columns would collide. */
const MIN_WIDTH = 760;

export function LibraryBoard({
  rows,
  canWrite,
}: {
  rows: BoardRow[];
  canWrite: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LifecycleState | "all">("all");

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.game.lifecycle_state === filter)),
    [rows, filter]
  );

  const open = rows.find((r) => r.game.id === openId) ?? null;

  return (
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        <FilterChip label="All" active={filter === "all"} onClick={() => setFilter("all")} count={rows.length} />
        {LIFECYCLE_STATES.map((s) => (
          <FilterChip
            key={s}
            label={LIFECYCLE_LABEL[s]}
            active={filter === s}
            onClick={() => setFilter(s)}
            count={rows.filter((r) => r.game.lifecycle_state === s).length}
          />
        ))}
      </div>

      {/* The fixed-width columns are wider than a narrow viewport. Scroll the
          board inside its own container rather than letting it push the page. */}
      <div
        style={{
          background: "#fff",
          border: "1px solid var(--color-cream-border)",
          borderRadius: 10,
          overflowX: "auto",
        }}
      >
        <div style={{ minWidth: MIN_WIDTH }}>
        <div
          className="font-mono"
          style={{
            display: "grid",
            gridTemplateColumns: TEMPLATE,
            gap: 12,
            padding: "10px 16px",
            borderBottom: "1px solid var(--color-cream-border)",
            background: "var(--color-warm-panel)",
            ...HEAD,
          }}
        >
          <span>Game</span>
          <span>Category</span>
          <span>Lifecycle</span>
          <span>Seasons</span>
          <span style={{ textAlign: "right" }}>Bank</span>
          <span>Launched</span>
          <span style={{ textAlign: "right" }}>Sort</span>
        </div>

        {visible.length === 0 ? (
          <div style={{ padding: "22px 16px", color: "#8d8375", fontSize: 13, textAlign: "center" }}>
            No games in this state.
          </div>
        ) : (
          visible.map((r) => (
            <button
              key={r.game.id}
              type="button"
              onClick={() => setOpenId(r.game.id)}
              className="lo-row"
              style={{
                display: "grid",
                gridTemplateColumns: TEMPLATE,
                gap: 12,
                alignItems: "center",
                padding: "11px 16px",
                width: "100%",
                textAlign: "left",
                border: "none",
                borderTop: "1px solid var(--color-cream-border)",
                background: "transparent",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    fontWeight: 600,
                    color: "#141210",
                    fontSize: 13.5,
                    display: "block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.game.display_name}
                </span>
                <span className="font-mono" style={{ fontSize: 10.5, color: "#9c9488" }}>
                  {r.game.game_key}
                </span>
              </span>

              <span style={{ fontSize: 12, color: "#6b6257" }}>{r.game.category ?? "—"}</span>

              <StatusChip
                label={LIFECYCLE_LABEL[r.game.lifecycle_state]}
                tone={LIFECYCLE_TONE[r.game.lifecycle_state]}
              />

              <span style={{ minWidth: 0, fontSize: 12, color: "#6b6257" }}>
                {r.assigned.count === 0 ? (
                  <span style={{ color: "#9c9488" }}>—</span>
                ) : (
                  <span
                    title={r.assigned.seasons.join(", ")}
                    style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    <strong style={{ color: "#141210", fontWeight: 600 }}>{r.assigned.count}</strong>{" "}
                    · {r.assigned.seasons.join(", ")}
                  </span>
                )}
              </span>

              <span
                className="font-mono"
                style={{
                  fontSize: 12,
                  textAlign: "right",
                  color: r.bankDepthUnavailable ? "#9c9488" : r.bankDepth === 0 ? "#9c3b2e" : "#141210",
                }}
                title={
                  r.game.runtime_key
                    ? `Rows in dc_puzzle_bank_staging matching runtime key “${r.game.runtime_key}”`
                    : "No runtime key — a concept has no puzzle bank."
                }
              >
                {r.bankDepthUnavailable ? "—" : r.bankDepth}
              </span>

              <span className="font-mono" style={{ fontSize: 11.5, color: "#6b6257" }}>
                {r.game.launched_on ?? "—"}
              </span>

              <span className="font-mono" style={{ fontSize: 11.5, color: "#9c9488", textAlign: "right" }}>
                {r.game.sort_order}
              </span>
            </button>
          ))
        )}
        </div>
      </div>

      {open ? <GameDrawer entry={open} canWrite={canWrite} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono"
      style={{
        fontSize: 10.5,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        padding: "5px 10px",
        borderRadius: 6,
        cursor: "pointer",
        border: `1px solid ${active ? "var(--color-forest)" : "var(--color-cream-border)"}`,
        background: active ? "var(--color-forest)" : "#fff",
        color: active ? "#f8f5f0" : "#6b6257",
      }}
    >
      {label} <span style={{ opacity: 0.7 }}>{count}</span>
    </button>
  );
}
