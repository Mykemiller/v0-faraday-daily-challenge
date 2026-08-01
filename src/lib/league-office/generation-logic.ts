// Part D (CC-FARADAY-LEAGUE-1.0) — pure generation gating logic.
//
// THE single implementation of the GENERATABLE conditions (spec conditions 1–10),
// mapped onto the live season-config model: season_config + season_games (by
// game_id → game_catalog) + season_difficulty_mix + season_theme_mix. The UI
// never re-implements these rules — it renders exactly what this module returns.
//
// Taxonomy note: season_theme_mix rows are keyed Theater → Sector → Thread, and
// the SECTOR codes are the IDF domain codes (D1–D23) — build-calendar's relaxed
// floors name "D16"/"D18" as sectors. Spec condition 7 ("every theme_emphasis
// key is an Active domain code queried live") is therefore enforced against the
// sector_code axis, with the Active D-code set supplied by the caller from the
// live Domain Registry (fail-soft to the corpus-derived set — see
// generation-status.ts).
//
// v1 reconciliation (documented in docs/league-model/PART-D-REPORT.md): the live
// bank enforces a GLOBAL unique (puzzle_type, go_live_date) — one puzzle per game
// per day. DEC-2's "override upward for selection surplus" is not representable
// until that constraint becomes league-aware, so puzzle_count above the day
// count WARNS (and the worker generates exactly one per day); below it ERRORS.

export type Finding = { severity: "error" | "warning"; code: string; message: string };

export type GenSeason = {
  id: string;
  league_id: string | null;
  starts_on: string | null;
  ends_on: string | null;
  playoff_starts_on: string | null;
  roster_freeze_on: string | null;
  locked_at: string | null;
  pilot_approved_at: string | null;
  generated_at: string | null;
};

export type GenCatalogGame = {
  id: string;
  game_key: string;
  display_name: string;
  lifecycle_state: string;
  runtime_key: string | null;
};

export type GenSlateGame = {
  game_id: string;
  is_enabled: boolean;
  puzzle_count: number | null;
};

export type GenThemeMixRow = {
  theater_id: string;
  sector_code: string | null;
  thread_code: string | null;
  target_pct: number;
  is_excluded: boolean;
};

export type GenDifficultyRow = {
  difficulty_band: string;
  target_pct: number;
  applies_to_game_id: string | null;
};

export type GenRun = {
  id: string;
  season_id: string | null;
  run_kind: string;
  status: string;
  target_count: number | null;
  written_count: number;
  failed_count: number;
  started_at: string;
  completed_at: string | null;
  superseded_at: string | null;
  last_heartbeat_at: string | null;
};

/** Never a game, never accepted, never surfaced (Phase 0 item 6). */
const DEAD_GAME_PATTERN = /logo[\s_-]*match/i;

export const STALL_MINUTES = 30;
export const BANK_MINIMUM_DAYS = 14;
export const RUN_SIZE_WARN = 2000;
export const THIN_CORPUS_SECTORS = ["D16", "D18"];
export const THIN_CORPUS_WARN_PCT = 15;

