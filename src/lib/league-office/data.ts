// League Office — Tier 1 domain readers (server-only).
//
// Every export takes an already-verified Svc (see requireStaff) and returns
// plain, typed, view-ready objects. Reads are live (no-store) against the real
// engine schema on ycadmmngkdhvpcsrcuaq. At the current data scale we load the
// small dimension tables (teams, seasons) whole and join in memory — clean and
// FK-embedding-free; revisit with count headers / RPCs at growth scale
// (see LEAGUE-OFFICE-FINDINGS.md).

import { q, type Svc } from "./service";
import { GAMES } from "./constants";
import {
  groupRosterBySubscriber,
  memberCountsPath,
  tallyMemberCounts,
  type MemberCounts,
  type MembershipRow,
} from "./member-counts";

// ── CT date helpers (engine boundary is America/Chicago) ─────────────────────
export function ctToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function lastNDates(n: number, end = ctToday()): string[] {
  const out: string[] = [];
  const base = new Date(end + "T12:00:00Z");
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ── Shared dimension loads ───────────────────────────────────────────────────
export type Team = {
  id: string;
  code: string;
  name: string;
  captain_id: string | null;
  league_id: string | null;
  conference_id: string | null;
  is_active: boolean;
  archived_at: string | null;
};
export type ConferenceDim = {
  id: string;
  code: string;
  name: string;
  type: string;
  league_id: string | null;
  is_active: boolean;
  archived_at: string | null;
};
export type LeagueDim = {
  id: string;
  code: string;
  name: string;
  league_type: string;
  is_active: boolean;
  archived_at: string | null;
};
export type Season = {
  id: string;
  slug: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  status: string;
  /** Season-local timezone (default America/Chicago) — the clock the config
   *  editor's effective-dating fields are read against. */
  tz: string;
  locked_at: string | null;
  free_agency_start: string | null;
  free_agency_notice_start: string | null;
  playoff_starts_on: string | null;
  roster_freeze_on: string | null;
};
export type Subscriber = {
  id: string;
  email: string;
  handle: string | null;
  active: boolean | null;
  play_streak: number | null;
  full_set_streak: number | null;
  last_seen_at: string | null;
  created_at: string | null;
};

const teamCols = "id,code,name,captain_id,league_id,conference_id,is_active,archived_at";
const seasonCols =
  "id,slug,name,starts_on,ends_on,status,tz,locked_at,free_agency_start,free_agency_notice_start,playoff_starts_on,roster_freeze_on";
const subCols =
  "id,email,handle,active,play_streak,full_set_streak,last_seen_at,created_at";

export const loadTeams = (s: Svc) => q<Team>(s, `teams?select=${teamCols}&order=name.asc`);
export const loadConferenceDims = (s: Svc) =>
  q<ConferenceDim>(s, `conferences?select=id,code,name,type,league_id,is_active,archived_at&order=name.asc`);
export const loadLeagueDims = (s: Svc) =>
  q<LeagueDim>(s, `leagues?select=id,code,name,league_type,is_active,archived_at&order=name.asc`);
export const loadSeasons = (s: Svc) =>
  q<Season>(s, `seasons?select=${seasonCols}&order=starts_on.desc`);

function handleOf(sub: { handle: string | null; email: string } | undefined) {
  if (!sub) return "—";
  return sub.handle || sub.email.split("@")[0];
}

// ── Member counts (CC-LO-TEAM-COUNTS-1.0) ────────────────────────────────────
// The rule itself — DISTINCT subscriber_id, scoped to a season, never a row
// count — lives in ./member-counts (pure, tested). This is just the read.
async function loadMemberCounts(s: Svc, seasonId?: string): Promise<MemberCounts> {
  return tallyMemberCounts(await q<MembershipRow>(s, memberCountsPath(seasonId)));
}

/** Resolve the header's `?season` param to a real season, or null for "All
 *  Seasons". An id that matches no season degrades to All Seasons — filtering
 *  on a bogus id would 400 the PostgREST read and silently zero every count. */
export async function resolveSeasonScope(
  s: Svc,
  seasonId?: string
): Promise<Season | null> {
  if (!seasonId) return null;
  const seasons = await loadSeasons(s);
  return seasons.find((x) => x.id === seasonId) ?? null;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export type Dashboard = {
  activeSubscribers: number;
  playingToday: number;
  teams: number;
  pendingRequests: number;
  puzzleCached: number;
  season: Season | null;
  activity: { who: string; what: string; when: string; tone: string }[];
  attention: { chip: string; tone: string; title: string; sub: string; href: string }[];
};

export async function getDashboard(s: Svc, seasonId?: string): Promise<Dashboard> {
  const today = ctToday();
  const [subs, seasons, teams, memberships, attemptsToday, pageContent, scoreEvents] =
    await Promise.all([
      q<Subscriber>(s, `dc_subscribers?select=id,active`),
      loadSeasons(s),
      loadTeams(s),
      q<{ pending: boolean; team_id: string }>(s, `team_memberships?select=pending,team_id`),
      q<{ subscriber_id: string }>(
        s,
        `dc_daily_attempts?play_date=eq.${today}&select=subscriber_id`
      ),
      q<{ puzzle_date: string }>(
        s,
        `dc_daily_page_content?select=puzzle_date&puzzle_date=gte.${today}`
      ),
      q<{ subscriber_id: string; game_id: string; points: number; played_at: string }>(
        s,
        `score_events?select=subscriber_id,game_id,points,played_at&order=played_at.desc&limit=8`
      ),
    ]);

  const season =
    seasons.find((x) => x.id === seasonId) ??
    seasons.find((x) => x.status === "active") ??
    seasons[0] ??
    null;

  const subMap = await loadSubscriberMap(s);
  const pendingList = memberships.filter((m) => m.pending);

  const activity = scoreEvents.map((e) => ({
    who: handleOf(subMap[e.subscriber_id]),
    what: `Scored ${e.points} · ${e.game_id}`,
    when: fmtTime(e.played_at),
    tone: "green",
  }));

  const attention: Dashboard["attention"] = [];
  if (pendingList.length) {
    attention.push({
      chip: "PENDING",
      tone: "amber",
      title: `${pendingList.length} team membership request${pendingList.length > 1 ? "s" : ""} awaiting review`,
      sub: "Approve or deny from the team detail screens",
      href: "/league-office/teams",
    });
  }
  if (pageContent.length <= 1) {
    attention.push({
      chip: "PIPELINE",
      tone: "red",
      title: "Puzzle cache is thin",
      sub: `${pageContent.length} day of content cached from today forward`,
      href: "/league-office/puzzles",
    });
  }

  return {
    activeSubscribers: subs.filter((x) => x.active !== false).length,
    playingToday: new Set(attemptsToday.map((a) => a.subscriber_id)).size,
    teams: teams.length,
    pendingRequests: pendingList.length,
    puzzleCached: pageContent.length,
    season,
    activity,
    attention,
  };
}

async function loadSubscriberMap(
  s: Svc
): Promise<Record<string, { handle: string | null; email: string }>> {
  const rows = await q<{ id: string; handle: string | null; email: string }>(
    s,
    `dc_subscribers?select=id,handle,email`
  );
  return Object.fromEntries(rows.map((r) => [r.id, { handle: r.handle, email: r.email }]));
}

// ── Subscribers ──────────────────────────────────────────────────────────────
export type SubscriberRow = Subscriber & { teamCount: number };

export async function listSubscribers(s: Svc): Promise<SubscriberRow[]> {
  const [subs, memberships] = await Promise.all([
    q<Subscriber>(s, `dc_subscribers?select=${subCols}&order=created_at.desc`),
    q<{ subscriber_id: string }>(s, `team_memberships?select=subscriber_id&pending=is.false`),
  ]);
  const counts = new Map<string, number>();
  for (const m of memberships) counts.set(m.subscriber_id, (counts.get(m.subscriber_id) ?? 0) + 1);
  return subs.map((sub) => ({ ...sub, teamCount: counts.get(sub.id) ?? 0 }));
}

export type SubscriberDetail = {
  sub: Subscriber | null;
  matrix: { game: string; neon: string; cells: { date: string; score: number | null; played: boolean }[] }[];
  dates: string[];
  memberships: { team: string; conference: string | null; role: string; pending: boolean }[];
  badges: { key: string; earnedAt: string }[];
  totals: { attempts: number; wins: number; badges: number; teams: number };
};

export async function getSubscriber(s: Svc, id: string): Promise<SubscriberDetail> {
  const dates = lastNDates(7);
  const [subs, attempts, memberships, badges, teams, confs] = await Promise.all([
    q<Subscriber>(s, `dc_subscribers?id=eq.${id}&select=${subCols}`),
    q<{ game_type: string; play_date: string; score: number; result: string }>(
      s,
      `dc_daily_attempts?subscriber_id=eq.${id}&play_date=gte.${dates[0]}&select=game_type,play_date,score,result`
    ),
    q<{ team_id: string; pending: boolean }>(
      s,
      `team_memberships?subscriber_id=eq.${id}&select=team_id,pending`
    ),
    q<{ badge_key: string; earned_at: string }>(
      s,
      `dc_badges?subscriber_id=eq.${id}&select=badge_key,earned_at&order=earned_at.desc`
    ),
    loadTeams(s),
    loadConferenceDims(s),
  ]);

  const byCell = new Map<string, { score: number; result: string }>();
  for (const a of attempts) byCell.set(`${a.game_type.toLowerCase()}|${a.play_date}`, a);

  const matrix = GAMES.map((g) => ({
    game: g.key,
    neon: g.neon,
    cells: dates.map((d) => {
      const hit = byCell.get(`${g.key.toLowerCase()}|${d}`);
      return { date: d, score: hit ? hit.score : null, played: !!hit };
    }),
  }));

  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const confMap = new Map(confs.map((c) => [c.id, c]));
  const sub = subs[0] ?? null;
  const memRows = memberships.map((m) => {
    const t = teamMap.get(m.team_id);
    return {
      team: t?.name ?? "—",
      conference: (t?.conference_id && confMap.get(t.conference_id)?.name) || null,
      role: t?.captain_id && sub && t.captain_id === sub.id ? "Captain" : "Member",
      pending: m.pending,
    };
  });

  return {
    sub,
    matrix,
    dates,
    memberships: memRows,
    badges: badges.map((b) => ({ key: b.badge_key, earnedAt: b.earned_at })),
    totals: {
      attempts: attempts.length,
      wins: attempts.filter((a) => a.result === "win").length,
      badges: badges.length,
      teams: memRows.filter((m) => !m.pending).length,
    },
  };
}

// ── Teams ────────────────────────────────────────────────────────────────────
export type TeamCard = Team & {
  memberCount: number;
  pendingCount: number;
  captainHandle: string | null;
  conference: string | null;
  archived: boolean;
};

function isArchived(t: Team): boolean {
  return t.is_active === false || t.archived_at != null;
}

export async function listTeams(s: Svc, seasonId?: string): Promise<TeamCard[]> {
  const [teams, counts, subMap, confs] = await Promise.all([
    loadTeams(s),
    loadMemberCounts(s, seasonId),
    loadSubscriberMap(s),
    loadConferenceDims(s),
  ]);
  const confMap = new Map(confs.map((c) => [c.id, c]));
  return teams.map((t) => ({
    ...t,
    memberCount: counts.members(t.id),
    pendingCount: counts.pending(t.id),
    captainHandle: t.captain_id ? handleOf(subMap[t.captain_id]) : null,
    conference: (t.conference_id && confMap.get(t.conference_id)?.name) || null,
    archived: isArchived(t),
  }));
}

/** One membership ROW — i.e. one season of one person's tenure on this team. */
export type RosterSeason = { membershipId: string; seasonId: string; seasonName: string };

export type RosterEntry = {
  subscriberId: string;
  handle: string;
  role: string;
  /** Every row this person holds on this team within the resolved scope, one
   *  per season, newest first. Length is always 1 when a season is selected;
   *  it can exceed 1 only under "All Seasons". The destructive actions key on
   *  a SINGLE membership id, so the UI must make the caller pick one whenever
   *  this is longer than one — see the team detail page. */
  seasons: RosterSeason[];
};

export type TeamDetail = {
  team: Team | null;
  conference: string | null;
  archived: boolean;
  /** ONE ENTRY PER PERSON — never one per (person, season). */
  roster: RosterEntry[];
  pending: { membershipId: string; subscriberId: string; handle: string; seasonName: string }[];
  /** Active subscribers addable to this team. `membership.add` writes for the
   *  ACTIVE season, so this excludes only people already on the team IN THAT
   *  season — not everyone who was ever on it. */
  addable: { subscriberId: string; handle: string }[];
  /** Other live (non-archived) teams — destinations for "Move member". */
  otherTeams: { id: string; name: string }[];
};

export async function getTeam(s: Svc, id: string, seasonId?: string): Promise<TeamDetail> {
  const [teams, allRows, subMap, subs, confs, seasons] = await Promise.all([
    loadTeams(s),
    // ⚠️ Season-keyed: one row per (subscriber, season). Rows are grouped by
    // person below — rendering them raw is what listed 8 roster entries for 3
    // people and offered each of them 2–3 times in the captain picker.
    //
    // Deliberately fetched UNSCOPED and narrowed in JS: the roster follows the
    // header's season, but `addable` must always reflect the ACTIVE season
    // (that is the only season `membership.add` writes to). One query, two
    // readings — a season-filtered fetch could not serve both.
    q<{ id: string; subscriber_id: string; pending: boolean; season_id: string }>(
      s,
      `team_memberships?team_id=eq.${id}&select=id,subscriber_id,pending,season_id&left_at=is.null`
    ),
    loadSubscriberMap(s),
    q<{ id: string; handle: string | null; email: string; active: boolean | null }>(
      s,
      `dc_subscribers?select=id,handle,email,active&order=handle.asc`
    ),
    loadConferenceDims(s),
    loadSeasons(s),
  ]);
  const team = teams.find((t) => t.id === id) ?? null;
  const conf = team?.conference_id ? confs.find((c) => c.id === team.conference_id) : undefined;

  // loadSeasons() is ordered starts_on desc, so grouping in fetch order leaves
  // each person's seasons newest-first.
  const seasonName = new Map(seasons.map((x) => [x.id, x.name]));
  const order = new Map(seasons.map((x, i) => [x.id, i]));
  // The roster follows the header's season scope; `allRows` stays whole for the
  // active-season add list below.
  const memberships = seasonId ? allRows.filter((m) => m.season_id === seasonId) : allRows;
  const confirmed = memberships
    .filter((m) => !m.pending)
    .sort((a, b) => (order.get(a.season_id) ?? 99) - (order.get(b.season_id) ?? 99));
  const roster: RosterEntry[] = groupRosterBySubscriber(confirmed).map(({ subscriberId, rows }) => ({
    subscriberId,
    handle: handleOf(subMap[subscriberId]),
    role: team?.captain_id === subscriberId ? "Captain" : "Member",
    seasons: rows.map((m) => ({
      membershipId: m.id,
      seasonId: m.season_id,
      seasonName: seasonName.get(m.season_id) ?? "Unknown season",
    })),
  }));

  // Pending stays one row per REQUEST — each is a distinct season's request and
  // approve/deny act on exactly that row — but it now names the season.
  const pending = memberships
    .filter((m) => m.pending)
    .map((m) => ({
      membershipId: m.id,
      subscriberId: m.subscriber_id,
      handle: handleOf(subMap[m.subscriber_id]),
      seasonName: seasonName.get(m.season_id) ?? "Unknown season",
    }));

  // `membership.add` resolves the ACTIVE season and refuses a duplicate there,
  // so the add list must be filtered on that same season. Filtering on "ever on
  // this team" instead made a Season-1-only member permanently un-re-addable.
  const activeSeasonId = seasons.find((x) => x.status === "active")?.id;
  const onTeamThisSeason = new Set(
    allRows.filter((m) => !activeSeasonId || m.season_id === activeSeasonId).map((m) => m.subscriber_id)
  );
  const addable = subs
    .filter((sub) => sub.active !== false && !onTeamThisSeason.has(sub.id))
    .map((sub) => ({ subscriberId: sub.id, handle: handleOf(sub) }));

  const otherTeams = teams
    .filter((t) => t.id !== id && !isArchived(t))
    .map((t) => ({ id: t.id, name: t.name }));

  return {
    team,
    conference: conf?.name ?? null,
    archived: team ? isArchived(team) : false,
    roster,
    pending,
    addable,
    otherTeams,
  };
}

// ── League tree (management view) ────────────────────────────────────────────
//
// NOTE: a `getLeagues()` reader used to sit here, carrying a THIRD copy of the
// row-counting member tally. It had zero callers (the Leagues & Conferences
// page renders from getLeagueTree below), so it was removed rather than
// repaired — CC-LO-TEAM-COUNTS-1.0.
// leagues → conferences → teams, plus league-level "no conference" teams and a
// synthetic "Independent (no league)" bucket. Archived leagues/conferences are
// INCLUDED (flagged) so staff can restore them. Team↔conference assignment is
// the teams.conference_id / league_id FK columns; team_conference_memberships
// (trigger-derived from play) is deliberately NOT read here.
export type TeamLite = { id: string; name: string; members: number; archived: boolean };
export type ConfNode = {
  id: string;
  code: string;
  name: string;
  type: string;
  archived: boolean;
  teams: TeamLite[];
};
export type LeagueNode = {
  id: string;
  code: string;
  name: string;
  league_type: string;
  archived: boolean;
  conferences: ConfNode[];
  looseTeams: TeamLite[]; // in this league, no conference
};
export type LeagueTree = {
  leagues: LeagueNode[];
  independentTeams: TeamLite[]; // no league_id at all
  /** Active conferences across all leagues — options for team assignment. */
  assignTargets: { id: string; label: string }[];
};

export async function getLeagueTree(s: Svc, seasonId?: string): Promise<LeagueTree> {
  const [teams, counts, confs, leagues] = await Promise.all([
    loadTeams(s),
    // Same reader the Teams page uses, so the two surfaces cannot disagree.
    loadMemberCounts(s, seasonId),
    loadConferenceDims(s),
    loadLeagueDims(s),
  ]);

  const teamLite = (t: Team): TeamLite => ({
    id: t.id,
    name: t.name,
    members: counts.members(t.id),
    archived: t.is_active === false || t.archived_at != null,
  });
  const confArchived = (c: ConferenceDim) => c.is_active === false || c.archived_at != null;
  const leagueArchived = (l: LeagueDim) => l.is_active === false || l.archived_at != null;

  const leagueNodes: LeagueNode[] = leagues.map((l) => {
    const leagueConfs = confs.filter((c) => c.league_id === l.id);
    const conferences: ConfNode[] = leagueConfs.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      archived: confArchived(c),
      teams: teams.filter((t) => t.conference_id === c.id).map(teamLite),
    }));
    const looseTeams = teams
      .filter((t) => t.league_id === l.id && !t.conference_id)
      .map(teamLite);
    return {
      id: l.id,
      code: l.code,
      name: l.name,
      league_type: l.league_type,
      archived: leagueArchived(l),
      conferences,
      looseTeams,
    };
  });

  const independentTeams = teams.filter((t) => !t.league_id).map(teamLite);

  const assignTargets = confs
    .filter((c) => !confArchived(c))
    .map((c) => {
      const league = leagues.find((l) => l.id === c.league_id);
      return { id: c.id, label: `${league?.name ?? "—"} · ${c.name}` };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return { leagues: leagueNodes, independentTeams, assignTargets };
}

// ── Seasons ──────────────────────────────────────────────────────────────────
export async function listSeasons(s: Svc): Promise<Season[]> {
  return loadSeasons(s);
}

export type SeasonDetail = {
  season: Season | null;
  standings: { handle: string; rank: number }[];
  participants: number;
};

export async function getSeason(s: Svc, id: string): Promise<SeasonDetail> {
  const today = ctToday();
  const [seasons, snapshots, state, subMap] = await Promise.all([
    loadSeasons(s),
    q<{ subscriber_id: string; rank: number; snapshot_day: string; scope: string }>(
      s,
      `dc_rank_snapshots?scope=eq.global&select=subscriber_id,rank,snapshot_day&order=snapshot_day.desc&limit=200`
    ),
    q<{ subscriber_id: string }>(s, `dc_season_state?season_id=eq.${id}&select=subscriber_id`),
    loadSubscriberMap(s),
  ]);
  const season = seasons.find((x) => x.id === id) ?? null;
  // Latest snapshot day present, top 10 by rank.
  const latestDay = snapshots[0]?.snapshot_day;
  const standings = snapshots
    .filter((r) => r.snapshot_day === latestDay)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 10)
    .map((r) => ({ handle: handleOf(subMap[r.subscriber_id]), rank: r.rank }));
  void today;
  return { season, standings, participants: new Set(state.map((x) => x.subscriber_id)).size };
}

