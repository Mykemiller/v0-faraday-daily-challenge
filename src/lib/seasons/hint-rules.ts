// Hint rules from the season's config — CC-DC-HINTS-FROM-CONFIG-1.0.
//
// Whether a season offers hints at all (`season_config.hints_enabled`) and how
// many it offers per game per day (`season_config.max_hints_per_game`) were
// League Office settings that nothing read: every hint surface hardcoded 3 and
// no surface could be switched off. This is the single server-side answer.
//
// Two halves, deliberately separated so the rule is testable without I/O —
// the same shape as team-rules.ts (CC-DC-TEAM-CAP-FROM-CONFIG-1.0):
//   · the PURE half (`hintRules`) — defaults, coercion, and the one decision
//     that matters: the budget is `min(max_hints_per_game, BANK_HINT_SLOTS)`.
//   · the I/O half (`hintRulesFor`) — one read of `v_season_effective_config`,
//     the only authority on WHICH config version is in force (state
//     active|scheduled, inside its effective dates). Never read `season_config`
//     directly here: that would pick a draft or a superseded version and the
//     two layers would disagree. Measured 2026-10-06: one season carries an
//     `active` season_config row that the view correctly reports as NOT in
//     force, so the two reads genuinely differ.
//
// WHY THE MIN IS LOAD-BEARING. `max_hints_per_game` is a request; the bank is
// the supply. The generator writes exactly three hint tiers per puzzle, so a
// season set to 4 has no fourth hint for anyone to reveal — honouring the 4
// would hand the player a button that can only ever fail. The Configurator now
// clamps new saves (sanitizeConfigPatch) and flags stored values above the
// bank (`max_hints_exceeds_bank`), but configs written before that clamp still
// exist, so the serve path mins as well. Two active configs sat at 4 when this
// shipped (measured 2026-10-06).
//
// FAIL SOFT, like teamRulesFor: any failure — no key, no season, no effective
// config, a transport error — returns the historical behaviour (hints on, 3 of
// them). A rules read that went wrong must never silently take hints away.
//
// NOT IN SCOPE: `hint_penalty_pct`. That column is read by
// scoring/season-scoring.ts and shipped in `rules.scoring`; this module never
// touches it.
//
// Tests: `npm run test:hint-rules`.

// Relative, with the extension: hint-rules.test.ts runs under plain
// `node --test` (type stripping), which does not read tsconfig `paths`.
import { BANK_HINT_SLOTS } from "../league-office/season-config-logic.ts";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

export { BANK_HINT_SLOTS };

export type HintRules = {
  /** Does this season offer hints at all? */
  hintsEnabled: boolean;
  /** Hints a player may reveal per game per day. 0..BANK_HINT_SLOTS. */
  maxHints: number;
};

/** The two columns, as PostgREST returns them. Both are NOT NULL with defaults
 *  in `season_config`, but `v_season_effective_config` LEFT JOINs, so a season
 *  with nothing in force hands back nulls — which is the case this type is
 *  for. */
export type HintRulesRow = {
  hints_enabled?: boolean | null;
  max_hints_per_game?: number | string | null;
};

/** What every surface did before this module existed, and the answer for any
 *  season with no effective config. */
export const DEFAULT_HINT_RULES: HintRules = {
  hintsEnabled: true,
  maxHints: BANK_HINT_SLOTS,
};

/** A whole number in [0, BANK_HINT_SLOTS], or null for anything that is not a
 *  number at all. Zero IS meaningful here (unlike the team cap): "this season
 *  gives no hints" is a legitimate setting, distinct from `hints_enabled`
 *  false in that the control is still budget-driven rather than switched off.
 *  Negatives are a typo, not a request, and read as unset. */
function hintCount(value: unknown): number | null {
  const n =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 0) return null;
  return Math.min(i, BANK_HINT_SLOTS);
}

/** PURE: a config row (or nothing) → the hint rules in force. */
export function hintRules(row: HintRulesRow | null | undefined): HintRules {
  return {
    // Only an explicit `false` switches hints off. null/undefined is "no
    // config", which must read as the historical default of ON.
    hintsEnabled: row?.hints_enabled !== false,
    maxHints: hintCount(row?.max_hints_per_game) ?? BANK_HINT_SLOTS,
  };
}

/** PURE: may a player reveal one more hint after spending `used`? */
export function canRevealHint(used: number, rules: HintRules): boolean {
  return rules.hintsEnabled && used < rules.maxHints;
}

/** The copy a season with hints switched off shows, in place of the control. */
export const HINTS_OFF_MESSAGE = "Hints are off this season.";

/**
 * The hint rules in force for `seasonId` right now.
 *
 * `headers` are service-role PostgREST headers. Returns the defaults rather
 * than throwing on every failure path — see the fail-soft note above.
 */
export async function hintRulesFor(
  headers: Record<string, string> | null | undefined,
  seasonId: string | null | undefined
): Promise<HintRules> {
  if (!headers || !seasonId) return { ...DEFAULT_HINT_RULES };
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/v_season_effective_config` +
        `?season_id=eq.${encodeURIComponent(seasonId)}` +
        `&select=hints_enabled,max_hints_per_game&limit=1`,
      { headers, cache: "no-store" }
    );
    if (!r.ok) return { ...DEFAULT_HINT_RULES };
    const rows = await r.json().catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    return hintRules(row as HintRulesRow | null);
  } catch {
    return { ...DEFAULT_HINT_RULES };
  }
}
