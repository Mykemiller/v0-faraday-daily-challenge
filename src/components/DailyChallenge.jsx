"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import BrandMark from "@/components/BrandMark";
import GameIcon, { GameIconDefs, GAME_NEON } from "@/components/GameIcon";
import {
  EDGE_FUNCTIONS_BASE,
  SESSION_STORAGE_KEY,
  EMAIL_STORAGE_KEY,
} from "@/lib/supabase";

// ── Brand tokens ──────────────────────────────────────────────────────────────
const C = {
  forest:  "#1C3424",
  forestMid:"#244228",
  gold:    "#C4922A",
  goldLight:"#DAB050",
  cream:   "#EEE6DA",
  white:   "#F8F5F0",
  sage:    "#8CA68A",
  black:   "#141210",
  gray:    "#B2A898",  // warm gray (brand)
  deepAmber:"#94560A", // AA-compliant amber-dark for small mono labels on light (FAR-63)
  bg:      "#0D110E",
  surface: "rgba(255,255,255,0.03)",
  border:  "rgba(255,255,255,0.07)",
  green:   "#4ADE80",
  amber:   "#F59E0B",
  red:     "#F87171",
  text:    "#E8E4DE",
  muted:   "#6B6560",
  dim:     "#2A2520",
};
const mono  = { fontFamily:"'IBM Plex Mono',monospace" };
const serif = { fontFamily:"'IBM Plex Serif',serif" };
const sans  = { fontFamily:"'Bricolage Grotesque',sans-serif" };

// ── Scoring constants ────────────────────────────────────────────────────────
const BASE_SCORE = 100;
const STREAK_MULTIPLIERS = [
  { days:1,  mult:1.0,  badge:null              },
  { days:7,  mult:1.25, badge:"Week Warrior"     },
  { days:14, mult:1.5,  badge:"Fortnight"        },
  { days:30, mult:2.0,  badge:"Signal Constant"  },
];
const SPEED_BONUS_THRESHOLD = 0.5; // complete in <50% of time → +10pts
const PERFECT_BONUS = 15;
const MW_PER_PUZZLE = 5;
const MW_STREAK_BONUS = 25; // at 7-day streak

function getStreakMultiplier(streak) {
  for (let i = STREAK_MULTIPLIERS.length - 1; i >= 0; i--) {
    if (streak >= STREAK_MULTIPLIERS[i].days) return STREAK_MULTIPLIERS[i];
  }
  return STREAK_MULTIPLIERS[0];
}

function calcScore({ basePoints, maxPoints, timeElapsed, timeLimit, perfect, streak }) {
  const accuracy = maxPoints > 0 ? (basePoints / maxPoints) : 1;
  let score = Math.round(accuracy * BASE_SCORE);
  if (perfect) score += PERFECT_BONUS;
  if (timeLimit && timeElapsed < timeLimit * SPEED_BONUS_THRESHOLD) score += 10;
  const { mult } = getStreakMultiplier(streak);
  return Math.min(Math.round(score * mult), 150);
}

// ── Mock puzzle data (would be fetched from Airtable in production) ──────────
const PUZZLE_DATA = {
  Rackl: {
    name: "The Power Stack",
    domain: "Power Architecture",
    groups: [
      { label:"800V DC Transition",   color:"#1C3424", textColor:"#EEE6DA", items:["Bus bar", "DC-DC converter", "Power shelf", "OCP ORW"] },
      { label:"Grid Access",          color:"#C4922A", textColor:"#141210", items:["Interconnect queue", "FERC Order", "Large-load study", "ISO/RTO"] },
      { label:"BTM Generation",       color:"#2A5A3A", textColor:"#EEE6DA", items:["SMR offtake", "Gas peaker", "Solar+storage", "BYOG contract"] },
      { label:"Cooling Architecture", color:"#5A4010", textColor:"#EEE6DA", items:["CDU", "Cold plate", "WUE", "Rear-door HX"] },
    ],
  },
  "Signal Drop": {
    name: "BUSBAR",
    domain: "Power Architecture",
    word: "BUSBAR",
    clue: "A rigid conductor distributing electrical power within a switchgear panel or power distribution unit",
    hint1: "Found in every data center switchroom",
    hint2: "Copper or aluminum, never flexible",
  },
  "The Stack": {
    name: "Rank GPU Generations: Hopper → Blackwell → Vera Rubin → Feynman",
    domain: "Chips & Density",
    items: ["H100 (Hopper)", "B200 (Blackwell)", "GB300 (Vera Rubin NVL72)", "Feynman (2028)"],
    correctOrder: [0, 1, 2, 3],
    metric: "TDP per chip (watts) — lowest to highest",
    values: ["700W", "1000W", "1200W", "~1500W est."],
  },
  Circuit: {
    name: "Power Architecture True/False Sprint #1",
    domain: "Power Architecture",
    timeLimit: 60,
    questions: [
      { q:"The 800V DC transition eliminates the need for per-rack UPS units.", a:true,  explanation:"800V DC-native racks eliminate per-rack AC/DC conversion and UPS stages, moving protection upstream." },
      { q:"NFPA 70 currently has complete code coverage for 800V DC data center distribution.", a:false, explanation:"NFPA 70 has significant gaps for 800V DC. The code framework is still catching up to the transition." },
      { q:"Behind-the-meter generation bypasses the ISO/RTO interconnection queue.", a:true,  explanation:"BTM generation connects directly to the facility, not to the grid — avoiding queue requirements entirely." },
      { q:"PJM's interconnection queue average wait time is currently under 2 years.", a:false, explanation:"PJM average queue wait exceeds 5 years as of 2026, driven by unprecedented large-load applications." },
      { q:"A CDU (Coolant Distribution Unit) is required for direct-to-chip liquid cooling.", a:true,  explanation:"The CDU is the central heat exchanger that manages facility-side coolant distribution to server-side cold plates." },
      { q:"WUE measures watts used per watt of IT load.", a:false, explanation:"WUE (Water Usage Effectiveness) measures liters of water per kWh of IT load — it's a water metric, not power." },
    ],
  },
  "The Brief": {
    name: "The 800V DC Transition",
    domain: "Power Architecture",
    readTime: 90,
    brief: `The AI data center industry is undergoing its most significant power architecture change in a generation: the shift from 415V AC to 800V DC distribution at the rack level.

Legacy data centers distribute power as alternating current (AC) at 415V (or 480V in the US), which requires multiple conversion stages — transformer to switchgear to UPS to PDU — before reaching the server. Each conversion wastes energy and adds failure points.

800V DC distribution eliminates three of those conversions. Power enters the facility as AC, converts once to 800V DC, and distributes directly to rack-level power shelves. GPU-native DC-DC converters inside the rack handle the final step. The result: higher efficiency, lower cooling burden on the power chain, and smaller copper footprint.

Eaton, Vertiv, and Schneider Electric are all acquiring capabilities in this space. OCP's Open Rack Wide (ORW) specification formalizes the 800V DC rack interface. NVIDIA's NVLink architecture is designed around DC-native power delivery.

The constraint: NFPA 70 (the National Electrical Code) does not yet have complete guidance for 800V DC in occupied buildings. Until the code catches up, facilities must navigate a patchwork of Authority Having Jurisdiction (AHJ) interpretations. Greenfield campuses are building to 800V DC today. Retrofits are operationally complex and expensive.`,
    questions: [
      {
        q: "What is the primary efficiency advantage of 800V DC distribution?",
        options: ["Higher voltage means less heat", "Fewer AC/DC conversion stages in the power chain", "Copper wire is cheaper at 800V", "UPS systems are not required"],
        correct: 1,
        explanation: "800V DC eliminates multiple conversion stages (transformer→switchgear→UPS→PDU→server), each of which wastes energy. Fewer conversions = higher round-trip efficiency."
      },
      {
        q: "What is the current primary constraint on 800V DC adoption in existing facilities?",
        options: ["Cost of copper busbars", "NFPA 70 code gap for 800V DC in occupied buildings", "GPU incompatibility", "Utility resistance to DC loads"],
        correct: 1,
        explanation: "NFPA 70 lacks complete code guidance for 800V DC. This forces facilities to work with local AHJ interpretations, creating inconsistency and risk across jurisdictions."
      },
      {
        q: "Which of the following companies is NOT mentioned as acquiring capabilities in 800V DC infrastructure?",
        options: ["Eaton", "Vertiv", "Schneider Electric", "Siemens"],
        correct: 3,
        explanation: "The brief mentions Eaton, Vertiv, and Schneider Electric. Siemens is a major player in this space but was not cited in this specific brief."
      },
    ],
  },
  "Dark Fiber": {
    name: "Power Architecture Terms #1",
    domain: "Power Architecture",
    pairs: [
      { term:"BUSBAR",      def:"A rigid conductor — copper or aluminum — that distributes electrical power within switchgear, bus ducts, or PDUs at high current with minimal loss"                },
      { term:"CDU",         def:"Coolant Distribution Unit — the rack-side heat exchanger that circulates chilled facility water to server-side cold plates in a direct liquid cooling loop"    },
      { term:"PUE",         def:"Power Usage Effectiveness — total facility power divided by IT load power; a score of 1.0 is perfect; real-world AI facilities target 1.2–1.4"                 },
      { term:"SWITCHGEAR",  def:"The assembly of circuit breakers, disconnects, and protective devices that controls and protects the electrical distribution system in a facility"             },
      { term:"WUE",         def:"Water Usage Effectiveness — liters of water consumed per kWh of IT load; the cooling equivalent of PUE; world-class target is below 0.5L/kWh"               },
      { term:"INTERCONNECT",def:"The physical and contractual connection between a generation asset or large load and the ISO/RTO transmission grid; acquiring a queue position takes years" },
    ],
  },
  Frequency: {
    name: "Power Architecture Quiz #1",
    domain: "Power Architecture",
    questions: [
      {
        q: "What does the acronym 'BYOG' stand for in data center power strategy?",
        options: ["Build Your Own Grid", "Bring Your Own Generation", "Bypass Your Operator Grid", "Backup Your Own Generator"],
        correct: 1,
        explanation: "BYOG (Bring Your Own Generation) refers to operators developing or contracting dedicated generation assets — nuclear, gas, solar — rather than relying solely on grid power."
      },
      {
        q: "Which ISO/RTO has the largest interconnection queue backlog in North America as of 2026?",
        options: ["ERCOT", "CAISO", "PJM", "MISO"],
        correct: 2,
        explanation: "PJM (covering the Mid-Atlantic and Midwest) has the largest backlog, with average queue wait times exceeding 5 years driven by AI data center demand in Northern Virginia and Ohio."
      },
      {
        q: "At what voltage does the emerging DC power distribution standard for high-density AI racks operate?",
        options: ["48V DC", "240V DC", "415V DC", "800V DC"],
        correct: 3,
        explanation: "800V DC is the emerging standard for high-density rack distribution, supported by OCP's Open Rack Wide (ORW) spec and NVIDIA's NVLink power architecture."
      },
      {
        q: "What does 'entitlement' mean in data center site selection?",
        options: ["Tax incentive approval", "Utility interconnection agreement", "Zoning and permitting approval for the intended use", "Grid capacity allocation"],
        correct: 2,
        explanation: "Entitlement refers to the regulatory and zoning approvals that permit the intended development. Entitled land with a grid queue position is categorically more valuable than unentitled land."
      },
    ],
  },
};

