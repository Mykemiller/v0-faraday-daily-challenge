// Season slate — server-side resolution of which games the active season serves.
//
// Reads: the CALLER'S season (CC-LO-CONCURRENT-SEASONS-1.0 — resolved by
// /api/challenge/today via lib/seasons/resolve, never here) → its ACTIVE
// season_config → enabled season_games →
// game_catalog.runtime_key. That last hop matters: `runtime_key` is the join key
// the runtime actually uses (D3), while `game_key` is a snake_case slug nothing
// joins on. Keying off game_key here would silently match nothing and — via the
// fail-safe — look like "no slate configured" forever.
//
// NEVER THROWS. Every failure path returns null, which callers treat as "no
// slate" and therefore serve everything. See season-slate.ts for why.

// CC-DC-GEN-SCHEDULE-FIELDS-1.0 — the serve path asks the SAME module the
// League Office checklist and the generator ask. There is one definition of
// "which games play on which dates" and this is not a second copy of it.
import { isoDate, scheduledTypesOn, type ScheduleGame } from "@/lib/seasons/schedule";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

/** Kill switch. Set DC_SLATE_ENFORCEMENT=off to restore pre-D4-retirement
 *  behaviour without a code change (still needs a redeploy — server env). */
function enforcementDisabled(): boolean {
  const v = (process.env.DC_SLATE_ENFORCEMENT || "").trim().toLowerCase();
  return v === "off" || v === "0" || v === "false";
}

function svcHeaders(): Record<string, string> | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function rows<T>(headers: Record<string, string>, path: string): Promise<T[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers, cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? (j as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * The enabled `runtime_key` list for `seasonId`, or null.
 *
 * null means "serve everything" and is returned for every one of:
 *   · enforcement killed by env
 *   · no service-role key
 *   · no season (the caller resolved none — anonymous with no default season)
 *   · the season has no ACTIVE config (true for 3 of 6 seasons in prod today)
 *   · the config has no enabled games
 *   · any fetch/parse failure
 */
export async function resolveSeasonSlate(seasonId: string | null | undefined): Promise<string[] | null> {
  if (enforcementDisabled()) return null;

  const h = svcHeaders();
  if (!h) return null;

  const season = seasonId ? { id: seasonId } : null;
  if (!season?.id) return null;

  // The config actually in force. `state=eq.active` is the same predicate the
  // League Office uses; a draft or scheduled version must NOT gate serving.
  const config = (
    await rows<{ id: string }>(
      h,
      `season_config?season_id=eq.${encodeURIComponent(season.id)}&state=eq.active&select=id&limit=1`
    )
  )[0];
  if (!config?.id) return null;

  const slate = await rows<{ game_catalog: { runtime_key: string | null } | null }>(
    h,
    `season_games?season_config_id=eq.${encodeURIComponent(config.id)}` +
      `&is_enabled=eq.true&select=game_catalog(runtime_key)`
  );

  const keys = slate
    .map((r) => r.game_catalog?.runtime_key)
    .filter((k): k is string => typeof k === "string" && k.length > 0);

  return keys.length > 0 ? keys : null;
}

// ── CC-DC-GEN-SCHEDULE-FIELDS-1.0 — the season CALENDAR, server-side ────────

/**
 * The enabled `runtime_key` values that are SCHEDULED to play on `date`, or
 * null for "do not narrow".
 *
 * null is returned for every one of:
 *   · enforcement killed by env (the same DC_SLATE_ENFORCEMENT switch)
 *   · no service-role key
 *   · no season, no ACTIVE config, no enabled games
 *   · `date` falls outside the season's own window — a season that has not
 *     started or has ended is CC-DC-SEASON-GOLIVE-1.0's business, not this
 *     function's, and narrowing there would change behaviour this pack has
 *     no mandate over
 *   · NOTHING WOULD BE NARROWED — every enabled game plays today. True of
 *     every production season but one (measured 2026-10-06: only TEST SEASON 1
 *     sets play_days_of_week, only demo 2 sets appears_on_days, and no
 *     season_games row anywhere sets a per-game window), so the common path
 *     stays byte-identical to the pre-pack behaviour.
 *   · any fetch/parse failure
 *
 * An EMPTY array is a real answer: today is not a play day. See
 * narrowToScheduled() in season-slate.ts for why that one is not a fail-safe.
 *
 * Reads are its own rather than shared with resolveSeasonSlate(): the two run
 * concurrently inside the route's existing Promise.all, so the cost is a round
 * trip in parallel, and keeping the slate resolver untouched keeps the D4
 * fail-safes it owns exactly as they were.
 */
export async function resolveSeasonSchedule(
  seasonId: string | null | undefined,
  date: string | null | undefined
): Promise<string[] | null> {
  if (enforcementDisabled()) return null;
  if (!seasonId || !date) return null;

  const h = svcHeaders();
  if (!h) return null;

  try {
    const season = (
      await rows<{ starts_on: string | null; ends_on: string | null }>(
        h,
        `seasons?id=eq.${encodeURIComponent(seasonId)}&select=starts_on,ends_on&limit=1`
      )
    )[0];
    const from = isoDate(season?.starts_on);
    const to = isoDate(season?.ends_on);
    if (!from || !to || date < from || date > to) return null;

    const config = (
      await rows<{ id: string; play_days_of_week: number[] | null }>(
        h,
        `season_config?season_id=eq.${encodeURIComponent(seasonId)}&state=eq.active&select=id,play_days_of_week&limit=1`
      )
    )[0];
    if (!config?.id) return null;

    const slate = await rows<{
      appears_on_days: number[] | null;
      starts_on: string | null;
      ends_on: string | null;
      game_catalog: { runtime_key: string | null } | null;
    }>(
      h,
      `season_games?season_config_id=eq.${encodeURIComponent(config.id)}` +
        `&is_enabled=eq.true&select=appears_on_days,starts_on,ends_on,game_catalog(runtime_key)`
    );

    const games: ScheduleGame[] = slate
      .filter((r) => typeof r.game_catalog?.runtime_key === "string" && !!r.game_catalog.runtime_key)
      .map((r) => ({
        type: r.game_catalog?.runtime_key as string,
        appears_on_days: r.appears_on_days ?? null,
        starts_on: r.starts_on ?? null,
        ends_on: r.ends_on ?? null,
      }));
    if (games.length === 0) return null;

    const scheduled = scheduledTypesOn({
      date,
      season: { starts_on: from, ends_on: to },
      config: { play_days_of_week: config.play_days_of_week ?? null },
      games,
    });

    // Nothing to narrow → say so, rather than handing the serve path a list it
    // would intersect with itself.
    return scheduled.length === games.length ? null : scheduled;
  } catch {
    return null;
  }
}
