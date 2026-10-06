// Part D — Tier 2 generation actions (server-only), dispatched from
// executeAction() so the mandatory reason, staff email and one-audit-row-per-
// write rule are identical to every other League Office mutation.
//
// Every action RE-DERIVES the server-side GENERATABLE status before writing —
// the UI's disabled buttons are presentation, never enforcement.

import { randomUUID } from "node:crypto";
import { q, type Svc } from "./service";
import { loadConfigs, pickFocusConfig, rpc } from "./seasons";
import { getGenerationStatus } from "./generation-status";
import { GEN_MODEL } from "@/lib/generation/worker";
// CC-DC-SEASON-GOLIVE-1.0 (D5/B2): approving puzzles dated TODAY has to put
// them in front of players today, not at the next midnight rotation.
import { approvalGoLivePlan, goLiveToday, todayCT } from "@/lib/seasons/golive";
// CC-LO-GEN-CONFORMANCE-1.0 D4 — the failing dimensions, named in the audit row.
import { failingKeys } from "./generation-conformance";
// CC-LO-REGENERATE-FROM-DATE-1.0 — every rule that decides whether approved
// content may be deleted, and which archived rows may come back, is pure and
// exhaustively tested in regenerate-logic.test.ts. Nothing below re-implements
// one; this file supplies only the archive → verify → delete mechanics.
import {
  REMOVABLE_STATES,
  missingFromArchive,
  projectedAllocation,
  regenerationPlan,
  restorePlan,
  type ArchivedBankRow,
  type ArchivedThemeRow,
  type ProjectionGame,
  type RegenBankRow,
  type RegenRun,
  type RegenSeason,
} from "./regenerate-logic";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

export type GenLogFn = (
  action: string,
  targetType: string,
  targetId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  reversible: boolean
) => Promise<string | null>;

type Result = { ok: boolean; message: string; runId?: string };

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
  input: {
    seasonId?: string;
    kind: "pilot" | "full";
    /** CC-LO-REGENERATE-FROM-DATE-1.0 — extra `phase_cursor` keys stamped on
     *  the queued run. The worker treats unknown keys as inert resume state, so
     *  this records WHY the run exists without changing how it behaves: the
     *  slots it refills are exactly the ones regenerate_from emptied, because
     *  the worker already derives its pending set from the live bank. */
    phaseCursor?: Record<string, unknown>;
  }
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
    ...(input.phaseCursor ? { phase_cursor: input.phaseCursor } : {}),
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
    runId,
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

