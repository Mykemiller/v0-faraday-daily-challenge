"use client";

// League Office — the mandatory-reason dialog for season-config mutations.
//
// Same contract as the console's existing ConfirmModal: confirm stays disabled
// until a reason is typed, because the reason is what makes the audit trail
// worth reading. Accepts arbitrary `details` so the promote flow can show the
// diff against the incumbent and the exact moment it takes effect (spec §4).

import { useEffect, useState } from "react";
import { GOLD, INK, MUTED } from "./fields";

type ReasonDialogProps = {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  details?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

/** Gate the body on `open` so the inner dialog MOUNTS FRESH each time — the
 *  reason field resets naturally via useState, with no reset-in-effect (which
 *  causes a cascading render and trips react-hooks/set-state-in-effect). */
export function ReasonDialog(props: ReasonDialogProps) {
  if (!props.open) return null;
  return <ReasonDialogBody {...props} />;
}

function ReasonDialogBody({
  title,
  description,
  details,
  confirmLabel = "Confirm",
  destructive = false,
  busy = false,
  onCancel,
  onConfirm,
}: ReasonDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,18,16,.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 60,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 22,
          width: "min(620px, 100%)",
          maxHeight: "86vh",
          overflowY: "auto",
          boxShadow: "0 18px 50px rgba(20,18,16,.28)",
        }}
      >
        <h2 className="font-serif" style={{ fontSize: 19, margin: "0 0 8px", color: INK }}>
          {title}
        </h2>
        {description ? (
          <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, marginBottom: 14 }}>{description}</div>
        ) : null}

        {details ? <div style={{ marginBottom: 16 }}>{details}</div> : null}

        <label style={{ display: "block" }}>
          <span
            className="font-mono"
            style={{
              display: "block",
              fontSize: 9.5,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "#8d8375",
              marginBottom: 5,
            }}
          >
            Reason (required)
          </span>
          <textarea
            autoFocus
            rows={2}
            value={reason}
            disabled={busy}
            placeholder="Why is this change being made?"
            onChange={(e) => setReason(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              border: "1px solid var(--color-cream-border)",
              borderRadius: 6,
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
              color: INK,
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="font-mono"
            style={{
              fontSize: 10.5,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              padding: "9px 16px",
              borderRadius: 7,
              border: "1px solid var(--color-cream-border)",
              background: "#fff",
              color: INK,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={busy || !reason.trim()}
            className="font-mono"
            style={{
              fontSize: 10.5,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              padding: "9px 16px",
              borderRadius: 7,
              border: `1px solid ${destructive ? "#9c3b2e" : GOLD}`,
              background: busy || !reason.trim() ? "rgba(107,98,87,.28)" : destructive ? "#9c3b2e" : GOLD,
              color: "#fff",
              cursor: busy || !reason.trim() ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
