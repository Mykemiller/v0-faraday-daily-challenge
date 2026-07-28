"use client";

// League Office — Scoring section: the "Reset Season Scoring" destructive action.
//
// Dedicated modal (not the generic ActionButton) because the confirm must name
// the active season, list the live per-table row counts that will be zeroed, and
// state plainly that streaks + past-season results are untouched. Single confirm
// click (no type-to-confirm phrase), required free-text reason. POSTs the
// "scoring.reset_season" action → the server runs the atomic RPC + audit row.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "./actions";

type Counts = {
  score_events: number;
  dc_completions: number;
  leaderboard_daily: number;
  dc_season_state: number;
};

const ROW_LABELS: { key: keyof Counts; label: string; detail: string }[] = [
  { key: "score_events", label: "Score events", detail: "points → 0" },
  { key: "dc_completions", label: "Completions", detail: "score → 0" },
  { key: "leaderboard_daily", label: "Daily leaderboard", detail: "score / games / time → 0" },
  { key: "dc_season_state", label: "Season state", detail: "signals → 0" },
];

export default function ScoringReset({
  seasonName,
  counts,
  total,
  hasActiveSeason,
}: {
  seasonName: string | null;
  counts: Counts;
  total: number;
  hasActiveSeason: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const canConfirm = reason.trim().length >= 3 && !busy && total > 0;

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/league-office/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scoring.reset_season", reason: reason.trim() }),
      });
      const j = await r.json().catch(() => ({ ok: false, message: "Request failed." }));
      if (!r.ok || !j.ok) {
        setErr(j.message || "Reset failed.");
        setBusy(false);
        return;
      }
      setOpen(false);
      setReason("");
      setBusy(false);
      toast(j.message || "Season scoring reset — logged to Audit Log.");
      router.refresh();
    } catch {
      setErr("Network error.");
      setBusy(false);
    }
  }

  const seasonLabel = seasonName ?? "the active season";

  return (
    <>
      <button
        onClick={() => hasActiveSeason && setOpen(true)}
        disabled={!hasActiveSeason}
        style={{
          fontSize: 13,
          fontWeight: 700,
          padding: "9px 16px",
          borderRadius: 8,
          border: "1px solid rgba(156,59,46,.45)",
          color: "#fff",
          background: hasActiveSeason ? "var(--color-brick)" : "var(--color-cream-edge)",
          cursor: hasActiveSeason ? "pointer" : "not-allowed",
        }}
      >
        Reset Season Scoring
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, background: "rgba(20,18,16,.42)", display: "grid", placeItems: "center", zIndex: 40, padding: 20 }}
          onClick={(e) => e.target === e.currentTarget && !busy && setOpen(false)}
        >
          <div style={{ background: "#fff", borderRadius: 12, padding: "24px 24px 20px", width: 500, maxWidth: "100%", border: "1px solid var(--color-cream-border)" }}>
            <h2 className="font-serif" style={{ fontSize: 19, margin: 0, color: "var(--color-brick)" }}>
              Reset scoring — {seasonLabel}
            </h2>
            <div className="double-rule" style={{ margin: "10px 0 0" }} />
            <p style={{ fontSize: 13.5, color: "#6b6257", margin: "14px 0 12px" }}>
              This zeros all scoring for <strong>{seasonLabel}</strong>. It cannot be undone from
              the console — the prior values are captured in the Audit Log for manual recovery.
            </p>

            <div style={{ border: "1px solid var(--color-cream-border)", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
              {ROW_LABELS.map((r, i) => (
                <div
                  key={r.key}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    padding: "8px 12px",
                    fontSize: 12.5,
                    borderTop: i === 0 ? "none" : "1px solid var(--color-warm-panel)",
                    background: i % 2 ? "#fdfcfa" : "#fff",
                  }}
                >
                  <span style={{ color: "#41382d", fontWeight: 600 }}>{r.label}</span>
                  <span className="font-mono" style={{ color: "#8d8375", fontSize: 11 }}>{r.detail}</span>
                  <span className="font-mono" style={{ marginLeft: "auto", color: "#141210", fontWeight: 700 }}>
                    {counts[r.key]} row{counts[r.key] === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
              <div style={{ padding: "8px 12px", fontSize: 12.5, borderTop: "1px solid var(--color-cream-border)", background: "var(--color-warm-panel)", display: "flex" }}>
                <span style={{ fontWeight: 700, color: "#141210" }}>Total</span>
                <span className="font-mono" style={{ marginLeft: "auto", fontWeight: 700, color: "#141210" }}>
                  {total} row{total === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            <p style={{ fontSize: 12.5, color: "#4f6b4d", margin: "0 0 14px", fontWeight: 600 }}>
              Streaks and past season results will NOT be affected.
            </p>

            <label className="font-mono" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "#8d8375", display: "block", marginBottom: 5 }}>
              Reason (required)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why are you resetting scoring? This is written to the Audit Log."
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "var(--color-warm-panel)",
                border: "1px solid var(--color-cream-border)",
                borderRadius: 8,
                padding: "8px 11px",
                fontSize: 13,
                color: "#141210",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
              autoFocus
            />

            {total === 0 && (
              <p style={{ color: "#8d8375", fontSize: 12.5, margin: "10px 0 0" }}>
                Nothing to reset — {seasonLabel} scoring is already at zero.
              </p>
            )}
            {err && <p style={{ color: "var(--color-brick)", fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button
                onClick={() => !busy && setOpen(false)}
                style={{ fontSize: 12.5, padding: "9px 16px", borderRadius: 8, border: "1px solid var(--color-cream-border)", color: "#6b6257", background: "#fff", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!canConfirm}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 18px",
                  fontWeight: 700,
                  fontSize: 13,
                  color: "#fff",
                  cursor: canConfirm ? "pointer" : "not-allowed",
                  background: canConfirm ? "var(--color-brick)" : "var(--color-cream-edge)",
                }}
              >
                {busy ? "Resetting…" : "Reset scoring to zero"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