/** Publishes the season's generated drafts via fn_dc_approve_season_puzzles
 *  (the per-season form of C½ D4's ONLY Unpublished→Published path; the trigger
 *  mints Public IDs). */
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

  // CC-LO-GEN-CONFORMANCE-1.0 D4 — approval is NEVER blocked by conformance
  // (D5: this is a read-only feature). What changes is the record: when the
  // bank fails its configuration the UI makes the commissioner tick "I
  // understand the bank does not match the configuration", and the audit row
  // says so, with the dimensions that were failing at the moment of approval.
  //
  // Re-derived server-side, before the write, for the same reason every other
  // action in this file re-derives: a checkbox in a browser is presentation.
  const conf = (await getGenerationStatus(s, input.seasonId)).conformance;
  const ack = conf?.worst === "fail"
    ? { conformance_ack: true, conformance_failures: failingKeys(conf) }
    : {};

  // CC-LO-CONCURRENT-SEASONS-1.0 §3.6: approve THIS season's rows only — the
  // season-less fn_dc_approve_puzzles(dates, actor) would also publish another
  // season's drafts on the same dates.
  const r = await rpc<{ approved: number; public_ids: string[] }>(s, "fn_dc_approve_season_puzzles", {
    p_season_id: input.seasonId,
    p_dates: dates,
    p_actor: staffEmail,
  });
  if (!r.ok) return { ok: false, message: `Approve failed — ${r.message}` };

  const approved = Number(r.data?.approved) || 0;
  await log("season.approve_puzzles", "season", input.seasonId, null, {
    dates,
    approved,
    ...ack,
  }, false);

  // CC-DC-SEASON-GOLIVE-1.0 (D5/B2). fn_dc_approve_season_puzzles leaves rows
  // at 'Published'; the ONLY Published→Live writer used to be /api/cron/rotate
  // behind a CT-midnight guard, so an approval at 21:43 for today's date served
  // nothing all day. If today is one of the approved dates, go live now —
  // goLiveToday rotates through the puzzle-bank facade and re-syncs
  // dc_daily_page_content, and never throws, so a failure here downgrades to a
  // sentence instead of losing the approval that already succeeded.
  const today = todayCT();
  const plan = approvalGoLivePlan(dates, today);
  let suffix: string;
  if (plan.goLive) {
    const g = await goLiveToday(s, { reason: "season.approve_puzzles", actor: staffEmail });
    const failures = g.skipped.filter((reason) => reason.includes("-failed:"));
    suffix = failures.length
      ? ` — but today's puzzles could not be put live automatically (${failures.join("; ")}); the nightly rotation will pick them up.`
      : g.promoted > 0
        ? ` — today's ${g.promoted} puzzle${g.promoted === 1 ? "" : "s"} ${g.promoted === 1 ? "is" : "are"} now live.`
        : " — today's puzzles were already live.";
  } else {
    suffix = ` — first serve day is ${plan.firstServeDay}.`;
  }

  return {
    ok: true,
    message: `${approved} puzzle${approved === 1 ? "" : "s"} approved and published across ${dates.length} day${dates.length === 1 ? "" : "s"} — Public IDs assigned.${suffix}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CC-LO-REGENERATE-FROM-DATE-1.0 — replace an approved season from a date on
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY A SEPARATE SECTION, AND WHY SO MUCH CEREMONY
// These are the only two actions in the League Office that DELETE approved
// production content. Everything below exists to make three claims true and
// checkable by reading:
//
//   A. Archive before delete, with the count verified. Nothing is deleted until
//      the same number of rows has been read back out of the archive table. A
//      mismatch ABORTS before the first delete and leaves the bank untouched.
//   B. Live and Retired rows are never touched. Twice: the pure planner refuses
//      the whole operation if one exists in the range, and the delete is issued
//      by PRIMARY KEY against the exact ids that were archived, so a row that
//      went Live between the plan and the delete is not in the id list at all.
//   C. Restore never overwrites. The planner only returns empty future slots,
//      and the insert carries `resolution=ignore-duplicates`, which is
//      ON CONFLICT DO NOTHING — PostgREST is physically unable to upsert.
//
// Both actions DRY RUN BY DEFAULT: only `dryRun === false` executes. An omitted
// or malformed flag reports and writes nothing.

/** PostgREST will not take an unbounded id list in a URL. 100 uuids is ~3.7 kB
 *  of query string — comfortably inside every proxy's limit. */
const ID_CHUNK = 100;

/** PostgREST caps a single response; page until it stops giving. Same shape as
 *  generation-status.ts's reader, kept local so this file has one dependency
 *  surface (service.q) and no circular import. */
async function qAll<T>(s: Svc, path: string, page = 1000): Promise<T[]> {
  const out: T[] = [];
  let step = page;
  for (let offset = 0; out.length < 100_000; offset += step) {
    const rows = await q<T>(s, `${path}&limit=${step}&offset=${offset}`);
    out.push(...rows);
    if (!rows.length) break;
    if (offset === 0 && rows.length < step) step = rows.length;
    if (rows.length < step) break;
  }
  return out;
}

/** POST rows in chunks. `prefer` is spelled out at every call site because the
 *  difference between `ignore-duplicates` and `merge-duplicates` is the
 *  difference between "never overwrites" and "silently overwrites". */
async function insertChunked(
  s: Svc,
  path: string,
  rows: Record<string, unknown>[],
  prefer: string
): Promise<boolean> {
  for (let i = 0; i < rows.length; i += 50) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method: "POST",
        headers: { ...s.headers, Prefer: prefer },
        body: JSON.stringify(rows.slice(i, i + 50)),
        cache: "no-store",
      });
      if (!r.ok) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** DELETE by primary key, in chunks. Returns false on the first failure so the
 *  caller can report a partial delete rather than claim success. */
async function deleteByIds(s: Svc, table: string, ids: string[]): Promise<boolean> {
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const list = ids.slice(i, i + ID_CHUNK).map((id) => `"${id}"`).join(",");
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=in.(${list})`, {
        method: "DELETE",
        headers: { ...s.headers, Prefer: "return=minimal" },
        cache: "no-store",
      });
      if (!r.ok) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** The rows the archive actually holds for one operation — read BACK from the
 *  archive table, never inferred from "the insert returned 200".
 *
 *  F1: `order=id.asc` is load-bearing, not tidiness. `qAll` pages with
 *  limit/offset, and OFFSET paging over an UNORDERED result is formally
 *  undefined in Postgres — past one page, with concurrent writes, a row can
 *  come back twice while another is omitted. That would leave the cardinality
 *  check below passing over an INCOMPLETE archive, after which the delete is
 *  irreversible. A total order on the paging key makes the pages disjoint. */
