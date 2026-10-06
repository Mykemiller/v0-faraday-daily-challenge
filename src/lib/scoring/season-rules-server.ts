// CC-LO-CONFIG-ENFORCEMENT-STATUS-1.0 (D7) — the season's scoring rules,
// resolved SERVER-SIDE. Service-role only.
//
// Two callers, one resolver:
//   /api/challenge/today  ships the block to the lobby so the score card can
//                         show the season's number the moment a game ends.
//   /api/score            resolves it AGAIN, for itself, before it writes.
//
// That duplication is the design, not an oversight. The client is told the
// rules so it can render them; it is never believed about them. The request
// body carries no rules, and this module would not read them if it did — it
// goes to the database for every value it returns.
//
// WHICH CONFIG: `v_season_effective_config`. That view is the repo's declared
// single authority on "which configuration is in force right now" (see
// league-playoffs/phase.ts and fetchSeasonRules in league-playoffs/server.ts),
// and it is the reader config-enforcement.ts credits for `effective_from` /
// `effective_to`. An earlier draft of this module used
// `season_config?state=eq.active&limit=1` instead, which is NOT the same
// question and already disagrees in production: config
// 667c488f-1c9f-4199-a7ee-40aff7c094a7 is `state = 'active'` with an
// `effective_to` of 2026-09-05, so the view correctly returns nothing for that
// season while the raw predicate happily returns a config whose window closed
// a month ago. Scoring a completion against a retired version is exactly the
// class of bug this pack exists to end, so it asks the one place.
//
// HINTS: the penalty is gated on `hints_enabled`. The editor already greys the
// penalty input out when hints are off; the server has to agree, or a season
// that gives no hints still charges for them.
//
// Fail-soft everywhere. Every failure returns the identity rules (150 / 0% /
// streak on) — a season with no configuration in force, a dropped connection
// or a missing key must never cost a player their score.

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

type EffectiveConfig = {
  config_id: string | null;
  hints_enabled: boolean | null;
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
    // The view LEFT JOINs the config onto the season, so a season with nothing
    // in force still returns one row — with `config_id` null. That is the
    // "no configuration applies" answer, and it must read as the identity
    // rules rather than as a missing row.
    const config = (
      await rows<EffectiveConfig>(
        h,
        `v_season_effective_config?season_id=eq.${encodeURIComponent(seasonId)}` +
          `&select=config_id,hints_enabled,hint_penalty_pct,streak_bonus_enabled&limit=1`
      )
    )[0];
    if (!config?.config_id) return out;

    // `hint_penalty_pct` is NUMERIC, so PostgREST hands it over as "10.00".
    // Gated on `hints_enabled`: a season that gives no hints cannot charge for
    // them, whatever the column says. Resolved HERE, not taken from the client.
    const hintPenaltyPct =
      config.hints_enabled === false ? 0 : toNumber(config.hint_penalty_pct, 0);
    out.streakBonus = config.streak_bonus_enabled !== false;

    const slate = await rows<{
      points_override: number | null;
      game_catalog: { runtime_key: string | null } | null;
    }>(
      h,
      `season_games?season_config_id=eq.${encodeURIComponent(config.config_id)}&is_enabled=eq.true` +
        `&select=points_override,game_catalog(runtime_key)`
    );

    for (const row of slate) {
      const key = row.game_catalog?.runtime_key;
      if (typeof key !== "string" || !key || key === "streakBonus") continue;
      // `points_override = 0` would zero every completion for this game. The
      // editor forbids it (min 1) and normalizeGameRow coerces it to null, but
      // a row predating those guards must not silently wipe a player's score:
      // a non-positive override reads as "no override".
      const override = toNumber(row.points_override, DEFAULT_POINTS_MAX);
      out[key] = {
        pointsMax: override > 0 ? override : DEFAULT_POINTS_MAX,
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
