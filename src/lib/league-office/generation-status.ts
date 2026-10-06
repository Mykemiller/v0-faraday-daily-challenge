// Part D — server-side generation status for a season: THE one place the
// GENERATABLE checklist, warnings, targets, run state, stall alarm and
// bank-minimum alarm are assembled. The UI panel renders this verbatim
// (spec: "Implement once, server-side; do not duplicate these rules in the
// client") and every write re-derives it before acting.

import { q, type Svc } from "./service";
import { ctToday } from "./data";
import { loadConfigs, pickFocusConfig } from "./seasons";
import {
  generationFindings, generationWarnings, computeTargets, isStalled,
  bankAlarmApplies, bankCoverageWindow, bankMinimumFindings, bankServeDays,
  seasonDayCount, seasonDates,
  // CC-DC-GEN-DOMAIN-FIDELITY-1.0 D4 — the read side of the off-domain flag.
  offDomainFlags,
  type Finding, type GenerationInput, type GenRun, type GenSeason, type GenCatalogGame,
  type DomainFlagRow, type OffDomainFlag,
} from "./generation-logic";
import { fetchActiveDomainCodes } from "@/lib/generation/corpus";
import { failuresFrom, lastFailureFrom, clampMessage } from "@/lib/generation/failure-reasons";
// CC-LO-GEN-CONFORMANCE-1.0 D3 — "configured vs generated". A pure function
// over plain rows; this module's only job is to hand it the right columns.
import { conformance, type ConformanceReport } from "./generation-conformance";

/**
 * CC-DC-GEN-FAILURE-VISIBILITY-1.0 D5 — the run row as the PANEL sees it.
 *
 * `phase_cursor` is deliberately dropped and replaced by three whitelisted
 * projections. The commissioner needs to know WHY a run failed, and nothing
 * more of the cursor should reach a browser: a jsonb blob passed through
 * wholesale is how a future field ends up rendered by accident.
 */
export type GenRunView = Omit<GenRun, "phase_cursor"> & {
  /** reason key → count, accumulated across worker slices */
  failures: Record<string, number>;
  /** the most recent failure: key + message only, never content */
  lastFailure: { key: string; message: string; at: string } | null;
  /** the failed_short summary the worker already wrote */
  error: string | null;
};

export type GenerationStatus = {
  season: (GenSeason & { name: string; slug: string }) | null;
  configId: string | null;
  dayCount: number | null;
  targets: { gameName: string; requested: number; effective: number }[];
  totalTarget: number;
  pilotFindings: Finding[];
  fullFindings: Finding[];
  warnings: Finding[];
  runs: GenRunView[];
  stalledRunId: string | null;
  bankAlarms: Finding[];
  /** Draft rows of the latest pilot run, for the review table. */
  pilotPreview: {
    id: string; puzzle_type: string; puzzle_name: string; difficulty: string | null;
    domain: string | null; go_live_date: string; answer_key: string | null;
  }[];
  latestPilotRunStatus: string | null;
  draftCount: number;
  unapprovedDates: string[];
  /** CC-DC-GEN-DOMAIN-FIDELITY-1.0 D4 — unapproved drafts the model itself
   *  reported as outside their day's sector. Date + game + a structural
   *  reason; never a name, an answer or any other puzzle content. */
  offDomain: OffDomainFlag[];
  /**
   * CC-LO-GEN-CONFORMANCE-1.0 D3 — configured vs generated, for a season that
   * has actually generated something. `null` before the first run wrote a row:
   * comparing a bank that does not exist yet against its configuration would
   * report 100% short on every dimension, which is noise, not a finding.
   */
  conformance: ConformanceReport | null;
};

/**
 * CC-LO-GEN-CONFORMANCE-1.0 D3 — a whole-season read, paged.
 *
 * A 7-game, 365-day season is 2,555 bank rows, and PostgREST caps any single
 * response at the project's `max-rows`. A silently truncated page would be read
 * by the conformance table as a coverage FAILURE for rows that are sitting
 * right there, so the page size is re-derived from the first response rather
 * than assumed. `path` must already carry a deterministic `order=`.
 */
