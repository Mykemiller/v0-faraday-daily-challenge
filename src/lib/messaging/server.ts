// Shared server helpers for the DC messaging routes (CC-DC-MESSAGING-1.0).
// Deliberately COPIES the service-role + dc_sessions pattern from
// /api/leaderboard/team/[teamId] rather than refactoring it — this PR must be
// revertible without touching existing routes. Impure (fetches PostgREST);
// the pure rules live in ./rules.ts.

import { isPairBlocked } from './rules';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export { SUPABASE_URL };

export type Svc = Record<string, string>;

export function svcHeaders(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

export interface Viewer {
  id: string;
  handle: string | null;
  email: string | null;
  active: boolean;
}

export async function resolveSubscriber(
  h: Svc,
  token: string
): Promise<Viewer | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_sessions?token=eq.${encodeURIComponent(token)}&select=subscriber_id,expires_at`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || (row.expires_at && new Date(row.expires_at) < new Date())) return null;
  const sr = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_subscribers?id=eq.${row.subscriber_id}&select=id,handle,email,active`,
    { headers: h, cache: 'no-store' }
  );
  const srows = await sr.json().catch(() => null);
  const sub = Array.isArray(srows) ? srows[0] : null;
  return sub
    ? { id: sub.id, handle: sub.handle, email: sub.email, active: sub.active !== false }
    : null;
}

export interface Season {
  id: string;
  name: string | null;
  ends_on: string | null;
  locked_at: string | null;
}

export async function activeSeason(h: Svc): Promise<Season | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/seasons?status=eq.active&select=id,name,ends_on,locked_at&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

export interface BlockRow {
  blocker_id: string;
  blocked_id: string;
}