// ── Publish pipeline helper ──────────────────────────────────────────────────
// In production: fetch from Airtable filtering Published = "Live"
// Status flow: Draft → In Review → Approved → Scheduled → Live → Retired
function getPuzzleStatus(puzzleType) {
  // Mock: all games are live for demo; in production this reads Airtable
  return "Live";
}

// ── Shared components ─────────────────────────────────────────────────────────
function SL({ children, color }) {
  return <span style={{ fontSize:"10px", letterSpacing:"0.14em", color:color||C.muted, textTransform:"uppercase", ...mono }}>{children}</span>;
}

function Btn({ children, onClick, disabled, variant="primary", small }) {
  const styles = {
    primary: { background:`rgba(196,146,42,0.12)`, border:`1px solid rgba(196,146,42,0.4)`, color:C.gold },
    ghost:   { background:`rgba(255,255,255,0.04)`, border:`1px solid ${C.border}`, color:C.muted },
    success: { background:`rgba(74,222,128,0.1)`, border:`1px solid rgba(74,222,128,0.3)`, color:C.green },
    danger:  { background:`rgba(248,113,113,0.1)`, border:`1px solid rgba(248,113,113,0.3)`, color:C.red },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...styles[variant], borderRadius:"6px",
      padding: small ? "6px 14px" : "10px 20px",
      fontSize: small ? "10px" : "11px",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      letterSpacing:"0.08em", transition:"all 0.15s", ...mono,
    }}>{children}</button>
  );
}

function ProgressBar({ value, max, color }) {
  return (
    <div style={{ height:"3px", background:"rgba(255,255,255,0.06)", borderRadius:"2px", overflow:"hidden" }}>
      <div style={{ height:"100%", width:`${(value/max)*100}%`, background:color||C.gold,
        borderRadius:"2px", transition:"width 0.3s ease" }}/>
    </div>
  );
}

