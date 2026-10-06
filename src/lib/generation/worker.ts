// Part D — the generation worker. Runs on Vercel (Myke's runtime decision,
// 2026-08-01) as bounded, resumable SLICES: each invocation (staff trigger or
// the */10 cron) claims the oldest in-flight run, works until its time budget,
// checkpoints phase_cursor + counters + heartbeat after every batch, and exits.
// A killed slice loses at most one batch; the next slice resumes from the DB.
//
// Hard properties (each a Part D acceptance criterion):
//   RESUMABLE   — progress is derived from staging + dc_daily_theme, never from
//                 process memory; phase_cursor records where the last slice was.
//   IDEMPOTENT  — theme inserts use on_conflict (season_id, theme_date); puzzle
//                 slots are recomputed each slice against the GLOBAL
//                 unique(season_id, puzzle_type, go_live_date) — CC-LO-CONCURRENT-
//                 SEASONS-1.0 — so a re-run never duplicates.
//   HEARTBEAT   — last_heartbeat_at is written with every checkpoint.
//   EXCLUSIVE   — exactly one slice works a run at a time. The slice LEASES the
//                 run (phase_cursor.slice_active, compare-and-swapped on
//                 last_heartbeat_at) and releases it in a finally; a run whose
//                 lease is held is IDLE to everyone else, not an error
//                 (CC-DC-GEN-LEASE-AUTOADVANCE-1.0).
//   BOUNDED     — per-type starting batch size (≤8–12), halved on a truncated
//                 response, and no model call is STARTED unless
//                 elapsed + the moving-average batch duration still fits the
//                 slice budget (CC-DC-GEN-BATCH-HARDENING-1.0).
//   HONEST      — written_count = rows actually in staging for this run;
//                 a zero-progress sweep with failures ends the run as
//                 'failed_short' and reports, never silently finishes short.
//
// DEC-6: rows land Draft/Unpublished with public_id NULL (the assign-on-publish
// trigger is the only minter). DEC-7: Airtable is READ-ONLY (corpus.ts is the
// only Airtable access, GET-only).

import type { Svc } from "@/lib/league-office/service";
import { seasonDates } from "@/lib/league-office/generation-logic";
import { buildCorpus, buildSubjectPool, type Corpus, type ThemedDay } from "./corpus";
import { systemPrompt, userPrompt } from "./prompts";
import { effectiveTypeMix, planDifficulty, resolveRowDifficulty } from "./difficulty";
import {
  parsePostgrestError, restErrorMessage, failureKey, mergeFailures, lastFailureEntry, clampMessage,
} from "./failure-reasons";
import { allocateThemeCalendar, type ThemeAllocationError } from "./theme-allocation";
import {
  createBudget, genMaxTokens, runBatchWithSplit, startingBatchSize,
} from "./batching";
import {
  claimCursor, heartbeatGuard, isClaimable, leaseNote, releaseCursor, withLease,
} from "./lease";
import { isBenignSlotConflict, sliceOutcome } from "./slots";
import {
  validateContent, answerKeyFrom, checkHints, copyViolations,
  contentHash, subjectFingerprint, parseModelJson,
} from "./puzzle-schema";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";
export const GEN_MODEL = process.env.DC_GEN_MODEL || process.env.FAR287_GEN_MODEL || "claude-sonnet-4-6";

// ── PostgREST (loud failures — the worker records them per batch) ────────────

/**
 * CC-DC-GEN-FAILURE-VISIBILITY-1.0 D2 — a PostgREST failure that CARRIES its
 * diagnosis. The old code built `... ${status}: ${body.slice(0, 200)}` and the
 * per-item handler sliced that string again, so the SQLSTATE and the constraint
 * name — the only two facts that identify the fault — were routinely cut off
 * before anyone read them. `message` is now the structured D2 line and the
 * parsed facts ride along for failureKey(). PostgREST's `details` is never
 * read: on this table it contains the whole failing row (content + answer key).
 */
export class SupabaseRestError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly hint: string | null;
  readonly constraint: string | null;
  constructor(message: string, info: { status: number | null; code: string | null; hint: string | null; constraint: string | null }) {
    super(message);
    this.name = "SupabaseRestError";
    this.status = info.status;
    this.code = info.code;
    this.hint = info.hint;
    this.constraint = info.constraint;
  }
}

/** An Anthropic failure that carries its HTTP status, for `model:<status>` keys. */
export class ModelCallError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ModelCallError";
    this.status = status;
  }
}

async function sb(s: Svc, path: string, init: RequestInit = {}): Promise<unknown> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...s.headers, ...(init.headers || {}) },
    cache: "no-store",
  });
  if (!r.ok) {
    const method = (init.method || "GET").toUpperCase();
    const table = path.split("?")[0];
    const info = parsePostgrestError(r.status, await r.text());
    throw new SupabaseRestError(restErrorMessage(method, table, info), info);
  }
  // `Prefer: return=minimal` answers a POST with 201 + an EMPTY body (and a
  // PATCH/DELETE with 204). Calling r.json() on that empty body throws
  // "Unexpected end of JSON input" — which made every SUCCESSFUL staging insert
  // get counted as a `db:` failure, so a run that actually wrote its puzzles
  // still reported failed_short / 0 written. Read the body as text first and
  // only parse when there is one.
  if (r.status === 204) return null;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
