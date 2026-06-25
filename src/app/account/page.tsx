"use client";

// /account — Account & Settings. Dark theme matching the rest of the app.
// Team section: join by code, create new, leave. Soft opt-out via Game Status.

import { useCallback, useEffect, useState } from "react";
import SocialGate from "@/components/SocialGate";
import {
  EDGE_FUNCTIONS_BASE,
  SESSION_STORAGE_KEY,
  HANDLE_STORAGE_KEY,
  OPTED_OUT_STORAGE_KEY,
} from "@/lib/supabase";

const C = {
  forest:  "#1C3424",
  gold:    "#C4922A",
  cream:   "#EEE6DA",
  white:   "#F8F5F0",
  sage:    "#8CA68A",
  black:   "#141210",
  bg:      "#0D110E",
  surface: "rgba(255,255,255,0.03)",
  border:  "rgba(255,255,255,0.07)",
  green:   "#4ADE80",
  amber:   "#F59E0B",
  red:     "#F87171",
  text:    "#E8E4DE",
  muted:   "#9A938C",
  dim:     "#2A2520",
};
const mono = { fontFamily: "'IBM Plex Mono',monospace" } as const;
const sans = { fontFamily: "'Bricolage Grotesque',sans-serif" } as const;

// SL = section label — IBM Plex Mono 10px, #9A938C, 0.14em tracking, uppercase
const slLabel: React.CSSProperties = {
  ...mono,
  fontSize: "10px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: C.muted,
  marginBottom: "14px",
};

const darkCard: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: "12px",
  padding: "20px 24px",
  marginTop: "12px",
};