/** Inclusive day count of a season window; null when dates are missing/invalid. */
export function seasonDayCount(startsOn: string | null, endsOn: string | null): number | null {
  if (!startsOn || !endsOn) return null;
  const a = Date.parse(startsOn + "T12:00:00Z");
  const b = Date.parse(endsOn + "T12:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Every date of the window, inclusive, as YYYY-MM-DD. */
export function seasonDates(startsOn: string, endsOn: string): string[] {
  const out: string[] = [];
  const n = seasonDayCount(startsOn, endsOn) ?? 0;
  const t = new Date(startsOn + "T12:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

export type GenerationInput = {
  season: GenSeason;
  /** Enabled/disabled slate rows of the season's focus config (empty when no config). */
  slate: GenSlateGame[];
  catalog: GenCatalogGame[];
  themeMix: GenThemeMixRow[];
  difficultyMix: GenDifficultyRow[];
  /** Live Active D-codes from the Domain Registry (or the corpus fallback). */
  activeDomainCodes: string[];
  /** Runs for this season that are neither completed nor superseded. */
  inflightRuns: GenRun[];
};

const isHundred = (n: number) => Math.abs(n - 100) < 0.001;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Per-game generation targets. v1: exactly one puzzle per game per day (see the
 *  header note); requested surplus is reported so the UI can show the warning. */
export function computeTargets(input: GenerationInput): {
  dayCount: number | null;
  perGame: { game: GenCatalogGame; requested: number; effective: number }[];
  total: number;
} {
  const dayCount = seasonDayCount(input.season.starts_on, input.season.ends_on);
  const byId = new Map(input.catalog.map((g) => [g.id, g]));
  const perGame = input.slate
    .filter((r) => r.is_enabled)
    .flatMap((r) => {
      const game = byId.get(r.game_id);
      if (!game) return [];
      const requested = r.puzzle_count ?? dayCount ?? 0;
      return [{ game, requested, effective: dayCount ?? 0 }];
    });
  return { dayCount, perGame, total: sum(perGame.map((g) => g.effective)) };
}

/** Spec conditions 1–10 as blocking errors. `forFullRun` adds condition 10. */
export function generationFindings(input: GenerationInput, forFullRun: boolean): Finding[] {
  const out: Finding[] = [];
  const err = (code: string, message: string) => out.push({ severity: "error", code, message });
  const s = input.season;

  // 1 — identity + window
  if (!s.league_id) err("no_league", "The season has no league.");
  const dayCount = seasonDayCount(s.starts_on, s.ends_on);
  if (dayCount == null) err("no_window", "Season start and end dates are not set (or invalid).");

  // 2 — playoff + freeze dates present and ordered (Part A CHECKs re-stated as copy)
  if (!s.playoff_starts_on) err("no_playoff_date", "Playoff start date is not set.");
  if (!s.roster_freeze_on) err("no_freeze_date", "Roster freeze date is not set.");
  if (s.playoff_starts_on && s.starts_on && s.ends_on) {
    if (s.playoff_starts_on <= s.starts_on || s.playoff_starts_on > s.ends_on)
      err("playoff_outside_window", "Playoff start must fall inside the season window.");
  }
  if (s.roster_freeze_on && s.playoff_starts_on && s.roster_freeze_on > s.playoff_starts_on)
    err("freeze_after_playoff", "Roster freeze must be on or before the playoff start.");
  if (s.roster_freeze_on && s.starts_on && s.ends_on && dayCount != null) {
    const quarter = Math.floor((dayCount - 1) / 4);
    const t = new Date(s.starts_on + "T12:00:00Z");
    t.setUTCDate(t.getUTCDate() + quarter);
    if (s.roster_freeze_on < t.toISOString().slice(0, 10))
      err("freeze_too_early", "Roster freeze is earlier than a quarter of the way into the season.");
  }

  // 3 — at least one configured game
  const enabled = input.slate.filter((r) => r.is_enabled);
  if (enabled.length === 0) err("no_games", "No games are enabled for this season.");

  // 4 — every configured game is a LIVE catalog game; Logo Match is dead
  const byId = new Map(input.catalog.map((g) => [g.id, g]));
  for (const r of enabled) {
    const g = byId.get(r.game_id);
    if (!g) {
      err("unknown_game", "A configured game is not in the game catalog.");
      continue;
    }
    if (DEAD_GAME_PATTERN.test(g.game_key) || DEAD_GAME_PATTERN.test(g.display_name)) {
      err("dead_game", `"${g.display_name}" is not a game — Logo Match never shipped.`);
      continue;
    }
    if (g.lifecycle_state !== "live" || !g.runtime_key)
      err("game_not_live", `"${g.display_name}" is not a live game (lifecycle: ${g.lifecycle_state}).`);
  }

  // 5 — puzzle_count covers the season (DEC-2; surplus handled as a warning)
  if (dayCount != null) {
    for (const r of enabled) {
      const g = byId.get(r.game_id);
      if (r.puzzle_count != null && r.puzzle_count < dayCount)
        err(
          "puzzle_count_short",
          `"${g?.display_name ?? r.game_id}" requests ${r.puzzle_count} puzzles for a ${dayCount}-day season — never below one per day.`
        );
    }
  }

  // 6 — difficulty mix sums to exactly 100 (global rows; per-game overrides per game)
  const globalDiff = input.difficultyMix.filter((d) => !d.applies_to_game_id);
  if (globalDiff.length === 0) err("no_difficulty_mix", "No difficulty mix is configured.");
  else if (!isHundred(sum(globalDiff.map((d) => d.target_pct))))
    err("difficulty_mix_not_100", `Difficulty mix totals ${sum(globalDiff.map((d) => d.target_pct))}% (must be exactly 100%).`);
  const perGameDiff = new Map<string, number>();
  for (const d of input.difficultyMix)
    if (d.applies_to_game_id)
      perGameDiff.set(d.applies_to_game_id, (perGameDiff.get(d.applies_to_game_id) ?? 0) + d.target_pct);
  for (const [gid, pct] of perGameDiff)
    if (!isHundred(pct))
      err("game_difficulty_mix_not_100", `"${byId.get(gid)?.display_name ?? gid}" difficulty override totals ${pct}% (must be exactly 100%).`);

  // 7 — theme emphasis: sector codes must be live Active domain codes; mix sums to 100
  const active = new Set(input.activeDomainCodes);
  const included = input.themeMix.filter((t) => !t.is_excluded);
  if (included.length === 0) err("no_theme_mix", "No theme mix is configured.");
  else if (!isHundred(sum(included.map((t) => t.target_pct))))
    err("theme_mix_not_100", `Theme mix totals ${sum(included.map((t) => t.target_pct))}% (must be exactly 100%).`);
  for (const t of input.themeMix) {
    if (t.sector_code && active.size > 0 && !active.has(t.sector_code))
      err("unknown_domain_code", `Theme mix references "${t.sector_code}", which is not an Active domain in the live registry.`);
  }

  // 8 — lock
  if (s.locked_at) err("season_locked", "The season is locked — unlock it to change or generate anything.");

  // 9 — one run at a time
  if (input.inflightRuns.length > 0)
    err("run_in_flight", "A generation run is already in flight for this season.");

  // 10 — full runs require the approved pilot (DEC-5)
  if (forFullRun && !s.pilot_approved_at)
    err("pilot_not_approved", "The pilot has not been approved — review and approve it before the full run.");

  return out;
}

/** Non-blocking warnings for the confirm modal. */
export function generationWarnings(input: GenerationInput): Finding[] {
  const out: Finding[] = [];
  const warn = (code: string, message: string) => out.push({ severity: "warning", code, message });

  for (const t of input.themeMix) {
    if (!t.is_excluded && t.sector_code && THIN_CORPUS_SECTORS.includes(t.sector_code) && t.target_pct > THIN_CORPUS_WARN_PCT)
      warn(
        "thin_corpus_emphasis",
        `${t.sector_code === "D16" ? "Cyber & Physical Security" : "Community Opposition"} carries ${t.target_pct}% emphasis — its corpus is thin (floor_relaxed) and will under-produce.`
      );
  }

  const targets = computeTargets(input);
  if (targets.total > RUN_SIZE_WARN)
    warn("large_run", `This run requests ${targets.total.toLocaleString()} puzzles in one go.`);

  const dayCount = targets.dayCount;
  for (const g of targets.perGame)
    if (dayCount != null && g.requested > dayCount)
      warn(
        "surplus_unsupported",
        `"${g.game.display_name}" requests ${g.requested} puzzles but the bank stores one per game per day — generating ${dayCount}.`
      );

  return out;
}

/** Stall alarm: in-flight and silent for more than 30 minutes. */
export function isStalled(run: GenRun, nowIso: string): boolean {
  if (run.completed_at || run.superseded_at) return false;
  const last = run.last_heartbeat_at ?? run.started_at;
  const t = Date.parse(last);
  if (Number.isNaN(t)) return false;
  return Date.parse(nowIso) - t > STALL_MINUTES * 60_000;
}

/** Bank-minimum alarm (AUTO-031 role, from the Puzzle Bank's own field docs):
 *  every configured game needs ≥14 days of Published-or-Live coverage ahead of
 *  today. `coverage` = per runtime_key count of DISTINCT future serve dates in
 *  (today, today+14] that are Published or Live (today's Live row counts too). */
export function bankMinimumFindings(
  configuredRuntimeKeys: string[],
  coverage: Record<string, number>
): Finding[] {
  const out: Finding[] = [];
  for (const key of configuredRuntimeKeys) {
    const days = coverage[key] ?? 0;
    if (days < BANK_MINIMUM_DAYS)
      out.push({
        severity: "warning",
        code: "bank_minimum",
        message: `${key} has ${days} day${days === 1 ? "" : "s"} of Published/Live coverage ahead — below the ${BANK_MINIMUM_DAYS}-day bank minimum.`,
      });
  }
  return out;
}