const sbGet = <T>(s: Svc, path: string) => sb(s, path) as Promise<T[]>;
const sbPatch = (s: Svc, path: string, body: unknown) =>
  sb(s, path, { method: "PATCH", body: JSON.stringify(body), headers: { Prefer: "return=minimal" } });
/**
 * A PATCH that reports WHICH rows it hit. The lease claim is a conditional
 * update (CC-DC-GEN-LEASE-AUTOADVANCE-1.0 L2) and "did my filter match" is the
 * entire answer, so the body must come back. `select=id` keeps it to the id —
 * the run's phase_cursor never needs to travel for this.
 */
const sbPatchReturning = (s: Svc, path: string, body: unknown) =>
  sb(s, path, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { Prefer: "return=representation" },
  }) as Promise<{ id: string }[] | null>;
const sbInsert = (s: Svc, path: string, rows: unknown, prefer = "return=minimal") =>
  sb(s, path, { method: "POST", body: JSON.stringify(rows), headers: { Prefer: prefer } });

// ── Anthropic (same call shape + model as the proven FAR-287 client) ─────────

/**
 * CC-DC-GEN-BATCH-HARDENING-1.0 D1 — the call's result, not just its text.
 * `stopReason` is the ONLY signal that output was cut off; dropping it (the old
 * `Promise<string>`) is what made truncation look like a model that answered
 * fewer items. `ms` feeds the budget guard's moving average.
 */
export type ModelResult = { text: string; stopReason: string | null; ms: number };

async function callModel(system: string, user: string): Promise<ModelResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is required to generate puzzles");
  // 4096 could not hold the OLD minimum batch of 8 for The Brief (~5.3k est.
  // output tokens) — see the sizing table in batching.js.
  const maxTokens = genMaxTokens();
  const attempt = async (): Promise<ModelResult> => {
    const startedAt = Date.now();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: GEN_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new ModelCallError(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
    const data = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string | null };
    return {
      text: (data.content || []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
      stopReason: typeof data.stop_reason === "string" ? data.stop_reason : null,
      ms: Date.now() - startedAt,
    };
  };
  try {
    return await attempt();
  } catch (err) {
    // one retry for transient upstream trouble; a 400 (bad request / no credit) will just fail again fast
    await new Promise((r) => setTimeout(r, 2000));
    void err;
    return attempt();
  }
}

// salvage a JSON array from model output (fences stripped; balanced-object scan)
function parseArray(raw: string): Record<string, unknown>[] {
  const s = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const j = JSON.parse(s);
    return Array.isArray(j) ? j : [j];
  } catch { /* salvage below */ }
  const out: Record<string, unknown>[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && start >= 0) { const o = parseModelJson(s.slice(start, i + 1)); if (o) out.push(o as Record<string, unknown>); } }
  }
  return out;
}

// ── run/row types ────────────────────────────────────────────────────────────
type RunRow = {
  id: string;
  season_id: string | null;
  run_kind: string;
  status: string;
  target_count: number | null;
  written_count: number;
  failed_count: number;
  phase_cursor: Record<string, unknown>;
  // CC-DC-GEN-LEASE-AUTOADVANCE-1.0 L1/L2 — the two facts the lease needs:
  // how long the run has been silent, and the exact heartbeat value to
  // compare-and-swap the claim against.
  started_at: string | null;
  last_heartbeat_at: string | null;
};

/**
 * The mutable handle the lease and the checkpoints share (L4).
 *   cursor      — the phase_cursor the slice LAST wrote, so the release flips
 *                 slice_active without discarding the slice's progress.
 *   heartbeatAt — the heartbeat the slice last wrote through checkpoint(), or
 *                 the run's original value if it never got that far. The CLAIM
 *                 has to bump last_heartbeat_at (that is the compare-and-swap),
 *                 but a slice that threw before doing any work must not leave
 *                 behind a fresh heartbeat: the 30-minute stall banner
 *                 (isStalled) is the only alarm for a run that cannot progress,
 *                 and a per-cron claim would silence it forever. So the release
 *                 writes the TRUTHFUL value back.
 */
type Lease = { cursor: Record<string, unknown>; heartbeatAt: string | null };

type SeasonRow = {
  id: string; slug: string; starts_on: string; ends_on: string;
  generated_at: string | null; locked_at: string | null;
};

type ThemeRow = ThemedDay & { id: string; season_id: string | null };

export type SliceReport = {
  idle?: boolean;
  runId?: string;
  status?: string;
  phase?: string;
  themesInserted?: number;
  written?: number;
  failed?: number;
  skippedExisting?: number;
  pendingAfter?: number;
  note?: string;
};

