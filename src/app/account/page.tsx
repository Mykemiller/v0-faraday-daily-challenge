"use client";

// /account — Account & Settings. Dark theme matching the rest of the app.
// Team section: view current teams; edit during Free Agency window via search picker.
// Auth: OTP (email + 6-digit code, no passwords).

import { useCallback, useEffect, useState } from "react";
import OTPGate from "@/components/OTPGate";
import {
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
  tier: string;
  joined_at: string | null;
  todayCompletions?: Record<string, { score: number; completedAt: string }>;
}
interface Team { team_id: string; team_name: string; pending?: boolean; }
interface AvailableTeam { id: string; name: string; }
interface Season {
  id: string;
  name: string;
  ends_on: string;
  free_agency_start: string | null;
  free_agency_notice_start: string | null;
  locked_at: string | null;
}

const MAX_TEAMS = 5;

export default function AccountPage() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [acct, setAcct] = useState<Account | null>(null);
  const [subState, setSubState] = useState<SubState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Handle editing
  const [editingHandle, setEditingHandle] = useState(false);
  const [newHandle, setNewHandle] = useState("");
  const [handleWarningShown, setHandleWarningShown] = useState(false);

  // Teams
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [availableTeams, setAvailableTeams] = useState<AvailableTeam[]>([]);
  const [teamSearch, setTeamSearch] = useState("");
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [season, setSeason] = useState<Season | null>(null);

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
          tier: d.tier ?? "free",
          joined_at: d.joined_at ?? null,
          todayCompletions: d.todayCompletions ?? {},
        });
      })
      .catch(() => {});
  }, []);

  const loadSeason = useCallback(() => {
    fetch("/api/season/active")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.season) setSeason(d.season); })
      .catch(() => {});
  }, []);

  const loadMyTeams = useCallback((t: string) => {
    setTeamsLoading(true);
    fetch(`/api/teams?scope=my&token=${encodeURIComponent(t)}`)
      .then((r) => r.ok ? r.json() : { teams: [] })
      .then((d) => setMyTeams(Array.isArray(d.teams) ? d.teams : []))
      .catch(() => {})
      .finally(() => setTeamsLoading(false));
  }, []);

  useEffect(() => {
    if (!token) return;
    loadAccount(token);
    loadSubState(token);
    loadSeason();
    loadMyTeams(token);
  }, [token, loadAccount, loadSubState, loadSeason, loadMyTeams]);

  // Load available teams for search (only during Free Agency)
  const today = new Date().toISOString().slice(0, 10);
  const inFreeAgency = season?.free_agency_start != null && today >= season.free_agency_start;
  const isLocked = season?.locked_at != null && new Date() > new Date(season.locked_at);
  const canEditTeams = token && inFreeAgency && !isLocked;

  useEffect(() => {
    if (!canEditTeams) return;
    fetch(`/api/teams${teamSearch ? `?q=${encodeURIComponent(teamSearch)}` : ""}`)
      .then((r) => r.ok ? r.json() : { teams: [] })
      .then((d) => setAvailableTeams(Array.isArray(d.teams) ? d.teams : []))
      .catch(() => {});
  }, [canEditTeams, teamSearch]);

  function signOut() {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(HANDLE_STORAGE_KEY);
      localStorage.removeItem(OPTED_OUT_STORAGE_KEY);
    } catch { /* ignore */ }
    window.location.href = "/challenge";
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
        try { if (d.handle) localStorage.setItem(HANDLE_STORAGE_KEY, d.handle); } catch { /* ignore */ }
        setAcct((a) => (a ? { ...a, handle: d.handle } : a));
        setEditingHandle(false);
        setNewHandle("");
        setHandleWarningShown(false);
        setMsg("Handle updated.");
      })
      .catch(() => setErr("Network error — try again."))
      .finally(() => setBusy(false));
  }

  async function toggleTeam(teamId: string, teamName: string) {
    if (!canEditTeams || !token) return;
    const alreadyIn = myTeams.some((t) => t.team_id === teamId);
    let next: Team[];
    if (alreadyIn) {
      next = myTeams.filter((t) => t.team_id !== teamId);
    } else {
      if (myTeams.length >= MAX_TEAMS) return;
      next = [...myTeams, { team_id: teamId, team_name: teamName, pending: true }];
    }
    setMyTeams(next);
    setTeamSaving(true); setTeamError("");
    try {
      const r = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, team_ids: next.map((t) => t.team_id), season_id: season?.id ?? null }),
      });
      const d = await r.json();
      if (!r.ok) { setTeamError(d?.error || "Could not update teams."); return; }
      if (Array.isArray(d.teams)) setMyTeams(d.teams);
    } catch { setTeamError("Network error — try again."); }
    finally { setTeamSaving(false); }
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
          <p style={{ fontSize: "14px", color: C.muted, marginBottom: "28px" }}>
            Sign in to manage your handle, teams, and game status.
          </p>
          <div style={darkCard}>
            <OTPGate
              trigger="account"
              C={C}
              sans={sans}
              mono={mono}
              Btn={Btn}
              onComplete={(newToken: string, subscriber: { email: string; handle?: string; id?: string }) => {
                try {
                  localStorage.setItem(SESSION_STORAGE_KEY, newToken);
                  if (subscriber.email) localStorage.setItem("dc_email", subscriber.email);
                  if (subscriber.handle) localStorage.setItem(HANDLE_STORAGE_KEY, subscriber.handle);
                  if (subscriber.id) localStorage.setItem("dc_subscriber_id", subscriber.id);
                } catch { /* ignore */ }
                setToken(newToken);
              }}
              onDismiss={() => { window.location.href = "/challenge"; }}
            />
          </div>
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

        {/* ── TEAMS ────────────────────────────────────────────────────────── */}
        <section style={darkCard}>
          <div style={slLabel}>Teams</div>

          {teamsLoading ? (
            <div style={{ ...mono, fontSize: "12px", color: C.muted }}>Loading…</div>
          ) : myTeams.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: canEditTeams ? "16px" : "0" }}>
              {myTeams.map((t) => (
                <span key={t.team_id} style={{
                  ...mono, fontSize: "12px", padding: "5px 12px", borderRadius: "20px",
                  border: `1px solid ${t.pending ? "rgba(196,146,42,0.5)" : "rgba(255,255,255,0.15)"}`,
                  background: t.pending ? "rgba(196,146,42,0.08)" : "rgba(255,255,255,0.05)",
                  color: t.pending ? C.gold : C.text,
                  display: "flex", alignItems: "center", gap: "6px",
                }}>
                  {t.team_name}
                  {t.pending && <span style={{ fontSize: "9px", opacity: 0.7 }}>pending</span>}
                  {canEditTeams && (
                    <button
                      onClick={() => toggleTeam(t.team_id, t.team_name)}
                      disabled={teamSaving}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, lineHeight: 1, fontSize: "14px", opacity: 0.6 }}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <p style={{ ...mono, fontSize: "12px", color: C.muted, marginBottom: canEditTeams ? "16px" : "0" }}>
              {canEditTeams ? "No teams selected yet." : "No teams."}
            </p>
          )}

          {/* Team picker — only during Free Agency */}
          {canEditTeams && (
            <>
              <input
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                placeholder="Search teams…"
                style={{ ...darkInput, flex: "1 1 100%", marginBottom: "10px" }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", maxHeight: "160px", overflowY: "auto" }}>
                {availableTeams
                  .filter((t) => !myTeams.some((m) => m.team_id === t.id))
                  .map((t) => (
                    <button key={t.id} onClick={() => toggleTeam(t.id, t.name)}
                      disabled={myTeams.length >= MAX_TEAMS || teamSaving}
                      style={{
                        ...mono, fontSize: "11px", padding: "5px 12px", borderRadius: "20px",
                        border: `1px solid ${C.border}`, background: "transparent", color: C.muted,
                        cursor: myTeams.length >= MAX_TEAMS ? "not-allowed" : "pointer",
                        opacity: myTeams.length >= MAX_TEAMS ? 0.5 : 1,
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
              </div>
              {teamError && <div style={{ ...mono, fontSize: "11px", color: C.red, marginTop: "8px" }}>{teamError}</div>}
              <div style={{ ...mono, fontSize: "10px", color: C.muted, marginTop: "10px" }}>
                Select up to {MAX_TEAMS} teams. Changes take effect at the start of the next season.
              </div>
            </>
          )}

          {!canEditTeams && token && season && !inFreeAgency && (
            <div style={{ ...mono, fontSize: "11px", color: C.muted, marginTop: "8px" }}>
              Team membership can be changed during the Free Agency window (final 3 days of each season).
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
                  <span style={{ ...mono, fontSize: "13px", fontWeight: 700, color: C.gold }}>{(data as { score: number }).score} pts</span>
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
              <p style={{ ...mono, fontSize: "12px", color: C.muted, marginBottom: "16px" }}>Your streak and history are all kept. Rejoin whenever you&apos;re ready.</p>
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
