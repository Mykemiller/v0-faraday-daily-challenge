// GET /api/lo/seasons/[id]/playoff — commissioner view of the playoff config,
// the seeded bracket, and its matchups.
//
// Read-only. Every mutation goes through /api/league-office/action →
// executeAction (`playoff.*`), so the mandatory reason + one audit row per write
// are enforced in one place. Staff is re-verified here independently, like every
// other /api/lo route.

import { requireStaff, q } from "@/lib/league-office/service";
import { loadPlayoffBracket, loadPlayoffConfig } from "@/lib/league-office/playoff-write";
import { getSeason } from "@/lib/league-office/data";
import { statusFor } from "@/lib/league-playoffs/server";

export const dynamic = "force-dynamic";

type SeedRow = {
  seed: number;
  participant_id: string;
  display_name: string;
  seed_points: number;
};

type MatchupRow = {
  id: string;
  round: number;
  slot: number;
  seed_a: number | null;
  seed_b: number | null;
  participant_a: string | null;
  participant_b: string | null;
  points_a: number | null;
  points_b: number | null;
  winner_participant_id: string | null;
  decided_reason: string | null;
  round_starts_on: string;
  round_ends_on: string;
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff.ok) return Response.json({ ok: false, error: "not_staff" }, { status: 403 });

  const { id } = await params;
  const [detail, config, bracket] = await Promise.all([
    getSeason(staff.s, id),
    loadPlayoffConfig(staff.s, id),
    loadPlayoffBracket(staff.s, id),
  ]);

  if (!detail.season) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  const seeds = bracket
    ? await q<SeedRow>(
        staff.s,
        `dc_playoff_seeds?bracket_id=eq.${bracket.id}&select=seed,participant_id,display_name,seed_points&order=seed.asc`
      )
    : [];

  const matchups = bracket
    ? await q<MatchupRow>(
        staff.s,
        `dc_playoff_matchups?bracket_id=eq.${bracket.id}` +
          `&select=id,round,slot,seed_a,seed_b,participant_a,participant_b,points_a,points_b,` +
          `winner_participant_id,decided_reason,round_starts_on,round_ends_on` +
          `&order=round.asc,slot.asc`
      )
    : [];

  // Season phase state, derived server-side in the season's own timezone.
  const status = statusFor(detail.season);

  // Name lookup so the bracket reads as names, not uuids. Seeds carry their own
  // snapshotted display_name — that is the authority, since a participant may
  // have been renamed since seeding.
  const nameBySeed = new Map(seeds.map((s) => [s.participant_id, s.display_name]));

  return Response.json({
    ok: true,
    season: {
      id: detail.season.id,
      name: detail.season.name,
      starts_on: detail.season.starts_on,
      ends_on: detail.season.ends_on,
      playoff_starts_on: detail.season.playoff_starts_on,
      roster_freeze_on: detail.season.roster_freeze_on,
      locked_at: detail.season.locked_at,
    },
    phase: status.phase,
    playoffs_live: status.playoffsLive,
    days_until_playoffs: status.daysUntilPlayoffs,
    roster_frozen: status.roster.frozen,
    regular_window: status.regularWindow,
    playoff_window: status.playoffWindow,
    config,
    bracket,
    seeds,
    matchups: matchups.map((m) => ({
      ...m,
      name_a: m.participant_a ? nameBySeed.get(m.participant_a) ?? null : null,
      name_b: m.participant_b ? nameBySeed.get(m.participant_b) ?? null : null,
    })),
  });
}