async function qPaged<T>(s: Svc, path: string, page = 1000): Promise<T[]> {
  const out: T[] = [];
  let step = page;
  for (let offset = 0; out.length < 50_000; offset += step) {
    const rows = await q<T>(s, `${path}&limit=${step}&offset=${offset}`);
    out.push(...rows);
    if (!rows.length) break;
    // A first page shorter than asked for is either the whole table or the
    // server's cap; either way it is the real page size from here on.
    if (offset === 0 && rows.length < step) step = rows.length;
    if (rows.length < step) break;
  }
  return out;
}

export async function getGenerationStatus(s: Svc, seasonId: string): Promise<GenerationStatus> {
  const empty: GenerationStatus = {
    season: null, configId: null, dayCount: null, targets: [], totalTarget: 0,
    pilotFindings: [], fullFindings: [], warnings: [], runs: [], stalledRunId: null,
    bankAlarms: [], pilotPreview: [], latestPilotRunStatus: null, draftCount: 0, unapprovedDates: [],
    offDomain: [], conformance: null,
  };

  const seasons = await q<GenSeason & { name: string; slug: string }>(
    s,
    `seasons?id=eq.${seasonId}&select=id,league_id,starts_on,ends_on,playoff_starts_on,roster_freeze_on,locked_at,pilot_approved_at,generated_at,name,slug&limit=1`
  );
  const season = seasons[0];
  if (!season) return empty;

  const configs = await loadConfigs(s, seasonId);
  const focus = pickFocusConfig(configs);
  const configId = focus?.id ?? null;

  const [slate, catalog, themeMix, difficultyMix, runs, corpusSectors] = await Promise.all([
    // CC-DC-GEN-DIFFICULTY-PERGAME-1.0 D3 — the floor/ceiling come down with
    // the slate: the checklist cannot say what the realized mix will be, or
    // that a window is empty, without them.
    configId
      ? q<GenerationInput["slate"][number]>(
          // CC-DC-GEN-SCHEDULE-FIELDS-1.0 — and the three calendar columns
          // with them: without appears_on_days and the per-game window the
          // checklist cannot say how many puzzles a game actually needs.
          s, `season_games?season_config_id=eq.${configId}&select=game_id,is_enabled,puzzle_count,difficulty_floor,difficulty_ceiling,appears_on_days,starts_on,ends_on`)
      : Promise.resolve([]),
    q<GenCatalogGame>(s, `game_catalog?select=id,game_key,display_name,lifecycle_state,runtime_key`),
    configId
      ? q<GenerationInput["themeMix"][number]>(
          s, `season_theme_mix?season_config_id=eq.${configId}&select=theater_id,sector_code,thread_code,target_pct,is_excluded`)
      : Promise.resolve([]),
    configId
      ? q<GenerationInput["difficultyMix"][number]>(
          s, `season_difficulty_mix?season_config_id=eq.${configId}&select=difficulty_band,target_pct,applies_to_game_id`)
      : Promise.resolve([]),
    q<GenRun>(
      s,
      `dc_puzzle_generation_runs?season_id=eq.${seasonId}&select=id,season_id,run_kind,status,target_count,written_count,failed_count,started_at,completed_at,superseded_at,last_heartbeat_at,phase_cursor&order=started_at.desc&limit=10`
    ),
    // CC-DC-GEN-THEME-ALLOCATION-1.0 D7 — theater_id + sector_code only. The
    // checklist needs to know which (theater, sector) pairs the corpus can
    // serve; it never needs a theme's title, blurb or threads to say so.
    q<{ theater_id: string; sector_code: string }>(
      s, `dc_daily_theme?season_id=is.null&select=theater_id,sector_code`),
  ]);

  // Condition 7's D-code set: live Domain Registry, fail-soft to the corpus-
  // derived sectors (the corpus was itself built from the live registry).
  const liveCodes = await fetchActiveDomainCodes();
  const activeDomainCodes = liveCodes ?? [...new Set(corpusSectors.map((r) => r.sector_code))];

  // ...and the same rows counted per (theater, sector) — the shape condition
  // 7's quota-fillability pre-flight reads (D7).
  const pairCounts = new Map<string, { theater_id: string; sector_code: string | null; count: number }>();
  for (const r of corpusSectors) {
    const key = `${r.theater_id}|${r.sector_code ?? ""}`;
    const hit = pairCounts.get(key);
    if (hit) hit.count += 1;
    else pairCounts.set(key, { theater_id: r.theater_id, sector_code: r.sector_code ?? null, count: 1 });
  }

  const inflightRuns = runs.filter((r) => !r.completed_at && !r.superseded_at);
  const input: GenerationInput = {
    season, slate, catalog, themeMix, difficultyMix, activeDomainCodes,
    corpusThemeCounts: [...pairCounts.values()], inflightRuns,
    // CC-DC-GEN-DIFFICULTY-ALLOCATION-1.0 D3 — the curve the generator will
    // actually place the bands along.
    difficultyCurve: focus?.difficulty_curve ?? null,
    // CC-DC-GEN-SCHEDULE-FIELDS-1.0 — the season's play days and its per-day
    // cap. `play_days_of_week` decides how many puzzles every target in this
    // panel is; `games_per_day` is validated against the calendar (D2) and
    // never used to choose which games run.
    playDaysOfWeek: focus?.play_days_of_week ?? null,
    gamesPerDay: focus?.games_per_day ?? null,
    // CC-DC-HINTS-FROM-CONFIG-1.0 D1 — validated against the bank's three
    // hint tiers; never used to pick anything.
    maxHintsPerGame: focus?.max_hints_per_game ?? null,
  };

  // D5: project the cursor down to the three failure facts; the blob itself
  // never leaves the server.
  const runViews: GenRunView[] = runs.map(({ phase_cursor, ...r }) => {
    const pc = (phase_cursor && typeof phase_cursor === "object" ? phase_cursor : {}) as Record<string, unknown>;
    return {
      ...r,
      failures: failuresFrom(phase_cursor),
      lastFailure: lastFailureFrom(phase_cursor),
      error: typeof pc.error === "string" ? clampMessage(pc.error) : null,
    };
  });

  const targets = computeTargets(input);
  const now = new Date().toISOString();
  const stalled = inflightRuns.find((r) => isStalled(r, now)) ?? null;

  // bank-minimum alarm (CC-LO-MIX-NORMALIZE-1.0 rescoped it):
  //   • only for a season that has been generated — bankAlarmApplies(); an
  //     un-generated season has nothing in the bank by definition and the
  //     checklist above is what says so.
  //   • THIS season's rows plus platform rows (season_id NULL, the D6 fallback)
  //     — never another season's puzzles, which cannot serve here.
  //   • only the serve dates inside the season window — a season ending in 5
  //     days needs 5 days covered, not 14.
  const configuredKeys = targets.perGame.map((g) => g.game.runtime_key).filter((k): k is string => !!k);
  const coverage: Record<string, number> = {};
  const window = bankCoverageWindow(ctToday(), season.starts_on, season.ends_on);
  if (bankAlarmApplies(season) && window.from && window.to && configuredKeys.length) {
    const coverageRows = await q<{ puzzle_type: string; go_live_date: string }>(
      s,
      `dc_puzzle_bank_staging?go_live_date=gte.${window.from}&go_live_date=lte.${window.to}` +
        `&published=in.(Published,Live)&or=(season_id.eq.${seasonId},season_id.is.null)&select=puzzle_type,go_live_date`
    );
    const seen = new Set<string>();
    for (const r of coverageRows) {
      const key = `${r.puzzle_type}|${r.go_live_date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      coverage[r.puzzle_type] = (coverage[r.puzzle_type] ?? 0) + 1;
    }
  }

  // pilot review table + approve state
  const latestPilot = runs.find((r) => r.run_kind === "pilot" && !r.superseded_at) ?? null;
  const pilotPreview = latestPilot
    ? await q<GenerationStatus["pilotPreview"][number]>(
        s,
        `dc_puzzle_bank_staging?generation_batch_id=eq.${latestPilot.id}&select=id,puzzle_type,puzzle_name,difficulty,domain,go_live_date,answer_key&order=puzzle_type.asc`
      )
    : [];

  // CC-DC-GEN-DOMAIN-FIDELITY-1.0 D4 — the SAME draft query answers the
  // approve count and the off-domain list, and its projection is exactly four
  // columns: go_live_date, puzzle_type, validation_status, validation_errors.
  // No puzzle_content, no hints, no answer_key — there is nothing here to leak.
  const drafts = await q<DomainFlagRow>(
    s,
    `dc_puzzle_bank_staging?season_id=eq.${seasonId}&published=eq.Unpublished` +
      `&select=go_live_date,puzzle_type,validation_status,validation_errors`
  );
  const unapprovedDates = [...new Set(drafts.map((r) => r.go_live_date))].sort();

  // CC-LO-GEN-CONFORMANCE-1.0 D3 — configured vs generated, but only once a
  // run has actually written something: before that there is no bank to
  // compare and every dimension would read 100% short.
  //
  // The two reads below are the ENTIRE data cost of this feature, and their
  // projections are three and four columns respectively. puzzle_content,
  // hints, answer_key and answer_explanation are not among them and must never
  // be: nothing on this panel needs a puzzle's answer to say whether the bank
  // matches its configuration.
  const hasGeneratedRows = runs.some((r) => (r.written_count ?? 0) > 0);
  let conformanceReport: ConformanceReport | null = null;
  if (hasGeneratedRows && season.starts_on && season.ends_on) {
    const [themeRows, bankRows] = await Promise.all([
      qPaged<{ theme_date: string; theater_id: string | null; sector_code: string | null; thread_codes: string[] | null }>(
        s, `dc_daily_theme?season_id=eq.${seasonId}&select=theme_date,theater_id,sector_code,thread_codes&order=theme_date.asc`),
      qPaged<{ puzzle_type: string | null; go_live_date: string | null; difficulty: string | null }>(
        s, `dc_puzzle_bank_staging?season_id=eq.${seasonId}&select=puzzle_type,go_live_date,difficulty&order=go_live_date.asc,puzzle_type.asc`),
    ]);
    conformanceReport = conformance({
      themeMix,
      difficultyMix,
      slate: slate.map((g) => {
        const game = catalog.find((c) => c.id === g.game_id) ?? null;
        return {
          runtime_key: game?.runtime_key ?? null,
          floor: g.difficulty_floor ?? null,
          ceiling: g.difficulty_ceiling ?? null,
          enabled: !!g.is_enabled,
        };
      }),
      themeRows: themeRows.map((r) => ({
        date: r.theme_date, theater_id: r.theater_id,
        sector_code: r.sector_code, thread_codes: r.thread_codes,
      })),
      bankRows,
      seasonDates: seasonDates(season.starts_on, season.ends_on),
    });
  }

  return {
    season,
    configId,
    dayCount: seasonDayCount(season.starts_on, season.ends_on),
    targets: targets.perGame.map((g) => ({ gameName: g.game.display_name, requested: g.requested, effective: g.effective })),
    totalTarget: targets.total,
    pilotFindings: generationFindings(input, false),
    fullFindings: generationFindings(input, true),
    warnings: generationWarnings(input),
    runs: runViews,
    stalledRunId: stalled?.id ?? null,
    // CC-DC-GEN-SCHEDULE-FIELDS-1.0 — the bar is per game: a Mon–Fri season
    // must not alarm for the weekend it never serves.
    bankAlarms: bankAlarmApplies(season)
      ? bankMinimumFindings(configuredKeys, coverage, window.required, bankServeDays(input, window.from, window.to))
      : [],
    pilotPreview,
    latestPilotRunStatus: latestPilot?.status ?? null,
    draftCount: drafts.length,
    unapprovedDates,
    offDomain: offDomainFlags(drafts),
    conformance: conformanceReport,
  };
}