// ── Scoring reset preview ────────────────────────────────────────────────────
// Live per-table counts of the rows that resetSeasonScoring() would zero for the
// ACTIVE season. Counts only "dirty" rows (a target column currently non-zero) so
// the modal's numbers match exactly what the atomic RPC will change. Display-only;
// the RPC recomputes the authoritative counts server-side at run time.
export type ScoringResetPreview = {
  season: Season | null;
  counts: {
    score_events: number;
    dc_completions: number;
    leaderboard_daily: number;
    dc_season_state: number;
  };
  total: number;
};

export async function getScoringResetPreview(s: Svc): Promise<ScoringResetPreview> {
  const zero = { score_events: 0, dc_completions: 0, leaderboard_daily: 0, dc_season_state: 0 };
  const seasons = await loadSeasons(s);
  const season = seasons.find((x) => x.status === "active") ?? null;
  if (!season || !season.starts_on || !season.ends_on) {
    return { season, counts: zero, total: 0 };
  }
  const [se, dc, lb, ss] = await Promise.all([
    // Part C: score_events carries legacy_season_id (audit-only) — new rows are
    // attributed by date at read time. This preview counts the legacy-stamped
    // rows, matching what the (un-applied) reset RPC would target.
    q<{ id: string }>(s, `score_events?legacy_season_id=eq.${season.id}&points=neq.0&select=id`),
    q<{ id: string }>(
      s,
      `dc_completions?puzzle_date=gte.${season.starts_on}&puzzle_date=lte.${season.ends_on}&score=neq.0&select=id`
    ),
    q<{ subscriber_id: string }>(
      s,
      `leaderboard_daily?play_date=gte.${season.starts_on}&play_date=lte.${season.ends_on}&or=(score.neq.0,games_played.neq.0,total_time_secs.neq.0)&select=subscriber_id`
    ),
    q<{ subscriber_id: string }>(
      s,
      `dc_season_state?season_id=eq.${season.id}&or=(completed_signals.neq.0,dropped_signals.neq.0)&select=subscriber_id`
    ),
  ]);
  const counts = {
    score_events: se.length,
    dc_completions: dc.length,
    leaderboard_daily: lb.length,
    dc_season_state: ss.length,
  };
  return {
    season,
    counts,
    total: counts.score_events + counts.dc_completions + counts.leaderboard_daily + counts.dc_season_state,
  };
}

