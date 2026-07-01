"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Briefing {
  id: string;
  type: "theater" | "sector" | "thread" | "keyplayer";
  title: string;
  subtitle: string;
  byline: "Mach" | "Gilbert";
  updated: string;
  status: "live" | "soon";
  abstract: string;
  hypothesis: string;
  contents: string[];
}

const COVER_BG: Record<string, string> = {
  theater: "linear-gradient(165deg,#16281C,#1C3424)",
  sector: "linear-gradient(165deg,#1C3424 60%,#16281C)",
  thread: "linear-gradient(165deg,#1C3424,#244228)",
  keyplayer: "linear-gradient(165deg,#244228,#1C3424)",
};

function eyebrow(b: Briefing) {
  const map: Record<string, string> = {
    theater: "Theater Briefing", sector: "Sector Briefing",
    thread: "Thread Briefing", keyplayer: "Key Player Briefing",
  };
  return map[b.type] ?? "Briefing";
}

function bylineLabel(b: Briefing) {
  return b.byline === "Mach" ? "Byline · Mach — forward thesis" : "Byline · Gilbert — empirical";
}

export default function ReadingRoom() {
  const { id } = useParams<{ id: string }>();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [reserved, setReserved] = useState(false);

  useEffect(() => {
    fetch("/api/library/catalog")
      .then((r) => r.json())
      .then((data: Briefing[]) => {
        const found = data.find((b) => b.id === id) ?? null;
        setBriefing(found);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    try {
      const saved = JSON.parse(localStorage.getItem("fbl_reserved") || "{}");
      setReserved(!!saved[id]);
    } catch {}
  }, [id]);

  function toggleReserve() {
    try {
      const saved = JSON.parse(localStorage.getItem("fbl_reserved") || "{}");
      const next = { ...saved };
      if (next[id]) delete next[id]; else next[id] = true;
      localStorage.setItem("fbl_reserved", JSON.stringify(next));
      setReserved(!reserved);
    } catch {}
  }

  const b = briefing;
  const coverBg = b ? (COVER_BG[b.type] ?? COVER_BG.sector) : "#1C3424";

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
          <div style={{ fontFamily: "var(--font-serif)", fontSize: 17, fontStyle: "italic", color: "#8CA68A" }}>Briefing Reading Room</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#8CA68A", letterSpacing: "1px", textTransform: "uppercase" }}>July 2026 · Shelf Edition</div>
        </div>
        <div style={{ height: 2, background: "#C4922A" }} />
      </div>

      {/* Reading Room body */}
      <div style={{ background: "#16281C", minHeight: "calc(100vh - 69px)", position: "relative", overflow: "hidden" }}>
        {/* Lamplight */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 900px 640px at 68% 12%,rgba(218,176,80,.16),transparent 65%),radial-gradient(ellipse 700px 500px at 12% 88%,rgba(196,146,42,.08),transparent 60%)",
        }} />

        <div style={{ position: "relative", maxWidth: 1120, margin: "0 auto", padding: "34px 32px 90px" }}>

          <Link href="/library" style={{
            background: "none", border: "none", color: "#8CA68A",
            fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "1px",
            textTransform: "uppercase", cursor: "pointer", textDecoration: "none",
            display: "inline-block",
          }}>
            ← Back to the shelf
          </Link>

          {loading && (
            <div style={{ marginTop: 60, fontFamily: "var(--font-mono)", fontSize: 12, color: "#8CA68A" }}>
              Loading…
            </div>
          )}

          {!loading && !b && (
            <div style={{ marginTop: 60, fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 19, color: "#E8E2D6" }}>
              Briefing not found.
            </div>
          )}

          {b && (
            <>
              {/* Header grid */}
              <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 56, marginTop: 36, alignItems: "start" }}>

                {/* Cover */}
                <div style={{
                  aspectRatio: "3/4", background: coverBg, padding: "28px 24px",
                  display: "flex", flexDirection: "column", justifyContent: "space-between",
                  boxShadow: "0 18px 60px rgba(0,0,0,.5),0 2px 8px rgba(0,0,0,.4)",
                  border: "1px solid rgba(218,176,80,.25)",
                }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "1.8px", textTransform: "uppercase", color: "#C4922A" }}>
                      {eyebrow(b)}
                    </div>
                    <div style={{ width: 44, height: 2.5, background: "#F8F5F0", marginTop: 12 }} />
                    <div style={{ width: 44, height: 2, background: "#C4922A", marginTop: 2 }} />
                    <div style={{ fontFamily: "var(--font-serif)", fontWeight: 700, fontSize: 30, lineHeight: 1.15, color: "#F8F5F0", marginTop: 18 }}>
                      {b.title}
                    </div>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "1.2px", textTransform: "uppercase", color: "#8CA68A" }}>
                    Faraday · {b.updated}
                  </div>
                </div>

                {/* Details */}
                <div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, letterSpacing: "1.6px", textTransform: "uppercase", color: "#DAB050" }}>
                    {eyebrow(b)}
                  </div>
                  <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 700, fontSize: 42, lineHeight: 1.1, color: "#F8F5F0", margin: "12px 0 0" }}>
                    {b.title}
                  </h1>
                  <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#8CA68A" }}>{bylineLabel(b)}</div>
                    <div style={{ width: 4, height: 4, background: "#C4922A", borderRadius: "50%" }} />
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#8CA68A" }}>Current as of {b.updated}</div>
                  </div>

                  <p style={{ fontFamily: "var(--font-serif)", fontSize: 19, lineHeight: 1.55, color: "#E8E2D6", margin: "26px 0 0", maxWidth: 620 }}>
                    {b.abstract}
                  </p>

                  {/* Contents list */}
                  {b.contents.length > 0 && (
                    <div style={{ marginTop: 34 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "1.6px", textTransform: "uppercase", color: "#8CA68A" }}>
                        In this Briefing
                      </div>
                      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 0, maxWidth: 520 }}>
                        {b.contents.map((item, i) => (
                          <div key={i} style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "9px 0", borderBottom: "1px solid rgba(140,166,138,.18)" }}>
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#C4922A", width: 22, flexShrink: 0 }}>
                              {String(i + 1).padStart(2, "0")}
                            </div>
                            <div style={{ fontSize: 15, color: "#D9D3C7" }}>{item}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Select button */}
                  <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 38, flexWrap: "wrap" }}>
                    <button
                      onClick={toggleReserve}
                      style={{
                        background: reserved ? "#C4922A" : "transparent",
                        color: reserved ? "#141210" : "#DAB050",
                        border: "1.5px solid #C4922A",
                        padding: "14px 30px", fontSize: 15, fontWeight: 600,
                        cursor: "pointer", letterSpacing: "0.3px",
                        fontFamily: "var(--font-sans)",
                      }}
                    >
                      {reserved ? "Reserved ✓" : "Select this Briefing"}
                    </button>
                    {reserved && (
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#8CA68A" }}>
                        Reserved on your shelf — acquisition arrives in FBL 1.1.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Preview slides */}
              <div style={{ marginTop: 72 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                  <h2 style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: 24, color: "#F8F5F0", margin: 0 }}>Preview</h2>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8CA68A", letterSpacing: "0.6px" }}>
                    The opening of the Briefing. The full deck unlocks on acquisition.
                  </div>
                </div>
                <div style={{ width: 56, height: 2.5, background: "#325638", marginTop: 12 }} />
                <div style={{ width: 56, height: 2, background: "#C4922A", marginTop: 2 }} />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 22, marginTop: 26 }}>

                  {/* Slide 01 — Hypothesis */}
                  <div style={{ aspectRatio: "16/10", background: "#F8F5F0", padding: "22px 24px", display: "flex", flexDirection: "column", boxShadow: "0 10px 34px rgba(0,0,0,.4)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "1.4px", textTransform: "uppercase", color: "#B8710A" }}>The Hypothesis</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#8C8279" }}>01 / —</div>
                    </div>
                    <div style={{ fontFamily: "var(--font-serif)", fontWeight: 700, fontSize: 18, lineHeight: 1.25, color: "#141210", marginTop: 12 }}>
                      What Faraday thinks, stated first
                    </div>
                    <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#5c564d", margin: "10px 0 0", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {b.hypothesis}
                    </p>
                    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column" }}>
                      <div style={{ height: 2, background: "#1C3424", width: 30 }} />
                      <div style={{ height: 1.5, background: "#C4922A", width: 30, marginTop: 2 }} />
                    </div>
                  </div>

                  {/* Slide 02 — Evidence */}
                  <div style={{ aspectRatio: "16/10", background: "#F8F5F0", padding: "22px 24px", display: "flex", flexDirection: "column", boxShadow: "0 10px 34px rgba(0,0,0,.4)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "1.4px", textTransform: "uppercase", color: "#B8710A" }}>
                        {b.contents[1] ?? "The Evidence"}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#8C8279" }}>02 / —</div>
                    </div>
                    <div style={{ fontFamily: "var(--font-serif)", fontWeight: 700, fontSize: 18, lineHeight: 1.25, color: "#141210", marginTop: 12 }}>
                      The signal confluence behind the thesis
                    </div>
                    <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#5c564d", margin: "10px 0 0", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      Sourced claims throughout — named companies, actual filings, dated proceedings. No &ldquo;experts predict.&rdquo; This body slide carries the evidence the hypothesis stands on.
                    </p>
                    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column" }}>
                      <div style={{ height: 2, background: "#1C3424", width: 30 }} />
                      <div style={{ height: 1.5, background: "#C4922A", width: 30, marginTop: 2 }} />
                    </div>
                  </div>

                  {/* Locked remainder */}
                  <div style={{
                    aspectRatio: "16/10", background: "rgba(248,245,240,.06)",
                    border: "1px dashed rgba(178,168,152,.4)",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: 12, padding: 24,
                  }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                      <rect x="5" y="10" width="14" height="10" rx="1.5" stroke="#C4922A" strokeWidth="1.6" />
                      <path d="M8 10 V7 a4 4 0 0 1 8 0 v3" stroke="#C4922A" strokeWidth="1.6" fill="none" />
                    </svg>
                    <div style={{ fontFamily: "var(--font-serif)", fontSize: 16, color: "#D9D3C7", textAlign: "center", lineHeight: 1.4 }}>
                      The rest of the Briefing is waiting.
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "1px", textTransform: "uppercase", color: "#8CA68A" }}>
                      Includes Faraday&apos;s Take · Sources &amp; methodology
                    </div>
                  </div>
                </div>
              </div>

              {/* Faraday's Take teaser */}
              <div style={{ marginTop: 56, maxWidth: 760, background: "#EEE6DA", padding: "26px 30px", position: "relative" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: "#1C3424" }} />
                <div style={{ position: "absolute", left: 4, top: 0, bottom: 0, width: 2.5, background: "#C4922A" }} />
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "1.6px", textTransform: "uppercase", color: "#1C3424" }}>
                  Faraday&apos;s Take
                </div>
                <p style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 17, lineHeight: 1.6, color: "#141210", margin: "12px 0 0" }}>
                  Every Briefing closes with Faraday&apos;s opinion — short, specific, and his alone. It travels with the full Briefing.
                </p>
              </div>
            </>
          )}
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
