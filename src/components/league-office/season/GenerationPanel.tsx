"use client";

// Part D — the season generation panel (League Office → Seasons → detail).
//
// Renders the SERVER-derived GENERATABLE checklist verbatim — the disabled
// states here are presentation only; every action re-validates in
// executeAction() before writing. Buttons follow the ticket's gates:
//   Generate Pilot   — enabled at conditions 1–9
//   Approve Pilot    — after the pilot run completes (DEC-5)
//   Generate Puzzles — condition 10 (approved pilot) unlocks it; the confirm
//                      modal shows the total count + warnings
//   Approve Puzzles  — publishes the season's drafts via fn_dc_approve_puzzles
//   Lock Season      — the final gate, blocked until generated_at is set
// Alarms: the stall banner (heartbeat silent >30 min) and the bank-minimum
// alert (a configured game under 14 days of Published/Live coverage ahead).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/league-office/actions";
import { ReasonDialog } from "./ReasonDialog";
import { MiniButton, PrimaryButton } from "./fields";

type Finding = { severity: "error" | "warning"; code: string; message: string };
type Run = {
  id: string; run_kind: string; status: string; target_count: number | null;
  written_count: number; failed_count: number; started_at: string;
  completed_at: string | null; superseded_at: string | null; last_heartbeat_at: string | null;
};
type Status = {
  season: {
    id: string; pilot_approved_at: string | null; generated_at: string | null;
    locked_at: string | null; starts_on: string | null; ends_on: string | null;
  };
  dayCount: number | null;
  targets: { gameName: string; requested: number; effective: number }[];
  totalTarget: number;
  pilotFindings: Finding[];
  fullFindings: Finding[];
  warnings: Finding[];
  runs: Run[];
  stalledRunId: string | null;
  bankAlarms: Finding[];
  pilotPreview: {
    id: string; puzzle_type: string; puzzle_name: string; difficulty: string | null;
    domain: string | null; go_live_date: string; answer_key: string | null;
  }[];
  latestPilotRunStatus: string | null;
  draftCount: number;
  unapprovedDates: string[];
};

type Action = "pilot" | "full" | "approve_pilot" | "approve_puzzles" | "lock";

const ACTION_TO_API: Record<Exclude<Action, "lock">, string> = {
  pilot: "season.generate_pilot",
  full: "season.generate_full",
  approve_pilot: "season.approve_pilot",
  approve_puzzles: "season.approve_puzzles",
};

