// GET /api/playoffs?token=... — the player-facing playoff view.
//
// READ ONLY. Players never write playoff state; every mutation is a staff action
// through executeAction (`playoff.*`). The token is optional and used only to
// mark "you" in the bracket — an anonymous visitor sees the same public state.
//
// ⚠️ FAILS SOFT on the bracket tables. The Part 3 migration may not be applied
// yet, so a missing dc_playoff_* table must degrade to "no bracket" rather than
// 500 the lobby. The phase/countdown half of this route reads only `seasons`,
// which always exists — so the banner works before the bracket does.

import { statusFor, SEASON_PLAYOFF_COLUMNS } from '@/lib/league-playoffs/server';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export const dynamic = 'force-dynamic';

function svcHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

/** Query that tolerates a missing table (pre-migration) by returning []. */
async function softQuery<T>(headers: Record<string, string>, path: string): Promise<T[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers, cache: 'no-store' });
    if (!r.ok) return [];
    const rows = await r.json().catch(() => null);
    return Array.isArray(rows) ? (rows as T[]) : [];
  } catch {
    return [];
  }
}

async function resolveSubscriberId(
  headers: Record<string, string>,
  token: string
): Promise<string | null> {
  if (!token) return null;
  const rows = await softQuery<{ subscriber_id: string; expires_at: string | null }>(
    headers,
    `dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at&limit=1`
  );
  const row = rows[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row.subscriber_id ?? null;
}

export async function GET(request: Request) {
  const h = svcHeaders();
  if (!h) return Response.json({ error: 'not_configured' }, { status: 500 });

  const token = new URL(request.url).searchParams.get('token') ?? '';

  const seasons = await softQuery<Record<string, unknown>>(
    h,
    `seasons?status=eq.active&select=${SEASON_PLAYOFF_COLUMNS}&limit=1`
  );
  const season = seasons[0];
  if (!season) return Response.json({ season: null, playoffs: null });

  const status = statusFor(season as never);

  // Phase + countdown come from `seasons` alone, so this half always works.
  const base = {
    season: { id: season.id, name: season.name },
    phase: status.phase,
    playoffs_live: status.playoffsLive,
    playoff_starts_on: status.playoffStartsOn,
    days_until_playoffs: status.daysUntilPlayoffs,
    playoff_window: status.playoffWindow,
    roster_frozen: status.roster.frozen,
    roster_freeze_on: status.roster.freezeOn,
    days_until_roster_freeze: status.roster.daysUntilFreeze,
  };

  const brackets = await softQuery<{
    id: string; participant_kind: string; qualifier_count: number; rounds: number;
    status: string; champion_participant_id: string | null;
    playoff_window_from: string; playoff_window_to: string;
  }>(h, `dc_playoff_brackets?season_id=eq.${season.id}&select=*&limit=1`);
  const bracket = brackets[0];

  if (!bracket) return Response.json({ ...base, bracket: null, seeds: [], matchups: [] });

  const [seeds, matchups] = await Promise.all([
    softQuery<{ seed: number; participant_id: string; display_name: string; seed_points: number }>(
      h,
      `dc_playoff_seeds?bracket_id=eq.${bracket.id}&select=seed,participant_id,display_name,seed_points&order=seed.asc`
    ),
    softQuery<{
      id: string; round: number; slot: number;
      seed_a: number | null; seed_b: number | null;
      participant_a: string | null; participant_b: string | null;
      points_a: number | null; points_b: number | null;
      winner_participant_id: string | null; decided_reason: string | null;
      round_starts_on: string; round_ends_on: string;
    }>(
      h,
      `dc_playoff_matchups?bracket_id=eq.${bracket.id}` +
        `&select=id,round,slot,seed_a,seed_b,participant_a,participant_b,points_a,points_b,` +
        `winner_participant_id,decided_reason,round_starts_on,round_ends_on&order=round.asc,slot.asc`
    ),
  ]);

  // "You" marking. For a team bracket the viewer's participant ids are their
  // teams for this season; for a player bracket it is the subscriber itself.
  const viewerId = await resolveSubscriberId(h, token);
  let mine: string[] = [];
  if (viewerId) {
    if (bracket.participant_kind === 'team') {
      const mems = await softQuery<{ team_id: string }>(
        h,
        `team_memberships?subscriber_id=eq.${viewerId}&season_id=eq.${season.id}&pending=eq.false&select=team_id`
      );
      mine = mems.map((m) => m.team_id);
    } else {
      mine = [viewerId];
    }
  }

  const nameOf = new Map(seeds.map((s) => [s.participant_id, s.display_name]));

  return Response.json({
    ...base,
    bracket: {
      participant_kind: bracket.participant_kind,
      qualifier_count: bracket.qualifier_count,
      rounds: bracket.rounds,
      status: bracket.status,
      champion: bracket.champion_participant_id
        ? {
            participant_id: bracket.champion_participant_id,
            display_name: nameOf.get(bracket.champion_participant_id) ?? null,
            is_you: mine.includes(bracket.champion_participant_id),
          }
        : null,
    },
    seeds: seeds.map((s) => ({ ...s, is_you: mine.includes(s.participant_id) })),
    matchups: matchups.map((m) => ({
      ...m,
      name_a: m.participant_a ? nameOf.get(m.participant_a) ?? null : null,
      name_b: m.participant_b ? nameOf.get(m.participant_b) ?? null : null,
      is_you_a: m.participant_a ? mine.includes(m.participant_a) : false,
      is_you_b: m.participant_b ? mine.includes(m.participant_b) : false,
    })),
  });
}
