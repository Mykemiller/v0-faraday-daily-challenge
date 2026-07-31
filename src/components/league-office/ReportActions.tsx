"use client";

// League Office — per-report status buttons for the message report queue
// (CC-DC-MESSAGING-1.0). Deliberately NOT the Tier-2 ActionButton funnel:
// setting a report's review status is queue triage, not a player-state
// override, so it needs no mandatory-reason audit row. The API re-verifies
// staff on every call.

import { useState } from "react";
import { useRouter } from "next/navigation";

const NEXT_STATUSES: Array<{ status: string; label: string; title: string }> = [
  { status: "reviewed", label: "Reviewed", title: "Seen — no action needed yet" },
  { status: "actioned", label: "Actioned", title: "Action was taken on this report" },
  { status: "dismissed", label: "Dismissed", title: "Not a violation" },
];

export default function ReportActions({
  reportId,
  status,
}: {
  reportId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function setStatus(next: string) {
    setBusy(true);
    setErr(false);
    try {
      const r = await fetch("/api/league-office/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, status: next }),
      });
      if (!r.ok) { setErr(true); return; }
      router.refresh();
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  if (status !== "open") {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setStatus("open")}
        title="Move this report back to the open queue"
        className="font-mono"
        style={{
          fontSize: 10,
          padding: "4px 8px",
          borderRadius: 5,
          border: "1px solid rgba(107,98,87,.35)",
          background: "#fff",
          color: "#6b6257",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.5 : 1,
        }}
      >
        Reopen
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {NEXT_STATUSES.map(({ status: next, label, title }) => (
        <button
          key={next}
          type="button"
          disabled={busy}
          onClick={() => setStatus(next)}
          title={title}
          className="font-mono"
          style={{
            fontSize: 10,
            padding: "4px 8px",
            borderRadius: 5,
            border: next === "actioned" ? "1px solid rgba(156,59,46,.35)" : "1px solid rgba(107,98,87,.35)",
            background: "#fff",
            color: next === "actioned" ? "#9c3b2e" : "#6b6257",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          {label}
        </button>
      ))}
      {err && (
        <span className="font-mono" style={{ fontSize: 10, color: "#9c3b2e" }} role="status">
          failed
        </span>
      )}
    </span>
  );
}
