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
  bankMinimumFindings, seasonDayCount, BANK_MINIMUM_DAYS,
  type Finding, type GenerationInput, type GenRun, type GenSeason, type GenCatalogGame,
} from "./generation-logic";
import { fetchActiveDomainCodes } from "@/lib/generation/corpus";

export type GenerationStatus = {
  season: (GenSeason & { name: string; slug: string }) | null;
  configId: string | null;
  dayCount: number | null;
  targets: { gameName: string; requested: number; effective: number }[];
  totalTarget: number;
  pilotFindings: Finding[];
  fullFindings: Finding[];
  warnings: Finding[];
  runs: GenRun[];
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
};

function addDaysISO(iso: string, n: number): string {
  const t = new Date(iso + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export async function getGenerationStatus(s: Svc, seasonId: string): Promise<GenerationStatus> {
  const empty: GenerationStatus = {
    season: null, configId: null, dayCount: null, targets: [], totalTarget: 0,
    pilotFindings: [], fullFindings: [], warnings: [], runs: [], stalledRunId: null,
    bankAlarms: [], pilotPreview: [], latestPilotRunStatus: null, draftCount: 0, unapprovedDates: [],
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
    configId
      ? q<{ game_id: string; is_enabled: boolean; puzzle_count: number | null }>(
          s, `season_games?season_config_id=eq.${configId}&select=game_id,is_enabled,puzzle_count`)
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
      `dc_puzzle_generation_runs?season_id=eq.${seasonId}&select=id,season_id,run_kind,status,target_count,written_count,failed_count,started_at,completed_at,superseded_at,last_heartbeat_at&order=started_at.desc&limit=10`
    ),
    q<{ sector_code: string }>(s, `dc_daily_theme?season_id=is.null&select=sector_code`),
  ]);

  // Condition 7's D-code set: live Domain Registry, fail-soft to the corpus-
  // derived sectors (the corpus was itself built from the live registry).
  const liveCodes = await fetchActiveDomainCodes();
  const activeDomainCodes = liveCodes ?? [...new Set(corpusSectors.map((r) => r.sector_code))];

  const inflightRuns = runs.filter((r) => !r.completed_at && !r.superseded_at);
  const input: GenerationInput = {
    season, slate, catalog, themeMix, difficultyMix, activeDomainCodes, inflightRuns,
  };

  const targets = computeTargets(input);
  const now = new Date().toISOString();
  const stalled = inflightRuns.find((r) => isStalled(r, now)) ?? null;

  // bank-minimum alarm: coverage of the next 14 serve days per configured game
  const today = ctToday();
  const horizon = addDaysISO(today, BANK_MINIMUM_DAYS);
  const coverageRows = await q<{ puzzle_type: string; go_live_date: string }>(
    s,
    `dc_puzzle_bank_staging?go_live_date=gt.${today}&go_live_date=lte.${horizon}&published=in.(Published,Live)&select=puzzle_type,go_live_date`
  );
  const coverage: Record<string, number> = {};
  const seen = new Set<string>();
  for (const r of coverageRows) {
    const key = `${r.puzzle_type}|${r.go_live_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    coverage[r.puzzle_type] = (coverage[r.puzzle_type] ?? 0) + 1;
  }
  const configuredKeys = targets.perGame.map((g) => g.game.runtime_key).filter((k): k is string => !!k);

  // pilot review table + approve state
  const latestPilot = runs.find((r) => r.run_kind === "pilot" && !r.superseded_at) ?? null;
  const pilotPreview = latestPilot
    ? await q<GenerationStatus["pilotPreview"][number]>(
        s,
        `dc_puzzle_bank_staging?generation_batch_id=eq.${latestPilot.id}&select=id,puzzle_type,puzzle_name,difficulty,domain,go_live_date,answer_key&order=puzzle_type.asc`
      )
    : [];

  const drafts = await q<{ go_live_date: string }>(
    s,
    `dc_puzzle_bank_staging?season_id=eq.${seasonId}&published=eq.Unpublished&select=go_live_date`
  );
  const unapprovedDates = [...new Set(drafts.map((r) => r.go_live_date))].sort();

  return {
    season,
    configId,
    dayCount: seasonDayCount(season.starts_on, season.ends_on),
    targets: targets.perGame.map((g) => ({ gameName: g.game.display_name, requested: g.requested, effective: g.effective })),
    totalTarget: targets.total,
    pilotFindings: generationFindings(input, false),
    fullFindings: generationFindings(input, true),
    warnings: generationWarnings(input),
    runs,
    stalledRunId: stalled?.id ?? null,
    bankAlarms: bankMinimumFindings(configuredKeys, coverage),
    pilotPreview,
    latestPilotRunStatus: latestPilot?.status ?? null,
    draftCount: drafts.length,
    unapprovedDates,
  };
}