// ── Score display ─────────────────────────────────────────────────────────────
function ScoreCard({ score, puzzleType, domain, streak, mwEarned, onShare, onNext, isNew7Day }) {
  const mark = score >= 130 ? "◆" : score >= 100 ? "◇" : score >= 75 ? "✦" : "◎";
  return (
    <div style={{ textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:"20px" }}>
      <div style={{ fontSize:"48px", color:C.gold }}>{mark}</div>
      <div>
        <div style={{ fontSize:"48px", fontWeight:800, color:C.gold, letterSpacing:"-0.04em", ...sans }}>{score}</div>
        <div style={{ fontSize:"11px", color:C.muted, marginTop:"4px", ...mono }}>points · {puzzleType}</div>
      </div>
      <div style={{ background:`rgba(196,146,42,0.06)`, border:`1px solid rgba(196,146,42,0.2)`,
        borderRadius:"8px", padding:"12px 20px", display:"flex", gap:"24px" }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:"16px", fontWeight:700, color:C.gold, ...sans }}>{streak}</div>
          <div style={{ fontSize:"9px", color:C.muted, ...mono }}>day streak</div>
        </div>
        <div style={{ width:"1px", background:C.border }}/>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:"16px", fontWeight:700, color:C.green, ...sans }}>+{mwEarned}</div>
          <div style={{ fontSize:"9px", color:C.muted, ...mono }}>MW earned</div>
        </div>
      </div>
      {isNew7Day && (
        <div style={{ background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.3)",
          borderRadius:"6px", padding:"10px 16px", fontSize:"11px", color:C.amber, ...mono }}>
          Week Warrior — 7-day streak! +{MW_STREAK_BONUS} bonus MW
        </div>
      )}
      <div style={{ display:"flex", gap:"10px" }}>
        <Btn onClick={onShare} variant="ghost" small>↑ Share Result</Btn>
        <Btn onClick={onNext}>Play Another →</Btn>
      </div>
      <div style={{ fontSize:"9px", color:C.dim, ...mono }}>
        Score includes {getStreakMultiplier(streak).mult}× streak multiplier
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: RACKL — Connections-style tile grouping
// ══════════════════════════════════════════════════════════════════════════════
function GameRackl({ puzzle, streak, onComplete }) {
  const allItems = puzzle.groups.flatMap((g, gi) => g.items.map((item, i) => ({ item, groupIdx:gi, id:`${gi}-${i}` })));
  const [tiles,    setTiles]    = useState(() => [...allItems].sort(() => Math.random()-0.5));
  const [selected, setSelected] = useState([]);
  const [solved,   setSolved]   = useState([]);
  const [mistakes, setMistakes] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [done,     setDone]     = useState(false);
  const [scoreVal, setScoreVal] = useState(null);
  const startTime = useRef(Date.now());

  function toggle(id) {
    if (solved.includes(id)) return;
    setSelected(prev => prev.includes(id) ? prev.filter(x=>x!==id) : prev.length < 4 ? [...prev, id] : prev);
  }

  function submit() {
    if (selected.length !== 4) return;
    const groups = selected.map(id => tiles.find(t=>t.id===id).groupIdx);
    if (groups.every(g => g === groups[0])) {
      const newSolved = [...solved, ...selected];
      setSolved(newSolved);
      setSelected([]);
      setFeedback({ type:"correct", label:puzzle.groups[groups[0]].label });
      setTimeout(() => setFeedback(null), 1500);
      if (newSolved.length === 16) {
        const elapsed = (Date.now() - startTime.current) / 1000;
        const perfect = mistakes === 0;
        const s = calcScore({ basePoints:16, maxPoints:16, timeElapsed:elapsed, timeLimit:180, perfect, streak });
        setScoreVal(s);
        setDone(true);
      }
    } else {
      setMistakes(m => m+1);
      setFeedback({ type:"wrong" });
      setSelected([]);
      setTimeout(() => setFeedback(null), 800);
    }
  }

  if (done) return <ScoreCard score={scoreVal} puzzleType="Rackl" domain={puzzle.domain}
    streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)}
    isNew7Day={streak===7} />;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      {/* Solved groups */}
      {puzzle.groups.filter((_, gi) => solved.some(id => tiles.find(t=>t.id===id)?.groupIdx===gi)).map((g, gi) => (
        <div key={gi} style={{ background:g.color, borderRadius:"8px", padding:"12px 16px",
          display:"flex", alignItems:"center", gap:"12px" }}>
          <span style={{ fontSize:"11px", fontWeight:700, color:g.textColor, letterSpacing:"0.06em", ...mono }}>{g.label}</span>
          <span style={{ fontSize:"10px", color:g.textColor, opacity:0.7, ...mono }}>{g.items.join(" · ")}</span>
        </div>
      ))}

      {/* Active tiles — crème background for readability */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"8px" }}>
        {tiles.filter(t => !solved.includes(t.id)).map(t => {
          const isSelected = selected.includes(t.id);
          return (
            <button key={t.id} onClick={() => toggle(t.id)} style={{
              background: isSelected ? `rgba(196,146,42,0.2)` : C.cream,
              border: `2px solid ${isSelected ? C.gold : "rgba(28,52,36,0.15)"}`,
              borderRadius:"8px", padding:"14px 8px",
              cursor:"pointer", transition:"all 0.12s",
              transform: isSelected ? "translateY(-2px)" : "none",
              boxShadow: isSelected ? `0 4px 12px rgba(196,146,42,0.2)` : "none",
            }}>
              <span style={{ fontSize:"11px", fontWeight:600, color: isSelected ? C.gold : C.black,
                lineHeight:1.3, textAlign:"center", display:"block", ...sans }}>{t.item}</span>
            </button>
          );
        })}
      </div>

      {feedback && (
        <div style={{ textAlign:"center", fontSize:"11px", ...mono,
          color: feedback.type==="correct" ? C.green : C.red,
          background: feedback.type==="correct" ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
          border:`1px solid ${feedback.type==="correct" ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
          borderRadius:"6px", padding:"8px" }}>
          {feedback.type==="correct" ? `✓ ${feedback.label}` : "✗ Not quite — try again"}
        </div>
      )}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", gap:"6px" }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ width:"10px", height:"10px", borderRadius:"50%",
              background: i < mistakes ? C.red : C.dim }} />
          ))}
          <span style={{ fontSize:"9px", color:C.muted, marginLeft:"6px", ...mono }}>{mistakes} mistakes</span>
        </div>
        <Btn onClick={submit} disabled={selected.length !== 4}>
          Submit {selected.length}/4
        </Btn>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: SIGNAL DROP — Wordle-style
// ══════════════════════════════════════════════════════════════════════════════
function GameSignalDrop({ puzzle, streak, onComplete }) {
  const word     = puzzle.word.toUpperCase();
  const [guesses, setGuesses]   = useState([]);
  const [current, setCurrent]   = useState("");
  const [won,     setWon]       = useState(false);
  const [lost,    setLost]      = useState(false);
  const [shake,   setShake]     = useState(false);
  const [scoreVal,setScoreVal]  = useState(null);
  const [hint,    setHint]      = useState(0);
  const maxGuesses = 6;
  const startTime  = useRef(Date.now());

  function addLetter(l) {
    if (current.length < word.length && !won && !lost) setCurrent(c => c+l);
  }
  function removeLetter() { setCurrent(c => c.slice(0,-1)); }

  function submitGuess() {
    if (current.length !== word.length) return;
    const newGuesses = [...guesses, current];
    setGuesses(newGuesses);
    setCurrent("");
    if (current === word) {
      setWon(true);
      const elapsed  = (Date.now() - startTime.current) / 1000;
      const perfect  = newGuesses.length === 1;
      const baseP    = Math.max(0, maxGuesses - newGuesses.length + 1);
      const s = calcScore({ basePoints:baseP, maxPoints:maxGuesses, timeElapsed:elapsed, timeLimit:300, perfect, streak });
      setScoreVal(s);
    } else if (newGuesses.length >= maxGuesses) {
      setLost(true);
      setScoreVal(10);
    }
  }

  function getTileState(rowIdx, colIdx) {
    const guess = guesses[rowIdx];
    if (!guess) return "empty";
    const letter = guess[colIdx];
    if (letter === word[colIdx]) return "correct";
    if (word.includes(letter)) return "present";
    return "absent";
  }

  const tileColors = { correct:"#1C3424", present:"#5A4010", absent:"#2A2520", empty:"rgba(255,255,255,0.03)" };
  const tileText   = { correct:C.green, present:C.amber, absent:C.muted, empty:C.dim };

  if (won || lost) return <ScoreCard score={scoreVal} puzzleType="Signal Drop" domain={puzzle.domain}
    streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)}
    isNew7Day={streak===7} />;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px", alignItems:"center" }}>
      <div style={{ fontSize:"10px", color:C.muted, textAlign:"center", lineHeight:1.6, ...mono, maxWidth:"360px" }}>
        {puzzle.clue}
        {hint > 0 && <div style={{ color:C.amber, marginTop:"4px" }}>Hint: {puzzle.hint1}</div>}
        {hint > 1 && <div style={{ color:C.amber }}>Hint 2: {puzzle.hint2}</div>}
      </div>

      {/* Grid */}
      <div style={{ display:"flex", flexDirection:"column", gap:"4px" }}>
        {[...Array(maxGuesses)].map((_, ri) => {
          const guess = guesses[ri] || (ri === guesses.length ? current : "");
          return (
            <div key={ri} style={{ display:"flex", gap:"4px" }}>
              {[...Array(word.length)].map((_, ci) => {
                const state = ri < guesses.length ? getTileState(ri, ci) : (guess[ci] ? "current" : "empty");
                return (
                  <div key={ci} style={{
                    width:"44px", height:"44px", borderRadius:"4px",
                    background: state === "current" ? "rgba(255,255,255,0.06)" : tileColors[state] || tileColors.empty,
                    border: `2px solid ${state === "current" ? C.border : (state === "empty" ? C.dim : "transparent")}`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:"16px", fontWeight:700, color: state === "current" ? C.text : (tileText[state] || C.muted),
                    transition:"all 0.2s", ...mono,
                  }}>
                    {guess[ci] || ""}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Keyboard */}
      <div style={{ display:"flex", flexDirection:"column", gap:"5px", alignItems:"center" }}>
        {[["Q","W","E","R","T","Y","U","I","O","P"],["A","S","D","F","G","H","J","K","L"],["ENTER","Z","X","C","V","B","N","M","⌫"]].map((row, ri) => (
          <div key={ri} style={{ display:"flex", gap:"4px" }}>
            {row.map(key => {
              const used = guesses.some(g => g.includes(key));
              const isCorrect = guesses.some((g, gi) => g.split("").some((l,ci) => l===key && word[ci]===key));
              const isPresent = !isCorrect && guesses.some(g => g.includes(key) && word.includes(key));
              return (
                <button key={key} onClick={() => {
                  if (key === "ENTER") submitGuess();
                  else if (key === "⌫") removeLetter();
                  else addLetter(key);
                }} style={{
                  background: isCorrect ? "#1C3424" : isPresent ? "#5A4010" : used ? "#2A2520" : "rgba(255,255,255,0.07)",
                  border:"none", borderRadius:"4px",
                  width: key.length > 1 ? "52px" : "32px", height:"40px",
                  color: isCorrect ? C.green : isPresent ? C.amber : C.text,
                  fontSize:"11px", cursor:"pointer", fontWeight:600, ...mono,
                }}>{key}</button>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ display:"flex", gap:"8px" }}>
        {hint < 2 && <Btn onClick={() => setHint(h=>h+1)} variant="ghost" small>Hint ({2-hint} left)</Btn>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: THE STACK — Drag-to-rank
// ══════════════════════════════════════════════════════════════════════════════
function GameStack({ puzzle, streak, onComplete }) {
  const [order,    setOrder]    = useState(() => [...puzzle.items.map((_,i)=>i)].sort(()=>Math.random()-0.5));
  const [dragging, setDragging] = useState(null);
  const [submitted,setSubmitted]= useState(false);
  const [scoreVal, setScoreVal] = useState(null);
  const startTime = useRef(Date.now());

  function dragStart(idx) { setDragging(idx); }
  function dragOver(e, idx) {
    e.preventDefault();
    if (dragging === null || dragging === idx) return;
    const newOrder = [...order];
    const item = newOrder.splice(dragging, 1)[0];
    newOrder.splice(idx, 0, item);
    setOrder(newOrder);
    setDragging(idx);
  }
  function dragEnd() { setDragging(null); }

  function submit() {
    // Score: count how many are in correct relative position
    const correct = order.filter((item, idx) => puzzle.correctOrder.indexOf(item) === idx).length;
    const perfect = correct === order.length;
    const elapsed = (Date.now() - startTime.current) / 1000;
    const s = calcScore({ basePoints:correct, maxPoints:order.length, timeElapsed:elapsed, timeLimit:120, perfect, streak });
    setScoreVal(s);
    setSubmitted(true);
  }

  if (submitted) return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      {order.map((itemIdx, rankIdx) => {
        const correctRank = puzzle.correctOrder.indexOf(itemIdx);
        const isCorrect   = correctRank === rankIdx;
        return (
          <div key={itemIdx} style={{
            background: isCorrect ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.06)",
            border:`1px solid ${isCorrect ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.2)"}`,
            borderRadius:"8px", padding:"12px 16px",
            display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ display:"flex", gap:"12px", alignItems:"center" }}>
              <span style={{ fontSize:"10px", color:isCorrect?C.green:C.red, ...mono }}>#{rankIdx+1}</span>
              <span style={{ fontSize:"12px", color:C.text }}>{puzzle.items[itemIdx]}</span>
            </div>
            <div style={{ textAlign:"right" }}>
              <span style={{ fontSize:"10px", color:C.muted, ...mono }}>{puzzle.values?.[correctRank] || ""}</span>
              {!isCorrect && <div style={{ fontSize:"9px", color:C.red, ...mono }}>Correct: #{correctRank+1}</div>}
            </div>
          </div>
        );
      })}
      <div style={{ fontSize:"10px", color:C.muted, ...mono, textAlign:"center" }}>
        Ranking by: {puzzle.metric}
      </div>
      <ScoreCard score={scoreVal} puzzleType="The Stack" domain={puzzle.domain}
        streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)}
        isNew7Day={streak===7} />
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      <div style={{ fontSize:"10px", color:C.muted, textAlign:"center", ...mono }}>
        {puzzle.metric} — drag to reorder
      </div>
      {order.map((itemIdx, rankIdx) => (
        <div key={itemIdx} draggable
          onDragStart={() => dragStart(rankIdx)}
          onDragOver={(e) => dragOver(e, rankIdx)}
          onDragEnd={dragEnd}
          style={{
            background: dragging === rankIdx ? "rgba(196,146,42,0.1)" : C.surface,
            border:`1px solid ${dragging === rankIdx ? C.gold : C.border}`,
            borderRadius:"8px", padding:"14px 16px",
            display:"flex", alignItems:"center", gap:"14px",
            cursor:"grab", transition:"all 0.1s",
            transform: dragging === rankIdx ? "scale(1.02)" : "none",
          }}>
          <span style={{ fontSize:"16px", color:C.dim, userSelect:"none" }}>⠿</span>
          <span style={{ fontSize:"14px", color:C.text, flex:1, ...sans }}>{puzzle.items[itemIdx]}</span>
          <span style={{ fontSize:"10px", color:C.muted, ...mono }}>#{rankIdx+1}</span>
        </div>
      ))}
      <div style={{ marginTop:"8px" }}>
        <Btn onClick={submit}>Lock In Ranking →</Btn>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: CIRCUIT — True/False sprint with timer
