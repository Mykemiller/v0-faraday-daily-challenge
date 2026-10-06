// CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 (D7) — the season's scoring rules,
// resolved SERVER-SIDE. Service-role only.
//
// Two callers, one resolver:
//   /api/challenge/today  ships the block to the lobby so the score card can
//                         show the season's number the moment a game ends.
//   /api/score            resolves it AGAIN, for itself, before it writes.
//
// That duplication is the design, not an oversight. The client is told the
// rules so it can render them; it is never believed about them. /api/score
// accepts `scoringVersion` and `hintsUsed` from the body and NOTHING ELSE
// about scoring — a POST claiming `pointsMax: 100000` carries no such field,
// and adding one would not help, because the route reads these columns itself
// from the season it resolved for that subscriber.
//
// Which config: `state = 'active'` for the caller's resolved season — the same
// predicate resolveSeasonSlate() uses, so the games a season serves and the
// ceilings it scores them at can never come from two different versions.
//
// Fail-soft everywhere. Every failure returns the identity rules (150 / 0% /
// streak on), which is byte-for-byte the pre-pack behaviour — a season with no
// config, a dropped connection or a missing key must never cost a player their
// score.

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

/** The `rules.scoring` block, keyed by `game_catalog.runtime_key` (the same
 *  string the lobby and /api/score call `gameType`), plus the one season-wide
 *  flag. `streakBonus` cannot collide with a runtime key — the seven are
 *  "Rackl", "Signal Drop", "The Stack", "Circuit", "The Brief", "Dark Fiber"
 *  and "Frequency". */
export type GameScoringRules = { pointsMax: number; hintPenaltyPct: number };
export type SeasonScoringRules = Record<string, GameScoringRules | boolean> & {
  streakBonus: boolean;
};

export const DEFAULT_POINTS_MAX = 150;

export function defaultScoringRules(): SeasonScoringRules {
  return { streakBonus: true };
}

function svcHeaders(): Record<string, string> | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function rows<T>(headers: Record<string, string>, path: string): Promise<T[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers, cache: "no-store" });
  if (!r.ok) return [];
  const body = await r.json().catch(() => null);
  return Array.isArray(body) ? (body as T[]) : [];
}

type ActiveConfig = {
  id: string;
  hint_penalty_pct: number | string | null;
  streak_bonus_enabled: boolean | null;
};

/**
 * Every enabled game's ceiling and the season's hint penalty, for `seasonId`
 * (from resolveSeasonFor — never a `status=eq.active` pick of its own).
 *
 * `headers` are optional so a caller that already built service-role headers
 * can pass them rather than re-reading the env.
 */
export async function resolveSeasonScoringRules(
  seasonId: string | null | undefined,
  headers?: Record<string, string> | null
): Promise<SeasonScoringRules> {
  const out = defaultScoringRules();
  if (!seasonId) return out;
  const h = headers ?? svcHeaders();
  if (!h) return out;

  try {
    const config = (
      await rows<ActiveConfig>(
        h,
        `season_config?season_id=eq.${encodeURIComponent(seasonId)}&state=eq.active` +
          `&select=id,hint_penalty_pct,streak_bonus_enabled&limit=1`
      )
    )[0];
    if (!config?.id) return out;

    // `hint_penalty_pct` is NUMERIC, so PostgREST hands it over as "10.00".
    const hintPenaltyPct = toNumber(config.hint_penalty_pct, 0);
    out.streakBonus = config.streak_bonus_enabled !== false;

    const slate = await rows<{
      points_override: number | null;
      game_catalog: { runtime_key: string | null } | null;
    }>(
      h,
      `season_games?season_config_id=eq.${encodeURIComponent(config.id)}&is_enabled=eq.true` +
        `&select=points_override,game_catalog(runtime_key)`
    );

    for (const row of slate) {
      const key = row.game_catalog?.runtime_key;
      if (typeof key !== "string" || !key || key === "streakBonus") continue;
      out[key] = {
        pointsMax: toNumber(row.points_override, DEFAULT_POINTS_MAX),
        hintPenaltyPct,
      };
    }
    return out;
  } catch {
    return defaultScoringRules();
  }
}

/** The rules for ONE game, without pulling the whole slate into the caller.
 *  Same reads, same fail-soft identity default. */
export async function resolveGameScoringRules(
  seasonId: string | null | undefined,
  gameType: string,
  headers?: Record<string, string> | null
): Promise<GameScoringRules> {
  const all = await resolveSeasonScoringRules(seasonId, headers);
  const entry = all[gameType];
  return entry && typeof entry === "object"
    ? entry
    : { pointsMax: DEFAULT_POINTS_MAX, hintPenaltyPct: 0 };
}

function toNumber(v: unknown, fallback: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
