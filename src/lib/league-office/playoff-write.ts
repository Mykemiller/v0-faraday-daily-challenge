// League Playoffs — Tier 2 commissioner actions (server-only), dispatched from
// executeAction() so the mandatory reason, staff email and one-audit-row-per-
// write rule are identical to every other League Office mutation.
//
// The bracket itself is NEVER hand-edited here. `playoff.seed` and
// `playoff.recompute` call the SQL functions, which derive everything from real
// score_events; this module only decides WHETHER a commissioner may run them
// and records that they did. There is deliberately no "set winner" action —
// a result that a commissioner could type in is not a result.

import { q, type Svc } from "./service";
import { rpc } from "./seasons";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ycadmmngkdhvpcsrcuaq.supabase.co";

export type PlayoffLogFn = (
  action: string,
  targetType: string,
  targetId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  reversible: boolean
) => Promise<string | null>;

type Result = { ok: boolean; message: string };

export type PlayoffConfigRow = {
  season_id: string;
  format: string;
  participant_kind: string;
  qualifier_count: number;
  seeding_source: string;
  updated_by: string | null;
};

export type PlayoffBracketRow = {
  id: string;
  season_id: string;
  participant_kind: string;
  qualifier_count: number;
  rounds: number;
  status: string;
  seeded_at: string;
  seeded_by: string | null;
  champion_participant_id: string | null;
  seeding_window_from: string;
  seeding_window_to: string;
  playoff_window_from: string;
  playoff_window_to: string;
};

/** Human copy for the SQLSTATEs fn_playoff_seed_field raises, so a commissioner
 *  gets the real reason rather than a raw Postgres string. */
const SEED_ERRORS: Record<string, string> = {
  PLY01: "This season has no playoff configuration yet — save the format first.",
  PLY02: "This season has no regular-season window to seed from.",
  PLY03: "This season has no playoff window — set the playoff start date first.",
  PLY04: "Fewer than two participants have scored in the seeding window, so there is no bracket to build.",
  PLY05: "The playoff window is too short for the number of rounds this field needs. Move the playoff start date earlier or lower the qualifier count.",
};

function seedErrorMessage(code: string | null, fallback: string): string {
  if (code && SEED_ERRORS[code]) return SEED_ERRORS[code];
  return fallback;
}

