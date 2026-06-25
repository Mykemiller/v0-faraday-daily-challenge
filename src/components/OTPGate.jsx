"use client";
// OTP-based authentication gate — replaces the old magic-link SocialGate.
// Steps for new subscribers: Email → OTP → Handle → Team selection → Done
// Steps for returning subscribers: Email → OTP → Done

import { useState, useEffect, useRef } from "react";
import { EDGE_FUNCTIONS_BASE } from "@/lib/supabase";

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const MAX_TEAMS = 5;

// Passed in from DailyChallenge so we inherit the same visual language
export default function OTPGate({ trigger, C, sans, mono, Btn, onComplete, onDismiss }) {
  const [step, setStep] = useState("email"); // email | otp | handle | teams | done
  const [email, setEmail] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [code, setCode] = useState("");
  const [handle, setHandle] = useState("");
  const [handleStatus, setHandleStatus] = useState("idle"); // idle | checking | ok | taken
  const [teams, setTeams] = useState([]); // available teams
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [teamSearch, setTeamSearch] = useState("");
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [migrateHandle, setMigrateHandle] = useState(""); // pre-fill from localStorage

  // Legacy migration: pre-fill handle from old localStorage if present
  useEffect(() => {
    try {
      const old = localStorage.getItem("dc_handle");
      if (old) setMigrateHandle(old);
    } catch {}
  }, []);

  // Load available teams + active season for team step
  async function loadTeams(q = "") {
    try {
      const r = await fetch(`/api/teams${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      const d = await r.json();
      setTeams(Array.isArray(d.teams) ? d.teams : []);
    } catch {}
  }

  async function loadSeason() {
    try {
      const r = await fetch("/api/season/active");
      const d = await r.json();
      setSeason(d.season ?? null);
    } catch {}
  }

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // Handle uniqueness check with debounce
  const handleCheckRef = useRef(null);
  useEffect(() => {
    if (step !== "handle") return;
    if (!HANDLE_RE.test(handle)) { setHandleStatus("idle"); return; }
    setHandleStatus("checking");
    clearTimeout(handleCheckRef.current);
    handleCheckRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/account?handle_check=${encodeURIComponent(handle)}`);
        const d = await r.json();
        setHandleStatus(d.available === false ? "taken" : "ok");
      } catch {
        setHandleStatus("idle");
      }
    }, 400);
  }, [handle, step]);

  async function sendOTP() {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) {
      setError("Enter a valid email address");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${EDGE_FUNCTIONS_BASE}/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalized }),
      });
      if (!r.ok) throw new Error("Couldn't send code — please try again");
      setVerifiedEmail(normalized);
      setCode("");
      setStep("otp");
      setResendCooldown(60);
    } catch (err) {
      setError(err.message || "Something went wrong — please try again");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOTP() {
    if (code.length !== 6) { setError("Enter the 6-digit code from your email"); return; }
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${EDGE_FUNCTIONS_BASE}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verifiedEmail, code: code.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error === "invalid_code" ? "Code is incorrect or expired — try again" : "Verification failed");

      if (d.status === "authenticated") {
        // Returning subscriber
        saveSession(d.session_token, d.subscriber);
        onComplete(d.session_token, d.subscriber);
      } else if (d.status === "new_subscriber") {
        // New subscriber — collect handle + teams
        if (migrateHandle) setHandle(migrateHandle);
        setStep("handle");
      }
    } catch (err) {
      setError(err.message || "Something went wrong — please try again");
    } finally {
      setLoading(false);
    }
  }

  async function submitHandle() {
    const h = handle.trim().toLowerCase();
    if (!HANDLE_RE.test(h)) {
      setError("Handle must be 3–20 characters: letters, numbers, underscore");
      return;
    }
    if (handleStatus === "taken") { setError("That handle is taken — choose another"); return; }
    setError("");
    await loadTeams();
    await loadSeason();
    setHandle(h);
    setStep("teams");
  }

  async function submitTeams() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${EDGE_FUNCTIONS_BASE}/create-subscriber`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: verifiedEmail, handle, team_ids: selectedTeamIds }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.error === "handle_taken") { setStep("handle"); setHandleStatus("taken"); setError("That handle was just taken — choose another"); return; }
        throw new Error(d.error || "Registration failed");
      }
      // Clear legacy localStorage migration data
      try {
        localStorage.removeItem("dc_handle");
        localStorage.removeItem("faraday_profile");
      } catch {}

      saveSession(d.session_token, d.subscriber);
      onComplete(d.session_token, d.subscriber);
    } catch (err) {
      setError(err.message || "Something went wrong — please try again");
    } finally {
      setLoading(false);
    }
  }

  function saveSession(token, subscriber) {
    try {
      localStorage.setItem("dc_session", token);
      localStorage.setItem("dc_email", subscriber.email);
      if (subscriber.handle) localStorage.setItem("dc_handle", subscriber.handle);
      if (subscriber.id) localStorage.setItem("dc_subscriber_id", subscriber.id);
    } catch {}
  }

  function toggleTeam(id) {
    setSelectedTeamIds((prev) => {
      if (prev.includes(id)) return prev.filter((t) => t !== id);
      if (prev.length >= MAX_TEAMS) return prev; // at max
      return [...prev, id];
    });
  }

  const input = (overrides = {}) => ({
    width: "100%",
    boxSizing: "border-box",
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${C.border}`,
    borderRadius: "6px",
    padding: "10px 14px",
    color: C.text,
    fontSize: "13px",
    outline: "none",
    ...mono,
    ...overrides,
  });

  const label = (extra = {}) => ({
    fontSize: "10px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: C.muted,
    marginBottom: "8px",
    display: "block",
    ...mono,
    ...extra,
  });

  const headlines = {
    leaderboard: "You just scored. See where you rank.",
    streak: "7-day streak — you're on a run.",
    default: "Enter the game.",
  };

  // ── Step: Email ────────────────────────────────────────────────────────────
  if (step === "email") return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <div style={{ fontSize: "16px", fontWeight: 700, color: C.text, marginBottom: "6px", ...sans }}>
          {headlines[trigger] || headlines.default}
        </div>
        <div style={{ fontSize: "11px", color: C.muted, lineHeight: 1.5, ...mono }}>
          One email. No password. We send a 6-digit code.
        </div>
      </div>
      {migrateHandle && (
        <div style={{ fontSize: "11px", color: C.gold, background: "rgba(196,146,42,0.08)", border: `1px solid rgba(196,146,42,0.3)`, borderRadius: "6px", padding: "10px 12px", ...mono }}>
          We found a saved handle <strong>{migrateHandle}</strong> — confirm your email and we'll link it.
        </div>
      )}
      <div>
        <span style={label()}>Email address</span>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendOTP()}
          placeholder="your@email.com" autoComplete="email"
          style={input()}
        />
      </div>
      {error && <div style={{ fontSize: "11px", color: C.red, ...mono }}>{error}</div>}
      <Btn onClick={sendOTP} disabled={loading || !email}>
        {loading ? "…" : "Send my access code"}
      </Btn>
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <div style={{ flex: 1, height: "1px", background: C.border }} />
        <span style={{ fontSize: "11px", color: C.muted, ...mono }}>OR</span>
        <div style={{ flex: 1, height: "1px", background: C.border }} />
      </div>
      <Btn onClick={onDismiss} variant="ghost" small>Skip — play without tracking</Btn>
    </div>
  );

  // ── Step: OTP Code ─────────────────────────────────────────────────────────
  if (step === "otp") return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <div style={{ fontSize: "16px", fontWeight: 700, color: C.text, marginBottom: "6px", ...sans }}>
          Check your inbox
        </div>
        <div style={{ fontSize: "11px", color: C.muted, lineHeight: 1.5, ...mono }}>
          We sent a 6-digit code to <span style={{ color: C.text }}>{verifiedEmail}</span>.
        </div>
      </div>
      <div>
        <span style={label()}>Access code</span>
        <input
          type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && verifyOTP()}
          placeholder="123456" autoComplete="one-time-code"
          style={input({ letterSpacing: "0.3em", fontSize: "20px", textAlign: "center" })}
        />
      </div>
      {error && <div style={{ fontSize: "11px", color: C.red, ...mono }}>{error}</div>}
      <Btn onClick={verifyOTP} disabled={loading || code.length !== 6}>
        {loading ? "Verifying…" : "Verify"}
      </Btn>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          onClick={() => setStep("email")}
          style={{ ...mono, fontSize: "11px", color: C.muted, background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          ← Use a different email
        </button>
        {resendCooldown > 0 ? (
          <span style={{ ...mono, fontSize: "11px", color: C.muted }}>Resend in {resendCooldown}s</span>
        ) : (
          <button
            onClick={() => { setCode(""); sendOTP(); }}
            style={{ ...mono, fontSize: "11px", color: C.gold, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            Resend code
          </button>
        )}
      </div>
    </div>
  );

  // ── Step: Handle ───────────────────────────────────────────────────────────
  if (step === "handle") return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <div style={{ fontSize: "16px", fontWeight: 700, color: C.text, marginBottom: "6px", ...sans }}>
          Choose your handle
        </div>
        <div style={{ fontSize: "11px", color: C.muted, lineHeight: 1.5, ...mono }}>
          This is how other players will see you on the leaderboard. You can change it later.
        </div>
      </div>
      <div>
        <input
          value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && submitHandle()}
          placeholder="circuit_breaker" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={20}
          style={input({
            borderColor: handleStatus === "taken" ? C.red : handleStatus === "ok" ? "rgba(100,180,100,0.6)" : C.border,
          })}
        />
        <div style={{ fontSize: "11px", marginTop: "5px", ...mono, color: handleStatus === "taken" ? C.red : handleStatus === "ok" ? "rgba(100,180,100,0.9)" : C.muted }}>
          {handleStatus === "taken" ? "That handle is taken — try another" : handleStatus === "ok" ? "✓ Available" : "3–20 chars · letters, numbers, underscore"}
        </div>
      </div>
      {error && <div style={{ fontSize: "11px", color: C.red, ...mono }}>{error}</div>}
      <Btn onClick={submitHandle} disabled={!HANDLE_RE.test(handle) || handleStatus === "taken" || handleStatus === "checking"}>
        Continue →
      </Btn>
    </div>
  );

  // ── Step: Teams ────────────────────────────────────────────────────────────
  if (step === "teams") {
    const today = new Date().toISOString().slice(0, 10);
    const inFreeAgency = season?.free_agency_start && today >= season.free_agency_start;
    const inNoticeWindow = season?.free_agency_notice_start && today >= season.free_agency_notice_start;
    // On account setup (new subscriber), always allow team selection
    const canEdit = true;

    const filtered = teamSearch
      ? teams.filter((t) => t.name.toLowerCase().includes(teamSearch.toLowerCase()))
      : teams;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: C.text, marginBottom: "6px", ...sans }}>
            Pick your teams
          </div>
          <div style={{ fontSize: "11px", color: C.muted, lineHeight: 1.5, ...mono }}>
            Select up to 5 teams to compete with. This is optional — you can always skip.
          </div>
        </div>
        <div>
          <input
            value={teamSearch}
            onChange={(e) => { setTeamSearch(e.target.value); loadTeams(e.target.value); }}
            placeholder="Search teams…"
            style={input()}
          />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", maxHeight: "180px", overflowY: "auto" }}>
          {filtered.length === 0 && (
            <span style={{ fontSize: "11px", color: C.muted, ...mono }}>No teams found.</span>
          )}
          {filtered.map((t) => {
            const sel = selectedTeamIds.includes(t.id);
            return (
              <button
                key={t.id} onClick={() => toggleTeam(t.id)}
                style={{
                  ...mono, fontSize: "11px", padding: "5px 12px", borderRadius: "20px", cursor: "pointer",
                  border: `1px solid ${sel ? C.gold : C.border}`,
                  background: sel ? "rgba(196,146,42,0.15)" : "transparent",
                  color: sel ? C.gold : C.muted,
                }}
              >
                {t.name}
              </button>
            );
          })}
        </div>
        {selectedTeamIds.length > 0 && (
          <div style={{ fontSize: "11px", color: C.muted, ...mono }}>
            {selectedTeamIds.length}/{MAX_TEAMS} selected
          </div>
        )}
        {error && <div style={{ fontSize: "11px", color: C.red, ...mono }}>{error}</div>}
        <Btn onClick={submitTeams} disabled={loading}>
          {loading ? "…" : "Enter the game →"}
        </Btn>
        <Btn onClick={submitTeams} variant="ghost" small disabled={loading}>
          Skip for now
        </Btn>
      </div>
    );
  }

  return null;
}
