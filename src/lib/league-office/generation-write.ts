// Part D — Tier 2 generation actions (server-only), dispatched from
// executeAction() so the mandatory reason, staff email and one-audit-row-per-
// write rule are identical to every other League Office mutation.
//
// Every action RE-DERIVES the server-side GENERATABLE status before writing —
// the UI's disabled buttons are presentation, never enforcement.

import { randomUUID } from "node:crypto";
import { q, type Svc } from "./service";
import { rpc } from "./seasons";
import { getGenerationStatus } from "./generation-status";
import { GEN_MODEL } from "@/lib/generation/worker";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

export type GenLogFn = (
  action: string,
  targetType: string,
  targetId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  reversible: boolean
) => Promise<string | null>;

type Result = { ok: boolean; message: string };

async function write(s: Svc, path: string, method: "POST" | "PATCH", body: unknown): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: { ...s.headers, Prefer: "return=minimal" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Queue a pilot or full run; the worker (staff trigger or the 10-minute cron)
 *  picks it up and advances it in bounded slices. */
export async function startGenerationRun(
  s: Svc,
  log: GenLogFn,
  input: { seasonId?: string; kind: "pilot" | "full" }
): Promise<Result> {
  if (!input.seasonId) return { ok: false, message: "Missing season." };
  const status = await getGenerationStatus(s, input.seasonId);
  if (!status.season) return { ok: false, message: "Season not found." };

  const findings = input.kind === "full" ? status.fullFindings : status.pilotFindings;
  if (findings.length)
    return { ok: false, message: `Not generatable — ${findings.map((f) => f.message).join(" ")}` };

  const targetCount =
    input.kind === "pilot" ? status.targets.length : status.totalTarget;
  if (!targetCount) return { ok: false, message: "Nothing to generate — the slate is empty." };

  const runId = randomUUID();
  const ok = await write(s, "dc_puzzle_generation_runs", "POST", {
    id: runId,
    season_id: input.seasonId,
    run_kind: input.kind,
    status: "queued",
    target_count: targetCount,
    written_count: 0,
    failed_count: 0,
    rotation_seed: `partd:${status.season.slug}`,
    registry_version: "IDF 4.0",
    params: { source: "league-office", model: GEN_MODEL, kind: input.kind },
  });
  if (!ok) return { ok: false, message: "Could not queue the run." };

  await log(`season.generate_${input.kind}`, "generation_run", runId, null, {
    season_id: input.seasonId,
    run_kind: input.kind,
    target_count: targetCount,
    warnings: status.warnings.map((w) => w.message),
  }, false);

  return {
    ok: true,
    message:
      input.kind === "pilot"
        ? `Pilot queued (${targetCount} puzzles) — the worker starts within minutes.`
        : `Full run queued (${targetCount} puzzles) — progress appears below as the worker advances.`,
  };
}

/** DEC-5: approving the pilot is what unlocks the full run. */
export async function approvePilot(
  s: Svc,
  log: GenLogFn,
  input: { seasonId?: string }
): Promise<Result> {
  if (!input.seasonId) return { ok: false, message: "Missing season." };
  const status = await getGenerationStatus(s, input.seasonId);
  if (!status.season) return { ok: false, message: "Season not found." };
  if (status.latestPilotRunStatus !== "pilot_complete")
    return { ok: false, message: "No completed pilot to approve — run the pilot first." };

  const before = { pilot_approved_at: status.season.pilot_approved_at };
  const at = new Date().toISOString();
  const ok = await write(s, `seasons?id=eq.${input.seasonId}`, "PATCH", { pilot_approved_at: at });
  if (!ok) return { ok: false, message: "Approve failed." };

  await log("season.approve_pilot", "season", input.seasonId, before, { pilot_approved_at: at }, false);
  return { ok: true, message: "Pilot approved — the full run is now unlocked." };
}

/** Publishes the season's generated drafts via fn_dc_approve_puzzles (C½ D4 —
 *  the ONLY Unpublished→Published path; the trigger mints Public IDs). */
export async function approveSeasonPuzzles(
  s: Svc,
  log: GenLogFn,
  staffEmail: string,
  input: { seasonId?: string }
): Promise<Result> {
  if (!input.seasonId) return { ok: false, message: "Missing season." };
  const drafts = await q<{ go_live_date: string }>(
    s,
    `dc_puzzle_bank_staging?season_id=eq.${input.seasonId}&published=eq.Unpublished&select=go_live_date`
  );
  const dates = [...new Set(drafts.map((r) => r.go_live_date))].sort();
  if (!dates.length) return { ok: false, message: "No unpublished generated puzzles for this season." };

  const r = await rpc<{ approved: number; public_ids: string[] }>(s, "fn_dc_approve_puzzles", {
    p_dates: dates,
    p_actor: staffEmail,
  });
  if (!r.ok) return { ok: false, message: `Approve failed — ${r.message}` };

  const approved = Number(r.data?.approved) || 0;
  await log("season.approve_puzzles", "season", input.seasonId, null, {
    dates,
    approved,
  }, false);
  return {
    ok: true,
    message: `${approved} puzzle${approved === 1 ? "" : "s"} approved and published across ${dates.length} day${dates.length === 1 ? "" : "s"} — Public IDs assigned.`,
  };
}