export function GenerationPanel({ seasonId }: { seasonId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/lo/seasons/${seasonId}/generation`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (alive.current && j?.ok) setStatus(j.status as Status);
    } catch {
      /* transient — next poll retries */
    }
  }, [seasonId]);

  const inflight = status?.runs.find((r) => !r.completed_at && !r.superseded_at) ?? null;

  useEffect(() => {
    alive.current = true;
    refresh();
    return () => { alive.current = false; };
  }, [refresh]);

  // poll while a run is in flight so written/target and the heartbeat stay live
  useEffect(() => {
    if (!inflight) return;
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [inflight, refresh]);

  const advance = useCallback(async () => {
    setAdvancing(true);
    try {
      await fetch(`/api/lo/generation/worker`, { method: "POST" });
    } finally {
      setAdvancing(false);
      refresh();
    }
  }, [refresh]);

  const run = async (reason: string) => {
    if (!action) return;
    setBusy(true);
    try {
      const res =
        action === "lock"
          ? await fetch(`/api/lo/seasons/${seasonId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ op: "lock", reason }),
            })
          : await fetch(`/api/league-office/action`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: ACTION_TO_API[action], reason, seasonId }),
            });
      const j = await res.json().catch(() => ({}));
      toast(j?.message ?? (res.ok ? "Done." : "That did not work."));
      if (res.ok) {
        setAction(null);
        if (action === "pilot" || action === "full") advance(); // kick the first slice now
        if (action === "lock") router.refresh();
      }
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (!status) return <p style={{ fontSize: 12.5, color: "#8d8375", margin: 0 }}>Loading generation status…</p>;

  const s = status.season;
  const pilotReady = status.pilotFindings.length === 0;
  const fullReady = status.fullFindings.length === 0;
  const pilotDone = status.latestPilotRunStatus === "pilot_complete";
  const est = Math.max(1, Math.ceil((status.totalTarget / 10) * 1.2)); // ~1 min per 10-puzzle batch, padded

  const copy: Record<Action, { title: string; description: string; confirm: string; destructive?: boolean }> = {
    pilot: {
      title: "Generate pilot",
      description: `Generates ONE puzzle per configured game (${status.targets.length} total) as Draft/Unpublished rows for review. Nothing is published; players see nothing.`,
      confirm: "Generate pilot",
    },
    full: {
      title: "Generate puzzles",
      description:
        `Generates ${status.totalTarget.toLocaleString()} puzzles (${status.targets.length} games × ${status.dayCount ?? "?"} days) as Draft/Unpublished rows. ` +
        `Estimated runtime ≈ ${est} min across worker slices. ` +
        (status.warnings.length ? `Warnings: ${status.warnings.map((w) => w.message).join(" ")}` : "No warnings."),
      confirm: "Generate puzzles",
    },
    approve_pilot: {
      title: "Approve pilot",
      description: "Records the pilot as reviewed and unlocks the full generation run (DEC-5). The pilot rows themselves stay Draft until Approve Puzzles.",
      confirm: "Approve pilot",
    },
    approve_puzzles: {
      title: "Approve puzzles",
      description: `Publishes ${status.draftCount.toLocaleString()} generated draft${status.draftCount === 1 ? "" : "s"} across ${status.unapprovedDates.length} day${status.unapprovedDates.length === 1 ? "" : "s"} via fn_dc_approve_puzzles — Public IDs are assigned and the nightly rotation will serve them on their dates.`,
      confirm: "Approve & publish",
      destructive: true,
    },
    lock: {
      title: "Lock season",
      description: "The final gate: freezes this season's configuration at the database level. Unlock remains available in the action bar above.",
      confirm: "Lock season",
    },
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* alarms */}
      {status.stalledRunId ? (
        <Banner tone="red">
          Generation run {status.stalledRunId.slice(0, 8)}… is <strong>stalled</strong> — no heartbeat for over 30
          minutes. Press “Advance now”, and check the worker logs if it stays silent.
        </Banner>
      ) : null}
      {status.bankAlarms.map((a) => (
        <Banner key={a.message} tone="amber">{a.message}</Banner>
      ))}

      {/* checklist */}
      <div>
        <SectionLabel>Generatable checklist</SectionLabel>
        {pilotReady && fullReady ? (
          <p style={{ fontSize: 12.5, color: "#325638", margin: "6px 0 0" }}>All conditions met.</p>
        ) : (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, color: "#9c3b2e" }}>
            {(fullReady ? status.pilotFindings : status.fullFindings).map((f) => (
              <li key={f.code}>{f.message}</li>
            ))}
          </ul>
        )}
        {status.warnings.length > 0 ? (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, color: "#94560a" }}>
            {status.warnings.map((w) => (
              <li key={w.code + w.message}>{w.message}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* targets */}
      {status.targets.length > 0 ? (
        <p style={{ fontSize: 12.5, color: "#6b6257", margin: 0 }}>
          Slate: {status.targets.map((t) => t.gameName).join(" · ")} — {status.totalTarget.toLocaleString()} puzzles over {status.dayCount ?? "?"} days.
        </p>
      ) : null}

      {/* actions */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <PrimaryButton
          onClick={() => setAction("pilot")}
          disabled={busy || !pilotReady}
          title={pilotReady ? undefined : "Resolve the checklist first."}
        >
          Generate pilot
        </PrimaryButton>
        <MiniButton
          onClick={() => setAction("approve_pilot")}
          disabled={busy || !pilotDone || !!s.pilot_approved_at}
          title={s.pilot_approved_at ? `Pilot approved ${s.pilot_approved_at.slice(0, 10)}` : pilotDone ? undefined : "Run the pilot first."}
        >
          Approve pilot
        </MiniButton>
        <PrimaryButton
          onClick={() => setAction("full")}
          disabled={busy || !fullReady}
          title={fullReady ? undefined : "The full run unlocks after the pilot is approved."}
        >
          Generate puzzles
        </PrimaryButton>
        <MiniButton
          onClick={() => setAction("approve_puzzles")}
          disabled={busy || status.draftCount === 0}
          title={status.draftCount === 0 ? "No generated drafts to approve." : undefined}
        >
          Approve puzzles ({status.draftCount})
        </MiniButton>
        <MiniButton
          onClick={() => setAction("lock")}
          disabled={busy || !s.generated_at || !!s.locked_at}
          title={s.locked_at ? "Already locked." : s.generated_at ? undefined : "Blocked until generation completes."}
        >
          Lock season
        </MiniButton>
      </div>

      {/* run progress */}
      {status.runs.length > 0 ? (
        <div>
          <SectionLabel>Runs</SectionLabel>
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 6 }}>
            {status.runs.slice(0, 4).map((r) => (
              <li key={r.id} style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 12.5, color: "#141210", flexWrap: "wrap" }}>
                <span className="font-mono" style={{ fontSize: 10.5, color: "#8d8375" }}>{r.id.slice(0, 8)}</span>
                <span style={{ fontWeight: 600 }}>{r.run_kind}</span>
                <StatusDot status={r.status} stalled={status.stalledRunId === r.id} />
                <span>{r.written_count}/{r.target_count ?? "?"} written{r.failed_count ? ` · ${r.failed_count} failed` : ""}</span>
                <span style={{ color: "#8d8375" }}>
                  {r.completed_at
                    ? `finished ${r.completed_at.slice(0, 16).replace("T", " ")}`
                    : r.last_heartbeat_at
                      ? `heartbeat ${r.last_heartbeat_at.slice(11, 16)} UTC`
                      : "queued"}
                </span>
                {!r.completed_at && !r.superseded_at ? (
                  <MiniButton onClick={advance} disabled={advancing}>
                    {advancing ? "Advancing…" : "Advance now"}
                  </MiniButton>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* pilot review table */}
      {status.pilotPreview.length > 0 ? (
        <div>
          <SectionLabel>Pilot review{s.pilot_approved_at ? " (approved)" : ""}</SectionLabel>
          <div style={{ overflowX: "auto", marginTop: 6 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Game", "Puzzle", "Difficulty", "Topic", "Date", "Answer"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "4px 10px 4px 0", color: "#8d8375", fontWeight: 600, borderBottom: "1px solid var(--color-cream-line)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {status.pilotPreview.map((p) => (
                  <tr key={p.id}>
                    <td style={{ padding: "5px 10px 5px 0", whiteSpace: "nowrap" }}>{p.puzzle_type}</td>
                    <td style={{ padding: "5px 10px 5px 0" }}>{p.puzzle_name}</td>
                    <td style={{ padding: "5px 10px 5px 0" }}>{p.difficulty ?? "—"}</td>
                    <td style={{ padding: "5px 10px 5px 0" }}>{p.domain ?? "—"}</td>
                    <td className="font-mono" style={{ padding: "5px 10px 5px 0", fontSize: 11 }}>{p.go_live_date}</td>
                    <td style={{ padding: "5px 0", color: "#6b6257", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.answer_key ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <ReasonDialog
        open={action !== null}
        busy={busy}
        title={action ? copy[action].title : ""}
        description={action ? copy[action].description : ""}
        confirmLabel={action ? copy[action].confirm : "Confirm"}
        destructive={action ? copy[action].destructive : false}
        onCancel={() => setAction(null)}
        onConfirm={run}
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono" style={{ fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase", color: "#8d8375" }}>
      {children}
    </span>
  );
}

function Banner({ tone, children }: { tone: "red" | "amber"; children: React.ReactNode }) {
  const colors = tone === "red"
    ? { bg: "rgba(156,59,46,.08)", border: "#9c3b2e", fg: "#9c3b2e" }
    : { bg: "rgba(196,146,42,.10)", border: "#c4922a", fg: "#94560a" };
  return (
    <div style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${colors.border}`, background: colors.bg, color: colors.fg, fontSize: 12.5 }}>
      {children}
    </div>
  );
}

function StatusDot({ status, stalled }: { status: string; stalled: boolean }) {
  const color = stalled || status === "failed_short" ? "#9c3b2e"
    : status === "complete" || status === "pilot_complete" ? "#325638"
    : "#c4922a";
  const label = stalled ? `${status} · stalled` : status;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} />
      <span className="font-mono" style={{ fontSize: 10.5, color }}>{label}</span>
    </span>
  );
}
