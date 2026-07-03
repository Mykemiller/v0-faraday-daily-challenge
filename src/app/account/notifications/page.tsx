"use client";

// /account/notifications — Daily Challenge Alerts.
// Light cream theme matching /account (same Card / SL / LightBtn styling).
// Preferences persist on dc_subscribers.notification_preferences via
// /api/account { action: "update-notifications" }; shape + defaults live in
// src/lib/notification-preferences.ts. Saves happen on every toggle
// (optimistic, reverted on failure) — same immediate-save pattern as the
// team picker on /account.

import { useCallback, useEffect, useRef, useState } from "react";
import OTPGate from "@/components/OTPGate";
import SiteHeaderNav from "@/components/SiteHeaderNav";
import { SESSION_STORAGE_KEY, HANDLE_STORAGE_KEY } from "@/lib/supabase";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CATEGORIES,
  normalizeNotificationPreferences,
  type NotificationCategoryId,
  type NotificationChannel,
  type NotificationPreferences,
} from "@/lib/notification-preferences";

// Dark C tokens forwarded to OTPGate (which renders on a forest card) — same
// gate treatment as /account.
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

// Light-theme toggle switch — forest track when on, matching the app's
// button/input styling (no icon library, gold focus ring via global outline).
function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full border transition-colors ${
        checked ? "border-forest bg-forest" : "border-forest/25 bg-forest/10"
      } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-[16px] w-[16px] rounded-full bg-warm-white shadow transition-transform ${
          checked ? "translate-x-[20px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

// SMS / Email channel chip — same rounded-full mono-chip look as the team
// picker on /account; filled forest when selected.
function ChannelChip({
  label,
  selected,
  onToggle,
  disabled,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
        selected
          ? "border-forest bg-forest text-warm-white"
          : "border-forest/20 text-forest/70 hover:border-forest hover:text-forest"
      } ${disabled ? "cursor-not-allowed opacity-40 hover:border-forest/20 hover:text-forest/70" : "cursor-pointer"}`}
    >
      {selected ? "✓ " : ""}{label}
    </button>
  );
}

const CHANNEL_LABELS: Record<NotificationChannel, string> = { sms: "SMS", email: "Email" };

export default function NotificationsPage() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let t: string | null = null;
    try { t = localStorage.getItem(SESSION_STORAGE_KEY); } catch { /* storage disabled */ }
    setToken(t);
    setReady(true);
  }, []);

  const loadPrefs = useCallback((t: string) => {
    fetch(`/api/account?token=${encodeURIComponent(t)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (ok) {
          // Missing field (pre-feature subscriber / older API) → defaults.
          setPrefs(normalizeNotificationPreferences(d.notification_preferences));
          if (d.handle) setHandle(d.handle);
        } else {
          setLoadErr(d?.error || "Could not load your alert settings.");
        }
      })
      .catch(() => setLoadErr("Network error loading your alert settings."));
  }, []);

  useEffect(() => {
    if (token) loadPrefs(token);
  }, [token, loadPrefs]);

  function signOut() {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(HANDLE_STORAGE_KEY);
    } catch { /* ignore */ }
    window.location.href = "/challenge";
  }

  // Auto-save on every toggle: apply optimistically, persist the whole
  // normalized object, revert if the write fails.
  function save(next: NotificationPreferences) {
    if (!token || !prefs) return;
    const prev = prefs;
    setPrefs(next);
    setSaveErr("");
    setSaveState("saving");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: "update-notifications", preferences: next }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) {
          setPrefs(prev);
          setSaveErr(d?.error || "Could not save — try again.");
          setSaveState("idle");
          return;
        }
        setPrefs(normalizeNotificationPreferences(d.notification_preferences));
        setSaveState("saved");
        savedTimer.current = setTimeout(() => setSaveState("idle"), 2000);
      })
      .catch(() => {
        setPrefs(prev);
        setSaveErr("Network error — try again.");
        setSaveState("idle");
      });
  }

  function toggleMaster() {
    if (!prefs) return;
    // Only master_enabled flips — category settings persist underneath so the
    // user's choices come back when they re-enable.
    save({ ...prefs, master_enabled: !prefs.master_enabled });
  }

  function toggleCategory(id: NotificationCategoryId) {
    if (!prefs) return;
    const cat = prefs.categories[id];
    save({
      ...prefs,
      categories: { ...prefs.categories, [id]: { ...cat, enabled: !cat.enabled } },
    });
  }

  function toggleChannel(id: NotificationCategoryId, channel: NotificationChannel) {
    if (!prefs) return;
    const cat = prefs.categories[id];
    save({
      ...prefs,
      categories: {
        ...prefs.categories,
        [id]: { ...cat, channels: { ...cat.channels, [channel]: !cat.channels[channel] } },
      },
    });
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────────
  if (!ready) {
    return (
      <div className="min-h-screen bg-warm-white">
        <SiteHeaderNav current="notifications" />
        <main className="mx-auto max-w-2xl px-5 pb-16 pt-8 animate-pulse space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-warm-cream" />
          ))}
        </main>
      </div>
    );
  }

  // ── Unauthenticated — show OTPGate on dark card (same as /account) ───────────
  if (!token) {
    return (
      <div className="min-h-screen bg-warm-white font-sans text-near-black">
        <SiteHeaderNav current="notifications" authed={false} />
        <main className="mx-auto max-w-2xl px-5 pb-16 pt-10">
          <h1 className="font-serif text-3xl font-bold text-forest">Daily Challenge Alerts</h1>
          <p className="mb-8 mt-1 text-sm text-near-black/60">
            Sign in to choose what you want to hear about, and how.
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
  const view = prefs ?? DEFAULT_NOTIFICATION_PREFERENCES;
  const masterOn = view.master_enabled;
  const loading = !prefs && !loadErr;

  return (
    <div className="min-h-screen bg-warm-white font-sans text-near-black">
      <SiteHeaderNav current="notifications" authed handle={handle} onSignOut={signOut} />

      <main className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-serif text-3xl font-bold text-forest">Daily Challenge Alerts</h1>
          <span
            className={`font-mono text-[11px] text-near-black/40 transition-opacity ${
              saveState === "idle" ? "opacity-0" : "opacity-100"
            }`}
            aria-live="polite"
          >
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
          </span>
        </div>
        <p className="mt-1 text-sm text-near-black/60">
          Choose what you want to hear about, and how.
        </p>

        {loadErr && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-700">
            {loadErr}
          </div>
        )}
        {saveErr && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 font-mono text-[12px] text-red-700">
            {saveErr}
          </div>
        )}

        {loading ? (
          <div className="mt-4 animate-pulse space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-warm-cream" />
            ))}
          </div>
        ) : (
          <>
            {/* ── MASTER TOGGLE ─────────────────────────────────────────── */}
            <Card>
              <SL>Master switch</SL>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[14px] font-semibold text-near-black">All daily challenge alerts</p>
                  <p className="mt-0.5 font-mono text-[11px] text-near-black/50">
                    The main switch — turning this off silences everything below.
                  </p>
                </div>
                <Toggle
                  checked={masterOn}
                  onChange={toggleMaster}
                  disabled={!prefs || saveState === "saving"}
                  label="All daily challenge alerts"
                />
              </div>
            </Card>

            {/* ── CATEGORIES — dimmed + non-interactive when master is off ── */}
            <Card>
              <SL>Alert types</SL>
              <div
                className={`divide-y divide-forest/8 transition-opacity ${masterOn ? "" : "pointer-events-none opacity-40"}`}
                aria-disabled={!masterOn}
              >
                {NOTIFICATION_CATEGORIES.map(({ id, label, description }) => {
                  const cat = view.categories[id];
                  const channelsActive = masterOn && cat.enabled;
                  return (
                    <div key={id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4 first:pt-1 last:pb-1">
                      <div className="min-w-0 flex-1 basis-52">
                        <p className="text-[14px] font-semibold text-near-black">{label}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-near-black/50">{description}</p>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <div className={`flex gap-1.5 transition-opacity ${channelsActive ? "" : "opacity-40"}`}>
                          {(["sms", "email"] as const).map((channel) => (
                            <ChannelChip
                              key={channel}
                              label={CHANNEL_LABELS[channel]}
                              selected={cat.channels[channel]}
                              onToggle={() => toggleChannel(id, channel)}
                              disabled={!channelsActive || !prefs || saveState === "saving"}
                            />
                          ))}
                        </div>
                        <Toggle
                          checked={cat.enabled}
                          onChange={() => toggleCategory(id)}
                          disabled={!masterOn || !prefs || saveState === "saving"}
                          label={label}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {!masterOn && (
                <p className="mt-3 font-mono text-[11px] text-near-black/50">
                  All alerts are off. Your choices below are kept and come back when you switch alerts on again.
                </p>
              )}
            </Card>
          </>
        )}
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
