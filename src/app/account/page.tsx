"use client";

// /account — Account & Settings.
// Light cream theme matching the Leaderboard. OTPGate embedded for auth.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import OTPGate from "@/components/OTPGate";
import BrandMark from "@/components/BrandMark";
import {
  SESSION_STORAGE_KEY,
  HANDLE_STORAGE_KEY,
  OPTED_OUT_STORAGE_KEY,
} from "@/lib/supabase";

// Dark C tokens forwarded to OTPGate (which renders on a forest card)
const GATE_C = {
  bg:      "#0D110E",
  surface: "rgba(255,255,255,0.05)",
  border:  "rgba(255,255,255,0.12)",
  inputBg: "rgba(255,255,255,0.08)",
  text:    "#E8E4DE",
  muted:   "#9A938C",
  gold:    "#C4922A",
  red:     "#F87171",
  green:   "#4ADE80",
  amber:   "#F59E0B",
};
const mono = { fontFamily: "'IBM Plex Mono',monospace" } as const;
const sans = { fontFamily: "'Bricolage Grotesque',sans-serif" } as const;

// Btn for OTPGate — dark-theme gold primary, transparent ghost
function GateBtn({
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
    width: variant === "primary" ? "100%" : undefined,
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: "rgba(196,146,42,0.18)", border: "1px solid rgba(196,146,42,0.5)", color: "#C4922A" },
    ghost:   { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#9A938C" },
    danger:  { background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "#F87171" },
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

  const today = new Date().toISOString().slice(0, 10);
  const inFreeAgency = season?.free_agency_start != null && today >= season.free_agency_start;
  const isLocked = season?.locked_at != null && new Date() > new Date(season.locked_at);
  // Allow initial setup (no teams yet) any time; gate changes to Free Agency only
  const canEditTeams = !!token && !isLocked && (inFreeAgency || myTeams.length === 0);

  // Load available teams when editing is open
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
      next = [...myTeams, { team_id: teamId, team_name: teamName, pending: inFreeAgency }];
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

  // ── Loading skeleton ──────────────────────────────────────────────────────────
  if (!ready) {
    return (
      <div className="min-h-screen bg-warm-white">
        <div className="h-0.5 bg-gold" />
        <header className="bg-forest">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-3">
            <BrandMark size={20} framed />
            <span className="font-serif text-[15px] font-bold tracking-wide text-warm-white">Faraday</span>
          </div>
        </header>
        <div className="h-0.5 bg-gold" />
        <main className="mx-auto max-w-2xl px-5 pb-16 pt-8 animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-warm-cream" />
          ))}
        </main>
      </div>
    );
  }

  // ── Unauthenticated — show OTPGate on dark card ───────────────────────────────
  if (!token) {
    return (
      <div className="min-h-screen bg-warm-white font-sans text-near-black">
        <div className="h-0.5 bg-gold" />
        <header className="bg-forest">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-3">
            <Link href="/challenge" className="flex items-center gap-3" aria-label="Daily Challenge">
              <BrandMark size={20} framed />
              <span className="font-serif text-[15px] font-bold tracking-wide text-warm-white">Faraday</span>
            </Link>
            <Link href="/challenge" className="ml-auto font-mono text-[11px] text-warm-cream hover:text-gold-light">
              ← Daily Challenge
            </Link>
          </div>
        </header>
        <div className="h-0.5 bg-gold" />
        <main className="mx-auto max-w-2xl px-5 pb-16 pt-10">
          <h1 className="font-serif text-3xl font-bold text-forest">Account &amp; settings</h1>
          <p className="mb-8 mt-1 text-sm text-near-black/60">
            Sign in to manage your handle, teams, and game status.
          </p>
          <div className="rounded-lg bg-forest p-7">
            <OTPGate
              trigger="account"
              C={GATE_C}
              sans={sans}
              mono={mono}
              Btn={GateBtn}
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
        </main>
      </div>
    );
  }

  // ── Authenticated ─────────────────────────────────────────────────────────────
  const optedOut = acct ? !acct.active : false;
  const recentGames = subState?.todayCompletions ? Object.entries(subState.todayCompletions) : [];

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <div className="h-0.5 bg-gold" />
      <header className="bg-forest">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-3">
          <Link href="/challenge" className="flex items-center gap-3" aria-label="Daily Challenge">
            <BrandMark size={20} framed />
            <span className="font-serif text-[15px] font-bold tracking-wide text-warm-white">Faraday</span>
          </Link>
          <Link href="/challenge" className="ml-auto font-mono text-[11px] text-warm-cream hover:text-gold-light">
            ← Daily Challenge
          </Link>
          <button
            onClick={signOut}
            className="font-mono text-[11px] text-warm-cream/70 hover:text-warm-cream"
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="h-0.5 bg-gold" />

      <main className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <h1 className="font-serif text-3xl font-bold text-forest">Account &amp; settings</h1>

        {/* Global feedback */}
        {msg && (
          <div className="mt-4 rounded-lg border border-green-700/30 bg-green-50 px-4 py-3 font-mono text-[12px] text-green-800">
            {msg}
          </div>
        )}
        {err && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-700">
            {err}
          </div>
        )}

        {/* ── HANDLE ─────────────────────────────────────────────────────── */}
        <Card>
          <SL>Handle</SL>
          {!editingHandle ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-serif text-2xl font-bold text-forest">
                @{acct?.handle || (acct?.email ? acct.email.split("@")[0] : "you")}
              </span>
              <LightBtn small onClick={() => { setEditingHandle(true); setNewHandle(acct?.handle || ""); setErr(""); setMsg(""); }}>
                Edit
              </LightBtn>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {!handleWarningShown ? (
                <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 font-mono text-[12px] text-amber-800">
                  Changing your handle may affect your standings history. Continue?{" "}
                  <button onClick={() => setHandleWarningShown(true)} className="underline font-semibold">Yes</button>
                  {" · "}
                  <button onClick={() => { setEditingHandle(false); setNewHandle(""); }} className="text-near-black/60">Cancel</button>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={newHandle}
                      onChange={(e) => setNewHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                      placeholder="new_handle"
                      maxLength={24}
                      className="flex-1 rounded border border-forest/20 bg-white px-3 py-2 font-mono text-[13px] text-forest outline-none focus:border-gold"
                      onKeyDown={(e) => e.key === "Enter" && !busy && updateHandle()}
                    />
                    <LightBtn disabled={busy || newHandle.length < 3} onClick={updateHandle}>{busy ? "Saving…" : "Save"}</LightBtn>
                    <LightBtn variant="ghost" disabled={busy} onClick={() => { setEditingHandle(false); setNewHandle(""); setHandleWarningShown(false); }}>Cancel</LightBtn>
                  </div>
                  <p className="font-mono text-[11px] text-near-black/50">3–24 characters · letters, numbers, underscore</p>
                </>
              )}
            </div>
          )}
          {acct?.email && (
            <p className="mt-2 font-mono text-[12px] text-near-black/50">{acct.email}</p>
          )}
        </Card>

        {/* ── STREAK ─────────────────────────────────────────────────────── */}
        <Card>
          <SL>Streak</SL>
          <div className="flex items-baseline gap-1.5">
            <span className="font-serif text-3xl font-bold text-forest">{subState?.playStreak ?? "—"}</span>
            <span className="font-mono text-[13px] text-near-black/50">days</span>
          </div>
        </Card>

        {/* ── TEAMS ──────────────────────────────────────────────────────── */}
        <Card>
          <SL>Teams</SL>

          {teamsLoading ? (
            <p className="font-mono text-[12px] text-near-black/40">Loading…</p>
          ) : myTeams.length > 0 ? (
            <div className={`flex flex-wrap gap-2${canEditTeams ? " mb-4" : ""}`}>
              {myTeams.map((t) => (
                <span
                  key={t.team_id}
                  className="flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px]"
                  style={{
                    border: `1px solid ${t.pending ? "rgba(196,146,42,0.5)" : "rgba(28,52,36,0.25)"}`,
                    background: t.pending ? "rgba(196,146,42,0.06)" : "rgba(28,52,36,0.04)",
                    color: t.pending ? "#C4922A" : "#1C3424",
                  }}
                >
                  {t.team_name}
                  {t.pending && <span className="text-[9px] opacity-70">pending</span>}
                  {canEditTeams && (
                    <button
                      onClick={() => toggleTeam(t.team_id, t.team_name)}
                      disabled={teamSaving}
                      className="opacity-50 hover:opacity-100 leading-none"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <p className={`font-mono text-[12px] text-near-black/50${canEditTeams ? " mb-4" : ""}`}>
              No teams yet.
            </p>
          )}

          {/* Team picker — open for new players or during Free Agency */}
          {canEditTeams && (
            <>
              <input
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                placeholder="Search teams…"
                className="w-full rounded border border-forest/20 bg-white px-3 py-2 font-mono text-[13px] text-forest outline-none focus:border-gold mb-3"
              />
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                {availableTeams
                  .filter((t) => !myTeams.some((m) => m.team_id === t.id))
                  .map((t) => (
                    <button
                      key={t.id}
                      onClick={() => toggleTeam(t.id, t.name)}
                      disabled={myTeams.length >= MAX_TEAMS || teamSaving}
                      className="rounded-full border border-forest/20 px-3 py-1 font-mono text-[11px] text-forest/70 hover:border-forest hover:text-forest disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t.name}
                    </button>
                  ))}
              </div>
              {teamError && <p className="mt-2 font-mono text-[11px] text-red-600">{teamError}</p>}
              <p className="mt-3 font-mono text-[10px] text-near-black/40">
                {inFreeAgency
                  ? `Free Agency — changes take effect next season. Select up to ${MAX_TEAMS}.`
                  : `First-time setup — your teams are effective immediately. Select up to ${MAX_TEAMS}.`}
              </p>
            </>
          )}

          {!canEditTeams && token && season && !inFreeAgency && myTeams.length > 0 && (
            <p className="mt-2 font-mono text-[11px] text-near-black/40">
              Team changes are locked until the Free Agency window (final 3 days of the season).
            </p>
          )}
        </Card>

        {/* ── RECENT GAMES ───────────────────────────────────────────────── */}
        {recentGames.length > 0 && (
          <Card>
            <SL>Recent Games</SL>
            <div className="divide-y divide-forest/8">
              {recentGames.map(([type, data]) => (
                <div key={type} className="flex items-center justify-between py-2">
                  <span className="font-mono text-[12px] capitalize text-near-black">{type.replace(/_/g, " ")}</span>
                  <span className="font-mono text-[13px] font-bold text-gold">{(data as { score: number }).score} pts</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── GAME STATUS ────────────────────────────────────────────────── */}
        <Card className={optedOut ? "" : "border-red-200"}>
          <SL>Game status</SL>
          {optedOut ? (
            <>
              <p className="mb-1 text-[14px] text-near-black">You&apos;ve left the game.</p>
              <p className="mb-4 font-mono text-[12px] text-near-black/50">Your streak and history are kept. Rejoin anytime.</p>
              <LightBtn disabled={busy} onClick={() => setOptOut(false)}>Rejoin the game</LightBtn>
            </>
          ) : !confirmLeave ? (
            <>
              <p className="mb-4 font-mono text-[12px] text-near-black/50">
                Leaving stops streak accrual and hides you from leaderboards. <strong className="text-near-black">Nothing is deleted.</strong>
              </p>
              <LightBtn variant="danger" disabled={busy} onClick={() => setConfirmLeave(true)}>Leave the game</LightBtn>
            </>
          ) : (
            <>
              <p className="mb-4 text-[14px] text-near-black">Leave the game? Your data is retained and you can rejoin anytime.</p>
              <div className="flex flex-wrap gap-2">
                <LightBtn variant="danger" disabled={busy} onClick={() => setOptOut(true)}>Yes, leave the game</LightBtn>
                <LightBtn variant="ghost" disabled={busy} onClick={() => setConfirmLeave(false)}>Cancel</LightBtn>
              </div>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`mt-4 rounded-lg border border-forest/10 bg-white px-5 py-5 ${className}`}>
      {children}
    </section>
  );
}

function SL({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-near-black/40">
      {children}
    </div>
  );
}

function LightBtn({
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
  const base = `font-mono rounded transition-colors cursor-pointer whitespace-nowrap ${small ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-[12px]"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`;
  const variants: Record<string, string> = {
    primary: "bg-gold/10 border border-gold/50 text-forest hover:bg-gold/20",
    ghost:   "bg-transparent border border-forest/20 text-near-black/60 hover:border-forest/40",
    danger:  "bg-red-50 border border-red-300 text-red-700 hover:bg-red-100",
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  );
}