// ── Puzzle & Hint calendar + IDF ranking ─────────────────────────────────────
export type PuzzleDay = { date: string; cached: boolean; domain: string | null; synced: boolean };
export type DomainRank = { code: string; name: string; num: number; emoji: string | null };

export async function getPuzzleCalendar(
  s: Svc
): Promise<{ days: PuzzleDay[]; domains: DomainRank[]; month: string }> {
  const dates = lastNDates(28); // trailing 4-week window ending today
  const [content, domains] = await Promise.all([
    q<{ puzzle_date: string; domain_code: string | null; synced_at: string | null }>(
      s,
      `dc_daily_page_content?select=puzzle_date,domain_code,synced_at&puzzle_date=gte.${dates[0]}`
    ),
    q<DomainRank & { domain_num: number; domain_name: string; domain_code: string }>(
      s,
      `faraday_domains?active=eq.true&select=domain_code,domain_num,domain_name,emoji&order=domain_num.asc`
    ),
  ]);
  const byDate = new Map(content.map((c) => [c.puzzle_date, c]));
  const days = dates.map((d) => {
    const hit = byDate.get(d);
    return {
      date: d,
      cached: !!hit,
      domain: hit?.domain_code ?? null,
      synced: !!hit?.synced_at,
    };
  });
  return {
    days,
    month: dates[dates.length - 1].slice(0, 7),
    domains: domains.map((d) => ({
      code: d.domain_code,
      name: d.domain_name,
      num: d.domain_num,
      emoji: d.emoji ?? null,
    })),
  };
}

// ── formatting ───────────────────────────────────────────────────────────────
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}