async function archivedIds(s: Svc, table: string, supersededAt: string): Promise<string[]> {
  const rows = await qAll<{ id: string }>(
    s,
    `${table}?superseded_at=eq.${encodeURIComponent(supersededAt)}&select=id&order=id.asc`
  );
  return rows.map((r) => r.id);
}

/** At most 5 ids, so a failure message names the problem without becoming one. */
const sampleIds = (ids: string[]) =>
  ids.slice(0, 5).join(", ") + (ids.length > 5 ? `, +${ids.length - 5} more` : "");

/**
 * F4 — the runs read, with the failure distinguished from the empty result.
 *
 * `service.q()` is deliberately fail-soft: a bad read degrades the console to
 * an empty state rather than throwing a whole screen away. That is right for
 * every READER, and wrong for exactly one gate — "is a generation run in
 * flight?" — where an empty answer is the PERMISSIVE one. So this call site
 * does its own fetch and reports `ok: false` on any non-2xx, network error or
 * non-array body. `q()` itself is untouched; nothing else in the console
 * changes behaviour.
 */
async function readRuns(s: Svc, sid: string): Promise<{ ok: boolean; rows: RegenRun[] }> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_puzzle_generation_runs?season_id=eq.${sid}` +
        `&select=id,status,completed_at,superseded_at&order=started_at.desc&limit=20`,
      { headers: s.headers, cache: "no-store" }
    );
    if (!r.ok) return { ok: false, rows: [] };
    const body = await r.json().catch(() => null);
    if (!Array.isArray(body)) return { ok: false, rows: [] };
    return { ok: true, rows: body as RegenRun[] };
  } catch {
    return { ok: false, rows: [] };
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

type SeasonRow = RegenSeason & { name: string | null; slug: string | null };

async function loadSeason(s: Svc, seasonId: string): Promise<SeasonRow | null> {
  const rows = await q<SeasonRow>(
    s,
    `seasons?id=eq.${encodeURIComponent(seasonId)}&select=id,name,slug,starts_on,ends_on,locked_at&limit=1`
  );
  return rows[0] ?? null;
}

/** The configuration the projection is computed against — the same focus config
 *  getGenerationStatus picks, re-read here so a dry run does not depend on the
 *  panel having been loaded. */
async function loadProjectionInputs(s: Svc, seasonId: string) {
  // loadConfigs + pickFocusConfig, NOT a hand-rolled "the newest one": season
  // configs are versioned with a `state` (draft/scheduled/active) and the panel
  // already has one answer for which one is in force. A second answer here
  // would quietly project the season against a config nobody is generating
  // against.
  const focus = pickFocusConfig(await loadConfigs(s, seasonId));
  if (!focus) return { config: null, themeMix: [], seasonMix: [], games: [] as ProjectionGame[] };

  const [slate, catalog, themeMix, difficultyMix] = await Promise.all([
    q<{
      game_id: string; is_enabled: boolean;
      difficulty_floor: string | null; difficulty_ceiling: string | null;
      appears_on_days: number[] | null; starts_on: string | null; ends_on: string | null;
    }>(
      s,
      `season_games?season_config_id=eq.${focus.id}&select=game_id,is_enabled,difficulty_floor,difficulty_ceiling,appears_on_days,starts_on,ends_on`
    ),
    q<{ id: string; display_name: string; runtime_key: string | null }>(
      s, `game_catalog?select=id,display_name,runtime_key`),
    q<{ theater_id: string; sector_code: string | null; thread_code: string | null; target_pct: number; is_excluded: boolean }>(
      s, `season_theme_mix?season_config_id=eq.${focus.id}&select=theater_id,sector_code,thread_code,target_pct,is_excluded`),
    q<{ difficulty_band: string; target_pct: number; applies_to_game_id: string | null }>(
      s, `season_difficulty_mix?season_config_id=eq.${focus.id}&select=difficulty_band,target_pct,applies_to_game_id`),
  ]);

  const games: ProjectionGame[] = slate.map((g) => {
    const cat = catalog.find((c) => c.id === g.game_id) ?? null;
    return {
      runtime_key: cat?.runtime_key ?? null,
      display_name: cat?.display_name ?? g.game_id,
      is_enabled: !!g.is_enabled,
      difficulty_floor: g.difficulty_floor,
      difficulty_ceiling: g.difficulty_ceiling,
      appears_on_days: g.appears_on_days,
      starts_on: g.starts_on,
      ends_on: g.ends_on,
      perGameMix: difficultyMix.filter((d) => d.applies_to_game_id === g.game_id),
    };
  });

  return {
    config: { play_days_of_week: focus.play_days_of_week ?? null },
    themeMix,
    seasonMix: difficultyMix.filter((d) => !d.applies_to_game_id),
    games,
  };
}

/**
 * D2 — `season.regenerate_from`.
 *
 * Archives and removes this season's unserved puzzles from `cutoffDate` onward,
 * plus the season theme days for the same range, then queues an ordinary full
 * run that rebuilds them under the CURRENT configuration. The new rows arrive
 * Unpublished and still need the normal Approve Puzzles step (D3) — which, on
 * this stack, also shows the CC-LO-GEN-CONFORMANCE-1.0 table, so the
 * commissioner approves the replacement against the configuration that made it.
 */
export async function regenerateFrom(
  s: Svc,
  log: GenLogFn,
  staffEmail: string,
  input: { seasonId?: string; cutoffDate?: string; reason: string; dryRun?: boolean }
): Promise<Result> {
  if (!input.seasonId) return { ok: false, message: "Missing season." };
  const seasonId = input.seasonId;
  const season = await loadSeason(s, seasonId);
  const today = todayCT();

  // Everything the planner needs, measured now. The cutoff is only used as a
  // filter after it has been validated as a date by the planner, so a malformed
  // value can never reach PostgREST — an invalid plan returns before any query
  // that interpolates it runs.
  const cutoff = typeof input.cutoffDate === "string" ? input.cutoffDate.slice(0, 10) : "";
  const safeCutoff = /^\d{4}-\d{2}-\d{2}$/.test(cutoff) ? cutoff : null;
  // F5 — the season id comes from a JSON body. It is a uuid in every real call
  // and the reviewer could not construct a widening filter from it, but an
  // identifier that reaches a PostgREST query string gets encoded, full stop.
  const sid = encodeURIComponent(seasonId);

  const [rows, themeRows, runs] = safeCutoff
    ? await Promise.all([
        qAll<RegenBankRow>(
          s,
          `dc_puzzle_bank_staging?season_id=eq.${sid}&go_live_date=gte.${safeCutoff}` +
            `&select=puzzle_type,go_live_date,published&order=go_live_date.asc`
        ),
        // season_id=eq.<this season> and nothing else. dc_daily_theme ALSO holds
        // the shared platform corpus (season_id IS NULL) that every season's
        // Phase A draws from; deleting any of that would break generation for
        // the whole league.
        qAll<{ theme_date: string }>(
          s,
          `dc_daily_theme?season_id=eq.${sid}&theme_date=gte.${safeCutoff}&select=theme_date&order=theme_date.asc`
        ),
        // F4 — `q()` returns [] on a transient failure, and an empty runs list
        // is exactly what "nothing is in flight" looks like. Every other read
        // here degrades safely (fewer rows → abort); this one would degrade
        // OPEN, so it goes through a reader that reports WHETHER it read.
        readRuns(s, sid),
      ])
    : [[], [], { ok: false, rows: [] as RegenRun[] }];

  const plan = regenerationPlan({
    today, now: Date.now(), cutoff: safeCutoff, reason: input.reason,
    season, rows, themeRows,
    runs: runs.rows,
    runsRead: runs.ok,
  });

  if (!plan.ok || !plan.cutoffDate || !season)
    return { ok: false, message: plan.blocks.map((b) => b.message).join(" ") || "Cannot regenerate." };

  const cutoffDate = plan.cutoffDate;

  // ── the dry run (the default) ─────────────────────────────────────────────
  const proj = projectedAllocation({
    cutoff: cutoffDate,
    season: { starts_on: season.starts_on, ends_on: season.ends_on },
    ...(await loadProjectionInputs(s, seasonId)),
  });

  const summary =
    `${plan.cutoffDate} → ${season.ends_on ?? "season end"}: ` +
    `${plural(plan.removable, "puzzle")} (` +
    REMOVABLE_STATES.map((st) => `${plan.byPublished[st] ?? 0} ${st}`).join(", ") +
    `) across ${plural(plan.dates.length, "day")}, plus ${plural(plan.themeRows, "theme day")}. ` +
    `Cutoff is ${plan.hoursUntilCutoff ?? "?"}h away.`;

  if (input.dryRun !== false) {
    const theaters = proj.theaters.map((t) => `${t.theater_id} ${t.target_pct}% (${t.days}d)`).join(", ");
    const bands = proj.perGame
      .map((g) => `${g.game} ${g.bands ? Object.entries(g.bands).map(([b, n]) => `${b.slice(0, 4)} ${n}`).join("/") : "NO BAND WINDOW"}`)
      .join("; ");
    return {
      ok: true,
      message:
        `DRY RUN — nothing was changed. ${summary} ` +
        `Replacement under the current configuration: ${theaters || "no theme mix configured"}. ` +
        `Per game: ${bands || "no games enabled"}.`,
    };
  }

  // ── execute ───────────────────────────────────────────────────────────────
  // ONE timestamp for the whole operation: it is the batch key the verification
  // read, the audit backfill and any later forensic query all filter on.
  const supersededAt = new Date().toISOString();
  const stamp = {
    superseded_at: supersededAt,
    superseded_reason: input.reason,
    superseded_by: staffEmail,
    audit_id: null as string | null,
  };
  const removableFilter = `published=in.(${REMOVABLE_STATES.join(",")})`;

  // (1) read the FULL rows that are about to go. `select=*` is the only place
  //     in this feature that touches puzzle content, and it never leaves the
  //     server: it goes straight into the archive insert.
  const doomed = await qAll<Record<string, unknown>>(
    s,
    `dc_puzzle_bank_staging?season_id=eq.${sid}&go_live_date=gte.${cutoffDate}&${removableFilter}&select=*&order=go_live_date.asc`
  );
  if (doomed.length !== plan.removable)
    return {
      ok: false,
      message: `The bank changed while this was being prepared (${plan.removable} planned, ${doomed.length} found). Nothing was deleted — run the dry run again.`,
    };

  // (2) archive.
  const archivedOk = await insertChunked(
    s,
    "dc_puzzle_bank_superseded",
    doomed.map((r) => ({ ...r, ...stamp })),
    "return=minimal"
  );
  if (!archivedOk)
    return { ok: false, message: "The archive write failed — NOTHING was deleted. Check that the dc_puzzle_bank_superseded migration has been applied." };

  // (3) VERIFY the archive by reading it back, BY IDENTITY. A 200 on the insert
  //     is not evidence that the rows are there — and neither is a matching
  //     count (F1): the read is paged, and two lists of the same length are not
  //     the same list. Every id about to be deleted must be in the archive, and
  //     the archive must hold nothing else under this batch key.
  const doomedIds = doomed.map((r) => String(r.id));
  const archivedPuzzleIds = await archivedIds(s, "dc_puzzle_bank_superseded", supersededAt);
  const puzzleCheck = missingFromArchive(doomedIds, archivedPuzzleIds);
  if (!puzzleCheck.ok)
    return {
      ok: false,
      message:
        `Archive verification FAILED (${doomed.length} selected, ${archivedPuzzleIds.length} archived, ` +
        `${puzzleCheck.missing.length} missing${puzzleCheck.extra ? `, ${puzzleCheck.extra} unexpected` : ""}). ` +
        `NOTHING was deleted. The partial archive is tagged superseded_at=${supersededAt}` +
        (puzzleCheck.missing.length ? `; missing ids: ${sampleIds(puzzleCheck.missing)}` : "") + ".",
    };

  // (4) the same for the theme days. Archived before the puzzles are deleted so
  //     that an abort at any point up to here leaves a complete, restorable
  //     archive and an untouched bank.
  const doomedThemes = await qAll<Record<string, unknown>>(
    s,
    `dc_daily_theme?season_id=eq.${sid}&theme_date=gte.${cutoffDate}&select=*&order=theme_date.asc`
  );
  const doomedThemeIds = doomedThemes.map((r) => String(r.id));
  let archivedThemeIds: string[] = [];
  if (doomedThemes.length) {
    const themesOk = await insertChunked(
      s, "dc_daily_theme_superseded", doomedThemes.map((r) => ({ ...r, ...stamp })), "return=minimal"
    );
    if (!themesOk)
      return { ok: false, message: "The theme archive write failed — NOTHING was deleted." };
    archivedThemeIds = await archivedIds(s, "dc_daily_theme_superseded", supersededAt);
    const themeCheck = missingFromArchive(doomedThemeIds, archivedThemeIds);
    if (!themeCheck.ok)
      return {
        ok: false,
        message:
          `Theme archive verification FAILED (${doomedThemes.length} selected, ${archivedThemeIds.length} archived, ` +
          `${themeCheck.missing.length} missing${themeCheck.extra ? `, ${themeCheck.extra} unexpected` : ""}). ` +
          `NOTHING was deleted. superseded_at=${supersededAt}` +
          (themeCheck.missing.length ? `; missing ids: ${sampleIds(themeCheck.missing)}` : "") + ".",
      };
  }

  // (5) delete — BY PRIMARY KEY, using exactly the ids that step (3) proved are
  //     in the archive. The point of deleting by id rather than by re-running
  //     the predicate is that the archive and the delete are provably the SAME
  //     SET: a predicate evaluated twice can match rows the archive never saw.
  //
  //     F2 — what delete-by-id does NOT do is protect against a row turning
  //     Live mid-operation. `doomedIds` is snapshotted at step (1), before the
  //     archive, so a row that flips afterwards is still in the list and would
  //     still be deleted. The real guarantee is upstream and comes from the
  //     clock: `fn_dc_rotate_live_set` only ever promotes rows whose
  //     `go_live_date = p_today`, and MIN_CUTOFF_LEAD_DAYS forces every row in
  //     this range to be dated today + 2 or later. Nothing in the range can
  //     become Live while this function runs.
  //
  //     ⚠️ That property is ENTIRELY a function of MIN_CUTOFF_LEAD_DAYS >= 2.
  //     Shorten the lead to 1 and the rotation can reach the top of the range
  //     during the operation; shorten it to 0 and it certainly will. Whoever
  //     changes that constant is changing this guarantee, not a UX nicety.
  //
  //     Puzzles first, then themes — dc_staging_theme_fk points
  //     (season_id, theme_date) at dc_daily_theme, so the child goes first.
  const deletedPuzzles = await deleteByIds(s, "dc_puzzle_bank_staging", doomedIds);
  const deletedThemes = deletedPuzzles
    ? await deleteByIds(s, "dc_daily_theme", doomedThemeIds)
    : false;

  // (6) ONE audit row (domain 'seasons', reversible = false — the reversal is
  //     season.restore_superseded, not the generic revert path, because putting
  //     570 rows back is not a before-snapshot PATCH).
  const auditId = await log(
    "season.regenerate_from",
    "season",
    seasonId,
    {
      cutoff_date: cutoffDate,
      staging_by_published: plan.byPublished,
      staging_removed: doomed.length,
      theme_days_removed: doomedThemes.length,
      days: plan.dates.length,
      per_game: plan.perType,
    },
    {
      superseded_at: supersededAt,
      archived_puzzles: archivedPuzzleIds.length,
      archived_theme_days: archivedThemeIds.length,
      deleted_puzzles: deletedPuzzles,
      deleted_theme_days: deletedThemes,
      hours_until_cutoff: plan.hoursUntilCutoff,
      projected: { theaters: proj.theaters, per_game: proj.perGame },
    },
    false
  );

  // (7) stamp the archive with the audit row it belongs to. Best effort: the
  //     rows are already safe, and superseded_at alone identifies the batch.
  if (auditId) {
    const batch = `superseded_at=eq.${encodeURIComponent(supersededAt)}`;
    await write(s, `dc_puzzle_bank_superseded?${batch}`, "PATCH", { audit_id: auditId });
    if (archivedThemeIds.length)
      await write(s, `dc_daily_theme_superseded?${batch}`, "PATCH", { audit_id: auditId });
  }

  // F3 — a partial delete needs an ACCURATE recovery, not a cheerful one. The
  //     two halves fail differently and this action cannot repair either of
  //     them by being run again, so say what actually happened and name the
  //     step that does work.
  if (!deletedPuzzles)
    return {
      ok: false,
      message:
        `The archive is complete (superseded_at=${supersededAt}) but the puzzle delete did not finish, so some rows in this range are still in the bank. ` +
        `Nothing is lost. Re-run "Regenerate from date" with the same cutoff: the rows that survived are still Published, so the planner will see them and archive-and-delete them on the second pass.`,
    };
  if (doomedThemes.length && !deletedThemes)
    return {
      ok: false,
      message:
        `The ${plural(doomed.length, "puzzle")} from ${cutoffDate} were archived (superseded_at=${supersededAt}) and removed, but the theme days for that range were NOT removed — they are archived and still live. ` +
        `Re-running "Regenerate from date" will be REFUSED, because the range now holds no Published or Unpublished puzzles to remove. ` +
        `The recovery is to press "Generate puzzles": a normal full run fills only the slots that are empty and writes a theme row for any date that lacks one, so the leftover theme days are simply reused. ` +
        `No replacement run was queued by this action.`,
    };

  // (8) queue the replacement through the EXISTING generate_full path, so the
  //     gates, the target count and the audit row for the run itself are the
  //     ordinary ones. The worker derives its pending slots from the live bank,
  //     so the empty range is exactly what it fills; `regenerate_from` on the
  //     cursor records why the run exists.
  const queued = await startGenerationRun(s, log, {
    seasonId,
    kind: "full",
    phaseCursor: { regenerate_from: cutoffDate, superseded_at: supersededAt },
  });

  return {
    ok: true,
    message:
      `Removed ${plural(doomed.length, "puzzle")} and ${plural(doomedThemes.length, "theme day")} from ${cutoffDate}. ` +
      `All of it is archived (superseded_at=${supersededAt}) and "Restore superseded" can put it back into any slot still empty. ` +
      (queued.ok
        ? `${queued.message} The new puzzles arrive Unpublished and still need Approve Puzzles.`
        : `The replacement run could NOT be queued (${queued.message}) — press "Generate puzzles" once the checklist is green.`),
  };
}

/**
 * D6 — `season.restore_superseded`. The safety net.
 *
 * Puts archived rows back into slots that are EMPTY and dated today or later,
 * with their original `public_id`, `published = 'Published'` and approval
 * columns intact. The `dc_assign_public_id` trigger returns early for any row
 * that arrives with a public_id already set (verified against the live function
 * 2026-10-06), so a restored puzzle keeps the Public ID that is already in
 * players' share text rather than being minted a new one.
 *
 * It never overwrites. Twice: restorePlan() omits occupied slots, and the
 * insert carries `resolution=ignore-duplicates`, which PostgREST compiles to
 * ON CONFLICT DO NOTHING against dc_staging_season_type_date_uniq.
 */
export async function restoreSuperseded(
  s: Svc,
  log: GenLogFn,
  staffEmail: string,
  input: { seasonId?: string; fromDate?: string; reason: string; dryRun?: boolean }
): Promise<Result> {
  if (!input.seasonId) return { ok: false, message: "Missing season." };
  const seasonId = input.seasonId;
  // F5 — same rule as regenerateFrom: an identifier off the wire is encoded
  // before it reaches a PostgREST filter.
  const sid = encodeURIComponent(seasonId);
  const season = await loadSeason(s, seasonId);
  if (!season) return { ok: false, message: "Season not found." };

  const today = todayCT();
  const raw = typeof input.fromDate === "string" ? input.fromDate.slice(0, 10) : "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  // The read floor is today whatever was asked for — the planner enforces the
  // same rule, but there is no reason to pull the past out of the archive at
  // all.
  const floor = from && from > today ? from : today;

  const [archived, archivedThemes, existing, existingThemes] = from
    ? await Promise.all([
        qAll<ArchivedBankRow>(
          s,
          `dc_puzzle_bank_superseded?season_id=eq.${sid}&go_live_date=gte.${floor}` +
            `&select=id,puzzle_type,go_live_date,theme_date,superseded_at&order=go_live_date.asc`
        ),
        qAll<ArchivedThemeRow>(
          s,
          `dc_daily_theme_superseded?season_id=eq.${sid}&theme_date=gte.${floor}` +
            `&select=id,theme_date,superseded_at&order=theme_date.asc`
        ),
        qAll<{ puzzle_type: string; go_live_date: string }>(
          s,
          `dc_puzzle_bank_staging?season_id=eq.${sid}&go_live_date=gte.${floor}&select=puzzle_type,go_live_date`
        ),
        qAll<{ theme_date: string }>(
          s,
          `dc_daily_theme?season_id=eq.${sid}&theme_date=gte.${floor}&select=theme_date`
        ),
      ])
    : [[], [], [], []];

  const plan = restorePlan({
    today, fromDate: from, reason: input.reason,
    archived, archivedThemes, existing, existingThemes,
  });

  const summary =
    `${plural(plan.rows.length, "puzzle")} and ${plural(plan.themes.length, "theme day")} would be restored from ${plan.floorDate ?? "?"}. ` +
    `Skipped: ${plan.skipped.occupied} slot${plan.skipped.occupied === 1 ? "" : "s"} already filled (never overwritten), ` +
    `${plan.skipped.past} already in the past, ${plan.skipped.superseded} older archive cop${plan.skipped.superseded === 1 ? "y" : "ies"}, ` +
    `${plan.skipped.noTheme} with no theme day.`;

  if (!plan.ok) return { ok: false, message: plan.blocks.map((b) => b.message).join(" ") || "Nothing to restore." };

  if (input.dryRun !== false) {
    const sample = plan.slots.slice(0, 8).map((x) => `${x.puzzle_type} ${x.go_live_date}`).join(", ");
    return {
      ok: true,
      message: `DRY RUN — nothing was changed. ${summary}${sample ? ` Slots: ${sample}${plan.slots.length > 8 ? `, +${plan.slots.length - 8} more` : ""}.` : ""}`,
    };
  }

  // Themes FIRST: dc_staging_theme_fk (season_id, theme_date) → dc_daily_theme,
  // so a puzzle inserted before its day exists would be rejected.
  const stripArchiveColumns = (r: Record<string, unknown>) => {
    const { superseded_at: _a, superseded_reason: _b, superseded_by: _c, audit_id: _d, ...rest } = r;
    void _a; void _b; void _c; void _d;
    return rest;
  };

  let themesRestored = 0;
  if (plan.themes.length) {
    const ids = plan.themes.map((t) => t.id);
    const full = await qAll<Record<string, unknown>>(
      s,
      `dc_daily_theme_superseded?id=in.(${ids.map((i) => `"${i}"`).join(",")})&select=*`
    );
    const bySlot = new Map<string, Record<string, unknown>>();
    for (const t of plan.themes) {
      const row = full.find((f) => String(f.id) === t.id && String(f.superseded_at) === t.superseded_at);
      if (row) bySlot.set(t.theme_date, stripArchiveColumns(row));
    }
    const ok = await insertChunked(
      s,
      "dc_daily_theme?on_conflict=season_id,theme_date",
      [...bySlot.values()],
      "return=minimal,resolution=ignore-duplicates"
    );
    if (!ok) return { ok: false, message: "Restoring the theme days failed — nothing else was attempted." };
    themesRestored = bySlot.size;
  }

  let restored = 0;
  if (plan.rows.length) {
    const ids = plan.rows.map((r) => r.id);
    const full: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      full.push(
        ...(await qAll<Record<string, unknown>>(
          s,
          `dc_puzzle_bank_superseded?id=in.(${ids.slice(i, i + ID_CHUNK).map((x) => `"${x}"`).join(",")})&select=*`
        ))
      );
    }
    const bySlot = new Map<string, Record<string, unknown>>();
    for (const r of plan.rows) {
      const row = full.find((f) => String(f.id) === r.id && String(f.superseded_at) === r.superseded_at);
      // published = 'Published' and the original approval columns come back
      // verbatim from the archive — this is the row that was approved, not a
      // new one pretending to be it.
      if (row) bySlot.set(`${r.puzzle_type}|${r.go_live_date}`, stripArchiveColumns(row));
    }
    const ok = await insertChunked(
      s,
      "dc_puzzle_bank_staging?on_conflict=season_id,puzzle_type,go_live_date",
      [...bySlot.values()],
      "return=minimal,resolution=ignore-duplicates"
    );
    if (!ok)
      return { ok: false, message: `Restoring the puzzles failed after ${plural(themesRestored, "theme day")} were restored. Nothing was overwritten; re-run to retry.` };
    restored = bySlot.size;
  }

  await log(
    "season.restore_superseded",
    "season",
    seasonId,
    { from_date: plan.floorDate, archived_candidates: archived.length, skipped: plan.skipped },
    { restored_puzzles: restored, restored_theme_days: themesRestored, slots: plan.slots },
    false
  );

  return {
    ok: true,
    message: `Restored ${plural(restored, "puzzle")} and ${plural(themesRestored, "theme day")} from ${plan.floorDate}. ${summary.slice(summary.indexOf("Skipped:"))}`,
  };
}