const darkInput: React.CSSProperties = {
  ...mono,
  fontSize: "13px",
  color: C.text,
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${C.border}`,
  borderRadius: "6px",
  padding: "9px 12px",
  flex: "1 1 160px",
  minWidth: "120px",
  outline: "none",
};

function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  small,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  small?: boolean;
}) {
  const base: React.CSSProperties = {
    ...mono,
    borderRadius: "6px",
    padding: small ? "6px 14px" : "9px 18px",
    fontSize: small ? "11px" : "12px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    letterSpacing: "0.08em",
    transition: "all 0.15s",
    whiteSpace: "nowrap",
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: "rgba(196,146,42,0.12)", border: `1px solid rgba(196,146,42,0.4)`, color: C.gold },
    ghost:   { background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, color: C.muted },
    danger:  { background: "rgba(248,113,113,0.1)", border: `1px solid rgba(248,113,113,0.3)`, color: C.red },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>
      {children}
    </button>
  );
}

interface Account { email: string; handle: string | null; active: boolean; }
interface SubState {
  playStreak: number;
  mwBalance: number;
  tier: string;
  joined_at: string | null;
  todayCompletions?: Record<string, { score: number; completedAt: string }>;
}
interface Group { team_id?: string; name?: string; code?: string; group_type?: string; }

export default function AccountPage() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [acct, setAcct] = useState<Account | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [subState, setSubState] = useState<SubState | null>(null);

  // Handle editing
  const [editingHandle, setEditingHandle] = useState(false);
  const [newHandle, setNewHandle] = useState("");
  const [handleWarningShown, setHandleWarningShown] = useState(false);

  // Team section
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<"company" | "team">("company");
  const [createError, setCreateError] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  useEffect(() => {
    let t: string | null = null;
    try { t = localStorage.getItem(SESSION_STORAGE_KEY); } catch { /* storage disabled */ }
    setToken(t);
    setReady(true);
  }, []);

  const loadAccount = useCallback((t: string) => {
    fetch(`/api/account?token=${encodeURIComponent(t)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) {
          setAcct(d);
          try {
            if (d.handle) localStorage.setItem(HANDLE_STORAGE_KEY, d.handle);
            if (d.active === false) localStorage.setItem(OPTED_OUT_STORAGE_KEY, "1");
            else localStorage.removeItem(OPTED_OUT_STORAGE_KEY);
          } catch { /* ignore */ }
        } else {
          setErr(d?.error || "Could not load your account.");
        }
      })
      .catch(() => setErr("Network error loading your account."));
  }, []);

  const loadSubState = useCallback((t: string) => {
    fetch(`/api/subscriber-state?token=${encodeURIComponent(t)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setSubState({
          playStreak: d.playStreak ?? 0,
          mwBalance: d.mwBalance ?? 0,
          tier: d.tier ?? "free",
          joined_at: d.joined_at ?? null,
          todayCompletions: d.todayCompletions ?? {},
        });
      })
      .catch(() => {});
  }, []);

  const loadGroups = useCallback((t: string) => {
    fetch(`${EDGE_FUNCTIONS_BASE}/get-team-leaderboard?token=${encodeURIComponent(t)}&limit=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        if (Array.isArray(d.myTeams)) setGroups(d.myTeams);
        else if (d.myTeam) setGroups([d.myTeam]);
      })
      .catch(() => { /* non-critical */ });
  }, []);

  useEffect(() => {
    if (!token) return;
    loadAccount(token);
    loadGroups(token);
    loadSubState(token);
  }, [token, loadAccount, loadGroups, loadSubState]);

  function signOut() {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(HANDLE_STORAGE_KEY);
      localStorage.removeItem(OPTED_OUT_STORAGE_KEY);
    } catch { /* ignore */ }
    window.location.href = "/challenge";
  }

  function doJoin() {
    if (!token || !joinCode.trim()) return;
    setJoinBusy(true);
    setJoinError("");
    fetch(`${EDGE_FUNCTIONS_BASE}/team-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token, action: "join", code: joinCode.trim() }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setJoinError(d?.error || "Invalid code — try again."); return; }
        if (Array.isArray(d.myTeams)) setGroups(d.myTeams);
        else loadGroups(token);
        setJoinCode("");
      })
      .catch(() => setJoinError("Network error — try again."))
      .finally(() => setJoinBusy(false));
  }

  function doCreate() {
    if (!token || !createName.trim()) return;
    const nameSnapshot = createName.trim();
    setCreateBusy(true);
    setCreateError("");
    setCreatedCode(null);
    fetch(`${EDGE_FUNCTIONS_BASE}/team-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token, action: "create", name: nameSnapshot, groupType: createType }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setCreateError(d?.error || "Could not create team."); return; }
        const myTeams: Group[] = Array.isArray(d.myTeams) ? d.myTeams : [];
        setGroups(myTeams);
        const newTeam = myTeams.find((g) => g.name === nameSnapshot);
        if (newTeam?.code) setCreatedCode(newTeam.code);
        setCreateName("");
        setShowCreate(false);
      })
      .catch(() => setCreateError("Network error — try again."))
      .finally(() => setCreateBusy(false));
  }

  function doLeave(code: string) {
    if (!token) return;
    fetch(`${EDGE_FUNCTIONS_BASE}/team-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token, action: "leave", code }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setErr(d?.error || "Could not leave team."); return; }
        if (Array.isArray(d.myTeams)) setGroups(d.myTeams);
        else loadGroups(token);
        if (createdCode) setCreatedCode(null);
      })
      .catch(() => setErr("Network error — try again."));
  }

  function updateHandle() {
    if (!token) return;
    const clean = newHandle.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(clean)) { setErr("Handle must be 3–24 characters, letters, numbers, and _ only."); return; }
    setBusy(true); setErr(""); setMsg("");
    fetch(`/api/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: "update-handle", newHandle: clean }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setErr(d?.error || "Could not update handle."); return; }
        try { if (d.handle) localStorage.setItem("dc_handle", d.handle); } catch { /* ignore */ }
        setAcct((a) => (a ? { ...a, handle: d.handle } : a));
        setEditingHandle(false);
        setNewHandle("");
        setHandleWarningShown(false);
        setMsg("Handle updated. Your leaderboard standings are linked to your new handle.");
      })
      .catch(() => setErr("Network error — try again."))
      .finally(() => setBusy(false));
  }

  function setOptOut(leave: boolean) {
    if (!token) return;
    setBusy(true); setErr(""); setMsg("");
    fetch(`/api/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: leave ? "leave" : "rejoin" }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setErr(d?.error || "Could not update."); return; }
        try {
          if (leave) localStorage.setItem(OPTED_OUT_STORAGE_KEY, "1");
          else localStorage.removeItem(OPTED_OUT_STORAGE_KEY);
        } catch { /* ignore */ }
        setAcct((a) => (a ? { ...a, active: !leave } : a));
        setConfirmLeave(false);
        setMsg(leave ? "You've left the game. Your data is kept — rejoin anytime." : "Welcome back — you're active again.");
      })
      .catch(() => setErr("Network error — try again."))
      .finally(() => setBusy(false));
  }

  const page: React.CSSProperties = { minHeight: "100vh", background: C.bg, color: C.text, ...sans };

  if (!ready) {
    return (
      <div style={page}>
        <style>{`@keyframes accountPulse{0%,100%{opacity:.25}50%{opacity:.5}}`}</style>
        <Shell>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ ...darkCard, height: "72px", animation: "accountPulse 1.6s ease-in-out infinite" }} />
          ))}
        </Shell>
      </div>
    );
  }

  if (!token) {
    return (
      <div style={page}>
        <Shell>
          <h1 style={{ ...sans, fontSize: "28px", fontWeight: 700, color: C.text, margin: "0 0 8px" }}>
            Account &amp; settings
          </h1>
          <p style={{ fontSize: "14px", color: C.muted, marginBottom: "24px" }}>
            Sign in to manage your handle, team, and game status.
          </p>
          <SocialGate trigger="account" heading="Sign in" subhead="One email, no password — we send a magic link." />
          <p style={{ marginTop: "24px" }}>
            <a href="/challenge" style={{ ...mono, fontSize: "13px", color: C.gold }}>← Back to the challenge</a>
          </p>
        </Shell>
      </div>
    );
  }

  const optedOut = acct ? !acct.active : false;
  const recentGames = subState?.todayCompletions ? Object.entries(subState.todayCompletions) : [];

  return (
    <div style={page}>
      <Shell>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <h1 style={{ ...sans, fontSize: "26px", fontWeight: 700, color: C.text, margin: 0 }}>
            Account &amp; settings
          </h1>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <a href="/challenge" style={{ ...mono, fontSize: "12px", color: C.muted, textDecoration: "none" }}>← challenge</a>
            <Btn variant="ghost" small onClick={signOut}>Sign out</Btn>
          </div>
        </div>

        {/* Global feedback */}
        {msg && (
          <div style={{ ...mono, fontSize: "12px", color: C.green, background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: "8px", padding: "10px 14px", marginTop: "16px" }}>
            {msg}
          </div>
        )}
        {err && (
          <div style={{ ...mono, fontSize: "12px", color: C.red, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "8px", padding: "10px 14px", marginTop: "16px" }}>
            {err}
          </div>
        )}

        {/* ── HANDLE ───────────────────────────────────────────────────────── */}
        <section style={darkCard}>
          <div style={slLabel}>Handle</div>
          {!editingHandle ? (
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <span style={{ ...sans, fontSize: "22px", fontWeight: 700, color: C.text }}>
                @{acct?.handle || (acct?.email ? acct.email.split("@")[0] : "you")}
              </span>
              <Btn variant="ghost" small disabled={busy} onClick={() => { setEditingHandle(true); setNewHandle(acct?.handle || ""); setErr(""); setMsg(""); }}>
                Edit
              </Btn>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {!handleWarningShown ? (
                <div style={{ ...mono, fontSize: "12px", color: C.amber, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "6px", padding: "10px 14px" }}>
                  Changing your handle may affect your standings history. Continue?{" "}
                  <button onClick={() => setHandleWarningShown(true)} style={{ ...mono, background: "none", border: "none", color: C.gold, cursor: "pointer", fontSize: "12px", padding: 0, textDecoration: "underline" }}>Yes</button>
                  {" · "}
                  <button onClick={() => { setEditingHandle(false); setNewHandle(""); }} style={{ ...mono, background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: "12px", padding: 0 }}>Cancel</button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <input
                      value={newHandle}
                      onChange={(e) => setNewHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                      placeholder="new_handle"
                      maxLength={24}
                      style={darkInput}
                      onKeyDown={(e) => e.key === "Enter" && !busy && updateHandle()}
                    />
                    <Btn disabled={busy || newHandle.length < 3} onClick={updateHandle}>{busy ? "Saving…" : "Save"}</Btn>
                    <Btn variant="ghost" disabled={busy} onClick={() => { setEditingHandle(false); setNewHandle(""); setHandleWarningShown(false); }}>Cancel</Btn>
                  </div>
                  <div style={{ ...mono, fontSize: "11px", color: C.muted }}>3–24 characters, letters, numbers, _ only.</div>
                </>
              )}
            </div>
          )}
          {acct?.email && (
            <div style={{ ...mono, fontSize: "12px", color: C.muted, marginTop: "10px" }}>{acct.email}</div>
          )}
        </section>

        {/* ── STREAK ───────────────────────────────────────────────────────── */}
        <section style={darkCard}>
          <div style={slLabel}>Streak</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
            <span style={{ ...sans, fontSize: "28px", fontWeight: 700, color: C.text }}>{subState?.playStreak ?? "—"}</span>
            <span style={{ ...mono, fontSize: "13px", color: C.muted }}>days</span>
          </div>
        </section>

        {/* ── MW BALANCE ───────────────────────────────────────────────────── */}
        <section style={darkCard}>
          <div style={slLabel}>MW Balance</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
            <span style={{ ...sans, fontSize: "28px", fontWeight: 700, color: C.gold }}>{subState?.mwBalance ?? "—"}</span>
            <span style={{ ...mono, fontSize: "13px", color: C.muted }}>MW</span>
          </div>
        </section>

        {/* ── SUBSCRIPTION ─────────────────────────────────────────────────── */}
        <section style={darkCard}>
          <div style={slLabel}>Subscription</div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <span style={{ ...sans, fontSize: "18px", fontWeight: 600, color: C.text, textTransform: "capitalize" }}>
              {subState?.tier ?? "free"}
            </span>
            {subState?.joined_at && (
              <span style={{ ...mono, fontSize: "11px", color: C.muted }}>
                member since {new Date(subState.joined_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </span>
            )}
          </div>
        </section>

        {/* ── TEAM ─────────────────────────────────────────────────────────── */}
        <section style={darkCard}>
          <div style={slLabel}>Team</div>

          {/* Current memberships */}
          {groups.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
              {groups.map((g, i) => (
                <div key={g.code || g.team_id || i} style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: "8px", padding: "10px 14px" }}>
                  <span style={{ ...sans, fontSize: "14px", fontWeight: 600, color: C.text }}>{g.name}</span>
                  {g.group_type && (
                    <span style={{ ...mono, fontSize: "10px", color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>{g.group_type}</span>
                  )}
                  {g.code && <span style={{ ...mono, fontSize: "11px", color: C.muted }}>· {g.code}</span>}
                  <button
                    disabled={!g.code}
                    onClick={() => g.code && doLeave(g.code)}
                    style={{ ...mono, marginLeft: "auto", background: "none", border: "none", color: C.red, cursor: g.code ? "pointer" : "not-allowed", fontSize: "12px", opacity: g.code ? 1 : 0.4 }}
                  >
                    Leave
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Newly created code chip */}
          {createdCode && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(196,146,42,0.08)", border: `1px solid rgba(196,146,42,0.3)`, borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", flexWrap: "wrap" }}>
              <span style={{ ...mono, fontSize: "11px", color: C.muted }}>Team code:</span>
              <span style={{ ...mono, fontSize: "14px", fontWeight: 700, color: C.gold, letterSpacing: "0.08em" }}>{createdCode}</span>
              <button
                onClick={() => navigator.clipboard.writeText(createdCode)}
                style={{ ...mono, background: "rgba(196,146,42,0.12)", border: `1px solid rgba(196,146,42,0.3)`, color: C.gold, borderRadius: "4px", padding: "3px 10px", fontSize: "11px", cursor: "pointer" }}
              >
                Copy
              </button>
              <span style={{ ...mono, fontSize: "11px", color: C.muted }}>Share this code so others can join.</span>
            </div>
          )}

          {groups.length === 0 && !createdCode && (
            <p style={{ ...mono, fontSize: "12px", color: C.muted, marginBottom: "14px" }}>You&apos;re not in any team yet.</p>
          )}

          {/* Join by code */}
          <div style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Enter team code"
                style={darkInput}
                onKeyDown={(e) => e.key === "Enter" && joinCode.trim() && doJoin()}
              />
              <Btn disabled={joinBusy || !joinCode.trim()} onClick={doJoin}>
                {joinBusy ? "Joining…" : "Join"}
              </Btn>
            </div>
            {joinError && <div style={{ ...mono, fontSize: "11px", color: C.red, marginTop: "6px" }}>{joinError}</div>}
          </div>

          {/* Create (collapsible) */}
          {!showCreate ? (
            <button
              onClick={() => setShowCreate(true)}
              style={{ ...mono, background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: "12px", padding: 0, textDecoration: "underline" }}
            >
              Create a new team
            </button>
          ) : (
            <div style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${C.border}`, borderRadius: "8px", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ ...mono, fontSize: "10px", color: C.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>Create team</div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Team name"
                  style={darkInput}
                  onKeyDown={(e) => e.key === "Enter" && !createBusy && createName.trim() && doCreate()}
                />
                <select
                  value={createType}
                  onChange={(e) => setCreateType(e.target.value as "company" | "team")}
                  style={{ ...darkInput, flex: "0 0 auto", minWidth: "100px" }}
                >
                  <option value="company">Company</option>
                  <option value="team">Team</option>
                </select>
                <Btn disabled={createBusy || !createName.trim()} onClick={doCreate}>{createBusy ? "Creating…" : "Create"}</Btn>
                <Btn variant="ghost" onClick={() => { setShowCreate(false); setCreateName(""); setCreateError(""); }}>Cancel</Btn>
              </div>
              {createError && <div style={{ ...mono, fontSize: "11px", color: C.red }}>{createError}</div>}
            </div>
          )}
        </section>

        {/* ── RECENT GAMES ─────────────────────────────────────────────────── */}
        {recentGames.length > 0 && (
          <section style={darkCard}>
            <div style={slLabel}>Recent Games</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {recentGames.map(([type, data], i) => (
                <div key={type} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: i < recentGames.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  <span style={{ ...mono, fontSize: "12px", color: C.text, textTransform: "capitalize" }}>{type.replace(/_/g, " ")}</span>
                  <span style={{ ...mono, fontSize: "13px", fontWeight: 700, color: C.gold }}>{data.score} MW</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── GAME STATUS (soft opt-out) ────────────────────────────────────── */}
        <section style={{ ...darkCard, borderColor: optedOut ? C.border : "rgba(248,113,113,0.15)", marginTop: "24px" }}>
          <div style={slLabel}>Game status</div>
          {optedOut ? (
            <>
              <p style={{ fontSize: "14px", color: C.text, margin: "0 0 8px" }}>You&apos;ve left the game.</p>
              <p style={{ ...mono, fontSize: "12px", color: C.muted, marginBottom: "16px" }}>Your streak, MW, and history are all kept. Rejoin whenever you&apos;re ready.</p>
              <Btn disabled={busy} onClick={() => setOptOut(false)}>Rejoin the game</Btn>
            </>
          ) : !confirmLeave ? (
            <>
              <p style={{ ...mono, fontSize: "12px", color: C.muted, margin: "0 0 16px" }}>
                Leaving stops streak accrual and hides you from leaderboards.{" "}
                <strong style={{ color: C.text }}>Nothing is deleted.</strong>
              </p>
              <Btn variant="danger" disabled={busy} onClick={() => setConfirmLeave(true)}>Leave the game</Btn>
            </>
          ) : (
            <>
              <p style={{ fontSize: "14px", color: C.text, margin: "0 0 16px" }}>Leave the game? Your data is retained and you can rejoin anytime.</p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <Btn variant="danger" disabled={busy} onClick={() => setOptOut(true)}>Yes, leave the game</Btn>
                <Btn variant="ghost" disabled={busy} onClick={() => setConfirmLeave(false)}>Cancel</Btn>
              </div>
            </>
          )}
        </section>

      </Shell>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div style={{ height: "2px", background: C.gold }} />
      <main style={{ maxWidth: "640px", margin: "0 auto", padding: "40px 20px 80px" }}>{children}</main>
    </>
  );
}