// ══════════════════════════════════════════════════════════════════════════════
function GameCircuit({ puzzle, streak, onComplete }) {
  const [qIdx,    setQIdx]    = useState(0);
  const [answers, setAnswers] = useState([]);
  const [timeLeft,setTimeLeft]= useState(puzzle.timeLimit);
  const [done,    setDone]    = useState(false);
  const [scoreVal,setScoreVal]= useState(null);
  const [lastFeedback, setLastFeedback] = useState(null);
  const startTime = useRef(Date.now());

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(t); finish(answers); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [done, answers]);

  function answer(val) {
    const q   = puzzle.questions[qIdx];
    const ok  = (val === q.a);
    const newAnswers = [...answers, { q:q.q, given:val, correct:q.a, ok, explanation:q.explanation }];
    setLastFeedback(ok);
    setTimeout(() => {
      setLastFeedback(null);
      if (qIdx + 1 >= puzzle.questions.length) { finish(newAnswers); }
      else { setQIdx(i => i+1); setAnswers(newAnswers); }
    }, 600);
  }

  function finish(finalAnswers) {
    setDone(true);
    const correct = finalAnswers.filter(a => a.ok).length;
    const elapsed = (Date.now() - startTime.current) / 1000;
    const perfect = correct === puzzle.questions.length;
    const s = calcScore({ basePoints:correct, maxPoints:puzzle.questions.length, timeElapsed:elapsed, timeLimit:puzzle.timeLimit, perfect, streak });
    setScoreVal(s);
  }

  if (done && scoreVal !== null) return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      {answers.map((a, i) => (
        <div key={i} style={{
          background: a.ok ? "rgba(74,222,128,0.05)" : "rgba(248,113,113,0.05)",
          border:`1px solid ${a.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
          borderRadius:"8px", padding:"12px 14px" }}>
          <div style={{ fontSize:"11px", color:C.text, marginBottom:"4px" }}>{a.q}</div>
          <div style={{ fontSize:"9px", color:a.ok?C.green:C.red, ...mono }}>
            {a.ok ? "✓ Correct" : `✗ You said ${a.given?"TRUE":"FALSE"} · Answer: ${a.correct?"TRUE":"FALSE"}`}
          </div>
          <div style={{ fontSize:"9px", color:C.muted, marginTop:"4px", lineHeight:1.5, ...mono }}>{a.explanation}</div>
        </div>
      ))}
      <ScoreCard score={scoreVal} puzzleType="Circuit" domain={puzzle.domain}
        streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)}
        isNew7Day={streak===7} />
    </div>
  );

  const q = puzzle.questions[qIdx];
  const timePct = (timeLeft / puzzle.timeLimit) * 100;
  const timeColor = timePct > 50 ? C.green : timePct > 25 ? C.amber : C.red;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"20px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <SL>{qIdx+1} / {puzzle.questions.length}</SL>
        <span style={{ fontSize:"16px", fontWeight:700, color:timeColor, ...mono }}>{timeLeft}s</span>
      </div>
      <ProgressBar value={timeLeft} max={puzzle.timeLimit} color={timeColor}/>

      <div style={{ background:"rgba(255,255,255,0.03)", border:`1px solid ${C.border}`,
        borderRadius:"10px", padding:"24px", minHeight:"100px",
        display:"flex", alignItems:"center", justifyContent:"center",
        transition:"background 0.2s",
        backgroundColor: lastFeedback === true ? "rgba(74,222,128,0.06)" : lastFeedback === false ? "rgba(248,113,113,0.06)" : undefined }}>
        <p style={{ fontSize:"15px", color:C.text, textAlign:"center", margin:0, lineHeight:1.6, ...sans }}>{q.q}</p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
        <button onClick={() => answer(true)} style={{
          background:"rgba(74,222,128,0.08)", border:"1px solid rgba(74,222,128,0.3)",
          borderRadius:"8px", padding:"18px", color:C.green,
          fontSize:"14px", fontWeight:700, cursor:"pointer", ...sans,
          transition:"all 0.1s",
        }}>TRUE ✓</button>
        <button onClick={() => answer(false)} style={{
          background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.3)",
          borderRadius:"8px", padding:"18px", color:C.red,
          fontSize:"14px", fontWeight:700, cursor:"pointer", ...sans,
          transition:"all 0.1s",
        }}>FALSE ✗</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: THE BRIEF — Read + comprehension
// ══════════════════════════════════════════════════════════════════════════════
function GameBrief({ puzzle, streak, onComplete }) {
  const [phase,   setPhase]   = useState("read"); // read | quiz | done
  const [qIdx,    setQIdx]    = useState(0);
  const [answers, setAnswers] = useState([]);
  const [selected,setSelected]= useState(null);
  const [scoreVal,setScoreVal]= useState(null);
  const [timeLeft,setTimeLeft]= useState(puzzle.readTime);
  const startTime = useRef(Date.now());

  useEffect(() => {
    if (phase !== "read") return;
    const t = setInterval(() => {
      setTimeLeft(prev => { if (prev <= 0) { clearInterval(t); return 0; } return prev - 1; });
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  function pickAnswer(idx) { setSelected(idx); }

  function nextQuestion() {
    const q = puzzle.questions[qIdx];
    const newAnswers = [...answers, { given:selected, correct:q.correct, ok:selected===q.correct, explanation:q.explanation }];
    setAnswers(newAnswers);
    setSelected(null);
    if (qIdx + 1 >= puzzle.questions.length) {
      const correct = newAnswers.filter(a => a.ok).length;
      const elapsed = (Date.now() - startTime.current) / 1000;
      const perfect = correct === puzzle.questions.length;
      const s = calcScore({ basePoints:correct, maxPoints:puzzle.questions.length, timeElapsed:elapsed, timeLimit:300, perfect, streak });
      setScoreVal(s);
      setPhase("done");
    } else {
      setQIdx(i => i+1);
    }
  }

  if (phase === "done") return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      {puzzle.questions.map((q, i) => (
        <div key={i} style={{
          background: answers[i]?.ok ? "rgba(74,222,128,0.05)" : "rgba(248,113,113,0.05)",
          border:`1px solid ${answers[i]?.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
          borderRadius:"8px", padding:"12px 14px" }}>
          <div style={{ fontSize:"11px", color:C.text, marginBottom:"6px" }}>{q.q}</div>
          <div style={{ fontSize:"10px", color:answers[i]?.ok?C.green:C.red, ...mono }}>
            {answers[i]?.ok ? "✓ Correct" : `✗ Correct: "${q.options[q.correct]}"`}
          </div>
          <div style={{ fontSize:"9px", color:C.muted, marginTop:"4px", lineHeight:1.5, ...mono }}>{q.explanation}</div>
        </div>
      ))}
      <ScoreCard score={scoreVal} puzzleType="The Brief" domain={puzzle.domain}
        streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)}
        isNew7Day={streak===7} />
    </div>
  );

  if (phase === "read") return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ display:"flex", justifyContent:"space-between" }}>
        <SL>Read the brief</SL>
        <span style={{ fontSize:"10px", color:C.muted, ...mono }}>{timeLeft}s suggested read time</span>
      </div>
      <div style={{ background:"rgba(255,255,255,0.025)", border:`1px solid ${C.border}`,
        borderRadius:"8px", padding:"20px", maxHeight:"320px", overflowY:"auto" }}>
        {puzzle.brief.split("\n\n").map((p, i) => (
          <p key={i} style={{ fontSize:"12px", color:C.text, lineHeight:1.7, marginBottom:"12px",
            marginTop:0, ...sans }}>{p}</p>
        ))}
      </div>
      <Btn onClick={() => setPhase("quiz")}>Ready — Take the Quiz →</Btn>
    </div>
  );

  const q = puzzle.questions[qIdx];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <SL>Question {qIdx+1} of {puzzle.questions.length}</SL>
      <div style={{ background:C.surface, border:`1px solid ${C.border}`,
        borderRadius:"8px", padding:"16px" }}>
        <p style={{ fontSize:"13px", color:C.text, margin:0, lineHeight:1.6, ...sans }}>{q.q}</p>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
        {q.options.map((opt, i) => (
          <button key={i} onClick={() => pickAnswer(i)} style={{
            background: selected === i ? "rgba(196,146,42,0.1)" : C.surface,
            border:`1px solid ${selected === i ? C.gold : C.border}`,
            borderRadius:"6px", padding:"12px 16px", textAlign:"left",
            cursor:"pointer", fontSize:"12px", color: selected===i ? C.gold : C.text,
            transition:"all 0.12s", ...sans,
          }}>
            <span style={{ color:C.muted, marginRight:"10px", ...mono }}>{String.fromCharCode(65+i)}.</span>{opt}
          </button>
        ))}
      </div>
      <Btn onClick={nextQuestion} disabled={selected === null}>
        {qIdx + 1 < puzzle.questions.length ? "Next Question →" : "Submit Answers →"}
      </Btn>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: DARK FIBER — Term ↔ Definition matching