/** Every block row touching this subscriber, in either direction. */
export async function loadBlocksFor(
  h: Svc,
  subscriberId: string
): Promise<BlockRow[]> {
  const id = encodeURIComponent(subscriberId);
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_message_blocks?or=(blocker_id.eq.${id},blocked_id.eq.${id})&select=blocker_id,blocked_id`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return [];
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

export interface Conversation {
  id: string;
  kind: 'team_broadcast' | 'direct';
  team_id: string | null;
  season_id: string | null;
  pair_low: string | null;
  pair_high: string | null;
  last_message_at: string | null;
}

export async function fetchConversation(
  h: Svc,
  conversationId: string
): Promise<Conversation | null> {
  if (!/^[0-9a-fA-F-]{16,}$/.test(conversationId)) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_conversations?id=eq.${encodeURIComponent(conversationId)}&select=id,kind,team_id,season_id,pair_low,pair_high,last_message_at&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

export interface Team {
  id: string;
  name: string | null;
  captain_id: string | null;
}

export async function fetchTeam(h: Svc, teamId: string): Promise<Team | null> {
  if (!/^[0-9a-fA-F-]{16,}$/.test(teamId)) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/teams?id=eq.${encodeURIComponent(teamId)}&select=id,name,captain_id&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

/**
 * Resolve — or lazily create — the broadcast conversation for (team, season).
 * dc_conversations_team_key is a PARTIAL unique index, which PostgREST's
 * on_conflict upsert can't target, so this is select → insert → re-select on
 * 409: the losing side of a concurrent create lands on the winner's row.
 */
export async function findOrCreateBroadcast(
  h: Svc,
  teamId: string,
  seasonId: string
): Promise<Conversation | null> {
  const q = `${SUPABASE_URL}/rest/v1/dc_conversations?kind=eq.team_broadcast&team_id=eq.${encodeURIComponent(teamId)}&season_id=eq.${encodeURIComponent(seasonId)}&select=id,kind,team_id,season_id,pair_low,pair_high,last_message_at&limit=1`;
  const r0 = await fetch(q, { headers: h, cache: 'no-store' });
  if (r0.ok) {
    const rows = await r0.json().catch(() => null);
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/dc_conversations`, {
    method: 'POST',
    headers: { ...h, Prefer: 'return=representation' },
    body: JSON.stringify({ kind: 'team_broadcast', team_id: teamId, season_id: seasonId }),
  });
  if (ins.ok) {
    const rows = await ins.json().catch(() => null);
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  const r1 = await fetch(q, { headers: h, cache: 'no-store' });
  if (!r1.ok) return null;
  const rows = await r1.json().catch(() => null);
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

export interface MemberState {
  conversation_id: string;
  last_read_at: string | null;
  muted_at: string | null;
}

/** The viewer's read/mute state rows for a set of conversations (state only). */
export async function loadMemberStates(
  h: Svc,
  viewerId: string,
  conversationIds: string[]
): Promise<Map<string, MemberState>> {
  const map = new Map<string, MemberState>();
  if (conversationIds.length === 0) return map;
  const inList = conversationIds.map(encodeURIComponent).join(',');
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_conversation_members?subscriber_id=eq.${encodeURIComponent(viewerId)}&conversation_id=in.(${inList})&select=conversation_id,last_read_at,muted_at`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return map;
  const rows = await r.json().catch(() => []);
  for (const row of Array.isArray(rows) ? rows : []) map.set(row.conversation_id, row);
  return map;
}

/** Display handle: dc_subscribers.handle, falling back to the email local-part. */
export function displayHandle(sub: { handle: string | null; email: string | null } | null | undefined): string {
  if (!sub) return 'anonymous';
  return sub.handle || (sub.email ? sub.email.split('@')[0] : 'anonymous');
}

export interface VisibleThreads {
  season: Season | null;
  directs: Conversation[];
  broadcasts: Array<{ conversation: Conversation | null; team: Team }>;
}

/**
 * Every conversation the viewer may see, from the authorization sources only:
 * direct = pair membership minus blocked pairs; broadcast = one channel per
 * non-pending team membership this season. `createMissing` lazily materializes
 * broadcast conversations (inbox view); the unread scope skips creation — a
 * channel with no row has no messages, hence no unread.
 */
export async function visibleThreads(
  h: Svc,
  viewerId: string,
  blocks: BlockRow[],
  opts: { createMissing: boolean }
): Promise<VisibleThreads> {
  const vid = encodeURIComponent(viewerId);
  const [season, directR] = await Promise.all([
    activeSeason(h),
    fetch(
      `${SUPABASE_URL}/rest/v1/dc_conversations?kind=eq.direct&or=(pair_low.eq.${vid},pair_high.eq.${vid})&select=id,kind,team_id,season_id,pair_low,pair_high,last_message_at`,
      { headers: h, cache: 'no-store' }
    ),
  ]);

  const allDirects: Conversation[] = directR.ok
    ? ((await directR.json().catch(() => [])) as Conversation[])
    : [];
  const directs = allDirects.filter(c => {
    const other = c.pair_low === viewerId ? c.pair_high : c.pair_low;
    return other != null && !isPairBlocked(blocks, viewerId, other);
  });

  const broadcasts: VisibleThreads['broadcasts'] = [];
  if (season) {
    const memR = await fetch(
      `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${vid}&season_id=eq.${encodeURIComponent(season.id)}&pending=eq.false&select=team_id,teams(id,name,captain_id)`,
      { headers: h, cache: 'no-store' }
    );
    const memRows: Array<{ team_id: string; teams?: Team }> = memR.ok
      ? await memR.json().catch(() => [])
      : [];
    const teams = (Array.isArray(memRows) ? memRows : [])
      .map(m => m.teams)
      .filter((t): t is Team => !!t);
    if (teams.length > 0) {
      const inList = teams.map(t => encodeURIComponent(t.id)).join(',');
      const convR = await fetch(
        `${SUPABASE_URL}/rest/v1/dc_conversations?kind=eq.team_broadcast&season_id=eq.${encodeURIComponent(season.id)}&team_id=in.(${inList})&select=id,kind,team_id,season_id,pair_low,pair_high,last_message_at`,
        { headers: h, cache: 'no-store' }
      );
      const convRows: Conversation[] = convR.ok ? await convR.json().catch(() => []) : [];
      const byTeam = new Map(
        (Array.isArray(convRows) ? convRows : []).map(c => [c.team_id as string, c])
      );
      for (const team of teams) {
        let conversation = byTeam.get(team.id) ?? null;
        if (!conversation && opts.createMissing) {
          conversation = await findOrCreateBroadcast(h, team.id, season.id);
        }
        broadcasts.push({ conversation, team });
      }
    }
  }

  return { season, directs, broadcasts };
}

export type AuthorizeResult =
  | { ok: true; conversation: Conversation }
  | { ok: false; conversation: null; reason: 'not_permitted' };

/**
 * THE authorization source for a conversation. Derived fresh per request from
 * dc_conversations + team_memberships — never from dc_conversation_members
 * (state only). Every denial collapses to 'not_permitted' so callers can't
 * leak whether the conversation exists.
 *
 * direct    → viewer is pair_low or pair_high, and the pair is not blocked in
 *             either direction (blocked threads are unreachable by id).
 * broadcast → viewer has a non-pending team_memberships row for
 *             (team_id, season_id). Blocks never gate broadcasts.
 */
export async function authorizeConversation(
  h: Svc,
  conversationId: string,
  viewerId: string
): Promise<AuthorizeResult> {
  const denied: AuthorizeResult = { ok: false, conversation: null, reason: 'not_permitted' };
  const convo = await fetchConversation(h, conversationId);
  if (!convo) return denied;

  if (convo.kind === 'direct') {
    if (convo.pair_low !== viewerId && convo.pair_high !== viewerId) return denied;
    const other = convo.pair_low === viewerId ? convo.pair_high : convo.pair_low;
    if (!other) return denied;
    const blocks = await loadBlocksFor(h, viewerId);
    if (isPairBlocked(blocks, viewerId, other)) return denied;
    return { ok: true, conversation: convo };
  }

  // team_broadcast
  if (!convo.team_id || !convo.season_id) return denied;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?team_id=eq.${convo.team_id}&season_id=eq.${convo.season_id}&subscriber_id=eq.${encodeURIComponent(viewerId)}&pending=eq.false&select=subscriber_id&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return denied;
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows) || rows.length === 0) return denied;
  return { ok: true, conversation: convo };
}