async function upsert(s: Svc, table: string, body: unknown, onConflict: string): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: { ...s.headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function loadPlayoffConfig(s: Svc, seasonId: string): Promise<PlayoffConfigRow | null> {
  const rows = await q<PlayoffConfigRow>(
    s,
    `dc_playoff_config?season_id=eq.${encodeURIComponent(seasonId)}&select=*&limit=1`
  );
  return rows[0] ?? null;
}

export async function loadPlayoffBracket(s: Svc, seasonId: string): Promise<PlayoffBracketRow | null> {
  const rows = await q<PlayoffBracketRow>(
    s,
    `dc_playoff_brackets?season_id=eq.${encodeURIComponent(seasonId)}&select=*&limit=1`
  );
  return rows[0] ?? null;
}

/**
 * Save the per-season playoff format.
 *
 * Config edits do NOT retroactively change an existing bracket — the bracket
 * copied its config at seed time on purpose. Changing config after seeding only
 * affects the NEXT re-seed, and the message says so rather than leaving the
 * commissioner to guess.
 */
export async function savePlayoffConfig(
  s: Svc,
  log: PlayoffLogFn,
  input: {
    seasonId?: string;
    participantKind?: string;
    qualifierCount?: number;
    seedingSource?: string;
    staffEmail: string;
  }
): Promise<Result> {
  if (!input.seasonId) return { ok: false, message: "Missing season." };

  const kind = input.participantKind ?? "team";
  if (kind !== "team" && kind !== "player")
    return { ok: false, message: "Participants must be teams or players." };

  const count = Number(input.qualifierCount ?? 8);
  if (!Number.isInteger(count) || count < 2 || count > 64)
    return { ok: false, message: "Qualifier count must be a whole number between 2 and 64." };

  const source = input.seedingSource ?? "regular";
  if (source !== "regular" && source !== "full")
    return { ok: false, message: "Seeding source must be the regular season or the full season." };

  const before = await loadPlayoffConfig(s, input.seasonId);
  const after = {
    season_id: input.seasonId,
    format: "single_elim",
    participant_kind: kind,
    qualifier_count: count,
    seeding_source: source,
    updated_at: new Date().toISOString(),
    updated_by: input.staffEmail,
  };

  const ok = await upsert(s, "dc_playoff_config", after, "season_id");
  if (!ok) return { ok: false, message: "Could not save the playoff configuration." };

  await log(
    "playoff.configure",
    "season",
    input.seasonId,
    before as Record<string, unknown> | null,
    after,
    true
  );

  const bracket = await loadPlayoffBracket(s, input.seasonId);
  const note = bracket
    ? " The existing bracket keeps the settings it was seeded with — re-seed to apply these."
    : "";
  return { ok: true, message: `Playoff configuration saved — logged to Audit Log.${note}` };
}

/**
 * Lock the playoff field: snapshot seeds from regular-season standings and lay
 * out the bracket. Re-seeding REPLACES the existing bracket, which is why the
 * audit row carries the previous bracket as `before`.
 */
export async function seedPlayoffField(
  s: Svc,
  log: PlayoffLogFn,
  input: { seasonId?: string; staffEmail: string }
): Promise<Result> {
  if (!input.seasonId) return { ok: false, message: "Missing season." };

  const before = await loadPlayoffBracket(s, input.seasonId);
  const res = await rpc<string>(s, "fn_playoff_seed_field", {
    p_season_id: input.seasonId,
    p_actor: input.staffEmail,
  });
  if (!res.ok) return { ok: false, message: seedErrorMessage(res.code, res.message) };

  const after = await loadPlayoffBracket(s, input.seasonId);
  await log(
    before ? "playoff.reseed" : "playoff.seed",
    "playoff_bracket",
    (after?.id ?? input.seasonId),
    before as Record<string, unknown> | null,
    after as Record<string, unknown> | null,
    // Re-seeding is reversible only in the sense of seeding again — there is no
    // snapshot to restore, so this is not offered as a one-click revert.
    false
  );

  const n = after?.qualifier_count ?? 0;
  const rounds = after?.rounds ?? 0;
  return {
    ok: true,
    message: before
      ? `Playoff field re-seeded — ${n} participants over ${rounds} round(s). The previous bracket was replaced. Logged to Audit Log.`
      : `Playoff field locked — ${n} participants seeded over ${rounds} round(s). Logged to Audit Log.`,
  };
}

/**
 * Re-settle the bracket from current score_events.
 *
 * This is a READ-DRIVEN refresh, not an edit: it can only move a matchup that
 * real points and a closed window already decided. Safe to run at any time and
 * idempotent — a run that changes nothing reports so.
 */
export async function recomputePlayoffBracket(
  s: Svc,
  log: PlayoffLogFn,
  input: { seasonId?: string }
): Promise<Result> {
  if (!input.seasonId) return { ok: false, message: "Missing season." };

  const bracket = await loadPlayoffBracket(s, input.seasonId);
  if (!bracket) return { ok: false, message: "This season has no bracket yet — seed the field first." };

  const res = await rpc<number>(s, "fn_playoff_recompute", { p_bracket_id: bracket.id });
  if (!res.ok) return { ok: false, message: res.message };

  const changed = Number(res.data ?? 0);
  const after = await loadPlayoffBracket(s, input.seasonId);

  // Only write an audit row when something actually moved — a no-op refresh is
  // not a mutation, and logging it would bury the real changes.
  if (changed > 0) {
    await log(
      "playoff.recompute",
      "playoff_bracket",
      bracket.id,
      bracket as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown> | null,
      false
    );
  }

  return {
    ok: true,
    message:
      changed > 0
        ? `Bracket refreshed — ${changed} matchup(s) updated from current scores. Logged to Audit Log.`
        : "Bracket refreshed — nothing changed; every result already matches current scores.",
  };
}

/** Discard the bracket entirely (seeds and matchups cascade). Config is kept. */
export async function clearPlayoffBracket(
  s: Svc,
  log: PlayoffLogFn,
  input: { seasonId?: string }
): Promise<Result> {
  if (!input.seasonId) return { ok: false, message: "Missing season." };

  const before = await loadPlayoffBracket(s, input.seasonId);
  if (!before) return { ok: false, message: "This season has no bracket to clear." };

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_playoff_brackets?id=eq.${encodeURIComponent(before.id)}`,
      { method: "DELETE", headers: s.headers, cache: "no-store" }
    );
    if (!r.ok) return { ok: false, message: "Could not clear the bracket." };
  } catch {
    return { ok: false, message: "Could not clear the bracket." };
  }

  await log(
    "playoff.clear",
    "playoff_bracket",
    before.id,
    before as unknown as Record<string, unknown>,
    null,
    false
  );
  return { ok: true, message: "Bracket cleared — seed the field again when ready. Logged to Audit Log." };
}
