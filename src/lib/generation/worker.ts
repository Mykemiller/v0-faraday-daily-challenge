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
//                 unique(puzzle_type, go_live_date), so a re-run never duplicates.
//   HEARTBEAT   — last_heartbeat_at is written with every checkpoint.
//   BOUNDED     — batch size 8–12, hard time budget per slice.
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
import {
  validateContent, answerKeyFrom, checkHints, copyViolations,
  contentHash, subjectFingerprint, parseModelJson,
} from "./puzzle-schema";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";
export const GEN_MODEL = process.env.DC_GEN_MODEL || process.env.FAR287_GEN_MODEL || "claude-sonnet-4-6";

// ── PostgREST (loud failures — the worker records them per batch) ────────────
async function sb(s: Svc, path: string, init: RequestInit = {}): Promise<unknown> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...s.headers, ...(init.headers || {}) },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Supabase ${init.method || "GET"} ${path.split("?")[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
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
const sbInsert = (s: Svc, path: string, rows: unknown, prefer = "return=minimal") =>
  sb(s, path, { method: "POST", body: JSON.stringify(rows), headers: { Prefer: prefer } });

// ── Anthropic (same call shape + model as the proven FAR-287 client) ─────────
async function callModel(system: string, user: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is required to generate puzzles");
  const attempt = async () => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: GEN_MODEL, max_tokens: 4096, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
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

// difficulty bag from the season's difficulty mix (default 40/40/20), deterministic per slot
function difficultyFor(mix: { difficulty_band: string; target_pct: number }[], slot: number): string {
  const bands = mix.length ? mix : [
    { difficulty_band: "easy", target_pct: 40 },
    { difficulty_band: "medium", target_pct: 40 },
    { difficulty_band: "hard", target_pct: 20 },
  ];
  const order = ["easy", "medium", "hard"];
  const sorted = [...bands].sort((a, b) => order.indexOf(a.difficulty_band) - order.indexOf(b.difficulty_band));
  const total = sorted.reduce((a, b) => a + b.target_pct, 0) || 100;
  let acc = 0;
  const thresholds = sorted.map((b) => ({ band: b.difficulty_band, upto: (acc += (b.target_pct / total) * 10) }));
  const r = slot % 10;
  return thresholds.find((t) => r < t.upto)?.band ?? sorted[sorted.length - 1].difficulty_band;
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
};

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

/** One bounded slice of work against the oldest in-flight run. */
export async function runGenerationSlice(
  s: Svc,
  opts: { budgetMs?: number; batchSize?: number } = {}
): Promise<SliceReport> {
  const budgetMs = opts.budgetMs ?? 240_000;
  const batchSize = Math.max(8, Math.min(12, opts.batchSize ?? 10));
  const t0 = Date.now();
  const overBudget = () => Date.now() - t0 > budgetMs;
  const nowIso = () => new Date().toISOString();

  const runs = await sbGet<RunRow>(
    s,
    `dc_puzzle_generation_runs?completed_at=is.null&superseded_at=is.null&season_id=not.is.null&select=id,season_id,run_kind,status,target_count,written_count,failed_count,phase_cursor&order=started_at.asc&limit=1`
  );
  const run = runs[0];
  if (!run) return { idle: true };

  const checkpoint = (patch: Record<string, unknown>) =>
    sbPatch(s, `dc_puzzle_generation_runs?id=eq.${run.id}`, { last_heartbeat_at: nowIso(), ...patch });

  const seasons = await sbGet<SeasonRow>(s, `seasons?id=eq.${run.season_id}&select=id,slug,starts_on,ends_on,generated_at,locked_at&limit=1`);
  const season = seasons[0];
  if (!season) {
    await checkpoint({ status: "failed_short", completed_at: nowIso(), phase_cursor: { error: "season not found" } });
    return { runId: run.id, status: "failed_short", note: "season not found" };
  }

  if (run.status === "queued") await checkpoint({ status: "generating" });

  // resolve the focus config's slate + mixes (active first, else latest version)
  const configs = await sbGet<{ id: string }>(
    s,
    `season_config?season_id=eq.${season.id}&select=id,state,version&state=eq.active&limit=1`
  );
  const cfg = configs[0] ?? (await sbGet<{ id: string }>(s, `season_config?season_id=eq.${season.id}&select=id,version&order=version.desc&limit=1`))[0];
  if (!cfg) {
    await checkpoint({ status: "failed_short", completed_at: nowIso(), phase_cursor: { error: "no season_config" } });
    return { runId: run.id, status: "failed_short", note: "no season_config" };
  }
  const [slate, catalog, themeMixRows, difficultyMixRows] = await Promise.all([
    sbGet<{ game_id: string; is_enabled: boolean }>(s, `season_games?season_config_id=eq.${cfg.id}&select=game_id,is_enabled`),
    sbGet<{ id: string; runtime_key: string | null; lifecycle_state: string }>(s, `game_catalog?select=id,runtime_key,lifecycle_state`),
    sbGet<{ theater_id: string; sector_code: string | null; thread_code: string | null; is_excluded: boolean }>(
      s, `season_theme_mix?season_config_id=eq.${cfg.id}&select=theater_id,sector_code,thread_code,is_excluded`),
    sbGet<{ difficulty_band: string; target_pct: number; applies_to_game_id: string | null }>(
      s, `season_difficulty_mix?season_config_id=eq.${cfg.id}&select=difficulty_band,target_pct,applies_to_game_id`),
  ]);
  const byId = new Map(catalog.map((g) => [g.id, g]));
  const types = slate
    .filter((r) => r.is_enabled)
    .map((r) => byId.get(r.game_id))
    .filter((g): g is NonNullable<typeof g> => !!g && g.lifecycle_state === "live" && !!g.runtime_key)
    .map((g) => g.runtime_key as string);
  if (types.length === 0) {
    await checkpoint({ status: "failed_short", completed_at: nowIso(), phase_cursor: { error: "no live games enabled" } });
    return { runId: run.id, status: "failed_short", note: "no live games enabled" };
  }

  const dates = seasonDates(season.starts_on, season.ends_on);
  const cursor = { ...(run.phase_cursor || {}) } as Record<string, unknown>;
  const report: SliceReport = { runId: run.id, written: 0, failed: 0, themesInserted: 0 };

  // ── Phase A — season theme rows, derived from the corpus calendar ──────────
  // The 500 corpus rows (season_id NULL) are the reusable well (DEC-1/DEC-3).
  // Each season date gets its own row (season_id set); mix EXCLUSIONS are
  // honored by substituting the nearest non-excluded corpus row; target
  // percentages steer validation/warnings, not row-by-row re-derivation (v1 —
  // documented in PART-D-REPORT.md).
  if (cursor.themes_done !== true) {
    report.phase = "themes";
    const existing = await sbGet<{ theme_date: string }>(s, `dc_daily_theme?season_id=eq.${season.id}&select=theme_date`);
    const have = new Set(existing.map((r) => r.theme_date));
    const missing = dates.filter((d) => !have.has(d));
    if (missing.length) {
      const corpusRows = await sbGet<ThemeRow & Record<string, unknown>>(
        s,
        `dc_daily_theme?season_id=is.null&select=*&order=theme_date.asc&limit=600`
      );
      const exTheater = new Set(themeMixRows.filter((r) => r.is_excluded && !r.sector_code && !r.thread_code).map((r) => r.theater_id));
      const exSector = new Set(themeMixRows.filter((r) => r.is_excluded && r.sector_code && !r.thread_code).map((r) => r.sector_code as string));
      const exThread = new Set(themeMixRows.filter((r) => r.is_excluded && r.thread_code).map((r) => r.thread_code as string));
      const passes = (row: ThemeRow) =>
        !exTheater.has(row.theater_id) && !exSector.has(row.sector_code) &&
        !(row.thread_codes || []).some((c) => exThread.has(c));
      const byDate = new Map(corpusRows.map((r) => [r.theme_date, r]));
      const usedSources = new Set<string>();
      const toInsert: Record<string, unknown>[] = [];
      for (const date of missing) {
        let source = byDate.get(date);
        if (!source || !passes(source) || usedSources.has(source.id)) {
          source = corpusRows
            .filter((r) => passes(r) && !usedSources.has(r.id))
            .sort((a, b) => Math.abs(Date.parse(a.theme_date) - Date.parse(date)) - Math.abs(Date.parse(b.theme_date) - Date.parse(date)))[0];
        }
        if (!source) throw new Error(`no corpus theme row available for ${date} under the configured exclusions`);
        usedSources.add(source.id);
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
  // enabled game is globally free (the C½ import already covers early dates).
  const rangeRows = await sbGet<{ puzzle_type: string; go_live_date: string }>(
    s,
    `dc_puzzle_bank_staging?go_live_date=gte.${season.starts_on}&go_live_date=lte.${season.ends_on}&select=puzzle_type,go_live_date`
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
    const done = run.run_kind === "pilot" ? "pilot_complete" : "complete";
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

  const mineAtStart = await sbGet<{ id: string }>(s, `dc_puzzle_bank_staging?generation_batch_id=eq.${run.id}&select=id`);
  const baseWritten = mineAtStart.length;
  const baseFailed = run.failed_count || 0;
  let written = 0;
  let failed = 0;
  let sweptAll = true;

  outer:
  for (const type of types) {
    const typePending = pending.filter((p) => p.type === type);
    if (!typePending.length) continue;
    const fpSet = fpByType.get(type) ?? fpByType.set(type, new Set()).get(type)!;

    for (let i = 0; i < typePending.length; i += batchSize) {
      if (overBudget()) { sweptAll = false; break outer; }
      const slice = typePending.slice(i, i + batchSize);
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
          difficulty: difficultyFor(globalDiffMix, idx * 7 + types.indexOf(type)),
          threadScope: day.thread_names.join("; "),
        };
      });

      // CC-DC-GAME-REGISTRY-1.0 Q5: a game with no prompt spec is SKIPPED, not
      // sent to the model with a blank schema. A catalog row can exist before
      // its generator does; that must degrade, never fabricate.
      const user = userPrompt(type, items);
      if (!user) {
        console.warn(JSON.stringify({ at: "generation-worker", run: run.id, type, step: "skip", reason: "no prompt spec for this game type" }));
        continue;
      }

      let arr: Record<string, unknown>[] = [];
      try {
        const raw = await callModel(systemPrompt(type), user);
        arr = parseArray(raw);
      } catch (err) {
        failed += slice.length;
        console.error(JSON.stringify({ at: "generation-worker", run: run.id, type, step: "model", error: String(err) }));
        await checkpoint({ failed_count: baseFailed + failed, phase_cursor: { ...cursor, phase: "puzzles", type, at: slice[0]?.date } });
        continue;
      }

      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        const el = arr[k] as { puzzle?: Record<string, unknown>; hints?: string[]; answer_explanation?: string; difficulty?: string } | undefined;
        const content = el?.puzzle;
        const hints = el?.hints || [];
        const fail = (msg: string) => {
          failed++;
          console.error(JSON.stringify({ at: "generation-worker", run: run.id, type, date: it.date, error: msg }));
        };
        if (!content) { fail("no content parsed"); continue; }
        const v = validateContent(type, content);
        if (!v.ok) { fail("schema: " + v.errors.join("; ")); continue; }
        const answerKey = answerKeyFrom(type, content);
        const hv = checkHints(hints[0], hints[1], hints[2], answerKey);
        if (!hv.ok) { fail("hints: " + hv.errors.join("; ")); continue; }
        let copyBad = false;
        for (const text of [content.name, el?.answer_explanation, ...hints]) {
          const cv = copyViolations(text);
          if (cv.length) { fail("copy: " + cv.join("; ")); copyBad = true; break; }
        }
        if (copyBad) continue;
        const fp = subjectFingerprint(type, content);
        if (fpSet.has(fp)) { fail("subject repeat within the bank"); continue; }

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
            difficulty: el?.difficulty || it.difficulty,
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
          fail("db: " + String(err).slice(0, 200));
        }
      }

      await checkpoint({
        written_count: baseWritten + written,
        failed_count: baseFailed + failed,
        phase_cursor: { ...cursor, phase: "puzzles", type, at: slice[slice.length - 1]?.date },
      });
    }
  }

  report.written = written;
  report.failed = failed;
  const pendingAfter = pending.length - written;
  report.pendingAfter = pendingAfter;

  if (pendingAfter <= 0) {
    const done = run.run_kind === "pilot" ? "pilot_complete" : "complete";
    await checkpoint({ status: done, completed_at: nowIso(), written_count: baseWritten + written, phase_cursor: cursor });
    if (run.run_kind === "full" && !season.generated_at)
      await sbPatch(s, `seasons?id=eq.${season.id}`, { generated_at: nowIso() });
    report.status = done;
  } else if (sweptAll && written === 0 && failed > 0) {
    // a full sweep produced nothing — stop and report rather than loop forever
    await checkpoint({
      status: "failed_short",
      completed_at: nowIso(),
      written_count: baseWritten,
      failed_count: baseFailed + failed,
      phase_cursor: { ...cursor, error: `zero-progress sweep: ${pendingAfter} slots unreachable` },
    });
    report.status = "failed_short";
    report.note = `stopped short: ${pendingAfter} slots kept failing — see run phase_cursor and logs`;
  } else {
    report.status = "generating";
  }
  return report;
}
