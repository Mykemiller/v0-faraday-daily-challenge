// CC-LO-REGENERATE-FROM-DATE-1.0 — the pure rules behind "replace this
// season's puzzles from a date onward" and behind putting them back.
//
// Nothing in this file does I/O, reads a clock or touches Supabase. Every
// decision that can destroy approved content — may we proceed, which rows go,
// which slots may be refilled — is decided HERE, from values the caller
// measured, so it can be unit-tested exhaustively (regenerate-logic.test.ts)
// and so the server action in generation-write.ts is left with nothing but the
// mechanics of archiving, verifying and deleting.
//
// THE TWO INVARIANTS THE WHOLE FEATURE RESTS ON
//   R1  Nothing served, or about to be served, is ever touched. The cutoff is
//       at least two CT days out, and a single Live or Retired row anywhere in
//       [cutoff, ends_on] BLOCKS the whole operation rather than being skipped
//       — a Live row in the future range means the serve-day boundary is not
//       where this module thinks it is, and the safe answer is to stop.
//   R2  Restore never overwrites. `restorePlan` returns only slots that are
//       EMPTY right now and dated today or later; a slot that has been refilled
//       by the regeneration keeps its new puzzle.
//
// Run: npm run test:regenerate
//
// Relative imports with extensions: the test runs under plain `node --test`
// (type stripping), which does not read tsconfig `paths` — the same contract
// generation-logic.ts honours.
import { themeQuotas } from "../generation/theme-allocation.js";
import { difficultyTargets, effectiveTypeMix } from "../generation/difficulty.js";
import { scheduledDates, type ScheduleConfig, type ScheduleGame, type ScheduleSeason } from "../seasons/schedule.ts";

// ── shapes ───────────────────────────────────────────────────────────────────

export type RegenBlock = { code: string; message: string };

export type RegenSeason = {
  id: string;
  name?: string | null;
  starts_on: string | null;
  ends_on: string | null;
  locked_at: string | null;
};

/** A staging row, projected to the four columns this module reasons about.
 *  Deliberately NOT the whole row: nothing here needs a puzzle's answer. */
export type RegenBankRow = {
  puzzle_type: string;
  go_live_date: string;
  published: string;
};

export type RegenRun = {
  id: string;
  status: string;
  completed_at: string | null;
  superseded_at: string | null;
};

/** The puzzle states `regenerate_from` may archive and delete. Live and Retired
 *  are NOT here, and that is the point: a Live row has served or is serving. */
export const REMOVABLE_STATES = ["Published", "Unpublished"] as const;
/** A row in either of these states anywhere in the range aborts the operation. */
export const UNTOUCHABLE_STATES = ["Live", "Retired"] as const;

/** How many CT days after today the earliest acceptable cutoff is. Two, not
 *  one: "tomorrow" is already in the hands of the midnight rotation. */
export const MIN_CUTOFF_LEAD_DAYS = 2;

export type RegenerationPlan = {
  ok: boolean;
  blocks: RegenBlock[];
  cutoffDate: string | null;
  /** The earliest cutoff this `today` admits — quoted back in the error. */
  earliestCutoff: string;
  /** Hours from `now` to 00:00 America/Chicago on the cutoff. Null when the
   *  cutoff is unparseable. Negative is possible and is itself a block. */
  hoursUntilCutoff: number | null;
  /** Staging rows in [cutoff, ends_on], counted by `published`. */
  byPublished: Record<string, number>;
  /** How many of those this action would archive and delete. */
  removable: number;
  /** Rows in the range that must never be touched — nonzero means blocked. */
  untouchable: number;
  /** Season theme rows (season_id = this season) in the same range. */
  themeRows: number;
  /** Distinct go_live_dates among the removable rows, ascending. */
  dates: string[];
  /** Removable rows per game runtime key, so the confirm step can be specific. */
  perType: { puzzle_type: string; count: number }[];
};