/**
 * One bounded slice of work against the oldest in-flight run — under a LEASE.
 *
 * CC-DC-GEN-LEASE-AUTOADVANCE-1.0 D1. The claim is deliberately the FIRST write
 * this function makes, before the season/config reads, so two slices never both
 * get as far as computing `occupied`. The release is in withLease()'s finally,
 * so a slice that throws frees the run for the next cron firing rather than
 * parking it for STALE_LEASE_MS.
 */
export async function runGenerationSlice(
  s: Svc,
  opts: { budgetMs?: number; batchSize?: number } = {}
): Promise<SliceReport> {
  const nowIso = () => new Date().toISOString();

  const runs = await sbGet<RunRow>(
    s,
    `dc_puzzle_generation_runs?completed_at=is.null&superseded_at=is.null&season_id=not.is.null&select=id,season_id,run_kind,status,target_count,written_count,failed_count,phase_cursor,started_at,last_heartbeat_at&order=started_at.asc&limit=1`
  );
  const run = runs[0];
  if (!run) return { idle: true };

  // L1 — cheap local check first: a lease held and heartbeating means another
  // slice is mid-batch, and there is nothing for this one to do.
  if (!isClaimable(run, { now: Date.now() })) return { idle: true, note: leaseNote(run) };

  const lease: Lease = { cursor: claimCursor(run.phase_cursor), heartbeatAt: run.last_heartbeat_at };

  return withLease<SliceReport>({
    // L2 — compare-and-swap on the heartbeat we just read. Of two slices that
    // read the same row, the second one's filter matches nothing.
    claim: async () => {
      const rows = await sbPatchReturning(
        s,
        `dc_puzzle_generation_runs?id=eq.${run.id}&${heartbeatGuard(run.last_heartbeat_at)}&select=id`,
        { phase_cursor: lease.cursor, last_heartbeat_at: nowIso() }
      );
      return Array.isArray(rows) && rows.length > 0;
    },
    work: () => sliceBody(s, opts, run, lease),
    // L4 — written over the cursor the slice LAST checkpointed, so releasing
    // the lease cannot roll back this slice's progress — and with the heartbeat
    // the slice actually earned, so a slice that threw before doing any work
    // leaves the stall alarm armed rather than reset by its own claim.
    release: () =>
      sbPatch(s, `dc_puzzle_generation_runs?id=eq.${run.id}`, {
        phase_cursor: releaseCursor(lease.cursor),
        last_heartbeat_at: lease.heartbeatAt,
      }),
    onUnavailable: () => ({ idle: true, note: "lease held" }),
    onReleaseError: (err) =>
      console.error(JSON.stringify({ at: "generation-worker", run: run.id, step: "release-lease", error: String(err) })),
  });
}

