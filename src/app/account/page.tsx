"use client";

// /account — self-service account & settings for the Daily Challenge.
//  • Shows the canonical leaderboard handle (read-only — it's permanent).
//  • Team & company affiliation editing via the existing `team-action` edge
//    function (the Leaderboard V2 typed-group hierarchy: company → team).
//  • "Leave the game" = SOFT opt-out (sets dc_subscribers.active=false via
//    /api/account). No hard deletion. Reversible with "Rejoin".
//  • Unauthenticated visitors get the existing email-capture flow (SocialGate).

import { useCallback, useEffect, useState } from "react";
import SocialGate from "@/components/SocialGate";
import {
  EDGE_FUNCTIONS_BASE,
  SESSION_STORAGE_KEY,
  EMAIL_STORAGE_KEY,
  HANDLE_STORAGE_KEY,
  OPTED_OUT_STORAGE_KEY,
} from "@/lib/supabase";

const C = {
  forest: "#1C3424",
  gold: "#C4922A",
  goldLight: "#DAB050",
  cream: "#EEE6DA",
  white: "#F8F5F0",
  black: "#141210",
  deepAmber: "#94560A",
  red: "#B42318",
  border: "rgba(28,52,36,0.18)",
  muted: "rgba(20,18,16,0.62)",
};
const mono = { fontFamily: "'IBM Plex Mono',monospace" } as const;
const serif = { fontFamily: "'IBM Plex Serif',serif" } as const;
const sans = { fontFamily: "'Bricolage Grotesque',sans-serif" } as const;

interface Account {
  email: string;
  handle: string | null;
  active: boolean;
}
interface Group {
  team_id?: string;
  name?: string;
  code?: string;
  group_type?: string;
  mw_total?: number;
}

