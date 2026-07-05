"use client";

// League Office — Tier 2 client action surface: ConfirmModal (mandatory reason,
// red confirm for destructive, optional extra input), ActionButton (opens it and
// POSTs to /api/league-office/action), and a lightweight Toaster.
//
// Every override the console offers routes through here → the server writes the
// audit row. Confirm stays disabled until the reason is non-empty.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ── toast ────────────────────────────────────────────────────────────────────
export function toast(message: string) {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("lo-toast", { detail: message }));
}

export function Toaster() {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      const id = ++n;
      setItems((xs) => [...xs, { id, msg }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3200);
    };
    window.addEventListener("lo-toast", onToast);
    return () => window.removeEventListener("lo-toast", onToast);
  }, []);
  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, display: "flex", flexDirection: "column", gap: 8, zIndex: 50 }}>
      {items.map((t) => (
        <div key={t.id} className="font-sans" style={{ background: "var(--color-forest)", color: "#f8f5f0", padding: "10px 16px", borderRadius: 8, fontSize: 13, boxShadow: "0 6px 20px rgba(20,18,16,.25)", maxWidth: 340 }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ── modal + button ───────────────────────────────────────────────────────────
export type ExtraField =
  | { kind: "text"; name: "name"; label: string; initial?: string; placeholder?: string }
  | { kind: "select"; name: "captainSubscriberId"; label: string; options: { value: string; label: string }[]; initial?: string };

type Payload = {
  action: string;
  subscriberId?: string;
  membershipId?: string;
  teamId?: string;
  auditId?: string;
};

export function ActionButton({
  label,
  title,
  description,
  payload,
  destructive = false,
  variant = "neutral",
  confirmLabel,
  extraField,
}: {
  label: string;
  title: string;
  description: string;
  payload: Payload;
  destructive?: boolean;
  variant?: "primary" | "neutral" | "danger";
  confirmLabel?: string;
  extraField?: ExtraField;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [extra, setExtra] = useState(extraField?.initial ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const extraOk = !extraField || (extraField.kind === "select" ? !!extra : extra.trim().length > 0);
  const canConfirm = reason.trim().length > 0 && extraOk && !busy;

  const base: React.CSSProperties = {
    fontSize: 12.5,
    padding: "7px 12px",
    borderRadius: 7,
    border: "1px solid var(--color-cream-border)",
    cursor: "pointer",
    background: "#fff",
  };
  const btnStyle: React.CSSProperties =
    variant === "primary"
      ? { ...base, background: "var(--color-forest)", color: "#f8f5f0", border: "none" }
      : variant === "danger"
        ? { ...base, color: "var(--color-brick)", borderColor: "rgba(156,59,46,.4)" }
        : { ...base, color: "#41382d" };

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { ...payload, reason: reason.trim() };
      if (extraField) body[extraField.name] = extraField.kind === "text" ? extra.trim() : extra;
      const r = await fetch("/api/league-office/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({ ok: false, message: "Request failed." }));
      if (!r.ok || !j.ok) {
        setErr(j.message || "Action failed.");
        setBusy(false);
        return;
      }
      setOpen(false);
      setReason("");
      setBusy(false);
      toast(j.message || "Done — logged to Audit Log.");
      router.refresh();
    } catch {
      setErr("Network error.");
      setBusy(false);
    }
  }

  return (
    <>
      <button style={btnStyle} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, background: "rgba(20,18,16,.42)", display: "grid", placeItems: "center", zIndex: 40, padding: 20 }}
          onClick={(e) => e.target === e.currentTarget && !busy && setOpen(false)}
        >
          <div style={{ background: "#fff", borderRadius: 12, padding: "24px 24px 20px", width: 460, maxWidth: "100%", border: "1px solid var(--color-cream-border)" }}>
            <h2 className="font-serif" style={{ fontSize: 19, margin: 0 }}>{title}</h2>
            <div className="double-rule" style={{ margin: "10px 0 0" }} />
            <p style={{ fontSize: 13.5, color: "#6b6257", margin: "14px 0 16px" }}>{description}</p>

            {extraField && (
              <div style={{ marginBottom: 14 }}>
                <label className="font-mono" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#8d8375", display: "block", marginBottom: 5 }}>
                  {extraField.label}
                </label>
                {extraField.kind === "text" ? (
                  <input
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                    placeholder={extraField.placeholder}
                    style={fieldStyle}
                  />
                ) : (
                  <select value={extra} onChange={(e) => setExtra(e.target.value)} style={fieldStyle}>
                    <option value="">Select…</option>
                    {extraField.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <label className="font-mono" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#8d8375", display: "block", marginBottom: 5 }}>
              Reason (required)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why are you making this change? This is written to the Audit Log."
              style={{ ...fieldStyle, resize: "vertical", fontFamily: "inherit" }}
              autoFocus
            />

            {err && <p style={{ color: "var(--color-brick)", fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button onClick={() => !busy && setOpen(false)} style={{ ...base, color: "#6b6257" }}>Cancel</button>
              <button
                onClick={submit}
                disabled={!canConfirm}
                style={{
                  border: "none",
                  borderRadius: 7,
                  padding: "9px 18px",
                  fontWeight: 700,
                  fontSize: 13,
                  color: "#fff",
                  cursor: canConfirm ? "pointer" : "not-allowed",
                  background: !canConfirm ? "var(--color-cream-edge)" : destructive ? "var(--color-brick)" : "var(--color-forest)",
                }}
              >
                {busy ? "Working…" : confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--color-warm-panel)",
  border: "1px solid var(--color-cream-border)",
  borderRadius: 8,
  padding: "8px 11px",
  fontSize: 13,
  color: "#141210",
  outline: "none",
};
