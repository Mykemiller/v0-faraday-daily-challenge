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
};
export type ConferenceDim = {
  id: string;
  code: string;
  name: string;
  type: string;
  league_id: string | null;
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

const teamCols = "id,code,name,captain_id,league_id,conference_id";
const seasonCols =
  "id,slug,name,starts_on,ends_on,status,tz,locked_at,free_agency_start,free_agency_notice_start";
const subCols =
  "id,email,handle,active,play_streak,full_set_streak,last_seen_at,created_at";

export const loadTeams = (s: Svc) => q<Team>(s, `teams?select=${teamCols}&order=name.asc`);
export const loadConferenceDims = (s: Svc) =>
  q<ConferenceDim>(s, `conferences?select=id,code,name,type,league_id,archived_at&order=name.asc`);
export const loadSeasons = (s: Svc) =>
  q<Season>(s, `seasons?select=${seasonCols}&order=starts_on.desc`);

function handleOf(sub: { handle: string | null; email: string } | undefined) {
  if (!sub) return "—";
  return sub.handle || sub.email.split("@")[0];
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
};

export async function listTeams(s: Svc): Promise<TeamCard[]> {
  const [teams, memberships, subMap, confs] = await Promise.all([
    loadTeams(s),
    q<{ team_id: string; pending: boolean }>(s, `team_memberships?select=team_id,pending`),
    loadSubscriberMap(s),
    loadConferenceDims(s),
  ]);
  const confMap = new Map(confs.map((c) => [c.id, c]));
  return teams.map((t) => {
    const mem = memberships.filter((m) => m.team_id === t.id);
    return {
      ...t,
      memberCount: mem.filter((m) => !m.pending).length,
      pendingCount: mem.filter((m) => m.pending).length,
      captainHandle: t.captain_id ? handleOf(subMap[t.captain_id]) : null,
      conference: (t.conference_id && confMap.get(t.conference_id)?.name) || null,
    };
  });
}

export type TeamDetail = {
  team: Team | null;
  conference: string | null;
  roster: { membershipId: string; subscriberId: string; handle: string; role: string }[];
  pending: { membershipId: string; subscriberId: string; handle: string }[];
};

export async function getTeam(s: Svc, id: string): Promise<TeamDetail> {
  const [teams, memberships, subMap, confs] = await Promise.all([
    loadTeams(s),
    q<{ id: string; subscriber_id: string; pending: boolean }>(
      s,
      `team_memberships?team_id=eq.${id}&select=id,subscriber_id,pending`
    ),
    loadSubscriberMap(s),
    loadConferenceDims(s),
  ]);
  const team = teams.find((t) => t.id === id) ?? null;
  const conf = team?.conference_id ? confs.find((c) => c.id === team.conference_id) : undefined;
  const roster = memberships
    .filter((m) => !m.pending)
    .map((m) => ({
      membershipId: m.id,
      subscriberId: m.subscriber_id,
      handle: handleOf(subMap[m.subscriber_id]),
      role: team?.captain_id === m.subscriber_id ? "Captain" : "Member",
    }));
  const pending = memberships
    .filter((m) => m.pending)
    .map((m) => ({ membershipId: m.id, subscriberId: m.subscriber_id, handle: handleOf(subMap[m.subscriber_id]) }));
  return { team, conference: conf?.name ?? null, roster, pending };
}

// ── Leagues & Conferences ────────────────────────────────────────────────────
export type Conference = {
  id: string;
  name: string;
  teamCount: number;
  memberCount: number;
  teams: { id: string; name: string; members: number }[];
};

export async function getLeagues(s: Svc): Promise<Conference[]> {
  // Part B: conferences are REAL rows now (the org/private/public groupings in
  // `conferences`), not teams.group_type='company' — that hierarchy is retired.
  const [teams, memberships, confs] = await Promise.all([
    loadTeams(s),
    q<{ team_id: string; pending: boolean }>(s, `team_memberships?select=team_id,pending`),
    loadConferenceDims(s),
  ]);
  const memByTeam = new Map<string, number>();
  for (const m of memberships) if (!m.pending) memByTeam.set(m.team_id, (memByTeam.get(m.team_id) ?? 0) + 1);
  const conferences = confs
    .filter((c) => !c.archived_at)
    .map((c) => {
      const members = teams.filter((t) => t.conference_id === c.id);
      const teamRows = members.map((t) => ({ id: t.id, name: t.name, members: memByTeam.get(t.id) ?? 0 }));
      return {
        id: c.id,
        name: c.name,
        teamCount: members.length,
        memberCount: teamRows.reduce((a, b) => a + b.members, 0),
        teams: teamRows,
      };
    });
  // Teams without a home conference grouped under a synthetic bucket.
  const homeless = teams.filter((t) => !t.conference_id);
  if (homeless.length) {
    conferences.push({
      id: "no-conference",
      name: "No conference",
      teamCount: homeless.length,
      memberCount: homeless.reduce((a, t) => a + (memByTeam.get(t.id) ?? 0), 0),
      teams: homeless.map((t) => ({ id: t.id, name: t.name, members: memByTeam.get(t.id) ?? 0 })),
    });
  }
  return conferences;
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
    q<{ id: string }>(s, `score_events?season_id=eq.${season.id}&points=neq.0&select=id`),
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