// ══════════════════════════════════════════════════════════════════════════════
function GameDarkFiber({ puzzle, streak, onComplete }) {
  const [selectedTerm, setSelectedTerm] = useState(null);
  const [selectedDef,  setSelectedDef]  = useState(null);
  const [matched,      setMatched]      = useState([]);
  const [wrong,        setWrong]        = useState(false);
  const [scoreVal,     setScoreVal]     = useState(null);
  const [done,         setDone]         = useState(false);
  const [mistakes,     setMistakes]     = useState(0);
  const [shuffledDefs, setShuffledDefs] = useState(() => [...puzzle.pairs].sort(()=>Math.random()-0.5).map(p=>p.term));
  const startTime = useRef(Date.now());

  useEffect(() => {
    if (!selectedTerm || !selectedDef) return;
    if (selectedTerm === selectedDef) {
      const newMatched = [...matched, selectedTerm];
      setMatched(newMatched);
      setSelectedTerm(null);
      setSelectedDef(null);
      if (newMatched.length === puzzle.pairs.length) {
        const elapsed = (Date.now() - startTime.current) / 1000;
        const perfect = mistakes === 0;
        const s = calcScore({ basePoints:puzzle.pairs.length, maxPoints:puzzle.pairs.length, timeElapsed:elapsed, timeLimit:180, perfect, streak });
        setScoreVal(s);
        setDone(true);
      }
    } else {
      setWrong(true);
      setMistakes(m=>m+1);
      setTimeout(() => { setWrong(false); setSelectedTerm(null); setSelectedDef(null); }, 800);
    }
  }, [selectedTerm, selectedDef]);

  if (done) return <ScoreCard score={scoreVal} puzzleType="Dark Fiber" domain={puzzle.domain}
    streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)}
    isNew7Day={streak===7} />;

  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
      {/* Terms column */}
      <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
        <SL color={C.gold}>Terms</SL>
        {puzzle.pairs.map(p => {
          const isMatched = matched.includes(p.term);
          const isSel = selectedTerm === p.term;
          return (
            <button key={p.term} onClick={() => !isMatched && setSelectedTerm(p.term)} style={{
              background: isMatched ? "rgba(74,222,128,0.08)" : isSel ? "rgba(196,146,42,0.12)" : C.surface,
              border:`1px solid ${isMatched ? "rgba(74,222,128,0.3)" : isSel ? C.gold : C.border}`,
              borderRadius:"6px", padding:"10px 12px", textAlign:"left",
              cursor: isMatched ? "default" : "pointer",
              color: isMatched ? C.green : isSel ? C.gold : C.text,
              fontSize:"11px", fontWeight:600, ...mono, transition:"all 0.12s",
            }}>{p.term}</button>
          );
        })}
      </div>
      {/* Definitions column */}
      <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
        <SL color={C.cyan||C.sage}>Definitions</SL>
        {shuffledDefs.map(term => {
          const pair = puzzle.pairs.find(p => p.term === term);
          const isMatched = matched.includes(term);
          const isSel = selectedDef === term;
          return (
            <button key={term} onClick={() => !isMatched && setSelectedDef(term)} style={{
              background: isMatched ? "rgba(74,222,128,0.08)" : isSel ? "rgba(140,166,138,0.12)" : C.surface,
              border:`1px solid ${isMatched ? "rgba(74,222,128,0.3)" : isSel ? C.sage : (wrong&&isSel?"rgba(248,113,113,0.4)":C.border)}`,
              borderRadius:"6px", padding:"10px 12px", textAlign:"left",
              cursor: isMatched ? "default" : "pointer",
              color: isMatched ? C.green : isSel ? C.sage : C.muted,
              fontSize:"10px", lineHeight:1.5, ...mono, transition:"all 0.12s",
            }}>{pair.def.length > 80 ? pair.def.slice(0,80)+"…" : pair.def}</button>
          );
        })}
      </div>
      {wrong && (
        <div style={{ gridColumn:"1/-1", textAlign:"center", fontSize:"10px", color:C.red,
          background:"rgba(248,113,113,0.06)", border:"1px solid rgba(248,113,113,0.2)",
          borderRadius:"4px", padding:"6px", ...mono }}>
          ✗ Incorrect match — try again ({mistakes} mistakes)
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME: FREQUENCY — Multiple choice quiz
// ══════════════════════════════════════════════════════════════════════════════
function GameFrequency({ puzzle, streak, onComplete }) {
  const [qIdx,    setQIdx]    = useState(0);
  const [answers, setAnswers] = useState([]);
  const [selected,setSelected]= useState(null);
  const [revealed,setRevealed]= useState(false);
  const [scoreVal,setScoreVal]= useState(null);
  const [done,    setDone]    = useState(false);
  const startTime = useRef(Date.now());

  function pick(idx) {
    if (revealed) return;
    setSelected(idx);
    setRevealed(true);
  }

  function next() {
    const q = puzzle.questions[qIdx];
    const newAnswers = [...answers, { given:selected, correct:q.correct, ok:selected===q.correct, explanation:q.explanation }];
    setAnswers(newAnswers);
    setSelected(null);
    setRevealed(false);
    if (qIdx + 1 >= puzzle.questions.length) {
      const correct = newAnswers.filter(a=>a.ok).length;
      const elapsed = (Date.now() - startTime.current) / 1000;
      const perfect = correct === puzzle.questions.length;
      const s = calcScore({ basePoints:correct, maxPoints:puzzle.questions.length, timeElapsed:elapsed, timeLimit:240, perfect, streak });
      setScoreVal(s);
      setDone(true);
    } else {
      setQIdx(i=>i+1);
    }
  }

  if (done) return (
    <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
      {puzzle.questions.map((q,i) => (
        <div key={i} style={{
          background: answers[i]?.ok ? "rgba(74,222,128,0.05)" : "rgba(248,113,113,0.05)",
          border:`1px solid ${answers[i]?.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
          borderRadius:"8px", padding:"12px" }}>
          <div style={{ fontSize:"11px", color:C.text, marginBottom:"4px" }}>{q.q}</div>
          <div style={{ fontSize:"10px", color:answers[i]?.ok?C.green:C.red, ...mono }}>
            {answers[i]?.ok ? "✓ Correct" : `✗ Answer: "${q.options[q.correct]}"`}
          </div>
          <div style={{ fontSize:"9px", color:C.muted, marginTop:"4px", lineHeight:1.5, ...mono }}>{q.explanation}</div>
        </div>
      ))}
      <ScoreCard score={scoreVal} puzzleType="Frequency" domain={puzzle.domain}
        streak={streak} mwEarned={MW_PER_PUZZLE} onShare={()=>{}} onNext={()=>onComplete(scoreVal)}
        isNew7Day={streak===7} />
    </div>
  );

  const q = puzzle.questions[qIdx];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div style={{ display:"flex", justifyContent:"space-between" }}>
        <SL>{qIdx+1} / {puzzle.questions.length}</SL>
        <ProgressBar value={qIdx+1} max={puzzle.questions.length} color={C.violet||C.sage} />
      </div>
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"10px", padding:"20px" }}>
        <p style={{ fontSize:"14px", color:C.text, margin:0, lineHeight:1.6, ...sans }}>{q.q}</p>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
        {q.options.map((opt, i) => {
          const isCorrect = revealed && i === q.correct;
          const isWrong   = revealed && i === selected && i !== q.correct;
          return (
            <button key={i} onClick={() => pick(i)} style={{
              background: isCorrect ? "rgba(74,222,128,0.1)" : isWrong ? "rgba(248,113,113,0.1)" :
                (selected===i&&!revealed) ? "rgba(196,146,42,0.1)" : C.surface,
              border:`1px solid ${isCorrect ? "rgba(74,222,128,0.4)" : isWrong ? "rgba(248,113,113,0.4)" :
                (selected===i&&!revealed) ? C.gold : C.border}`,
              borderRadius:"6px", padding:"12px 16px", textAlign:"left",
              cursor: revealed ? "default" : "pointer",
              fontSize:"12px", color: isCorrect ? C.green : isWrong ? C.red :
                (selected===i&&!revealed) ? C.gold : C.text,
              transition:"all 0.15s", ...sans,
            }}>
              <span style={{ color:C.muted, marginRight:"10px", ...mono }}>{String.fromCharCode(65+i)}.</span>{opt}
            </button>
          );
        })}
      </div>
      {revealed && (
        <div>
          <div style={{ fontSize:"10px", color:C.muted, lineHeight:1.6, ...mono,
            background:"rgba(255,255,255,0.02)", borderRadius:"6px", padding:"10px",
            marginBottom:"10px" }}>{q.explanation}</div>
          <Btn onClick={next}>
            {qIdx + 1 < puzzle.questions.length ? "Next Question →" : "See Results →"}
          </Btn>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SOCIAL GATE — Email capture
// ══════════════════════════════════════════════════════════════════════════════
function SocialGate({ trigger, onRegister, onDismiss }) {
  const [email,   setEmail]   = useState("");
  const [sent,    setSent]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const headlines = {
    leaderboard:   { h:"You just scored. See where you rank.", sub:"Drop your email to join the leaderboard and track your streak." },
    streak:        { h:"7-day streak — you're on a run.", sub:"Register to keep your streak alive across sessions." },
    team:          { h:"You've been challenged.", sub:"Add your email to accept and track your score against theirs." },
    default:       { h:"Want to track your streak?", sub:"One email. No password. We send a magic link." },
  };
  const copy = headlines[trigger] || headlines.default;

  async function submit() {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) { setError("Enter a valid email address"); return; }
    setLoading(true);
    setError("");
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`${EDGE_FUNCTIONS_BASE}/register-with-magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalized, source: `dailychallenge-${trigger || "default"}`, timezone }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Registration failed — please try again");
      setSent(true);
      if (onRegister) onRegister(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — please try again");
    } finally {
      setLoading(false);
    }
  }

  if (sent) return (
    <div style={{ textAlign:"center", padding:"24px" }}>
      <div style={{ fontSize:"32px", marginBottom:"12px" }}>✦</div>
      <div style={{ fontSize:"15px", fontWeight:700, color:C.gold, marginBottom:"8px", ...sans }}>Check your inbox</div>
      <div style={{ fontSize:"11px", color:C.muted, lineHeight:1.6, ...mono }}>
        We sent a magic link to <span style={{ color:C.text }}>{email}</span>.<br/>
        Click it to activate your leaderboard profile and streak tracking.
      </div>
      <div style={{ marginTop:"16px" }}>
        <Btn onClick={onDismiss} variant="ghost" small>Continue playing →</Btn>
      </div>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"16px" }}>
      <div>
        <div style={{ fontSize:"16px", fontWeight:700, color:C.text, marginBottom:"6px", ...sans }}>{copy.h}</div>
        <div style={{ fontSize:"11px", color:C.muted, lineHeight:1.5, ...mono }}>{copy.sub}</div>
      </div>
      <div style={{ display:"flex", gap:"8px" }}>
        <input value={email} onChange={e=>setEmail(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&submit()}
          placeholder="your@email.com"
          style={{ flex:1, background:"rgba(255,255,255,0.04)", border:`1px solid ${C.border}`,
            borderRadius:"6px", padding:"10px 14px", color:C.text, fontSize:"12px", ...mono }} />
        <Btn onClick={submit} disabled={loading || !email}>
          {loading ? "…" : "→"}
        </Btn>
      </div>
      {error && <div style={{ fontSize:"10px", color:C.red, ...mono }}>{error}</div>}
      <div style={{ display:"flex", gap:"10px", alignItems:"center" }}>
        <div style={{ flex:1, height:"1px", background:C.border }}/>
        <span style={{ fontSize:"9px", color:C.dim, ...mono }}>OR</span>
        <div style={{ flex:1, height:"1px", background:C.border }}/>
      </div>
      <Btn onClick={onDismiss} variant="ghost" small>Skip — play without tracking</Btn>
      <div style={{ fontSize:"9px", color:C.dim, lineHeight:1.5, ...mono }}>
        No password. No newsletter. One magic link per session. Your email is only used for game notifications and streak persistence.
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GAME TILES — Lobby
// ══════════════════════════════════════════════════════════════════════════════
const GAME_CONFIGS = [
  { type:"Rackl",       desc:"Group the tiles — four connected sets",     time:"~3 min", domain:"Power Architecture" },
  { type:"Signal Drop", desc:"Guess the industry term — Wordle style",     time:"~2 min", domain:"Power Architecture" },
  { type:"The Stack",   desc:"Drag to rank in the correct order",          time:"~2 min", domain:"Power Architecture" },
  { type:"Circuit",     desc:"True/False sprint — beat the clock",         time:"~2 min", domain:"Power Architecture" },
  { type:"The Brief",   desc:"Read the intelligence brief, then answer",   time:"~4 min", domain:"Power Architecture" },
  { type:"Dark Fiber",  desc:"Match terms to their definitions",           time:"~3 min", domain:"Power Architecture" },
  { type:"Frequency",   desc:"Multiple choice knowledge quiz",             time:"~3 min", domain:"Power Architecture" },
];

// White card on cream, forest icon tile with the game's neon pictogram, hover
// glow in the game's locked neon (hover rules injected in the global style block).
function GameTile({ config, onPlay }) {
  const glow = GAME_NEON[config.type]?.glow || "rgba(196,146,42,.3)";
  return (
    <button onClick={onPlay} className="fdc-game" style={{
      "--glow": glow,
      background:C.white, border:`1px solid ${C.gray}`, borderRadius:"12px",
      padding:"16px", cursor:"pointer", textAlign:"left",
      display:"flex", gap:"16px", alignItems:"center",
      transition:"transform .12s, border-color .12s",
    }}>
      <GameIcon game={config.type} size={64} />
      <span style={{ minWidth:0, flex:1 }}>
        <span style={{ display:"block", fontSize:"18px", fontWeight:600, color:C.black, ...serif }}>{config.type}</span>
        <span style={{ display:"block", fontSize:"11.5px", color:"rgba(20,18,16,0.62)", marginTop:"3px", ...mono }}>{config.desc}</span>
        <span style={{ display:"block", marginTop:"9px", fontSize:"10px", letterSpacing:"0.08em", color:C.deepAmber, textTransform:"uppercase", ...mono }}>{config.domain}</span>
      </span>
      <span style={{ fontSize:"10px", color:"rgba(20,18,16,0.62)", alignSelf:"flex-start", whiteSpace:"nowrap", ...mono }}>{config.time}</span>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TEAM LEADERBOARD — teams_v1 standings, wired to per-player MW
// ══════════════════════════════════════════════════════════════════════════════
// Reads the seasonal team standings (public.team_leaderboard via the
// get-team-leaderboard edge function). Each player's puzzle MW feeds their
// team's total through a DB trigger, so these numbers are real results — no
// mock data. Signed-in players can start or join a team to put MW on the board.
function TeamLeaderboard({ leaderboard, myTeam, signedIn, busy, error, onCreate, onJoin, onLeave }) {
  const [mode, setMode] = useState(null); // null | "create" | "join"
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const rows = Array.isArray(leaderboard) ? leaderboard : [];

  const ghostBtn = { ...mono, fontSize:"11px", color:C.forest, background:"transparent",
    border:`1px solid ${C.gray}`, borderRadius:"6px", padding:"7px 12px",
    cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1, whiteSpace:"nowrap" };
  const input = { ...mono, fontSize:"12px", color:C.black, background:C.cream,
    border:`1px solid ${C.gray}`, borderRadius:"6px", padding:"7px 10px", flex:"1 1 160px", minWidth:"120px" };

  return (
    <section style={{ margin:"28px 0 0", background:C.white, border:`1px solid ${C.gray}`,
      borderRadius:"12px", padding:"20px 22px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:"10px", flexWrap:"wrap" }}>
        <span style={{ ...mono, fontSize:"11px", letterSpacing:"0.14em", color:C.deepAmber, textTransform:"uppercase" }}>
          Team Leaderboard
        </span>
        <span style={{ ...mono, fontSize:"9px", color:"rgba(20,18,16,0.5)" }}>Ranked by MW earned this season</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ ...mono, fontSize:"11px", color:"rgba(20,18,16,0.55)", marginTop:"14px" }}>
          No teams yet — be the first to start one.
        </div>
      ) : (
        <div style={{ marginTop:"14px", display:"flex", flexDirection:"column", gap:"4px" }}>
          {rows.map(t => {
            const mine = myTeam && t.team_id === myTeam.team_id;
            return (
              <div key={t.team_id} style={{ display:"flex", alignItems:"center", gap:"10px",
                padding:"8px 10px", borderRadius:"6px",
                background: mine ? "rgba(196,146,42,0.12)" : "transparent",
                border:`1px solid ${mine ? "rgba(196,146,42,0.4)" : "transparent"}` }}>
                <span style={{ ...mono, fontSize:"12px", color:C.deepAmber, width:"26px" }}>#{t.rank}</span>
                <span style={{ ...sans, fontSize:"13px", fontWeight:600, color:C.black, flex:1, minWidth:0,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.name}</span>
                <span style={{ ...mono, fontSize:"10px", color:"rgba(20,18,16,0.55)" }}>{t.members} member{t.members === 1 ? "" : "s"}</span>
                <span style={{ ...mono, fontSize:"12px", fontWeight:600, color:C.forest, width:"66px", textAlign:"right" }}>{t.mw} MW</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop:"16px", borderTop:`1px solid ${C.gray}`, paddingTop:"14px" }}>
        {!signedIn ? (
          <div style={{ ...mono, fontSize:"11px", color:"rgba(20,18,16,0.55)" }}>
            Sign in to start or join a team and put your MW on the board.
          </div>
        ) : myTeam ? (
          <div style={{ display:"flex", alignItems:"center", gap:"10px", flexWrap:"wrap" }}>
            <span style={{ ...mono, fontSize:"11px", color:C.forest }}>
              On <b>{myTeam.name}</b> · code <b>{myTeam.code}</b>
              {typeof myTeam.rank === "number" ? ` · rank #${myTeam.rank}` : ""} · {myTeam.mw_total} MW
              {typeof myTeam.my_mw === "number" ? ` (you: ${myTeam.my_mw})` : ""}
            </span>
            <button onClick={onLeave} disabled={busy} style={ghostBtn}>Leave team</button>
          </div>
        ) : mode === null ? (
          <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
            <button onClick={() => setMode("create")} disabled={busy} style={ghostBtn}>Start a team</button>
            <button onClick={() => setMode("join")} disabled={busy} style={ghostBtn}>Join with code</button>
          </div>
        ) : mode === "create" ? (
          <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Team name" style={input}
              onKeyDown={e => e.key === "Enter" && name.trim() && onCreate(name.trim())} />
            <button onClick={() => name.trim() && onCreate(name.trim())} disabled={busy || !name.trim()} style={ghostBtn}>
              {busy ? "…" : "Create"}
            </button>
            <button onClick={() => { setMode(null); setName(""); }} disabled={busy} style={ghostBtn}>Cancel</button>
          </div>
        ) : (
          <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="Team code" style={input}
              onKeyDown={e => e.key === "Enter" && code.trim() && onJoin(code.trim())} />
            <button onClick={() => code.trim() && onJoin(code.trim())} disabled={busy || !code.trim()} style={ghostBtn}>
              {busy ? "…" : "Join"}
            </button>
            <button onClick={() => { setMode(null); setCode(""); }} disabled={busy} style={ghostBtn}>Cancel</button>
          </div>
        )}
        {error && <div style={{ ...mono, fontSize:"10px", color:C.red, marginTop:"8px" }}>{error}</div>}
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN — Daily Challenge App
// ══════════════════════════════════════════════════════════════════════════════
export default function DailyChallenge() {
  const [screen,     setScreen]     = useState("lobby");  // lobby | game | gate | result
  const [activeGame, setActiveGame] = useState(null);
  const [email,      setEmail]      = useState(null);     // registered email
  // Session counters — honest defaults for an anonymous session (0). These
  // increment as the player completes games in-session. Cross-session streak/MW
  // persistence belongs to the subscriber session (Supabase) and is wired
  // separately; we never seed these with fabricated values. (FAR-63 stats AC.)
  const [streak,     setStreak]     = useState(0);
  const [mwBalance,  setMwBalance]  = useState(0);
  const [gamesPlayed,setGamesPlayed]= useState(0);
  const [gateReason, setGateReason] = useState(null);
  const [lastScore,  setLastScore]  = useState(null);
  // Verified subscriber session (set by /auth after a magic link). When
  // present, streak/MW/completions are hydrated from and persisted to
  // Supabase — the masthead chips and stat line show real results.
  const [sessionToken,     setSessionToken]     = useState(null);
  const [todayCompletions, setTodayCompletions] = useState({});
  // Team leaderboard (teams_v1) wired to per-player MW: public standings, plus
  // the caller's team when signed in. Refreshed after each completion.
  const [leaderboard, setLeaderboard] = useState([]);
  const [myTeam,      setMyTeam]      = useState(null);
  const [teamBusy,    setTeamBusy]    = useState(false);
  const [teamError,   setTeamError]   = useState("");

  // Live puzzles + tip from the Airtable Puzzle Bank (via /api/challenge/today).
  // Each falls back to built-in mock data if the fetch fails or a type is absent,
  // so the lobby always renders all 7 games even if Airtable is unreachable.
  const [livePuzzles,  setLivePuzzles]  = useState({});
  const [tipOfTheDay,  setTipOfTheDay]  = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/challenge/today")
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => {
        if (cancelled || !data) return;
        if (data.puzzles && typeof data.puzzles === "object") setLivePuzzles(data.puzzles);
        if (data.tip) setTipOfTheDay(data.tip);
      })
      .catch(() => { /* keep mock fallback */ });
    return () => { cancelled = true; };
  }, []);

  // Hydrate the subscriber's real state (play streak, MW balance, today's
  // completions) from Supabase when a verified session exists in storage.
  useEffect(() => {
    let token = null;
    try { token = localStorage.getItem(SESSION_STORAGE_KEY); } catch { /* storage disabled */ }
    if (!token) return;

    let cancelled = false;
    fetch(`${EDGE_FUNCTIONS_BASE}/get-subscriber-state?token=${encodeURIComponent(token)}`)
      .then(r => r.json().then(data => ({ ok: r.ok, status: r.status, data })))
      .then(({ ok, status, data }) => {
        if (cancelled) return;
        if (!ok) {
          // Expired/invalid session: clear it so the gate offers sign-in again.
          if (status === 401) {
            try {
              localStorage.removeItem(SESSION_STORAGE_KEY);
              localStorage.removeItem(EMAIL_STORAGE_KEY);
            } catch { /* ignore */ }
          }
          return;
        }
        setSessionToken(token);
        setEmail(data.email);
        setStreak(data.playStreak || 0);
        setMwBalance(data.mwBalance || 0);
        setTodayCompletions(data.todayCompletions || {});
        setGamesPlayed(Object.keys(data.todayCompletions || {}).length);
      })
      .catch(() => { /* offline — keep anonymous session counters */ });
    return () => { cancelled = true; };
  }, []);

  // Team standings — public board, plus the caller's team/rank when a session
  // token is present. Non-critical: failures leave the panel empty silently.
  const refreshLeaderboard = useCallback(() => {
    let token = null;
    try { token = localStorage.getItem(SESSION_STORAGE_KEY); } catch { /* storage disabled */ }
    const qs = new URLSearchParams({ limit: "10" });
    if (token) qs.set("token", token);
    return fetch(`${EDGE_FUNCTIONS_BASE}/get-team-leaderboard?${qs.toString()}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return;
        if (Array.isArray(data.leaderboard)) setLeaderboard(data.leaderboard);
        setMyTeam(data.myTeam || null);
      })
      .catch(() => { /* leaderboard is non-critical */ });
  }, []);

  useEffect(() => { refreshLeaderboard(); }, [refreshLeaderboard]);

  // Team membership actions (create/join/leave) — session-gated via team-action.
  function teamAction(action, payload) {
    let token = null;
    try { token = localStorage.getItem(SESSION_STORAGE_KEY); } catch { /* storage disabled */ }
    if (!token) { setTeamError("Sign in first"); return; }
    setTeamBusy(true);
    setTeamError("");
    fetch(`${EDGE_FUNCTIONS_BASE}/team-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token, action, ...payload }),
    })
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) { setTeamError(data?.error || "Team action failed"); return; }
        setMyTeam(data.myTeam || null);
        refreshLeaderboard();
      })
      .catch(() => setTeamError("Network error — try again"))
      .finally(() => setTeamBusy(false));
  }

  useEffect(() => {
    const link = document.createElement("link");
    link.rel  = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=IBM+Plex+Serif:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing:border-box; }
      @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.35} }
      .ca { animation:fadeUp 0.3s ease forwards; }
      button { font-family:inherit; }
      input { font-family:inherit; }
      input:focus { border-color:rgba(196,146,42,0.4)!important; outline:none; box-shadow:0 0 0 2px rgba(196,146,42,0.05); }
      a:focus-visible, button:focus-visible { outline:2px solid #C4922A; outline-offset:3px; }
      /* Game tile hover — lift + neon glow in the game's locked color */
      .fdc-game:hover { transform:translateY(-2px); border-color:#1C3424 !important; }
      .fdc-game:hover .icon-tile { box-shadow:0 0 18px var(--glow); }
      /* Narrow masthead — drop secondary chips so Sign in stays legible (ref Ch.09b) */
      @media (max-width:560px){ .fdc-mw, .fdc-live { display:none !important; } }
    `;
    document.head.appendChild(style);
  }, []);

  function startGame(gameType) {
    setActiveGame(gameType);
    setScreen("game");
  }

  // Deep-link: /daily-challenge?game=<type> opens that puzzle directly (from the
  // homepage neon icons) instead of landing on the lobby. Runs once on mount.
  useEffect(() => {
    let g = null;
    try { g = new URLSearchParams(window.location.search).get("game"); } catch { /* no search */ }
    if (!g) return;
    const match = GAME_CONFIGS.find(c => c.type.toLowerCase() === g.toLowerCase());
    if (match) startGame(match.type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onGameComplete(score) {
    const playedGame = activeGame;
    const mwEarned = MW_PER_PUZZLE + (streak === 6 ? MW_STREAK_BONUS : 0);
    setLastScore(score);
    setGamesPlayed(g => g+1);
    setMwBalance(b => b + mwEarned);
    setStreak(s => s+1);
    // Signed-in players: persist the completion; the server's streak/MW
    // response then overwrites the optimistic local increments above.
    if (sessionToken && playedGame) {
      setTodayCompletions(prev => ({
        ...prev,
        [playedGame]: { score, completedAt: new Date().toISOString() },
      }));
      fetch(`${EDGE_FUNCTIONS_BASE}/complete-puzzle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, puzzleType: playedGame, score, mwEarned }),
      })
        .then(r => r.json())
        .then(data => {
          if (data && data.ok && typeof data.playStreak === "number") {
            setStreak(data.playStreak);
            setMwBalance(data.mwBalance);
          }
          // Completion fed the player's team MW (DB trigger) — refresh standings.
          refreshLeaderboard();
        })
        .catch(() => { /* offline — keep optimistic counters */ });
    }
    // Show social gate after first game if not registered
    if (!email && gamesPlayed === 0) {
      setGateReason("leaderboard");
      setScreen("gate");
    } else {
      setScreen("lobby");
    }
  }

  function onRegister() {
    // Registration only sends the magic link — the player isn't signed in
    // until /auth verifies it and stores the session. Leave the
    // "check your inbox" panel up; its Continue button dismisses the gate.
  }

  function onGateDismiss() {
    setScreen("lobby");
  }

  const GAME_COMPONENTS = {
    "Rackl":       GameRackl,
    "Signal Drop": GameSignalDrop,
    "The Stack":   GameStack,
    "Circuit":     GameCircuit,
    "The Brief":   GameBrief,
    "Dark Fiber":  GameDarkFiber,
    "Frequency":   GameFrequency,
  };

  return (
    <div style={{ minHeight:"100vh", background: screen === "lobby" ? C.cream : C.forest, color:C.black, ...sans }}>
      <GameIconDefs />

      {/* ── MASTHEAD — gold rule · forest banner · gold rule ── */}
      <div style={{ height:"2px", background:C.gold }} />
      <header style={{ background:C.forest, position:"sticky", top:0, zIndex:50 }}>
        <div style={{ maxWidth:"820px", margin:"0 auto", padding:"12px 20px",
          display:"flex", alignItems:"center", gap:"12px" }}>
          <BrandMark size={20} framed />
          <div style={{ lineHeight:1.25 }}>
            <b style={{ ...serif, fontWeight:700, fontSize:"16px", color:C.white, letterSpacing:"0.04em" }}>Faraday</b>
            <span style={{ display:"block", ...mono, fontSize:"9.5px", letterSpacing:"0.18em", color:C.sage }}>DAILY CHALLENGE</span>
          </div>
          {/* Live indicator — status, not a metric */}
          <div className="fdc-live" style={{ display:"flex", alignItems:"center", gap:"6px", ...mono,
            fontSize:"10px", letterSpacing:"0.14em", color:C.goldLight }}>
            <span style={{ width:"6px", height:"6px", borderRadius:"50%",
              background:C.goldLight, animation:"pulse 2s ease infinite", display:"inline-block" }}/>
            LIVE
          </div>
          {/* Chips — mono treatment. Streak/MW are honest session counters. */}
          <div style={{ marginLeft:"auto", display:"flex", gap:"8px", alignItems:"center" }}>
            <span style={{ ...mono, fontSize:"11px", color:C.cream, border:"1px solid rgba(248,245,240,.22)",
              borderRadius:"5px", padding:"6px 10px", whiteSpace:"nowrap" }}>
              Streak <b style={{ color:C.goldLight, fontWeight:500 }}>{streak}</b>
            </span>
            <span className="fdc-mw" style={{ ...mono, fontSize:"11px", color:C.cream, border:"1px solid rgba(248,245,240,.22)",
              borderRadius:"5px", padding:"6px 10px", whiteSpace:"nowrap" }}>
              <b style={{ color:C.goldLight, fontWeight:500 }}>{mwBalance}</b> MW
            </span>
            <a href="https://faraday-academy.vercel.app/academy" target="_blank" rel="noopener noreferrer"
              style={{ ...mono, fontSize:"11px", color:C.forest, background:C.goldLight,
                border:`1px solid ${C.goldLight}`, borderRadius:"5px", padding:"6px 10px",
                whiteSpace:"nowrap", textDecoration:"none", fontWeight:500 }}>
              Academy →
            </a>
            {!email && screen === "lobby" && (
              <button onClick={() => { setGateReason("default"); setScreen("gate"); }} style={{
                ...mono, fontSize:"11px", color:C.goldLight, background:"transparent",
                border:"1px solid rgba(196,146,42,.5)", borderRadius:"5px", padding:"6px 10px",
                whiteSpace:"nowrap", cursor:"pointer" }}>
                Sign in →
              </button>
            )}
            {screen !== "lobby" && (
              <button onClick={() => setScreen("lobby")} style={{
                ...mono, fontSize:"11px", color:C.cream, background:"transparent",
                border:"1px solid rgba(248,245,240,.22)", borderRadius:"5px", padding:"6px 10px",
                whiteSpace:"nowrap", cursor:"pointer" }}>
                ← Lobby
              </button>
            )}
          </div>
        </div>
      </header>
      <div style={{ height:"2px", background:C.gold }} />

      {/* ── BODY ── */}
      <main style={{ maxWidth:"820px", margin:"0 auto", padding:"0 20px" }}>

        {/* LOBBY */}
        {screen === "lobby" && (
          <div className="ca">
            <div style={{ padding:"44px 0 8px" }}>
              <h1 style={{ ...serif, fontWeight:700, fontSize:"clamp(32px,7vw,44px)",
                letterSpacing:"-0.01em", color:C.black, margin:0 }}>
                Test your edge.
              </h1>
              <div className="double-rule" aria-hidden="true" />
              <p style={{ fontSize:"15px", color:"rgba(20,18,16,0.68)", marginTop:"16px",
                maxWidth:"52ch", lineHeight:1.6, ...sans }}>
                Seven daily intelligence challenges for people who work in and around the AI data
                center economy. Free to play. Two minutes.
              </p>
            </div>

            {/* Game tiles — neon pictograms on forest tiles, white card on cream */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(330px,1fr))",
              gap:"14px", padding:"28px 0 8px" }}>
              {GAME_CONFIGS.map(config => (
                <GameTile key={config.type} config={config}
                  onPlay={() => startGame(config.type)} />
              ))}
            </div>

            {/* Subscriber stat line — real Supabase results only (no mock
                engagement stats): play streak, MW balance, and today's
                completion count come from get-subscriber-state / complete-puzzle. */}
            {email && (
              <div style={{ marginTop:"18px", ...mono, fontSize:"11px", color:C.forest }}>
                Signed in as {email} · {streak}-day streak · {mwBalance} MW banked
                · {Object.keys(todayCompletions).length}/7 puzzles today
              </div>
            )}

            {/* Team leaderboard — real per-player MW, wired via DB trigger */}
            <TeamLeaderboard
              leaderboard={leaderboard}
              myTeam={myTeam}
              signedIn={!!email}
              busy={teamBusy}
              error={teamError}
              onCreate={(name) => teamAction("create", { name })}
              onJoin={(code) => teamAction("join", { code })}
              onLeave={() => teamAction("leave", {})}
            />

            {/* Tip of the day — Faraday's Take treatment */}
            <div style={{ background:C.forest, borderRadius:"10px", borderTop:`3px solid ${C.gold}`,
              padding:"26px 28px", color:C.cream, margin:"28px 0 56px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap:"10px",
                flexWrap:"wrap", ...mono, fontSize:"10.5px", letterSpacing:"0.16em" }}>
                <span style={{ color:C.cream }}>FARADAY TIP OF THE DAY</span>
                <span style={{ color:C.goldLight, border:"1px solid rgba(196,146,42,.45)",
                  borderRadius:"4px", padding:"2px 9px" }}>
                  {(tipOfTheDay?.domain || "POWER ARCHITECTURE").toUpperCase()}
                </span>
              </div>
              <blockquote style={{ ...serif, fontStyle:"italic", fontSize:"17px", lineHeight:1.65,
                marginTop:"14px", color:C.cream }}>
                {tipOfTheDay?.body ||
                  `"The 800V DC transition isn't a technology decision — it's a real estate decision. Legacy AC facilities can't retrofit fast enough to host Blackwell-class density. The hardware roadmap and the facility obsolescence schedule are the same document."`}
              </blockquote>
            </div>
          </div>
        )}

        {/* GAME */}
        {screen === "game" && activeGame && (() => {
          const GameComponent = GAME_COMPONENTS[activeGame];
          // Prefer the live puzzle from Airtable; fall back to mock per-game.
          const puzzle = livePuzzles[activeGame] || PUZZLE_DATA[activeGame];
          const config = GAME_CONFIGS.find(c=>c.type===activeGame);
          if (!GameComponent || !puzzle) return <div style={{ color:C.red }}>Puzzle not found</div>;
          return (
            <div className="ca" style={{ paddingTop:"28px" }}>
              {/* Game header */}
              <div style={{ marginBottom:"20px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"6px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
                    <GameIcon game={activeGame} size={32} />
                    <span style={{ fontSize:"16px", fontWeight:700, color:C.white, ...serif }}>{activeGame}</span>
                  </div>
                  <div style={{ display:"flex", gap:"8px" }}>
                    <span style={{ fontSize:"9px", color:C.muted, background:"rgba(255,255,255,0.04)",
                      border:`1px solid ${C.border}`, padding:"3px 8px", borderRadius:"3px", ...mono }}>
                      {puzzle.domain}
                    </span>
                    <span style={{ fontSize:"9px", color:C.muted, ...mono }}>{config.time}</span>
                  </div>
                </div>
                <div style={{ fontSize:"11px", color:C.muted, ...mono }}>{puzzle.name}</div>
              </div>
              <GameComponent puzzle={puzzle} streak={streak} onComplete={onGameComplete} />
            </div>
          );
        })()}

        {/* SOCIAL GATE */}
        {screen === "gate" && (
          <div className="ca" style={{ maxWidth:"420px", margin:"0 auto", paddingTop:"40px" }}>
            <div style={{ background:C.forestMid, border:"1px solid rgba(248,245,240,.12)",
              borderRadius:"12px", padding:"28px" }}>
              <SocialGate trigger={gateReason} onRegister={onRegister} onDismiss={onGateDismiss} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
