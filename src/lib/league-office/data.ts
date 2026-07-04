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
  name: string;
  season: string | null;
  group_type: string | null;
  parent_id: string | null;
  captain_id: string | null;
};
export type Season = {
  id: string;
  slug: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  status: string;
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

const teamCols = "id,name,season,group_type,parent_id,captain_id";
const seasonCols =
  "id,slug,name,starts_on,ends_on,status,locked_at,free_agency_start,free_agency_notice_start";
const subCols =
  "id,email,handle,active,play_streak,full_set_streak,last_seen_at,created_at";

export const loadTeams = (s: Svc) => q<Team>(s, `teams?select=${teamCols}&order=name.asc`);
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
    teams: teams.filter((t) => t.group_type === "team" || t.group_type == null).length,
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
  memberships: { team: string; group_type: string | null; role: string; pending: boolean }[];
  badges: { key: string; earnedAt: string }[];
  totals: { attempts: number; wins: number; badges: number; teams: number };
};

export async function getSubscriber(s: Svc, id: string): Promise<SubscriberDetail> {
  const dates = lastNDates(7);
  const [subs, attempts, memberships, badges, teams] = await Promise.all([
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
  const sub = subs[0] ?? null;
  const memRows = memberships.map((m) => {
    const t = teamMap.get(m.team_id);
    return {
      team: t?.name ?? "—",
      group_type: t?.group_type ?? null,
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
  const [teams, memberships, subMap] = await Promise.all([
    loadTeams(s),
    q<{ team_id: string; pending: boolean }>(s, `team_memberships?select=team_id,pending`),
    loadSubscriberMap(s),
  ]);
  const byId = new Map(teams.map((t) => [t.id, t]));
  return teams
    .filter((t) => t.group_type !== "company")
    .map((t) => {
      const mem = memberships.filter((m) => m.team_id === t.id);
      const parent = t.parent_id ? byId.get(t.parent_id) : undefined;
      return {
        ...t,
        memberCount: mem.filter((m) => !m.pending).length,
        pendingCount: mem.filter((m) => m.pending).length,
        captainHandle: t.captain_id ? handleOf(subMap[t.captain_id]) : null,
        conference: parent?.name ?? null,
      };
    });
}

export type TeamDetail = {
  team: Team | null;
  conference: string | null;
  roster: { handle: string; role: string; pending: boolean }[];
  pending: { handle: string }[];
};

export async function getTeam(s: Svc, id: string): Promise<TeamDetail> {
  const [teams, memberships, subMap] = await Promise.all([
    loadTeams(s),
    q<{ subscriber_id: string; pending: boolean }>(
      s,
      `team_memberships?team_id=eq.${id}&select=subscriber_id,pending`
    ),
    loadSubscriberMap(s),
  ]);
  const team = teams.find((t) => t.id === id) ?? null;
  const parent = team?.parent_id ? teams.find((t) => t.id === team.parent_id) : undefined;
  const roster = memberships
    .filter((m) => !m.pending)
    .map((m) => ({
      handle: handleOf(subMap[m.subscriber_id]),
      role: team?.captain_id === m.subscriber_id ? "Captain" : "Member",
      pending: false,
    }));
  const pending = memberships
    .filter((m) => m.pending)
    .map((m) => ({ handle: handleOf(subMap[m.subscriber_id]) }));
  return { team, conference: parent?.name ?? null, roster, pending };
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
  const [teams, memberships] = await Promise.all([
    loadTeams(s),
    q<{ team_id: string; pending: boolean }>(s, `team_memberships?select=team_id,pending`),
  ]);
  const memByTeam = new Map<string, number>();
  for (const m of memberships) if (!m.pending) memByTeam.set(m.team_id, (memByTeam.get(m.team_id) ?? 0) + 1);
  const companies = teams.filter((t) => t.group_type === "company");
  const conferences = companies.map((c) => {
    const children = teams.filter((t) => t.parent_id === c.id);
    const teamRows = children.map((t) => ({ id: t.id, name: t.name, members: memByTeam.get(t.id) ?? 0 }));
    return {
      id: c.id,
      name: c.name,
      teamCount: children.length,
      memberCount: teamRows.reduce((a, b) => a + b.members, 0),
      teams: teamRows,
    };
  });
  // Independent teams (no company parent) grouped under a synthetic conference.
  const independents = teams.filter(
    (t) => t.group_type !== "company" && (!t.parent_id || !companies.some((c) => c.id === t.parent_id))
  );
  if (independents.length) {
    conferences.push({
      id: "independent",
      name: "Independent (no conference)",
      teamCount: independents.length,
      memberCount: independents.reduce((a, t) => a + (memByTeam.get(t.id) ?? 0), 0),
      teams: independents.map((t) => ({ id: t.id, name: t.name, members: memByTeam.get(t.id) ?? 0 })),
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
