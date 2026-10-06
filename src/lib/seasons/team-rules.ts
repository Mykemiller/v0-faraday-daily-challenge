// Team rules from the season's config — CC-DC-TEAM-CAP-FROM-CONFIG-1.0.
//
// How many teams a player may hold in a season, and how large a team may get,
// are League Office settings (`season_config.max_teams_per_subscriber` and
// `max_team_size`). Until this module existed every reader hardcoded 5, so a
// commissioner could set the cap to 3 and `/api/teams` would still let a
// player join a fourth team. This is the single server-side answer.
//
// Two halves, deliberately separated so the rule is testable without I/O:
//   · the PURE half (`teamRulesFrom` + the four predicates) — defaults,
//     coercion, the cap decision and the grandfathering rule;
//   · the I/O half (`teamRulesFor`) — one read of `v_season_effective_config`,
//     which is the only authority on WHICH config version is in force
//     (state active|scheduled, inside its effective dates). Never read
//     `season_config` directly here: that would pick a draft or a superseded
//     version and the two layers would disagree.
//
// FAIL SOFT, like `fetchSeasonRules`: any failure — no key, no row, a draft-only
// season, a transport error — returns the historical default of 5 teams and no
// size limit. A rules read that went wrong must never lock players out.
//
// Tests: `npm run test:team-rules`.

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

/** The cap every reader used to hardcode. Still the answer when the season has
 *  no effective config, or the column is null. */
export const DEFAULT_MAX_TEAMS_PER_PLAYER = 5;

/** The wire code a blocked join returns. Unchanged from the pre-config era so
 *  every existing client branch keeps working. */
export const TEAM_LIMIT_CODE = "team_limit_reached";

/** The wire code a join into a full team returns. New in this pack. */
export const TEAM_FULL_CODE = "team_full";

export type TeamRules = {
  /** How many teams one player may hold in this season. Always >= 1. */
  maxTeamsPerPlayer: number;
  /** How many distinct confirmed members a team may hold. null = unlimited. */
  maxTeamSize: number | null;
};

/** The two columns, as PostgREST returns them (numbers, or strings on some
 *  numeric types, or null). */
export type TeamRulesRow = {
  max_teams_per_subscriber?: number | string | null;
  max_team_size?: number | string | null;
};

export const DEFAULT_TEAM_RULES: TeamRules = {
  maxTeamsPerPlayer: DEFAULT_MAX_TEAMS_PER_PLAYER,
  maxTeamSize: null,
};

/** A positive whole number, or null for anything that is not one. Zero and
 *  negatives are treated as "unset" rather than "nobody may join anything" —
 *  a typo in the Configurator must not brick a season. */
function positiveInt(value: unknown): number | null {
  const n =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i >= 1 ? i : null;
}

/** PURE: a config row (or nothing) → the rules in force. */
export function teamRulesFrom(row: TeamRulesRow | null | undefined): TeamRules {
  return {
    maxTeamsPerPlayer:
      positiveInt(row?.max_teams_per_subscriber) ?? DEFAULT_MAX_TEAMS_PER_PLAYER,
    maxTeamSize: positiveInt(row?.max_team_size),
  };
}

/** PURE: may a player holding `currentCount` teams join ONE more? */
export function canJoinAnotherTeam(currentCount: number, rules: TeamRules): boolean {
  return currentCount < rules.maxTeamsPerPlayer;
}

/**
 * PURE: may a player move from `currentCount` teams to `desiredCount`?
 *
 * GRANDFATHERING (D5): lowering a cap never removes a membership, so a player
 * can legitimately be sitting above it. Such a player must still be able to
 * save their roster — to leave a team, or to re-confirm it unchanged — or the
 * lowered cap would trap them. The rule is therefore "never grow past the cap",
 * not "never be above it": anything at or under the cap is fine, and anything
 * above it is fine only while it does not increase the count.
 */
export function isTeamSetAllowed(
  desiredCount: number,
  currentCount: number,
  rules: TeamRules
): boolean {
  if (desiredCount <= rules.maxTeamsPerPlayer) return true;
  return desiredCount <= currentCount;
}

/**
 * PURE: is a team at its size limit?
 *
 * `confirmedMembers` MUST be COUNT(DISTINCT subscriber_id) within the season,
 * never a row count — `team_memberships` is season-keyed and one person can own
 * several rows (CC-LO-TEAM-COUNTS-1.0).
 */
export function isTeamFull(confirmedMembers: number, rules: TeamRules): boolean {
  return rules.maxTeamSize != null && confirmedMembers >= rules.maxTeamSize;
}

/** The copy a blocked join shows (D5). Says the number, so a player who hits a
 *  cap of 3 is not told about 5. */
export function teamLimitMessage(cap: number): string {
  return `This season allows ${cap} ${cap === 1 ? "team" : "teams"} — leave one to join another.`;
}

/** The copy a join into a full team shows. */
export function teamFullMessage(maxTeamSize: number): string {
  return `This team is full — it holds the maximum of ${maxTeamSize} ${
    maxTeamSize === 1 ? "player" : "players"
  } for this season.`;
}

/**
 * The team rules in force for `seasonId` right now.
 *
 * `headers` are service-role PostgREST headers. Returns the defaults rather
 * than throwing on every failure path — see the fail-soft note above.
 */
export async function teamRulesFor(
  headers: Record<string, string> | null | undefined,
  seasonId: string | null | undefined
): Promise<TeamRules> {
  if (!headers || !seasonId) return { ...DEFAULT_TEAM_RULES };
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/v_season_effective_config` +
        `?season_id=eq.${encodeURIComponent(seasonId)}` +
        `&select=max_teams_per_subscriber,max_team_size&limit=1`,
      { headers, cache: "no-store" }
    );
    if (!r.ok) return { ...DEFAULT_TEAM_RULES };
    const rows = await r.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    return teamRulesFrom(row as TeamRulesRow | null);
  } catch {
    return { ...DEFAULT_TEAM_RULES };
  }
}