async function sliceBody(
  s: Svc,
  opts: { budgetMs?: number; batchSize?: number },
  run: RunRow,
  lease: Lease
): Promise<SliceReport> {
  const budgetMs = opts.budgetMs ?? 240_000;
  const batchSize = Math.max(8, Math.min(12, opts.batchSize ?? 10));
  const t0 = Date.now();
  // CC-DC-GEN-BATCH-HARDENING-1.0 D4/B3 — the guard is "can one more
  // average-length batch finish", not "is the clock already past the budget".
  // The old `Date.now() - t0 > budgetMs` let a batch START at 249s on a 250s
  // budget and run into Vercel's 300s wall, losing it uncheckpointed.
  const budget = createBudget({ budgetMs, startedAt: t0 });
  const nowIso = () => new Date().toISOString();

  // CC-DC-GEN-FAILURE-VISIBILITY-1.0 D3 — WHY a run failed must survive the
  // slice that saw it. `baseFailures` is what the DB already had when this
  // slice claimed the run; `sliceFailures` is what THIS slice has seen so far.
  // Every checkpoint writes mergeFailures(base, slice), so a resumed run
  // accumulates across slices and a second checkpoint inside one slice is
  // idempotent rather than double-counting.
  const cursor = { ...(run.phase_cursor || {}) } as Record<string, unknown>;
  const baseFailures = cursor.failures;
  const sliceFailures: Record<string, number> = {};
  let lastFailure: { key: string; message: string; at: string } | null = null;
  const countFailure = (key: string, n = 1) => {
    sliceFailures[key] = (sliceFailures[key] ?? 0) + n;
  };
  const noteFailure = (key: string, message: string, n = 1) => {
    countFailure(key, n);
    lastFailure = lastFailureEntry(key, message, nowIso());
  };

  // CC-DC-GEN-LEASE-AUTOADVANCE-1.0 L4 — every checkpoint now ALWAYS writes a
  // phase_cursor (it used to skip the write when there was nothing new to say)
  // and always re-stamps `slice_active: true`, because the heartbeat and the
  // lease flag must stay in agreement: a run that is heartbeating is a run
  // someone owns. `lease.cursor` tracks what was last written so the release can
  // flip the flag without discarding this slice's progress.
  const checkpoint = (patch: Record<string, unknown>) => {
    const beat = nowIso();
    const body: Record<string, unknown> = { last_heartbeat_at: beat, ...patch };
    lease.heartbeatAt = beat;
    const given = body.phase_cursor;
    const hasCursor = !!given && typeof given === "object";
    const next: Record<string, unknown> = {
      ...(hasCursor ? (given as Record<string, unknown>) : cursor),
      slice_active: true,
      failures: mergeFailures(baseFailures, sliceFailures),
      ...(lastFailure ? { last_failure: lastFailure } : {}),
    };
    body.phase_cursor = next;
    lease.cursor = next;
    return sbPatch(s, `dc_puzzle_generation_runs?id=eq.${run.id}`, body);
  };

  const seasons = await sbGet<SeasonRow>(s, `seasons?id=eq.${run.season_id}&select=id,slug,starts_on,ends_on,generated_at,locked_at&limit=1`);
  const season = seasons[0];
  if (!season) {
    await checkpoint({ status: "failed_short", completed_at: nowIso(), phase_cursor: { error: "season not found" } });
    return { runId: run.id, status: "failed_short", note: "season not found" };
  }

  if (run.status === "queued") await checkpoint({ status: "generating" });

  // resolve the focus config's slate + mixes (active first, else latest version).
  // CC-DC-GEN-DIFFICULTY-ALLOCATION-1.0 D3 — `difficulty_curve` comes down with
  // it: the shape the commissioner previewed decides WHICH dates carry the
  // deeper bands, so the generator has to read it.
  type FocusConfig = { id: string; difficulty_curve?: string | null };
  const configs = await sbGet<FocusConfig>(
    s,
    `season_config?season_id=eq.${season.id}&select=id,state,version,difficulty_curve&state=eq.active&limit=1`
  );
  const cfg = configs[0] ?? (await sbGet<FocusConfig>(s, `season_config?season_id=eq.${season.id}&select=id,version,difficulty_curve&order=version.desc&limit=1`))[0];
  if (!cfg) {
    await checkpoint({ status: "failed_short", completed_at: nowIso(), phase_cursor: { error: "no season_config" } });
    return { runId: run.id, status: "failed_short", note: "no season_config" };
  }
  const [slate, catalog, themeMixRows, difficultyMixRows] = await Promise.all([
    // CC-DC-GEN-DIFFICULTY-PERGAME-1.0 D2 — the slate's difficulty WINDOW comes
    // down with it. These two columns were configured and read by nothing, and
    // the Football season banked 167 rows below their own game's floor as a
    // direct result (measured 2026-10-06).
    sbGet<{ game_id: string; is_enabled: boolean; difficulty_floor: string | null; difficulty_ceiling: string | null }>(
      s, `season_games?season_config_id=eq.${cfg.id}&select=game_id,is_enabled,difficulty_floor,difficulty_ceiling`),
    sbGet<{ id: string; runtime_key: string | null; lifecycle_state: string }>(s, `game_catalog?select=id,runtime_key,lifecycle_state`),
    sbGet<{ theater_id: string; sector_code: string | null; thread_code: string | null; target_pct: number; is_excluded: boolean }>(
      s, `season_theme_mix?season_config_id=eq.${cfg.id}&select=theater_id,sector_code,thread_code,target_pct,is_excluded`),
    sbGet<{ difficulty_band: string; target_pct: number; applies_to_game_id: string | null }>(
      s, `season_difficulty_mix?season_config_id=eq.${cfg.id}&select=difficulty_band,target_pct,applies_to_game_id`),
  ]);
  const byId = new Map(catalog.map((g) => [g.id, g]));
  // CC-DC-GEN-DIFFICULTY-PERGAME-1.0 D2 — the catalog row and the SLATE row are
  // carried together from here on: the runtime key names the type, and the
  // slate row carries the floor/ceiling that type is generated inside.
  const enabledGames = slate
    .filter((r) => r.is_enabled)
    .map((r) => ({ row: r, game: byId.get(r.game_id) }))
    .filter((x): x is { row: typeof x.row; game: NonNullable<typeof x.game> } =>
      !!x.game && x.game.lifecycle_state === "live" && !!x.game.runtime_key);
  const types = enabledGames.map((x) => x.game.runtime_key as string);
  if (types.length === 0) {
    await checkpoint({ status: "failed_short", completed_at: nowIso(), phase_cursor: { error: "no live games enabled" } });
    return { runId: run.id, status: "failed_short", note: "no live games enabled" };
  }

  const dates = seasonDates(season.starts_on, season.ends_on);
  const report: SliceReport = { runId: run.id, written: 0, failed: 0, themesInserted: 0 };

  // ── Phase A — season theme rows, allocated from the configured mix ────────
  // CC-DC-GEN-THEME-ALLOCATION-1.0 D8: `target_pct` is AUTHORITATIVE. The 500
  // corpus rows (season_id NULL) are the reusable well (DEC-1/DEC-3) and each
  // season date gets its own row (season_id set), but WHICH well row a date
  // draws is now decided by src/lib/generation/theme-allocation.js from the
  // commissioner's mix — included Theater (and Sector) target percentages
  // converted to whole days by largest remainder, exclusions applied on all
  // three axes, spread interleaved on the season id.
  //
  // What this replaces: the old loop matched the corpus row whose theme_date
  // EQUALLED the season date and substituted the nearest-dated row otherwise,
  // so the calendar was a function of the corpus window rather than of the
  // mix — and a season date past the end of that window (2027-12-13) exhausted
  // the tail rows and threw. Corpus row dates are now read by nothing here.
  //
  // The plan is computed over the WHOLE season so the quotas are season-wide,
  // and only the dates that have no row yet are inserted: a resumed run and a
  // partially-built season both stay correct, and no existing theme row is
  // modified or deleted (D8 — Football remediation is a separate issue).
  if (cursor.themes_done !== true) {
    report.phase = "themes";
    const existing = await sbGet<{ theme_date: string }>(s, `dc_daily_theme?season_id=eq.${season.id}&select=theme_date`);
    const have = new Set(existing.map((r) => r.theme_date));
    const missing = dates.filter((d) => !have.has(d));
    if (missing.length) {
      const corpusRows = await sbGet<ThemeRow & Record<string, unknown>>(
        s,
        // `order=id.asc` only so the 600-row window is a stable SET — the
        // allocator re-orders by its own seed and never reads theme_date.
        `dc_daily_theme?season_id=is.null&select=*&order=id.asc&limit=600`
      );
      let plan: ReturnType<typeof allocateThemeCalendar>;
      try {
        plan = allocateThemeCalendar({ dates, corpusRows, mixRows: themeMixRows, seed: season.id });
      } catch (e) {
        // D7 — an included Theater/Sector the corpus cannot serve is a
        // configuration fault. Fail the run and NAME it; never redistribute the
        // share onto whichever theaters happen to have rows.
        const err = e as ThemeAllocationError;
        const keys: string[] = Array.isArray(err?.failureKeys) && err.failureKeys.length
          ? err.failureKeys
          : [err?.failureKey || "theme:unfillable:-"];
        for (const k of keys) countFailure(k);
        noteFailure(keys[0], err?.message ?? String(e));
        await checkpoint({
          status: "failed_short",
          completed_at: nowIso(),
          phase_cursor: { ...cursor, error: clampMessage(err?.message ?? String(e)) },
        });
        return { ...report, status: "failed_short", note: clampMessage(err?.message ?? String(e)) };
      }
      const byId = new Map(corpusRows.map((r) => [String(r.id), r]));
      const needed = new Set(missing);
      const toInsert: Record<string, unknown>[] = [];
      for (const slot of plan) {
        if (!needed.has(slot.date)) continue;
        const source = byId.get(slot.sourceId);
        if (!source) continue; // unreachable: the plan only names rows it was given
        const date = slot.date;
        toInsert.push({
          theme_date: date,
          season_id: season.id,
          theater_id: source.theater_id, theater_name: source.theater_name,
          sector_code: source.sector_code, sector_name: source.sector_name,
          thread_codes: source.thread_codes, thread_names: source.thread_names,
          jpas_tier_code: source.jpas_tier_code,
          theme_title: source.theme_title, theme_blurb: source.theme_blurb,
          maturity_grade: source.maturity_grade, coverage_grade: source.coverage_grade ?? null,
          rotation_seed: source.rotation_seed, registry_version: source.registry_version,
          generation_run_id: run.id,
        });
      }
      for (let i = 0; i < toInsert.length; i += 50) {
        await sbInsert(
          s,
          `dc_daily_theme?on_conflict=season_id,theme_date`,
          toInsert.slice(i, i + 50),
          "return=minimal,resolution=ignore-duplicates"
        );
        report.themesInserted = (report.themesInserted ?? 0) + Math.min(50, toInsert.length - i);
      }
    }
    cursor.themes_done = true;
    await checkpoint({ phase_cursor: cursor });
  }

  // ── Phase B — puzzles ──────────────────────────────────────────────────────
  report.phase = "puzzles";

  // pilot = one puzzle per configured game (DEC-5), on the first date every
  // enabled game is free FOR THIS SEASON. CC-LO-CONCURRENT-SEASONS-1.0 D6: the
  // bank is unique per (season, type, date), so another season's rows — and the
  // season-less platform rows the C½ import left — do not occupy this season's
  // dates; a season's own row simply beats the platform row for its members.
  const rangeRows = await sbGet<{ puzzle_type: string; go_live_date: string }>(
    s,
    `dc_puzzle_bank_staging?season_id=eq.${season.id}&go_live_date=gte.${season.starts_on}&go_live_date=lte.${season.ends_on}&select=puzzle_type,go_live_date`
  );
  const occupied = new Set(rangeRows.map((r) => `${r.puzzle_type}|${r.go_live_date}`));

  let slotDates = dates;
  if (run.run_kind === "pilot") {
    let pilotDate = typeof cursor.pilot_date === "string" ? cursor.pilot_date : null;
    if (!pilotDate) {
      pilotDate = dates.find((d) => types.every((t) => !occupied.has(`${t}|${d}`))) ?? null;
      if (!pilotDate) {
        await checkpoint({ status: "failed_short", completed_at: nowIso(), phase_cursor: { ...cursor, error: "no free date for a pilot" } });
        return { ...report, status: "failed_short", note: "no free date for a pilot — every season date already has bank rows" };
      }
      cursor.pilot_date = pilotDate;
      await checkpoint({ phase_cursor: cursor });
    }
    slotDates = [pilotDate];
  }

  const pending: { type: string; date: string }[] = [];
  for (const type of types)
    for (const date of slotDates)
      if (!occupied.has(`${type}|${date}`)) pending.push({ type, date });
  report.skippedExisting = types.length * slotDates.length - pending.length;

  if (pending.length === 0) {
    const done = sliceOutcome({ runKind: run.run_kind, pendingCount: 0 }).status;
    const mine = await sbGet<{ id: string }>(s, `dc_puzzle_bank_staging?generation_batch_id=eq.${run.id}&select=id`);
    await checkpoint({ status: done, completed_at: nowIso(), written_count: mine.length, phase_cursor: cursor });
    if (run.run_kind === "full" && !season.generated_at)
      await sbPatch(s, `seasons?id=eq.${season.id}`, { generated_at: nowIso() });
    return { ...report, status: done, pendingAfter: 0 };
  }

  // context for generation
  const [corpus, themeRows, fpRows] = await Promise.all([
    buildCorpus(s),
    sbGet<ThemeRow>(s, `dc_daily_theme?season_id=eq.${season.id}&select=*`),
    sbGet<{ puzzle_type: string; subject_fingerprint: string | null }>(s, `dc_puzzle_bank_staging?select=puzzle_type,subject_fingerprint`),
  ]);
  const themeByDate = new Map(themeRows.map((r) => [r.theme_date, r]));
  const fpByType = new Map<string, Set<string>>();
  for (const r of fpRows) {
    if (!r.subject_fingerprint) continue;
    (fpByType.get(r.puzzle_type) ?? fpByType.set(r.puzzle_type, new Set()).get(r.puzzle_type)!).add(r.subject_fingerprint);
  }
  const globalDiffMix = difficultyMixRows.filter((d) => !d.applies_to_game_id);

  // ── the season's difficulty plan ──────────────────────────────────────────
  // CC-DC-GEN-DIFFICULTY-ALLOCATION-1.0 D4 — computed ONCE per slice, over the
  // FULL season date list and every enabled type, so the band counts are a
  // property of the season rather than of whichever slice happens to be
  // running. Each slot then just looks itself up. What this replaces: the
  // 10-slot bag in difficulty.js, keyed on `idx * 7 + types.indexOf(type)`,
  // which could only quantize the mix to tenths — Football asked for
  // 14.41/29.82/55.77 and banked 120/178/297 instead of 85/180/330 — and which
  // read difficulty_curve not at all.
  //
  // CC-DC-GEN-DIFFICULTY-PERGAME-1.0 D2 — and the mix each type is apportioned
  // against is now the game's OWN: its override rows
  // (season_difficulty_mix.applies_to_game_id, which this worker used to drop
  // on the floor) when it has any, else the season mix — clipped to the
  // game's [difficulty_floor, difficulty_ceiling] and renormalized. Rackl is
  // configured expert-expert, so Rackl is now 100% expert instead of 20/30/50
  // of a mix that was never its own.
  const perTypeMix: Record<string, { difficulty_band: string; target_pct: number }[]> = {};
  for (const { row, game } of enabledGames) {
    const eff = effectiveTypeMix({
      seasonMix: globalDiffMix,
      perGameRows: difficultyMixRows.filter((d) => d.applies_to_game_id === game.id),
      floor: row.difficulty_floor,
      ceiling: row.difficulty_ceiling,
    });
    // P4 — a floor deeper than the ceiling leaves no band to generate. The
    // League Office blocks this as `difficulty_window_empty` before a run is
    // ever queued; reaching it here means the slate changed under a queued run,
    // and inventing a band would be worse than stopping.
    if (!eff) {
      const note = `difficulty_window_empty: ${game.runtime_key}`;
      await checkpoint({ status: "failed_short", completed_at: nowIso(), phase_cursor: { ...cursor, error: note } });
      return { runId: run.id, status: "failed_short", note };
    }
    perTypeMix[game.runtime_key as string] = eff;
  }

  const diffPlan = planDifficulty({
    dates,
    types,
    mix: globalDiffMix,
    perTypeMix,
    curve: cfg.difficulty_curve ?? "flat",
    seed: season.id,
  });

  const mineAtStart = await sbGet<{ id: string }>(s, `dc_puzzle_bank_staging?generation_batch_id=eq.${run.id}&select=id`);
  const baseWritten = mineAtStart.length;
  const baseFailed = run.failed_count || 0;
  let written = 0;
  let failed = 0;
  // CC-DC-GEN-LEASE-AUTOADVANCE-1.0 D2 — slots this slice found already filled
  // by someone else MID-SLICE (the pre-computed `occupied` set could not know).
  // Filled is filled: these are progress, not failures.
  let duplicateSkips = 0;
  let sweptAll = true;

  outer:
  for (const type of types) {
    const typePending = pending.filter((p) => p.type === type);
    if (!typePending.length) continue;
    const fpSet = fpByType.get(type) ?? fpByType.set(type, new Set()).get(type)!;

    // CC-DC-GEN-BATCH-HARDENING-1.0 D3 — the first call's size is a property of
    // the GAME, not a single number for all seven. `batchSize` stays the upper
    // bound; a verbose type (The Brief) starts below it.
    const startSize = startingBatchSize(type, batchSize);

    for (let i = 0; i < typePending.length; i += startSize) {
      if (!budget.canAfford()) { sweptAll = false; break outer; }
      const slice = typePending.slice(i, i + startSize);
      const items = slice.map((p, k) => {
        const theme = themeByDate.get(p.date);
        const day: ThemedDay = theme ?? {
          theme_date: p.date, theater_id: "", theater_name: "the buildout", sector_code: "",
          sector_name: "AI infrastructure", thread_codes: [], thread_names: [], jpas_tier_code: "",
        };
        const pool = buildSubjectPool(corpus, day);
        const idx = dates.indexOf(p.date);
        return {
          date: p.date,
          day,
          subject: pool.length ? pool[(idx + types.indexOf(type) + k) % pool.length] : day.sector_name,
          theme: {
            theater_name: day.theater_name,
            sector_name: day.sector_name,
            thread_names: day.thread_names,
            tier_name: corpus.tier_names[day.jpas_tier_code] || day.jpas_tier_code,
          },
          difficulty: diffPlan.get(`${type}|${p.date}`) ?? "practitioner",
          threadScope: day.thread_names.join("; "),
        };
      });

      // CC-DC-GAME-REGISTRY-1.0 Q5: a game with no prompt spec is SKIPPED, not
      // sent to the model with a blank schema. A catalog row can exist before
      // its generator does; that must degrade, never fabricate.
      const user = userPrompt(type, items);
      if (!user) {
        const key = failureKey("skip");
        // Counted for visibility only: a skip is NOT a failure (the slot was
        // never attempted, and D6 keeps failed_count's meaning intact), and it
        // must not displace a real failure's last_failure message either.
        countFailure(key, slice.length);
        console.warn(JSON.stringify({ at: "generation-worker", run: run.id, type, step: "skip", key, reason: "no prompt spec for this game type" }));
        continue;
      }

      // CC-DC-GEN-BATCH-HARDENING-1.0 D2 — one model call per sub-slice, split
      // in half whenever `stop_reason` says the output was cut off and fewer
      // complete objects came back than were asked for. The split logic itself
      // is pure and lives in batching.js; the closure below is the only part
      // that touches the network.
      const batch = await runBatchWithSplit(items, {
        budget,
        call: async (sub) => {
          const subUser = userPrompt(type, sub);
          if (!subUser) throw new Error(`no prompt spec for ${type}`);
          const res = await callModel(systemPrompt(type), subUser);
          return { objects: parseArray(res.text), stopReason: res.stopReason, ms: res.ms };
        },
        log: (event) =>
          console.warn(JSON.stringify({ at: "generation-worker", run: run.id, type, ...event })),
      });

      for (const outcome of batch.outcomes) {
        const it = outcome.item;
        if (outcome.failure) {
          // A `truncated` or `model` failure already describes a whole
          // sub-slice; it arrives here once per ITEM so failed_count keeps its
          // meaning (slots that did not produce a row).
          failed++;
          const err = outcome.failure.error;
          const key = failureKey(outcome.failure.reason, {
            status: err instanceof ModelCallError ? err.status : null,
          });
          noteFailure(key, outcome.failure.message);
          console.error(JSON.stringify({ at: "generation-worker", run: run.id, type, date: it.date, key, error: outcome.failure.message }));
          continue;
        }
        const el = outcome.object as { puzzle?: Record<string, unknown>; hints?: string[]; answer_explanation?: string; difficulty?: string } | undefined;
        const content = el?.puzzle;
        const hints = el?.hints || [];
        // D4: the structured log line keeps its shape and gains `key`. The
        // messages below are STRUCTURAL ("Rackl g0: label", "hints: must be
        // distinct", "count phrase") — puzzle-schema never echoes content
        // values into them, which is why they are safe to persist and render.
        const fail = (kind: string, msg: string, info?: { code?: string | null; constraint?: string | null; status?: number | null }) => {
          failed++;
          const key = failureKey(kind, info);
          noteFailure(key, msg);
          console.error(JSON.stringify({ at: "generation-worker", run: run.id, type, date: it.date, key, error: msg }));
        };
        if (!content) { fail("no-content", "no content parsed"); continue; }
        const v = validateContent(type, content);
        if (!v.ok) { fail("schema", "schema: " + v.errors.join("; ")); continue; }
        const answerKey = answerKeyFrom(type, content);
        const hv = checkHints(hints[0], hints[1], hints[2], answerKey);
        if (!hv.ok) { fail("hints", "hints: " + hv.errors.join("; ")); continue; }
        let copyBad = false;
        for (const text of [content.name, el?.answer_explanation, ...hints]) {
          const cv = copyViolations(text);
          if (cv.length) { fail("copy", "copy: " + cv.join("; ")); copyBad = true; break; }
        }
        if (copyBad) continue;
        const fp = subjectFingerprint(type, content);
        if (fpSet.has(fp)) { fail("subject-repeat", "subject repeat within the bank"); continue; }

        const day = it.day;
        try {
          // DEC-6: Draft/Unpublished, public_id NULL (the trigger is the only minter)
          await sbInsert(s, `dc_puzzle_bank_staging`, [{
            theme_date: it.date,
            season_id: season.id,
            puzzle_type: type,
            puzzle_name: (content.name as string) || `${day.sector_name} ${type}`,
            go_live_date: it.date,
            status: "Draft",
            published: "Unpublished",
            puzzle_content: content,
            hint_1: hints[0], hint_2: hints[1], hint_3: hints[2],
            answer_key: answerKey,
            answer_explanation: el?.answer_explanation ?? null,
            domain: day.sector_code || null,
            sub_domain: (day.thread_codes || [])[0] || null,
            theater_id: day.theater_id || null,
            jpas_tier_code: day.jpas_tier_code || null,
            // CC-DC-GEN-DIFFICULTY-CANON-1.0 D1/D2: the season-assigned band is
            // authoritative for `difficulty` (the staging CHECK only accepts the
            // canonical three); the model's self-report is audit-only in difficulty_raw.
            ...resolveRowDifficulty(it.difficulty, el?.difficulty),
            subject_fingerprint: fp,
            source_refs: { subject: it.subject, thread_codes: day.thread_codes },
            content_hash: contentHash(content, answerKey),
            generation_batch_id: run.id,
            generator_model: GEN_MODEL,
            validation_status: "passed",
          }]);
          fpSet.add(fp);
          written++;
        } catch (err) {
          // The D2 message already reads
          //   `Supabase POST dc_puzzle_bank_staging 400 23514 new row ... constraint "..."`
          // so it is logged WHOLE — the old `String(err).slice(0, 200)` was a
          // second truncation of an already-truncated body and was exactly what
          // hid the SQLSTATE and the constraint name.
          const e = err instanceof SupabaseRestError ? err : null;
          // CC-DC-GEN-LEASE-AUTOADVANCE-1.0 D2/S1 — 23505 on
          // dc_staging_season_type_date_uniq means this exact (season, type,
          // date) slot already has a row. That is the outcome the slice wanted,
          // so it is a SKIP: it does not touch failed_count, it is not recorded
          // in phase_cursor.failures, and it counts as progress (S3) so a slice
          // that only hit duplicates cannot trip the zero-progress rule. S2:
          // any OTHER 23505 is still a failure.
          if (e && isBenignSlotConflict({ code: e.code, constraint: e.constraint })) {
            duplicateSkips++;
            fpSet.add(fp);
            console.warn(JSON.stringify({ at: "generation-worker", run: run.id, type, date: it.date, step: "slot-already-filled" }));
            continue;
          }
          fail("db", e ? e.message : String(err), e ? { code: e.code, constraint: e.constraint } : undefined);
        }
      }

      await checkpoint({
        written_count: baseWritten + written,
        failed_count: baseFailed + failed,
        phase_cursor: { ...cursor, phase: "puzzles", type, at: slice[slice.length - 1]?.date },
      });

      // B3 — the guard stopped mid-batch. Whatever was written is checkpointed
      // above; the unattempted slots stay pending and the next invocation (cron
      // or staff trigger) resumes from the DB. This is NOT a zero-progress
      // sweep, so `sweptAll` must say so.
      if (batch.stopped) { sweptAll = false; break outer; }
    }
  }

  report.written = written;
  report.failed = failed;
  // D2/S1 — the duplicates this slice discovered mid-flight join the slots that
  // were already filled when it started. Both are "skipped, not failed".
  report.skippedExisting = (report.skippedExisting ?? 0) + duplicateSkips;

  // D2/S3 — the completion and zero-progress rules now live in slots.js, where
  // the clause that matters ("a duplicate-only slice made progress") is a test
  // rather than an inline condition. The zero-progress THRESHOLD is unchanged.
  const outcome = sliceOutcome({
    runKind: run.run_kind,
    pendingCount: pending.length,
    written,
    duplicateSkips,
    failed,
    sweptAll,
  });
  const pendingAfter = outcome.pendingAfter;
  report.pendingAfter = pendingAfter;

  if (outcome.done && !outcome.failedShort) {
    await checkpoint({ status: outcome.status, completed_at: nowIso(), written_count: baseWritten + written, phase_cursor: cursor });
    if (run.run_kind === "full" && !season.generated_at)
      await sbPatch(s, `seasons?id=eq.${season.id}`, { generated_at: nowIso() });
    report.status = outcome.status;
  } else if (outcome.failedShort) {
    // a full sweep produced nothing — stop and report rather than loop forever
    await checkpoint({
      status: "failed_short",
      completed_at: nowIso(),
      written_count: baseWritten,
      failed_count: baseFailed + failed,
      phase_cursor: { ...cursor, error: `zero-progress sweep: ${pendingAfter} slots unreachable` },
    });
    report.status = "failed_short";
    report.note = outcome.note;
  } else {
    report.status = "generating";
  }
  return report;
}
