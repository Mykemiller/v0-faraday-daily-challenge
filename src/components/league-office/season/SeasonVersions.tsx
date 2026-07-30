"use client";

// League Office — Season detail: version timeline + field-by-field diff
// (spec §2.3).
//
// The timeline is the season's configuration history in order of effective_from.
// The active node is gold. Clicking a node opens it in the editor — read-only if
// it is superseded/cancelled/active, which the editor enforces itself.
//
// Selecting exactly two nodes renders the diff between them: changed fields
// only, before → after.

import { useState } from "react";
import Link from "next/link";
import { FAINT, GOLD, INK, MUTED } from "./fields";
import type { SeasonConfigRow } from "@/lib/league-office/seasons";
import { diffConfigs, fieldLabel, formatValue } from "@/lib/league-office/season-config-logic";

const STATE_TONE: Record<string, { fg: string; bg: string; border: string }> = {
  active: { fg: "#7c5407", bg: "rgba(196,146,42,.16)", border: GOLD },
  scheduled: { fg: "#94560a", bg: "rgba(148,86,10,.10)", border: "rgba(148,86,10,.35)" },
  draft: { fg: "#6b6257", bg: "#fff", border: "var(--color-cream-border)" },
  superseded: { fg: "#8d8375", bg: "var(--color-warm-panel)", border: "var(--color-cream-border)" },
  cancelled: { fg: "#9c3b2e", bg: "rgba(156,59,46,.07)", border: "rgba(156,59,46,.25)" },
};

export function SeasonVersions({
  seasonId,
  configs,
}: {
  seasonId: string;
  configs: SeasonConfigRow[];
}) {
  const [selected, setSelected] = useState<string[]>([]);

  const ordered = configs
    .slice()
    .sort((a, b) => String(a.effective_from).localeCompare(String(b.effective_from)));

  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length >= 2 ? [s[1], id] : [...s, id]
    );

  const [aId, bId] = selected;
  const a = ordered.find((c) => c.id === aId) ?? null;
  const b = ordered.find((c) => c.id === bId) ?? null;
  // Always diff older → newer so "before → after" reads correctly regardless of
  // the order the two nodes were clicked.
  const [before, after] =
    a && b
      ? String(a.effective_from) <= String(b.effective_from)
        ? [a, b]
        : [b, a]
      : [null, null];

  const rows =
    before && after
      ? diffConfigs(
          before as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>
        )
      : [];

  if (!ordered.length)
    return (
      <div style={{ fontSize: 13, color: FAINT }}>
        No configuration versions yet.
      </div>
    );

  return (
    <div>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8, alignItems: "stretch" }}>
        {ordered.map((c, i) => {
          const tone = STATE_TONE[c.state] ?? STATE_TONE.draft;
          const isSelected = selected.includes(c.id);
          return (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
              {i > 0 ? <span aria-hidden style={{ color: "#d9d2c6", fontSize: 14 }}>→</span> : null}
              <div
                style={{
                  border: `1px solid ${isSelected ? "#4f6b4d" : tone.border}`,
                  borderWidth: c.state === "active" ? 2 : 1,
                  background: tone.bg,
                  borderRadius: 9,
                  padding: "10px 13px",
                  minWidth: 148,
                  boxShadow: isSelected ? "0 0 0 2px rgba(79,107,77,.18)" : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Link
                    href={`/league-office/seasons/${seasonId}/config/${c.id}`}
                    className="font-serif"
                    style={{ fontSize: 15, color: INK, textDecoration: "none", fontWeight: 600 }}
                  >
                    v{c.version}
                  </Link>
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 8.5,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: tone.fg,
                    }}
                  >
                    {c.state}
                  </span>
                </div>

                <div className="font-mono" style={{ fontSize: 10, color: FAINT, marginTop: 4 }}>
                  {String(c.effective_from).slice(0, 10)}
                </div>

                {c.label ? (
                  <div
                    style={{ fontSize: 11, color: MUTED, marginTop: 4, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={c.label}
                  >
                    {c.label}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  className="font-mono"
                  style={{
                    marginTop: 8,
                    fontSize: 8.5,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    padding: "3px 7px",
                    borderRadius: 4,
                    border: `1px solid ${isSelected ? "#4f6b4d" : "var(--color-cream-border)"}`,
                    background: isSelected ? "rgba(79,107,77,.12)" : "#fff",
                    color: isSelected ? "#4f6b4d" : FAINT,
                    cursor: "pointer",
                  }}
                >
                  {isSelected ? "Selected" : "Compare"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14 }}>
        {selected.length === 0 ? (
          <p style={{ fontSize: 12.5, color: FAINT, margin: 0 }}>
            Select two versions to see what changed between them.
          </p>
        ) : selected.length === 1 ? (
          <p style={{ fontSize: 12.5, color: FAINT, margin: 0 }}>
            Select one more version to compare.{" "}
            <button
              type="button"
              onClick={() => setSelected([])}
              style={{ border: "none", background: "none", color: "var(--color-amber-dark)", cursor: "pointer", fontSize: 12.5, padding: 0 }}
            >
              Clear
            </button>
          </p>
        ) : (
          <div style={{ border: "1px solid var(--color-cream-border)", borderRadius: 9, overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 13px",
                background: "var(--color-warm-panel)",
                borderBottom: "1px solid var(--color-cream-border)",
              }}
            >
              <span className="font-mono" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: FAINT }}>
                v{before?.version} → v{after?.version} · {rows.length} field{rows.length === 1 ? "" : "s"} changed
              </span>
              <button
                type="button"
                onClick={() => setSelected([])}
                style={{ marginLeft: "auto", border: "none", background: "none", color: "var(--color-amber-dark)", cursor: "pointer", fontSize: 12 }}
              >
                Clear
              </button>
            </div>

            {rows.length === 0 ? (
              <div style={{ padding: 14, fontSize: 12.5, color: MUTED }}>
                These two versions have identical configuration values.
              </div>
            ) : (
              <>
                <div
                  className="font-mono"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1fr",
                    gap: 10,
                    padding: "7px 13px",
                    fontSize: 9,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: FAINT,
                    borderBottom: "1px solid var(--color-cream-line)",
                  }}
                >
                  <span>Field</span>
                  <span>v{before?.version}</span>
                  <span>v{after?.version}</span>
                </div>
                {rows.map((r) => (
                  <div
                    key={r.field}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr 1fr 1fr",
                      gap: 10,
                      padding: "8px 13px",
                      fontSize: 12,
                      borderTop: "1px solid var(--color-cream-line)",
                    }}
                  >
                    <span style={{ color: INK }}>{fieldLabel(r.field)}</span>
                    <span className="font-mono" style={{ color: FAINT }}>{formatValue(r.before)}</span>
                    <span className="font-mono" style={{ color: "#4f6b4d" }}>{formatValue(r.after)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
