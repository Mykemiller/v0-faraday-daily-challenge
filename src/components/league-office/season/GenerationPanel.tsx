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
// alert (a configured game under 14 days of Published/Live coverage ahead —
// only once the season has been generated; an un-generated season has
// nothing to protect and the checklist is its guide).
//
// CC-DC-GEN-LEASE-AUTOADVANCE-1.0 D3: the in-flight run's primary control is
// "Continue until done", which drives worker slices SEQUENTIALLY until the run
// finishes. The loop's rules — and all five of its stop conditions — live in
// src/lib/generation/advance.js so they are unit-tested; this component only
// supplies the effects. The loop is a convenience, never the mechanism: closing
// the tab reverts the run to the ten-minute cron, and "Advance one slice" keeps
// the old single-slice behaviour reachable.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/league-office/actions";
import { ReasonDialog } from "./ReasonDialog";
import { MiniButton, PrimaryButton } from "./fields";
import { topFailure } from "@/lib/generation/failure-reasons";
import { advanceUntilDone, MAX_ADVANCE_SLICES } from "@/lib/generation/advance";

type Finding = { severity: "error" | "warning"; code: string; message: string };
type Run = {
  id: string; run_kind: string; status: string; target_count: number | null;
  written_count: number; failed_count: number; started_at: string;
  completed_at: string | null; superseded_at: string | null; last_heartbeat_at: string | null;
  // CC-DC-GEN-FAILURE-VISIBILITY-1.0 D5 — WHY, projected server-side out of
  // phase_cursor. Optional so an older cached payload still renders.
  failures?: Record<string, number> | null;
  lastFailure?: { key: string; message: string; at: string } | null;
  error?: string | null;
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
  // D3 — the loop's visible state: which slice is in flight and how it ended.
  const [loop, setLoop] = useState<{ slice: number } | null>(null);
  const [loopEnd, setLoopEnd] = useState<string | null>(null);
  const alive = useRef(true);
  const stopRef = useRef(false);
  // A1 — one loop, one slice at a time. A ref (not state) because the guard has
  // to be true the instant the handler runs, not after the next render.
  const loopingRef = useRef(false);

  // Fetch AND return the status, so the loop can read the run it just advanced
  // instead of racing React state.
  const fetchStatus = useCallback(async (): Promise<Status | null> => {
    try {
      const r = await fetch(`/api/lo/seasons/${seasonId}/generation`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!j?.ok) return null;
      const next = j.status as Status;
      if (alive.current) setStatus(next);
      return next;
    } catch {
      /* transient — next poll retries */
      return null;
    }
  }, [seasonId]);

  const refresh = useCallback(() => { void fetchStatus(); }, [fetchStatus]);

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

  /** One slice, the old behaviour — kept reachable (D3). */
  const advance = useCallback(async () => {
    if (loopingRef.current) return;
    setAdvancing(true);
    try {
      await fetch(`/api/lo/generation/worker`, { method: "POST" });
    } finally {
      setAdvancing(false);
      refresh();
    }
  }, [refresh]);

  /**
   * D3 — slice after slice until the run finishes. Every effect handed to
   * advanceUntilDone() is a thin closure; the stop conditions themselves are
   * advance.js's, and they are what the tests assert.
   */
  const continueUntilDone = useCallback(async (runId: string | null, seed: { status: string; written: number }) => {
    if (loopingRef.current) return;
    loopingRef.current = true;
    stopRef.current = false;
    setLoopEnd(null);
    setLoop({ slice: 1 });
    let trackedId = runId;
    try {
      const result = await advanceUntilDone({
        start: seed,
        shouldStop: () => stopRef.current || !alive.current,
        onTick: (t) => { if (alive.current) setLoop({ slice: t.slice }); },
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        slice: async () => {
          const res = await fetch(`/api/lo/generation/worker`, { method: "POST" });
          const j = await res.json().catch(() => null);
          // A lease held by the cron answers ok:true with report.idle — normal,
          // not an error (lease.js L3).
          return { ok: res.ok && j?.ok !== false, idle: j?.report?.idle === true };
        },
        readRun: async () => {
          const next = await fetchStatus();
          if (!next) return null;
          const r =
            (trackedId ? next.runs.find((x) => x.id === trackedId) : null) ??
            next.runs.find((x) => !x.completed_at && !x.superseded_at) ??
            null;
          if (!r) return null;
          trackedId = r.id;
          return { status: r.completed_at ? "complete" : r.status, written: r.written_count };
        },
      });
      if (alive.current) {
        setLoopEnd(
          result.reason === "finished" ? `Run ${result.status}.`
            : result.reason === "stopped" ? `Stopped after ${result.slices} slice${result.slices === 1 ? "" : "s"} — the cron carries on every 10 minutes.`
            : result.reason === "no-progress" ? "Stopped: 3 slices in a row wrote nothing. Check the failure note below."
            : result.reason === "slice-cap" ? `Stopped at the ${MAX_ADVANCE_SLICES}-slice ceiling — press Continue until done again.`
            : "Stopped: a worker slice did not answer. The cron will retry."
        );
      }
    } finally {
      loopingRef.current = false;
      stopRef.current = false;
      if (alive.current) setLoop(null);
      refresh();
    }
  }, [fetchStatus, refresh]);

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
        // D3 — a run the commissioner just asked for should finish, not wait for
        // the next cron tick. The run row exists but this payload predates it,
        // so the loop starts with no id and adopts the in-flight run on its
        // first re-read.
        if (action === "pilot" || action === "full")
          void continueUntilDone(null, { status: "queued", written: 0 });
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
      // CC-DC-SEASON-GOLIVE-1.0 (D5): approving no longer means "wait for the
      // nightly rotation" for today. Rows dated today go live on approval.
      description: `Publishes ${status.draftCount.toLocaleString()} generated draft${status.draftCount === 1 ? "" : "s"} across ${status.unapprovedDates.length} day${status.unapprovedDates.length === 1 ? "" : "s"} via fn_dc_approve_puzzles — Public IDs are assigned. Any puzzle dated today goes live immediately; later dates go live at midnight CT on their own date.`,
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
          minutes. Press “Continue until done”, and check the worker logs if it stays silent.
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
              <li key={r.id} style={{ display: "grid", gap: 3 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 12.5, color: "#141210", flexWrap: "wrap" }}>
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
                    loop ? (
                      <>
                        <MiniButton onClick={() => { stopRef.current = true; }}>Stop</MiniButton>
                        <span className="font-mono" style={{ fontSize: 10.5, color: "#94560a" }}>
                          slice {loop.slice} · {r.written_count}/{r.target_count ?? "?"}
                        </span>
                      </>
                    ) : (
                      <>
                        <MiniButton
                          onClick={() => continueUntilDone(r.id, { status: r.status, written: r.written_count })}
                          disabled={advancing}
                          title={`Runs worker slices back to back until the run finishes (max ${MAX_ADVANCE_SLICES}). Closing this tab just hands it back to the 10-minute cron.`}
                        >
                          Continue until done
                        </MiniButton>
                        <MiniButton onClick={advance} disabled={advancing} title="One slice only.">
                          {advancing ? "Advancing…" : "Advance one slice"}
                        </MiniButton>
                      </>
                    )
                  ) : null}
                </div>
                <FailureNote run={r} />
              </li>
            ))}
          </ul>
          {/* why the loop stopped — kept after the list so it survives the run
              completing (at which point the row loses its controls) */}
          {loopEnd ? (
            <p style={{ fontSize: 11.5, color: "#6b6257", margin: "6px 0 0" }}>{loopEnd}</p>
          ) : null}
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

/**
 * CC-DC-GEN-FAILURE-VISIBILITY-1.0 D5 — the one line that answers "why did it
 * fail?". The key already names the cause
 * (`db:23514:dc_puzzle_bank_staging_difficulty_canon`); the message is the
 * server-scrubbed Postgres message, never the row, the hints or the answer key.
 */
function FailureNote({ run }: { run: Run }) {
  const top = topFailure(run.failures);
  const shortfall = run.status === "failed_short" && run.error ? run.error : null;
  if (!top && !shortfall) return null;

  const parts: string[] = [];
  if (top) {
    // the stored message belongs to the LAST failure; show it only when that is
    // the reason being named, so the line never mislabels a message.
    const msg = run.lastFailure && run.lastFailure.key === top.key ? run.lastFailure.message : "";
    parts.push(`Top failure: ${top.key} ×${top.count}${msg ? ` — ${msg}` : ""}`);
    if (top.others > 0) parts.push(`+${top.others} other reason${top.others === 1 ? "" : "s"}`);
  }
  if (shortfall) parts.push(shortfall);

  return (
    <span style={{ fontSize: 11.5, color: "#9c3b2e", wordBreak: "break-word" }}>
      {parts.join(" · ")}
    </span>
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