// ── dates ────────────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD or null. Rejects "2026-13-40" as well as garbage. */
export function isoDateOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !ISO.test(value)) return null;
  const t = Date.parse(`${value}T12:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === value ? value : null;
}

/** `date` + n days, as YYYY-MM-DD. Noon anchoring keeps DST out of it. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The offset, in ms, that America/Chicago is ahead of UTC at the given
 *  instant. Pure: the instant is an argument, never `new Date()`. */
function ctOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

/** The UTC instant of 00:00 America/Chicago on `date`. Two passes, because the
 *  offset that applies is the one at the ANSWER, not at the guess — one DST
 *  Sunday a year the first pass is an hour out. */
export function ctMidnightMs(date: string): number | null {
  if (!isoDateOrNull(date)) return null;
  const naive = Date.parse(`${date}T00:00:00Z`);
  const once = naive - ctOffsetMs(naive);
  return naive - ctOffsetMs(once);
}

/** Whole-ish hours from `now` to 00:00 CT on `cutoff`, to one decimal. */
export function hoursUntil(nowIso: string | number | Date, cutoff: string): number | null {
  const target = ctMidnightMs(cutoff);
  if (target === null) return null;
  const now = nowIso instanceof Date ? nowIso.getTime() : typeof nowIso === "number" ? nowIso : Date.parse(nowIso);
  if (Number.isNaN(now)) return null;
  return Math.round(((target - now) / 3_600_000) * 10) / 10;
}

// ── the regeneration plan ────────────────────────────────────────────────────

export type RegenerationPlanInput = {
  /** Today in America/Chicago, YYYY-MM-DD (todayCT()). */
  today: string;
  /** The instant to measure hoursUntilCutoff from. */
  now?: string | number | Date;
  cutoff: string | null | undefined;
  reason?: string | null;
  season: RegenSeason | null | undefined;
  /** Staging rows for THIS season with go_live_date >= cutoff. The caller
   *  filters by season and by date; this module filters by nothing else. */
  rows: RegenBankRow[];
  /** Season theme rows (season_id = this season) with theme_date >= cutoff.
   *  Platform rows (season_id NULL) are a different, shared well and must not
   *  be in this list — deleting them would break every other season. */
  themeRows?: { theme_date: string }[];
  /** Every run row for the season; in-flight is derived here, once. */
  runs?: RegenRun[];
  /**
   * F4 — did the run read actually SUCCEED?
   *
   * `service.q()` returns `[]` on any failure, so a transient PostgREST error
   * on the runs query is indistinguishable from "no runs" at the call site.
   * Every other read in this feature degrades SAFELY when it fails — fewer
   * rows means fewer deletions, and the archive-count check aborts. This one
   * degrades OPEN: an empty `runs` array silently disables the in-flight guard
   * and permits a delete concurrent with a running worker.
   *
   * So the caller must state whether the read worked, and `undefined` is
   * treated as "did not read" — a caller that forgets this flag gets the
   * blocking answer, not the permissive one.
   */
  runsRead?: boolean;
};

export function regenerationPlan(input: RegenerationPlanInput): RegenerationPlan {
  const blocks: RegenBlock[] = [];
  const block = (code: string, message: string) => blocks.push({ code, message });

  const today = isoDateOrNull(input?.today) ?? "";
  const earliestCutoff = today ? addDays(today, MIN_CUTOFF_LEAD_DAYS) : "";
  const cutoff = isoDateOrNull(input?.cutoff);
  const season = input?.season ?? null;
  const rows = Array.isArray(input?.rows) ? input.rows : [];
  const themes = Array.isArray(input?.themeRows) ? input.themeRows : [];
  const runs = Array.isArray(input?.runs) ? input.runs : [];

  // 1 — a reason. executeAction enforces this too; stating it here means the
  // planner can be called from anywhere and still refuses an unreasoned delete.
  if (!(input?.reason ?? "").trim()) block("reason_required", "A reason is required.");

  // 2 — a season.
  if (!season) block("season_missing", "Season not found.");

  // 3 — a real cutoff date.
  if (!cutoff) block("cutoff_invalid", "Pick a cutoff date (YYYY-MM-DD).");
  if (!today) block("today_invalid", "Could not determine today's date.");

  // 4 — far enough out. R1: today+1 is already the midnight rotation's.
  if (cutoff && today && cutoff < earliestCutoff)
    block(
      "cutoff_too_soon",
      `The cutoff must be at least ${MIN_CUTOFF_LEAD_DAYS} days out — the earliest allowed is ${earliestCutoff}.`
    );

  // 5 — inside the season.
  if (cutoff && season?.ends_on && cutoff > season.ends_on)
    block("cutoff_after_season", `The cutoff is after the season ends (${season.ends_on}) — there is nothing to regenerate.`);
  if (cutoff && season?.starts_on && cutoff < season.starts_on)
    block("cutoff_before_season", `The cutoff is before the season starts (${season.starts_on}).`);

  // 6 — the lock. Named with the remedy, like condition 8 of the checklist.
  if (season?.locked_at) block("season_locked", "The season is locked — unlock it before regenerating.");

  // 7 — one run at a time, the same rule generate_full obeys.
  //
  // F4: the ABSENCE of runs only means "nothing in flight" if the read that
  // produced it succeeded. `runsRead === true` is the only value that lets this
  // gate pass on an empty list; anything else (false, undefined, a caller that
  // never heard of the flag) blocks. A failed read must never be mistaken for a
  // quiet season.
  if (input?.runsRead !== true && !runs.length)
    block(
      "runs_unreadable",
      "Could not read this season's generation runs, so it is not possible to tell whether one is in flight. Nothing was changed — try again."
    );
  const inflight = runs.filter((r) => r && !r.completed_at && !r.superseded_at);
  if (inflight.length) block("run_in_flight", "A generation run is already in flight for this season — wait for it to finish.");

  // ── counts ────────────────────────────────────────────────────────────────
  const byPublished: Record<string, number> = {};
  for (const r of rows) byPublished[r.published] = (byPublished[r.published] ?? 0) + 1;

  const removableSet = new Set<string>(REMOVABLE_STATES);
  const untouchableSet = new Set<string>(UNTOUCHABLE_STATES);
  const removableRows = rows.filter((r) => removableSet.has(r.published));
  const untouchable = rows.filter((r) => untouchableSet.has(r.published)).length;

  // 8 — R1, the one that matters most. A served or serving row in the range is
  // not skipped, it stops the operation: it means the range is not what the
  // commissioner thinks it is.
  if (untouchable > 0)
    block(
      "live_rows_in_range",
      `${untouchable} puzzle${untouchable === 1 ? " is" : "s are"} Live or Retired on or after ${cutoff ?? "the cutoff"} — nothing that has served can be regenerated. Move the cutoff later.`
    );

  // 9 — a cutoff that removes nothing is a no-op worth saying out loud rather
  // than a successful delete of zero rows.
  //
  // F3: but there are TWO ways to remove nothing, and they need different
  // advice. If the puzzles are gone and the theme days are still there, a
  // previous regenerate_from deleted the children and failed on the parents —
  // re-running this action cannot fix that (the range is already empty), and
  // the recovery is an ordinary full run, which refills empty slots and writes
  // a theme row for every date that lacks one.
  if (!blocks.length && removableRows.length === 0)
    block(
      themes.length > 0 ? "range_already_emptied" : "nothing_to_regenerate",
      themes.length > 0
        ? `No Published or Unpublished puzzles exist on or after ${cutoff}, but ${themes.length} theme day${themes.length === 1 ? "" : "s"} in that range do. The range has already been emptied — press "Generate puzzles" to refill it; the worker fills only empty slots and writes a theme row for any date that has none.`
        : `No Published or Unpublished puzzles exist on or after ${cutoff} for this season.`
    );

  const perTypeMap = new Map<string, number>();
  for (const r of removableRows) perTypeMap.set(r.puzzle_type, (perTypeMap.get(r.puzzle_type) ?? 0) + 1);

  return {
    ok: blocks.length === 0,
    blocks,
    cutoffDate: cutoff,
    earliestCutoff,
    hoursUntilCutoff: cutoff ? hoursUntil(input?.now ?? Date.now(), cutoff) : null,
    byPublished,
    removable: removableRows.length,
    untouchable,
    themeRows: themes.length,
    dates: [...new Set(removableRows.map((r) => r.go_live_date))].sort(),
    perType: [...perTypeMap.entries()]
      .map(([puzzle_type, count]) => ({ puzzle_type, count }))
      .sort((a, b) => a.puzzle_type.localeCompare(b.puzzle_type)),
  };
}

// ── what the new rows will look like ─────────────────────────────────────────

export type ProjectionGame = {
  runtime_key: string | null;
  display_name: string;
  is_enabled: boolean;
  difficulty_floor?: string | null;
  difficulty_ceiling?: string | null;
  appears_on_days?: number[] | null;
  starts_on?: string | null;
  ends_on?: string | null;
  /** season_difficulty_mix rows whose applies_to_game_id is this game. */
  perGameMix?: { difficulty_band: string; target_pct: number }[];
};

export type ProjectedAllocation = {
  /** Days in [cutoff, ends_on] — the theme calendar's denominator. */
  dayCount: number;
  theaters: { theater_id: string; target_pct: number; days: number }[];
  perGame: {
    game: string;
    runtime_key: string | null;
    days: number;
    /** Null when the game's [floor, ceiling] window admits no band at all —
     *  the same P4 fault generate_full blocks on. */
    bands: Record<string, number> | null;
  }[];
};

/**
 * What the commissioner is trading the deleted rows FOR: the theater shares and
 * per-game band counts the CURRENT configuration implies for the range, from
 * the same pure allocators the worker uses (CC-DC-GEN-THEME-ALLOCATION-1.0 and
 * CC-DC-GEN-DIFFICULTY-ALLOCATION-1.0 / -PERGAME-1.0). It is a projection, not
 * a promise — the worker re-plans over the WHOLE season, so a range in the
 * middle of a season will not match day for day. What it is for is answering
 * "will this actually change anything?" before 570 approved puzzles are
 * deleted.
 */
export function projectedAllocation(input: {
  cutoff: string;
  season: { starts_on: string | null; ends_on: string | null };
  config?: { play_days_of_week?: number[] | null } | null;
  themeMix?: { theater_id: string; sector_code: string | null; thread_code: string | null; target_pct: number; is_excluded: boolean }[];
  seasonMix?: { difficulty_band: string; target_pct: number }[];
  games?: ProjectionGame[];
}): ProjectedAllocation {
  const endsOn = input?.season?.ends_on ?? null;
  const cutoff = isoDateOrNull(input?.cutoff);
  const dayCount =
    cutoff && endsOn && endsOn >= cutoff
      ? Math.round((Date.parse(`${endsOn}T12:00:00Z`) - Date.parse(`${cutoff}T12:00:00Z`)) / 86_400_000) + 1
      : 0;

  const quotas = themeQuotas(input?.themeMix ?? [], dayCount) as {
    theaters: { theater_id: string; target_pct: number; days: number }[];
  };

  // The range, as a season window the schedule module understands — so a
  // Monday-only game is projected over the Mondays in the range, not over
  // every day of it.
  const rangeSeason: ScheduleSeason = { starts_on: cutoff, ends_on: endsOn };
  const scheduleConfig: ScheduleConfig = { play_days_of_week: input?.config?.play_days_of_week ?? null };

  const perGame = (input?.games ?? [])
    .filter((g) => g.is_enabled && g.runtime_key)
    .map((g) => {
      const game: ScheduleGame = {
        type: g.runtime_key as string,
        appears_on_days: g.appears_on_days ?? null,
        starts_on: g.starts_on ?? null,
        ends_on: g.ends_on ?? null,
      };
      const days = dayCount ? scheduledDates({ season: rangeSeason, config: scheduleConfig, game }).length : 0;
      const eff = effectiveTypeMix({
        seasonMix: input?.seasonMix ?? [],
        perGameRows: g.perGameMix ?? [],
        floor: g.difficulty_floor ?? null,
        ceiling: g.difficulty_ceiling ?? null,
      }) as { difficulty_band: string; target_pct: number }[] | null;
      return {
        game: g.display_name,
        runtime_key: g.runtime_key,
        days,
        bands: eff ? (difficultyTargets(eff, days) as Record<string, number>) : null,
      };
    });

  return { dayCount, theaters: quotas.theaters, perGame };
}

// ── the restore plan ─────────────────────────────────────────────────────────

export type ArchivedBankRow = {
  id: string;
  puzzle_type: string;
  go_live_date: string;
  theme_date: string | null;
  superseded_at: string;
};

export type ArchivedThemeRow = {
  id: string;
  theme_date: string;
  superseded_at: string;
};

export type RestorePlan = {
  ok: boolean;
  blocks: RegenBlock[];
  /** max(fromDate, today) — restore never reaches into the past (R2). */
  floorDate: string | null;
  /** Theme days to re-insert, in date order. Inserted BEFORE the puzzles:
   *  dc_staging_theme_fk points (season_id, theme_date) at dc_daily_theme. */
  themes: ArchivedThemeRow[];
  /** Puzzle rows to re-insert, in (date, type) order. */
  rows: ArchivedBankRow[];
  /** The slots `rows` would fill — what the dry run shows. */
  slots: { puzzle_type: string; go_live_date: string }[];
  skipped: {
    /** Slot already holds a puzzle. R2: it keeps it. */
    occupied: number;
    /** Dated before the floor — already served or serving. */
    past: number;
    /** Older archive copy of a slot a newer archive also holds. */
    superseded: number;
    /** No theme row for the day, live or restorable — the FK would reject it. */
    noTheme: number;
  };
};

export function restorePlan(input: {
  today: string;
  fromDate: string | null | undefined;
  reason?: string | null;
  archived: ArchivedBankRow[];
  archivedThemes?: ArchivedThemeRow[];
  /** Slots currently occupied in dc_puzzle_bank_staging for this season. */
  existing: { puzzle_type: string; go_live_date: string }[];
  /** Theme dates currently present in dc_daily_theme for this season. */
  existingThemes?: { theme_date: string }[];
}): RestorePlan {
  const blocks: RegenBlock[] = [];
  const block = (code: string, message: string) => blocks.push({ code, message });

  const today = isoDateOrNull(input?.today);
  const from = isoDateOrNull(input?.fromDate);
  if (!(input?.reason ?? "").trim()) block("reason_required", "A reason is required.");
  if (!from) block("from_invalid", "Pick a date to restore from (YYYY-MM-DD).");
  if (!today) block("today_invalid", "Could not determine today's date.");

  // R2 — today is a hard floor whatever the caller asks for. Restoring a row
  // onto a date that has already served would resurrect a puzzle players have
  // seen, under a Public ID that is already in someone's share text.
  const floorDate = today && from ? (from > today ? from : today) : null;

  const archived = Array.isArray(input?.archived) ? input.archived : [];
  const archivedThemes = Array.isArray(input?.archivedThemes) ? input.archivedThemes : [];
  const occupiedSlots = new Set(
    (Array.isArray(input?.existing) ? input.existing : []).map((r) => `${r.puzzle_type}|${r.go_live_date}`)
  );
  const liveThemeDates = new Set(
    (Array.isArray(input?.existingThemes) ? input.existingThemes : []).map((r) => r.theme_date)
  );

  const skipped = { occupied: 0, past: 0, superseded: 0, noTheme: 0 };

  if (!floorDate || blocks.length)
    return { ok: false, blocks, floorDate, themes: [], rows: [], slots: [], skipped };

  // ── themes first ──────────────────────────────────────────────────────────
  // One per date: a date archived twice keeps the MOST RECENT archive, because
  // that is the state the last regeneration removed.
  const themeByDate = new Map<string, ArchivedThemeRow>();
  for (const t of archivedThemes) {
    if (!t || !isoDateOrNull(t.theme_date)) continue;
    if (t.theme_date < floorDate) { skipped.past += 1; continue; }
    if (liveThemeDates.has(t.theme_date)) { skipped.occupied += 1; continue; }
    const seen = themeByDate.get(t.theme_date);
    if (seen) {
      skipped.superseded += 1;
      if ((t.superseded_at ?? "") <= (seen.superseded_at ?? "")) continue;
    }
    themeByDate.set(t.theme_date, t);
  }
  const themes = [...themeByDate.values()].sort((a, b) => a.theme_date.localeCompare(b.theme_date));

  // A day whose theme row will exist after this restore — live or about to be.
  const themeAvailable = new Set([...liveThemeDates, ...themeByDate.keys()]);

  // ── then the puzzles ──────────────────────────────────────────────────────
  const bySlot = new Map<string, ArchivedBankRow>();
  for (const r of archived) {
    if (!r || !isoDateOrNull(r.go_live_date)) continue;
    if (r.go_live_date < floorDate) { skipped.past += 1; continue; }
    const slot = `${r.puzzle_type}|${r.go_live_date}`;
    // R2 — the single most important line in this file.
    if (occupiedSlots.has(slot)) { skipped.occupied += 1; continue; }
    // dc_staging_theme_fk (season_id, theme_date) → dc_daily_theme. A row whose
    // theme day is neither live nor restorable cannot be inserted at all, so
    // say so here rather than letting PostgREST reject the batch.
    if (r.theme_date && !themeAvailable.has(r.theme_date)) { skipped.noTheme += 1; continue; }
    const seen = bySlot.get(slot);
    if (seen) {
      skipped.superseded += 1;
      if ((r.superseded_at ?? "") <= (seen.superseded_at ?? "")) continue;
    }
    bySlot.set(slot, r);
  }

  const rows = [...bySlot.values()].sort(
    (a, b) => a.go_live_date.localeCompare(b.go_live_date) || a.puzzle_type.localeCompare(b.puzzle_type)
  );

  if (!rows.length && !themes.length)
    block("nothing_to_restore", `No archived rows can be restored from ${floorDate} — every slot is either filled or already in the past.`);

  return {
    ok: blocks.length === 0,
    blocks,
    floorDate,
    themes,
    rows,
    slots: rows.map((r) => ({ puzzle_type: r.puzzle_type, go_live_date: r.go_live_date })),
    skipped,
  };
}

// ── the archive check ────────────────────────────────────────────────────────

/**
 * F1 — the archive check, by IDENTITY rather than cardinality.
 *
 * Two lists of the same length are not the same list. The ids are in hand on
 * both sides, so compare the sets: every id that is about to be deleted must be
 * present in the archive, and the archive must hold no more than those. A
 * length-only check passes on a duplicated-plus-omitted page; this does not.
 *
 * The concrete failure this exists for: `archivedIds` reads the archive back
 * through an OFFSET-paged query. Over an UNORDERED result that is formally
 * undefined in Postgres — past one page, under concurrent writes, a row can be
 * returned twice while another is omitted. The lengths still match, the caller
 * proceeds, and the next statement is an irreversible delete of rows that are
 * not in the archive. `order=id.asc` makes the pages disjoint and this makes
 * the check notice if they ever are not.
 *
 * Returns the ids that are MISSING from the archive — ids only. Puzzle content
 * never leaves the server and must never reach an error message.
 */
export function missingFromArchive(selectedIds: string[], archived: string[]): {
  ok: boolean;
  missing: string[];
  extra: number;
} {
  const have = new Set(archived);
  const missing = selectedIds.filter((id) => !have.has(id));
  // `extra` catches the other half of a bad page: the archive holding rows this
  // operation did not select. Non-zero means the batch key is not unique and
  // the whole premise of the verification is wrong, so it aborts too.
  const want = new Set(selectedIds);
  const extra = archived.filter((id) => !want.has(id)).length;
  return { ok: missing.length === 0 && extra === 0 && have.size === want.size, missing, extra };
}
