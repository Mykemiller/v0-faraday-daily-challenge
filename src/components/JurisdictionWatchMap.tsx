"use client";

import { useMemo, useState } from "react";

// Jurisdiction Watch posture map — an on-brand, illustrative surface served
// in-engine so /jurisdiction-watch is a live map instead of a dead stub. The
// production scoring app (Jurisdiction Posture Score, ~300+ jurisdictions) lives
// in the separate faraday-jurisdiction-watch project; this view is mocked:
//   • the granularity toggle (Country/State/County/Metro) is a real control that
//     changes how many jurisdiction cells render, but the filtering is illustrative;
//   • each cell's posture band is deterministic-by-index, not real JPS data.
// The note copy is locked per Myke.

type Level = "Country" | "State" | "County" | "Metro";

const LEVELS: Level[] = ["Country", "State", "County", "Metro"];

// Cell counts per granularity. County (312) anchors the "over 300 jurisdictions"
// note; Metro/State are coarser rollups, Country the coarsest.
const COUNTS: Record<Level, number> = { Country: 6, State: 50, County: 312, Metro: 120 };

const REGION_LABELS = ["West", "Pacific", "Mountain", "Midwest", "South", "Northeast"];

// Posture bands, favorable → restrictive. `ink` is the label color for the large
// Country-level cells (chosen for legibility on each band).
const BANDS = [
  { name: "Favorable", color: "#23512F", ink: "#F8F5F0" },
  { name: "Open", color: "#4A7A43", ink: "#F8F5F0" },
  { name: "Neutral", color: "#C4922A", ink: "#141210" },
  { name: "Tightening", color: "#A86418", ink: "#F8F5F0" },
  { name: "Restrictive", color: "#8E342A", ink: "#F8F5F0" },
];

// Deterministic pseudo-random in [0,1) by index — stable across SSR/CSR so the
// choropleth doesn't flash/rehydrate differently.
function rand(i: number) {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export default function JurisdictionWatchMap() {
  const [level, setLevel] = useState<Level>("County");
  const count = COUNTS[level];

  const cells = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const r = rand(i * 7 + count); // vary with level so each granularity reads distinctly
        const band = BANDS[Math.min(BANDS.length - 1, Math.floor(r * BANDS.length))];
        const score = 22 + Math.floor(rand(i * 13 + count) * 70); // illustrative JPS 22–91
        const label = level === "Country" ? REGION_LABELS[i % REGION_LABELS.length] : `${level} ${i + 1}`;
        return { band, score, label };
      }),
    [count, level]
  );

  const big = level === "Country";

  return (
    <div>
      {/* Granularity toggle — jurisdiction filter (illustrative) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          role="group"
          aria-label="Jurisdiction granularity filter"
          className="inline-flex rounded-lg border border-warm-gray bg-warm-white p-1"
        >
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLevel(l)}
              aria-pressed={level === l}
              className={`rounded-md px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.08em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${
                level === l ? "bg-forest text-warm-white" : "text-near-black/70 hover:text-forest"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-amber-dark">
          {count.toLocaleString()} {level.toLowerCase()} jurisdictions · illustrative
        </span>
      </div>

      {/* Choropleth — one cell per jurisdiction, colored by posture band */}
      <div
        aria-hidden
        className="mt-4 rounded-xl border border-warm-gray bg-warm-cream p-3"
        style={{
          display: "grid",
          gridTemplateColumns: big ? "repeat(auto-fill, minmax(150px, 1fr))" : "repeat(auto-fill, minmax(20px, 1fr))",
          gap: big ? "10px" : "5px",
        }}
      >
        {cells.map((c, i) => (
          <div
            key={i}
            title={`${c.label} · JPS ${c.score}`}
            style={{
              background: c.band.color,
              borderRadius: big ? 8 : 3,
              aspectRatio: big ? "16 / 9" : "1 / 1",
              display: big ? "flex" : "block",
              alignItems: "flex-end",
              padding: big ? "10px 12px" : 0,
            }}
          >
            {big && (
              <span className="font-mono text-[12px] font-medium" style={{ color: c.band.ink }}>
                {c.label} · {c.score}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-near-black/60">Posture</span>
        {BANDS.map((b) => (
          <span key={b.name} className="inline-flex items-center gap-1.5">
            <span aria-hidden style={{ background: b.color }} className="h-3 w-3 rounded-[3px]" />
            <span className="font-mono text-[11px] text-near-black/70">{b.name}</span>
          </span>
        ))}
      </div>

      {/* Locked note */}
      <p className="mt-6 rounded-lg border border-gold/40 bg-warm-white px-4 py-3 text-center font-serif text-[16px] italic text-forest">
        Jurisdiction Posture Score calculated for over 300 Jurisdictions
      </p>
    </div>
  );
}
