// League Office — member counting (CC-LO-TEAM-COUNTS-1.0). Pure logic, no I/O,
// so the rule can be tested directly: `npm run test:member-counts`.
//
// ⚠️ `team_memberships` is SEASON-KEYED — one row per (subscriber, team,
// season). A player who has been on a team for three seasons owns three rows.
// Counting rows therefore reports a season artifact, not a headcount: it is
// what made the console show "8 members" beside a team of 3 people whose
// leaderboard score came from 3 players, and it cost real diagnostic time on
// 2026-08-03. EVERY member count over this table must be
// COUNT(DISTINCT subscriber_id), scoped to a season. Never `.length`,
// never COUNT(*).

export type MembershipRow = {
  team_id: string;
  subscriber_id: string;
  pending: boolean;
};

export type MemberCounts = {
  /** Distinct confirmed members of a team, within the resolved season scope. */
  members: (teamId: string) => number;
  /** Distinct pending join requests — surfaced separately, never folded in. */
  pending: (teamId: string) => number;
};

/** The PostgREST path every League Office member count reads.
 *
 *  Filters mirror `team_leaderboard` exactly, because the leaderboard is the
 *  correct surface and the console aligns to it (D6):
 *    · `pending` is selected, not filtered — confirmed and pending are counted
 *      into separate buckets by `tallyMemberCounts`, matching the RPC's
 *      `tm.pending = false` for the headline figure.
 *    · `left_at IS NULL` — departed members are not members.
 *    · NO `dc_subscribers.active` filter. `team_leaderboard` has none either;
 *      adding one here would make the console and the leaderboard disagree the
 *      day an opted-out subscriber holds an active-season membership.
 *
 *  `seasonId` = a specific season → members IN that season. `undefined`
 *  ("All Seasons") → distinct people who have EVER been on the team. */
export function memberCountsPath(seasonId?: string): string {
  const season = seasonId ? `&season_id=eq.${encodeURIComponent(seasonId)}` : "";
  return `team_memberships?select=team_id,subscriber_id,pending&left_at=is.null${season}`;
}

/** Roll season-keyed membership rows up into per-team DISTINCT headcounts. */
export function tallyMemberCounts(rows: MembershipRow[]): MemberCounts {
  const confirmed = new Map<string, Set<string>>();
  const awaiting = new Map<string, Set<string>>();
  for (const r of rows) {
    const bucket = r.pending ? awaiting : confirmed;
    let seen = bucket.get(r.team_id);
    if (!seen) bucket.set(r.team_id, (seen = new Set<string>()));
    seen.add(r.subscriber_id);
  }
  return {
    members: (id) => confirmed.get(id)?.size ?? 0,
    pending: (id) => awaiting.get(id)?.size ?? 0,
  };
}
