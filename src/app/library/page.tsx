"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";

// ── Types ────────────────────────────────────────────────────────────────────

interface Briefing {
  id: string;
  type: "theater" | "sector" | "thread" | "keyplayer";
  theater?: string;
  sector?: string;
  thread?: string;
  group?: string;
  title: string;
  subtitle: string;
  byline: "Mach" | "Gilbert";
  updated: string;
  status: "live" | "soon";
  abstract: string;
  hypothesis: string;
  contents: string[];
  sort_order: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const THEATERS = [
  { id: "power", name: "The Power Reckoning" },
  { id: "inference", name: "The Inference Economy" },
  { id: "capital", name: "The Capital Concentration" },
];

const COVER_BG: Record<string, string> = {
  theater: "linear-gradient(165deg,#16281C,#1C3424)",
  sector: "linear-gradient(165deg,#1C3424 60%,#16281C)",
  thread: "linear-gradient(165deg,#1C3424,#244228)",
  keyplayer: "linear-gradient(165deg,#244228,#1C3424)",
  soon: "linear-gradient(160deg,#5a544a,#46413a)",
};

function coverBg(b: Briefing) {
  return b.status === "soon" ? COVER_BG.soon : COVER_BG[b.type] ?? COVER_BG.sector;
}

function eyebrow(b: Briefing) {
  const map: Record<string, string> = {
    theater: "Theater Briefing",
    sector: "Sector Briefing",
    thread: "Thread Briefing",
    keyplayer: "Key Player Briefing",
  };
  return map[b.type] ?? "Briefing";
}

function metaLine(b: Briefing, reserved: Record<string, boolean>) {
  if (b.status === "soon") return "In production";
  const parts = [b.updated, b.byline];
  if (reserved[b.id]) parts.push("Reserved");
  return parts.join("  ·  ");
}

const GROUPS = [
  { type: "theater", label: "Theater Briefings", note: "The strategic arenas of the buildout" },
  { type: "sector", label: "Sector Briefings", note: "Analyst coverage areas inside each Theater" },
  { type: "thread", label: "Thread Briefings", note: "Persistent storylines, followed Signal by Signal" },
  { type: "keyplayer", label: "Key Player Briefings", note: "The companies that move the market" },
] as const;

const CHIPS = [
  { key: "all", label: "All" },
  { key: "theater", label: "Theater" },
  { key: "sector", label: "Sector" },
  { key: "thread", label: "Thread" },
  { key: "keyplayer", label: "Key Player" },
] as const;

// ── Component ────────────────────────────────────────────────────────────────

export default function LibraryShelf() {
  const [catalog, setCatalog] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);
  const [navKey, setNavKey] = useState("all");
  const [chip, setChip] = useState("all");
  const [search, setSearch] = useState("");
  const [reserved, setReserved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("fbl_reserved") || "{}");
      setReserved(saved);
    } catch {}

    fetch("/api/library/catalog")
      .then((r) => r.json())
      .then((data: Briefing[]) => {
        setCatalog(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = catalog;
    if (navKey.startsWith("t:")) {
      list = list.filter((b) => b.theater === navKey.slice(2));
    } else if (navKey === "kp") {
      list = list.filter((b) => b.type === "keyplayer");
    } else if (navKey === "mine") {
      list = list.filter((b) => reserved[b.id]);
    }
    if (chip !== "all") list = list.filter((b) => b.type === chip);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((b) =>
        (b.title + " " + b.abstract + " " + (b.thread ?? "") + " " + eyebrow(b))
          .toLowerCase()
          .includes(q)
      );
    }
    return list;
  }, [catalog, navKey, chip, search, reserved]);

  const groups = useMemo(() =>
    GROUPS.flatMap((g) => {
      const items = filtered.filter((b) => b.type === g.type);
      return items.length ? [{ ...g, items }] : [];
    }), [filtered]);

  const isEmpty = !loading && groups.length === 0;

  // ── Nav items ──────────────────────────────────────────────────────────────

  function NavItem({ k, label, depth = 0 }: { k: string; label: string; depth?: number }) {
    const active = navKey === k;
    return (
      <div
        style={{ padding: depth > 0 ? "0 20px 0 34px" : "0 20px", cursor: "pointer" }}
        onClick={() => { setNavKey(k); setChip("all"); }}
      >
        <div style={{
          fontSize: 14, lineHeight: "1.4", color: active ? "#1C3424" : "#5c564d",
          fontWeight: active ? 600 : 400,
          borderLeft: `3px solid ${active ? "#C4922A" : "transparent"}`,
          padding: "5px 0 5px 10px",
        }}>
          {label}
        </div>
      </div>
    );
  }

  // ── Cover card ─────────────────────────────────────────────────────────────

  function BriefingCard({ b }: { b: Briefing }) {
    const isLive = b.status === "live";
    const card = (
      <div style={{ cursor: isLive ? "pointer" : "default", opacity: isLive ? 1 : 0.72 }}>
        {/* Typographic cover */}
        <div style={{
          aspectRatio: "3/4", background: coverBg(b), padding: "20px 18px",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
          boxShadow: "0 2px 10px rgba(20,18,16,.18)",
          transition: "box-shadow .15s",
        }}
          onMouseEnter={(e) => isLive && ((e.currentTarget as HTMLDivElement).style.boxShadow = "0 6px 22px rgba(20,18,16,.3)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 10px rgba(20,18,16,.18)")}
        >
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "1.6px", textTransform: "uppercase", color: "#C4922A" }}>
              {eyebrow(b)}
            </div>
            <div style={{ width: 34, height: 2, background: "#F8F5F0", marginTop: 10, opacity: 0.9 }} />
            <div style={{ width: 34, height: 1.5, background: "#C4922A", marginTop: 2 }} />
            <div style={{
              fontFamily: "var(--font-serif)", fontWeight: 700,
              fontSize: b.title.length > 22 ? 17 : 20,
              lineHeight: 1.15, color: "#F8F5F0", marginTop: 14,
            }}>
              {b.title}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "1px", textTransform: "uppercase", color: "#8CA68A" }}>Faraday</div>
            {b.status === "soon" && (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "1.4px", textTransform: "uppercase", color: "#141210", background: "#DAB050", padding: "4px 8px" }}>
                Coming Soon
              </div>
            )}
          </div>
        </div>
        {/* Below-cover text */}
        <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: 16.5, marginTop: 14, color: "#141210", lineHeight: 1.25 }}>
          {b.title}
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: "#5c564d", margin: "6px 0 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {b.abstract}
        </p>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#8C8279", marginTop: 8, letterSpacing: "0.4px" }}>
          {metaLine(b, reserved)}
        </div>
      </div>
    );

    return isLive ? <Link href={`/library/${b.id}`} style={{ textDecoration: "none", color: "inherit" }}>{card}</Link> : card;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#F8F5F0", fontFamily: "var(--font-sans)", color: "#141210" }}>

      {/* Masthead */}
      <div style={{ borderTop: "3px solid #C4922A" }}>
        <div style={{ background: "#1C3424", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", height: 64 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 2, textDecoration: "none" }}>
            <svg width="34" height="34" viewBox="0 0 110 110">
              <rect x="0" y="0" width="110" height="110" rx="14" fill="#1C3424" />
              <rect x="34" y="20" width="13" height="70" fill="#F8F5F0" />
              <rect x="34" y="20" width="46" height="12" fill="#F8F5F0" />
              <rect x="34" y="50" width="36" height="11" fill="#F8F5F0" />
              <rect x="76" y="20" width="6" height="12" fill="#C4922A" />
              <rect x="66" y="50" width="6" height="11" fill="#C4922A" />
              <rect x="34" y="84" width="13" height="6" fill="#C4922A" />
            </svg>
            <div style={{ fontFamily: "var(--font-serif)", fontWeight: 700, fontSize: 24, color: "#F8F5F0", letterSpacing: "2.5px" }}>ARADAY</div>
          </Link>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: 17, fontStyle: "italic", color: "#8CA68A" }}>The Briefing Library</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#8CA68A", letterSpacing: "1px", textTransform: "uppercase" }}>July 2026 · Shelf Edition</div>
        </div>
        <div style={{ height: 2, background: "#C4922A" }} />
      </div>

      <div style={{ display: "flex", minHeight: "calc(100vh - 69px)", alignItems: "stretch" }}>

        {/* Sidebar */}
        <div style={{ width: 248, flexShrink: 0, background: "#F1EDE5", borderRight: "1px solid #DDD5C7", padding: "28px 0 48px" }}>
          <NavItem k="all" label="The Full Shelf" />

          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "1.8px", textTransform: "uppercase", color: "#8C8279", padding: "14px 20px 0" }}>
            Theaters
          </div>
          {THEATERS.map((t) => <NavItem key={t.id} k={`t:${t.id}`} label={t.name} />)}

          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "1.8px", textTransform: "uppercase", color: "#8C8279", padding: "14px 20px 0" }}>
            Key Players
          </div>
          <NavItem k="kp" label="Key Player Briefings" />

          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "1.8px", textTransform: "uppercase", color: "#8C8279", padding: "14px 20px 0" }}>
            Your Shelf
          </div>
          <NavItem k="mine" label="Reserved Briefings" />
        </div>

        {/* Main column */}
        <div style={{ flex: 1, minWidth: 0, padding: "40px 44px 80px" }}>
          <div style={{ maxWidth: 1180 }}>
            <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 700, fontSize: 38, margin: 0, color: "#141210" }}>
              The Briefing Library
            </h1>
            <div style={{ width: 72, height: 3, background: "#1C3424", marginTop: 14 }} />
            <div style={{ width: 72, height: 2, background: "#C4922A", marginTop: 3 }} />
            <p style={{ fontSize: 16, color: "#5c564d", margin: "16px 0 0", maxWidth: 560, lineHeight: 1.55 }}>
              Follow the Thread, catch the Signals. Every Briefing on this shelf is current, sourced, and carries Faraday&apos;s Read.
            </p>

            {/* Search + chips */}
            <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 30, flexWrap: "wrap" }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search the shelf…"
                style={{
                  flex: 1, minWidth: 220, maxWidth: 380, padding: "11px 16px",
                  border: "1px solid #B2A898", background: "#FFFFFF",
                  fontSize: 14.5, color: "#141210", outline: "none", borderRadius: 0,
                  fontFamily: "var(--font-sans)",
                }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {CHIPS.map(({ key, label }) => {
                  const active = chip === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setChip(key)}
                      style={{
                        padding: "9px 16px", border: `1px solid ${active ? "#1C3424" : "#B2A898"}`,
                        background: active ? "#1C3424" : "transparent",
                        color: active ? "#F8F5F0" : "#5c564d",
                        fontSize: 13, fontWeight: 500, cursor: "pointer", borderRadius: 999,
                        fontFamily: "var(--font-sans)",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Loading */}
            {loading && (
              <div style={{ marginTop: 60, fontFamily: "var(--font-mono)", fontSize: 12, color: "#8C8279" }}>
                Loading the shelf…
              </div>
            )}

            {/* Groups */}
            {groups.map((g) => (
              <div key={g.type} style={{ marginTop: 44 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                  <h2 style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: 22, margin: 0, color: "#141210" }}>
                    {g.label}
                  </h2>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8C8279", letterSpacing: "0.5px" }}>
                    {g.note}
                  </div>
                </div>
                <div style={{ height: 1, background: "#DDD5C7", marginTop: 10 }} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(238px,1fr))", gap: 26, marginTop: 22 }}>
                  {g.items.map((b) => <BriefingCard key={b.id} b={b} />)}
                </div>
              </div>
            ))}

            {/* Empty state */}
            {isEmpty && (
              <div style={{ marginTop: 60, padding: 48, border: "1px dashed #B2A898", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 19, color: "#5c564d" }}>
                  Nothing on this shelf yet.
                </div>
                <p style={{ fontSize: 14, color: "#8C8279", margin: "10px 0 0" }}>
                  Try a different Theater, or clear the search.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: "#244228", padding: "26px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "1px", textTransform: "uppercase", color: "#8CA68A" }}>
          Faraday Intelligence · Briefing Library
        </div>
        <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13.5, color: "#8CA68A" }}>
          Curated with Conviction. Cultivated for Depth.
        </div>
      </div>
    </div>
  );
}