export default function AccountPage() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [acct, setAcct] = useState<Account | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Handle editing state
  const [editingHandle, setEditingHandle] = useState(false);
  const [newHandle, setNewHandle] = useState("");
  const [handleWarningShown, setHandleWarningShown] = useState(false);

  // Affiliation form state
  const [joinCode, setJoinCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"company" | "team">("company");
  const [parentCode, setParentCode] = useState("");

  useEffect(() => {
    let t: string | null = null;
    try {
      t = localStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      /* storage disabled */
    }
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
          } catch {
            /* ignore */
          }
        } else {
          setErr(d?.error || "Could not load your account.");
        }
      })
      .catch(() => setErr("Network error loading your account."));
  }, []);

  const loadGroups = useCallback((t: string) => {
    // Current membership comes back as `myTeam` from the team leaderboard.
    fetch(`${EDGE_FUNCTIONS_BASE}/get-team-leaderboard?token=${encodeURIComponent(t)}&limit=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.myTeam) setGroups([d.myTeam]);
      })
      .catch(() => {
        /* non-critical */
      });
  }, []);

  useEffect(() => {
    if (!token) return;
    loadAccount(token);
    loadGroups(token);
  }, [token, loadAccount, loadGroups]);

  function teamAction(action: "create" | "join" | "leave", payload: Record<string, unknown>) {
    if (!token) return;
    setBusy(true);
    setErr("");
    setMsg("");
    fetch(`${EDGE_FUNCTIONS_BASE}/team-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: token, action, ...payload }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          setErr(d?.error || "That didn't work — check the code and try again.");
          return;
        }
        if (Array.isArray(d.myTeams)) setGroups(d.myTeams);
        else loadGroups(token);
        setMsg("Affiliation updated.");
        setJoinCode("");
        setNewName("");
        setParentCode("");
      })
      .catch(() => setErr("Network error — try again."))
      .finally(() => setBusy(false));
  }

  function updateHandle() {
    if (!token) return;
    const clean = newHandle.trim().toLowerCase();
    if (!/^[a-z0-9]{3,20}$/.test(clean)) {
      setErr("Handle must be 3–20 characters, letters and numbers only.");
      return;
    }
    setBusy(true);
    setErr("");
    setMsg("");
    fetch(`/api/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: "update-handle", newHandle: clean }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          setErr(d?.error || "Could not update handle — try again.");
          return;
        }
        try {
          if (d.handle) localStorage.setItem("dc_handle", d.handle);
        } catch { /* ignore */ }
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
    setBusy(true);
    setErr("");
    setMsg("");
    fetch(`/api/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: leave ? "leave" : "rejoin" }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          setErr(d?.error || "Could not update — try again.");
          return;
        }
        try {
          if (leave) localStorage.setItem(OPTED_OUT_STORAGE_KEY, "1");
          else localStorage.removeItem(OPTED_OUT_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        setAcct((a) => (a ? { ...a, active: !leave } : a));
        setConfirmLeave(false);
        setMsg(
          leave
            ? "You've left the game. Your data is kept — rejoin anytime."
            : "Welcome back — you're active again."
        );
      })
      .catch(() => setErr("Network error — try again."))
      .finally(() => setBusy(false));
  }

  // ── Shared inline styles ──────────────────────────────────────────────────
  const page: React.CSSProperties = {
    minHeight: "100vh",
    background: C.cream,
    color: C.black,
    ...sans,
  };
  const card: React.CSSProperties = {
    background: C.white,
    border: `1px solid ${C.border}`,
    borderRadius: "12px",
    padding: "22px 24px",
    marginTop: "20px",
  };
  const label: React.CSSProperties = {
    ...mono,
    fontSize: "11px",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: C.deepAmber,
  };
  const input: React.CSSProperties = {
    ...mono,
    fontSize: "14px",
    color: C.black,
    background: C.cream,
    border: `1px solid ${C.border}`,
    borderRadius: "6px",
    padding: "9px 12px",
    flex: "1 1 160px",
    minWidth: "120px",
  };
  const btn = (variant: "primary" | "ghost" | "danger" = "primary"): React.CSSProperties => ({
    ...mono,
    fontSize: "13px",
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.6 : 1,
    borderRadius: "6px",
    padding: "9px 16px",
    whiteSpace: "nowrap",
    border:
      variant === "danger"
        ? `1px solid ${C.red}`
        : variant === "ghost"
        ? `1px solid ${C.border}`
        : `1px solid ${C.gold}`,
    background:
      variant === "danger"
        ? "rgba(180,35,24,0.06)"
        : variant === "ghost"
        ? "transparent"
        : "rgba(196,146,42,0.12)",
    color: variant === "danger" ? C.red : variant === "ghost" ? C.forest : C.deepAmber,
  });

  // ── Render ────────────────────────────────────────────────────────────────
  if (!ready) {
    return (
      <div style={page}>
        <Shell>
          <p style={{ ...mono, fontSize: "13px", color: C.muted }}>Loading…</p>
        </Shell>
      </div>
    );
  }

  if (!token) {
    return (
      <div style={page}>
        <Shell>
          <h1 style={{ ...serif, fontSize: "28px", fontWeight: 700, color: C.forest, margin: "0 0 8px" }}>
            Account &amp; settings
          </h1>
          <p style={{ fontSize: "14px", color: C.muted, marginBottom: "24px" }}>
            Sign in to manage your handle, team &amp; company, and game status.
          </p>
          <SocialGate trigger="account" heading="Sign in" subhead="One email, no password — we send a magic link." />
          <p style={{ marginTop: "24px" }}>
            <a href="/challenge" style={{ ...mono, fontSize: "13px", color: C.deepAmber }}>
              ← Back to the challenge
            </a>
          </p>
        </Shell>
      </div>
    );
  }

  const optedOut = acct ? !acct.active : false;

  return (
    <div style={page}>
      <Shell>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "10px" }}>
          <h1 style={{ ...serif, fontSize: "28px", fontWeight: 700, color: C.forest, margin: 0 }}>
            Account &amp; settings
          </h1>
          <a href="/challenge" style={{ ...mono, fontSize: "13px", color: C.deepAmber, textDecoration: "none" }}>
            ← Back to the challenge
          </a>
        </div>

        {msg && (
          <div style={{ ...mono, fontSize: "13px", color: C.forest, background: "rgba(28,52,36,0.06)", border: `1px solid ${C.border}`, borderRadius: "8px", padding: "10px 14px", marginTop: "16px" }}>
            {msg}
          </div>
        )}
        {err && (
          <div style={{ ...mono, fontSize: "13px", color: C.red, background: "rgba(180,35,24,0.06)", border: `1px solid ${C.red}`, borderRadius: "8px", padding: "10px 14px", marginTop: "16px" }}>
            {err}
          </div>
        )}

        {/* Identity */}
        <section style={card}>
          <div style={label}>Your identity</div>
          {!editingHandle ? (
            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ fontSize: "20px", fontWeight: 700, color: C.forest, ...sans }}>
                  @{acct?.handle || (acct?.email ? acct.email.split("@")[0] : "you")}
                </div>
                <button
                  disabled={busy}
                  onClick={() => { setEditingHandle(true); setNewHandle(acct?.handle || ""); setErr(""); setMsg(""); }}
                  style={{ ...btn("ghost"), fontSize: "11px", padding: "5px 10px" }}
                >
                  Edit handle
                </button>
              </div>
              <div style={{ ...mono, fontSize: "13px", color: C.muted }}>
                {acct?.email || ""}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {!handleWarningShown ? (
                <div style={{ ...mono, fontSize: "12px", color: "#94560A", background: "rgba(148,86,10,0.06)", border: "1px solid rgba(148,86,10,0.25)", borderRadius: "6px", padding: "10px 14px" }}>
                  Changing your handle may affect your standings history. Continue?{" "}
                  <button onClick={() => setHandleWarningShown(true)} style={{ ...btn("ghost"), fontSize: "11px", padding: "3px 8px", display: "inline" }}>Yes, continue</button>
                  {" "}
                  <button onClick={() => { setEditingHandle(false); setNewHandle(""); }} style={{ ...btn("ghost"), fontSize: "11px", padding: "3px 8px", display: "inline" }}>Cancel</button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <input
                      value={newHandle}
                      onChange={(e) => setNewHandle(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))}
                      placeholder="new-handle"
                      maxLength={20}
                      style={input}
                      onKeyDown={(e) => e.key === "Enter" && !busy && updateHandle()}
                    />
                    <button disabled={busy || newHandle.length < 3} onClick={updateHandle} style={btn()}>
                      {busy ? "Saving…" : "Save handle"}
                    </button>
                    <button disabled={busy} onClick={() => { setEditingHandle(false); setNewHandle(""); setHandleWarningShown(false); }} style={btn("ghost")}>
                      Cancel
                    </button>
                  </div>
                  <div style={{ ...mono, fontSize: "11px", color: C.muted }}>
                    3–20 characters, letters and numbers only.
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* Team & company */}
        <section style={card}>
          <div style={label}>Team &amp; company</div>
          <p style={{ fontSize: "13px", color: C.muted, margin: "10px 0 14px" }}>
            Companies and teams are shared groups. Join by code, or create one — a team
            sits under a company (enter the company&apos;s code as its parent).
          </p>

          {groups.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
              {groups.map((g, i) => (
                <div key={g.code || g.team_id || i} style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", background: C.cream, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "10px 12px" }}>
                  <span style={{ ...sans, fontSize: "14px", fontWeight: 600, color: C.forest }}>{g.name}</span>
                  {g.group_type && (
                    <span style={{ ...mono, fontSize: "11px", color: C.deepAmber, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      {g.group_type}
                    </span>
                  )}
                  {g.code && <span style={{ ...mono, fontSize: "12px", color: C.muted }}>code {g.code}</span>}
                  <button disabled={busy || !g.code} onClick={() => g.code && teamAction("leave", { code: g.code })} style={{ ...btn("ghost"), marginLeft: "auto" }}>
                    Leave
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ ...mono, fontSize: "13px", color: C.muted, marginBottom: "16px" }}>
              You&apos;re not in a team or company yet.
            </p>
          )}

          {/* Join by code */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Join with a group code" style={input}
              onKeyDown={(e) => e.key === "Enter" && joinCode.trim() && teamAction("join", { code: joinCode.trim() })} />
            <button disabled={busy || !joinCode.trim()} onClick={() => teamAction("join", { code: joinCode.trim() })} style={btn()}>
              Join
            </button>
          </div>

          {/* Create */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New group name" style={input} />
            <select value={newType} onChange={(e) => setNewType(e.target.value as "company" | "team")} style={{ ...input, flex: "0 0 auto", minWidth: "110px" }}>
              <option value="company">Company</option>
              <option value="team">Team</option>
            </select>
            {newType === "team" && (
              <input value={parentCode} onChange={(e) => setParentCode(e.target.value)} placeholder="Parent company code" style={input} />
            )}
            <button
              disabled={busy || !newName.trim() || (newType === "team" && !parentCode.trim())}
              onClick={() =>
                teamAction("create", {
                  name: newName.trim(),
                  groupType: newType,
                  ...(newType === "team" ? { parentCode: parentCode.trim() } : {}),
                })
              }
              style={btn()}
            >
              Create
            </button>
          </div>
        </section>

        {/* Game status — soft opt-out */}
        <section style={{ ...card, borderColor: optedOut ? C.border : "rgba(180,35,24,0.25)" }}>
          <div style={label}>Game status</div>
          {optedOut ? (
            <>
              <p style={{ fontSize: "14px", color: C.black, margin: "12px 0 4px" }}>
                You&apos;ve left the game.
              </p>
              <p style={{ fontSize: "13px", color: C.muted, marginBottom: "16px" }}>
                Your streak, MW, and history are all kept. Rejoin whenever you want to start
                accruing again.
              </p>
              <button disabled={busy} onClick={() => setOptOut(false)} style={btn()}>
                Rejoin the game
              </button>
            </>
          ) : !confirmLeave ? (
            <>
              <p style={{ fontSize: "13px", color: C.muted, margin: "12px 0 16px" }}>
                Leaving the game stops streak accrual and notifications and hides you from
                leaderboards. <strong>Nothing is deleted</strong> — you can rejoin anytime.
              </p>
              <button disabled={busy} onClick={() => setConfirmLeave(true)} style={btn("danger")}>
                Leave the game
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: "14px", color: C.black, margin: "12px 0 16px" }}>
                Leave the game? Your data is retained and you can rejoin anytime.
              </p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button disabled={busy} onClick={() => setOptOut(true)} style={btn("danger")}>
                  Yes, leave the game
                </button>
                <button disabled={busy} onClick={() => setConfirmLeave(false)} style={btn("ghost")}>
                  Cancel
                </button>
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
      <main style={{ maxWidth: "640px", margin: "0 auto", padding: "40px 20px 64px" }}>{children}</main>
    </>
  );
}
