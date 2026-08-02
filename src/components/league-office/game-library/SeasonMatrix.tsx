// League Office — games × seasons matrix (server-safe, no client hooks).
//
// Renders the D1 relationship directly: rows are games, columns are seasons, and
// a cell is enabled / disabled / not-assigned. Closed, locked and superseded
// seasons are visually locked — their column head carries a lock and their cells
// are muted, matching the fact that the API refuses to write them.

import { StatusChip } from "@/components/league-office/primitives";
import { matrixCell } from "@/lib/league-office/game-library-logic";
import type { GameLibraryEntry, SeasonColumn } from "@/lib/league-office/game-library";

const CELL: Record<string, { glyph: string; color: string; title: string }> = {
  enabled: { glyph: "●", color: "#3f7d52", title: "Enabled for this season" },
  disabled: { glyph: "○", color: "#b0653a", title: "On the slate but switched off" },
  unassigned: { glyph: "·", color: "#c9c2b6", title: "Not assigned to this season" },
};

export function SeasonMatrix({
  entries,
  seasons,
}: {
  entries: GameLibraryEntry[];
  seasons: SeasonColumn[];
}) {
  // A concept that has never been on any slate would be 18 rows of dots — show
  // only games that are assigned somewhere, plus every live/in_test game.
  const rows = entries.filter(
    (e) =>
      e.assignments.length > 0 ||
      e.game.lifecycle_state === "live" ||
      e.game.lifecycle_state === "in_test"
  );

  const template = `minmax(150px, 1.4fr) repeat(${seasons.length}, minmax(96px, 1fr))`;

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 150 + seasons.length * 96 }}>
        <div
          className="font-mono"
          style={{
            display: "grid",
            gridTemplateColumns: template,
            gap: 8,
            padding: "8px 12px",
            borderBottom: "1px solid var(--color-cream-border)",
            fontSize: 10,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "#8d8375",
          }}
        >
          <span>Game</span>
          {seasons.map((s) => (
            <span key={s.seasonId} style={{ textAlign: "center" }} title={`${s.name} · ${s.configState ?? "no config"}`}>
              {s.readOnly ? "🔒 " : ""}
              {shortSeason(s.name)}
            </span>
          ))}
        </div>

        {rows.map((e) => (
          <div
            key={e.game.id}
            style={{
              display: "grid",
              gridTemplateColumns: template,
              gap: 8,
              padding: "9px 12px",
              alignItems: "center",
              borderBottom: "1px solid var(--color-cream-border)",
            }}
          >
            <span style={{ fontSize: 12.5, color: "#141210", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.game.display_name}
            </span>
            {seasons.map((s) => {
              const kind = matrixCell(e.assignments.find((a) => a.seasonId === s.seasonId));
              const c = CELL[kind];
              return (
                <span
                  key={s.seasonId}
                  title={`${c.title}${s.readOnly ? " · season is read-only" : ""}`}
                  style={{
                    textAlign: "center",
                    fontSize: 15,
                    lineHeight: 1,
                    color: c.color,
                    opacity: s.readOnly ? 0.45 : 1,
                  }}
                >
                  {c.glyph}
                </span>
              );
            })}
          </div>
        ))}

        <div style={{ display: "flex", gap: 14, padding: "10px 12px", fontSize: 11.5, color: "#6b6257", flexWrap: "wrap" }}>
          <Legend kind="enabled" label="Enabled" />
          <Legend kind="disabled" label="Disabled" />
          <Legend kind="unassigned" label="Not assigned" />
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <StatusChip label="live" tone="green" />
            <span>enabled games are what subscribers are served</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function Legend({ kind, label }: { kind: keyof typeof CELL | string; label: string }) {
  const c = CELL[kind];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ color: c.color, fontSize: 14, lineHeight: 1 }}>{c.glyph}</span>
      {label}
    </span>
  );
}

/** "Season 2 — Post-YOTTA" → "S2 Post-YOTTA" so four columns fit without wrap. */
function shortSeason(name: string): string {
  const m = /^Season\s+(\d+)\s*[—–-]\s*(.+)$/.exec(name);
  return m ? `S${m[1]} ${m[2]}` : name;
}
