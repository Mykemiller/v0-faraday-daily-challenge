// DC messaging core API (CC-DC-MESSAGING-1.0).
//
// GET  /api/messages?token=&scope=threads                      → inbox
// GET  /api/messages?token=&scope=thread&conversation_id=|team_id= → one thread
// GET  /api/messages?token=&scope=unread                       → badge counts
// GET  /api/messages?token=&scope=commissioner                 → commissioner resolver (CC-DC-MSG-DOCK-1.0 D4)
// GET  /api/messages?token=&scope=captain                      → per-team captain resolver (CC-DC-MSG-DOCK-1.0 D2)
// POST /api/messages   body: { token, action, ... }
//   action "send"       { conversation_id | team_id | to_subscriber_id, body }
//   action "mark-read"  { conversation_id }
//   action "mute" / "unmute"  { conversation_id }
//   action "delete"     { message_id }   (soft delete — never SQL DELETE)
//
// Every read and write is authorized server-side against the resolved session
// (authorizeConversation / captain re-check) — the UI hiding an affordance is
// never the enforcement point. Mirrors the service-role + dc_sessions pattern
// of /api/leaderboard/team/[teamId].

import {
  SUPABASE_URL,
  type Svc,
  type Conversation,
  svcHeaders,
  resolveSubscriber,
  activeSeason,
  loadBlocksFor,
  authorizeConversation,
  fetchConversation,
  fetchTeam,
  findOrCreateBroadcast,
  loadMemberStates,
  displayHandle,
  visibleThreads,
} from '@/lib/messaging/server';
import {
  MAX_BROADCASTS_PER_TEAM_PER_DAY,
  MAX_NEW_THREADS_PER_DAY,
  MAX_DMS_PER_DAY,
  DAY_MS,
  normalizeBody,
  orderPair,
  countInWindow,
  countUnread,
  isPairBlocked,
} from '@/lib/messaging/rules';
import { STAFF } from '@/lib/league-office/constants';

export const dynamic = 'force-dynamic';

const PREVIEW_CHARS = 120;
const THREAD_PAGE = 100;

interface MessageRow {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
  dc_subscribers?: { handle: string | null; email: string | null };
}

/** All non-deleted messages for a set of conversations, newest first. */
async function loadMessagesFor(h: Svc, conversationIds: string[]): Promise<MessageRow[]> {
  if (conversationIds.length === 0) return [];
  const inList = conversationIds.map(encodeURIComponent).join(',');
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_messages?conversation_id=in.(${inList})&deleted_at=is.null&select=id,conversation_id,author_id,body,created_at,deleted_at&order=created_at.desc&limit=1000`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return [];
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

/** Broadcast sends in this conversation in the trailing 24h — INCLUDING soft-
 *  deleted ones (deleting a broadcast never refunds the day's quota). */
async function broadcastsInWindow(h: Svc, conversationId: string): Promise<number> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&select=created_at&order=created_at.desc&limit=${MAX_BROADCASTS_PER_TEAM_PER_DAY + 5}`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return 0;
  const rows: Array<{ created_at: string }> = await r.json().catch(() => []);
  return countInWindow(
    (Array.isArray(rows) ? rows : []).map(m => m.created_at),
    Date.now()
  );
}

async function upsertMemberState(
  h: Svc,
  conversationId: string,
  subscriberId: string,
  patch: { last_read_at?: string; muted_at?: string | null }
): Promise<boolean> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/dc_conversation_members`, {
    method: 'POST',
    headers: { ...h, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      conversation_id: conversationId,
      subscriber_id: subscriberId,
      ...patch,
    }),
  });
  return r.ok;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  const h = svcHeaders();
  if (!h) return Response.json({ error: 'not_configured' }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') ?? '';
  const scope = searchParams.get('scope') ?? 'threads';

  const viewer = token ? await resolveSubscriber(h, token) : null;
  if (!viewer) return Response.json({ error: 'invalid_session' }, { status: 401 });

  if (scope === 'threads') return getThreads(h, viewer.id);
  if (scope === 'thread') {
    return getThread(
      h,
      viewer.id,
      searchParams.get('conversation_id'),
      searchParams.get('team_id')
    );
  }
  if (scope === 'unread') return getUnread(h, viewer.id);
  if (scope === 'commissioner') return getCommissioner(h, viewer.id);
  if (scope === 'captain') return getCaptains(h, viewer.id);
  return Response.json({ error: 'unknown_scope' }, { status: 400 });
}

/**
 * D4 (CC-DC-MSG-DOCK-1.0): resolve "The Commissioner" for the dock. The League
 * Office staff allowlist (src/lib/league-office/constants.ts STAFF) is the
 * source of truth — the subscriber row is looked up by email (citext) on every
 * request, never a hardcoded uuid. Requires a valid session (the shared 401
 * gate in GET runs before scope dispatch). No subscriber row for the allowlist
 * email → { available: false } → the dock disables the item. Sends to the
 * resolved id go through the ordinary direct-message path: normal rate limits
 * and block rules apply.
 */
async function getCommissioner(h: Svc, viewerId: string) {
  const email = Object.keys(STAFF).find(e => STAFF[e] === 'commissioner');
  if (!email) return Response.json({ available: false });
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_subscribers?email=eq.${encodeURIComponent(email)}&select=id,handle,email,active&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  const rows = r.ok ? await r.json().catch(() => []) : [];
  const sub = Array.isArray(rows) ? rows[0] : null;
  if (!sub || sub.active === false) return Response.json({ available: false });
  return Response.json({
    available: true,
    subscriber_id: sub.id,
    handle: displayHandle(sub),
    is_self: sub.id === viewerId,
  });
}

/**
 * D2 (CC-DC-MSG-DOCK-1.0): fresh captain resolution for every team the viewer
 * belongs to this season. Captaincy rolls when a captain leaves, so the client
 * must call this at the moment it opens or sends the captain thread — never
 * cache a captain id client-side. Membership comes from the same
 * team_memberships source authorizeConversation uses.
 */
async function getCaptains(h: Svc, viewerId: string) {
  const season = await activeSeason(h);
  if (!season) return Response.json({ teams: [] });
  const memR = await fetch(
    `${SUPABASE_URL}/rest/v1/team_memberships?subscriber_id=eq.${encodeURIComponent(viewerId)}&season_id=eq.${encodeURIComponent(season.id)}&pending=eq.false&select=team_id,teams(id,name,captain_id)`,
    { headers: h, cache: 'no-store' }
  );
  const memRows = memR.ok ? await memR.json().catch(() => []) : [];
  const teams = (Array.isArray(memRows) ? memRows : [])
    .map((m: { teams?: { id: string; name: string | null; captain_id: string | null } }) => m.teams)
    .filter((t): t is { id: string; name: string | null; captain_id: string | null } => !!t);

  // Handle lookup for all foreign captains in one query — handle only, never
  // the email address.
  const captainIds = [...new Set(
    teams.map(t => t.captain_id).filter((id): id is string => !!id && id !== viewerId)
  )];
  const handleById = new Map<string, string>();
  if (captainIds.length > 0) {
    const inList = captainIds.map(encodeURIComponent).join(',');
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_subscribers?id=in.(${inList})&select=id,handle,email`,
      { headers: h, cache: 'no-store' }
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    for (const s of Array.isArray(rows) ? rows : []) handleById.set(s.id, displayHandle(s));
  }

  return Response.json({
    teams: teams.map(t => ({
      team_id: t.id,
      team_name: t.name,
      is_captain: t.captain_id === viewerId,
      captain:
        t.captain_id && t.captain_id !== viewerId
          ? { subscriber_id: t.captain_id, handle: handleById.get(t.captain_id) ?? 'anonymous' }
          : null,
    })),
  });
}

async function getThreads(h: Svc, viewerId: string) {
  const blocks = await loadBlocksFor(h, viewerId);
  const { directs, broadcasts } = await visibleThreads(h, viewerId, blocks, {
    createMissing: true,
  });

  const broadcastConvos = broadcasts.filter(b => b.conversation);
  const convoIds = [
    ...directs.map(c => c.id),
    ...broadcastConvos.map(b => b.conversation!.id),
  ];

  const [states, messages] = await Promise.all([
    loadMemberStates(h, viewerId, convoIds),
    loadMessagesFor(h, convoIds),
  ]);
  const byConvo = new Map<string, MessageRow[]>();
  for (const m of messages) {
    const list = byConvo.get(m.conversation_id);
    if (list) list.push(m);
    else byConvo.set(m.conversation_id, [m]);
  }

  // Counterpart handles for direct threads — one query, handle only.
  const counterpartIds = directs
    .map(c => (c.pair_low === viewerId ? c.pair_high : c.pair_low))
    .filter((id): id is string => !!id);
  const handleById = new Map<string, string>();
  if (counterpartIds.length > 0) {
    const inList = counterpartIds.map(encodeURIComponent).join(',');
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_subscribers?id=in.(${inList})&select=id,handle,email`,
      { headers: h, cache: 'no-store' }
    );
    const rows = r.ok ? await r.json().catch(() => []) : [];
    for (const s of Array.isArray(rows) ? rows : []) {
      handleById.set(s.id, displayHandle(s));
    }
  }

  const threadRow = (c: Conversation, title: string, counterpart: string | null, teamId: string | null) => {
    const msgs = byConvo.get(c.id) ?? []; // newest first
    const state = states.get(c.id);
    return {
      conversation_id: c.id,
      kind: c.kind,
      title,
      counterpart_handle: counterpart,
      team_id: teamId,
      last_message_at: c.last_message_at,
      preview: msgs[0] ? msgs[0].body.slice(0, PREVIEW_CHARS) : null,
      unread: countUnread(msgs, state?.last_read_at ?? null, viewerId),
      muted: !!state?.muted_at,
    };
  };

  const threads = [
    ...directs.map(c => {
      const other = c.pair_low === viewerId ? c.pair_high! : c.pair_low!;
      const handle = handleById.get(other) ?? 'anonymous';
      return threadRow(c, `@${handle}`, handle, null);
    }),
    ...broadcastConvos.map(b =>
      threadRow(b.conversation!, b.team.name ?? 'Team', null, b.team.id)
    ),
  ].sort((a, b) => {
    if (a.last_message_at === b.last_message_at) return 0;
    if (a.last_message_at === null) return 1;
    if (b.last_message_at === null) return -1;
    return a.last_message_at < b.last_message_at ? 1 : -1;
  });

  return Response.json({ threads });
}

async function getThread(
  h: Svc,
  viewerId: string,
  conversationId: string | null,
  teamId: string | null
) {
  let convo: Conversation | null = null;

  if (teamId) {
    // Broadcast channel by team: resolve or lazily create for the active
    // season, then authorize by membership like any other conversation.
    const season = await activeSeason(h);
    if (!season) return Response.json({ error: 'no_active_season' }, { status: 404 });
    const team = await fetchTeam(h, teamId);
    if (!team) return Response.json({ error: 'not_permitted' }, { status: 403 });
    convo = await findOrCreateBroadcast(h, teamId, season.id);
  } else if (conversationId) {
    convo = await fetchConversation(h, conversationId);
  }
  if (!convo) return Response.json({ error: 'not_permitted' }, { status: 403 });

  // 403 on every denial — never leak whether the conversation exists.
  const auth = await authorizeConversation(h, convo.id, viewerId);
  if (!auth.ok) return Response.json({ error: 'not_permitted' }, { status: 403 });
  convo = auth.conversation;

  // Latest page, returned oldest → newest. Author handle comes from the
  // embedded subscriber row — handle or email local-part, NEVER the email.
  // The FK hint is required: dc_messages has TWO FKs to dc_subscribers
  // (author_id, deleted_by), and an unhinted embed is ambiguous → PostgREST 300.
  const mR = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_messages?conversation_id=eq.${encodeURIComponent(convo.id)}&deleted_at=is.null&select=id,conversation_id,author_id,body,created_at,deleted_at,dc_subscribers!dc_messages_author_id_fkey(handle,email)&order=created_at.desc&limit=${THREAD_PAGE}`,
    { headers: h, cache: 'no-store' }
  );
  const raw: MessageRow[] = mR.ok ? await mR.json().catch(() => []) : [];
  const page = (Array.isArray(raw) ? raw : []).reverse();

  let isCaptain = false;
  let extra: Record<string, unknown> = {};

  if (convo.kind === 'team_broadcast') {
    // Re-fetch the team on every read — captaincy rolls on leave.
    const team = convo.team_id ? await fetchTeam(h, convo.team_id) : null;
    isCaptain = !!team && team.captain_id === viewerId;
    const used = isCaptain ? await broadcastsInWindow(h, convo.id) : 0;
    extra = {
      is_captain: isCaptain,
      remaining_today: isCaptain
        ? Math.max(0, MAX_BROADCASTS_PER_TEAM_PER_DAY - used)
        : null,
      team: team ? { id: team.id, name: team.name } : null,
    };
  } else {
    const otherId = convo.pair_low === viewerId ? convo.pair_high! : convo.pair_low!;
    const [blocks, sR] = await Promise.all([
      loadBlocksFor(h, viewerId),
      fetch(
        `${SUPABASE_URL}/rest/v1/dc_subscribers?id=eq.${encodeURIComponent(otherId)}&select=id,handle,email`,
        { headers: h, cache: 'no-store' }
      ),
    ]);
    const sRows = sR.ok ? await sR.json().catch(() => []) : [];
    const other = Array.isArray(sRows) ? sRows[0] : null;
    extra = {
      counterpart: {
        subscriber_id: otherId,
        handle: displayHandle(other),
        is_blocked_by_me: blocks.some(
          b => b.blocker_id === viewerId && b.blocked_id === otherId
        ),
      },
    };
  }

  const messages = page.map(m => ({
    id: m.id,
    author_id: m.author_id,
    author_handle: displayHandle(m.dc_subscribers),
    body: m.body,
    created_at: m.created_at,
    is_mine: m.author_id === viewerId,
    can_delete: m.author_id === viewerId || (convo!.kind === 'team_broadcast' && isCaptain),
  }));

  // The viewer's own read/mute state (state only — never authorization) so the
  // UI can mark unread messages and render the mute toggle without extra calls.
  const states = await loadMemberStates(h, viewerId, [convo.id]);
  const st = states.get(convo.id);

  return Response.json({
    conversation_id: convo.id,
    kind: convo.kind,
    messages,
    viewer_state: {
      last_read_at: st?.last_read_at ?? null,
      muted: !!st?.muted_at,
    },
    ...extra,
  });
}

async function getUnread(h: Svc, viewerId: string) {
  const blocks = await loadBlocksFor(h, viewerId);
  const { directs, broadcasts } = await visibleThreads(h, viewerId, blocks, {
    createMissing: false,
  });
  const broadcastConvos = broadcasts.filter(b => b.conversation);
  const convoIds = [
    ...directs.map(c => c.id),
    ...broadcastConvos.map(b => b.conversation!.id),
  ];

  // Bounded round-trips: one state query + one messages query for ALL visible
  // conversations — never a fetch per conversation.
  const [states, messages] = await Promise.all([
    loadMemberStates(h, viewerId, convoIds),
    loadMessagesFor(h, convoIds),
  ]);
  const byConvo = new Map<string, MessageRow[]>();
  for (const m of messages) {
    const list = byConvo.get(m.conversation_id);
    if (list) list.push(m);
    else byConvo.set(m.conversation_id, [m]);
  }

  let total = 0;
  const by_conversation: Record<string, number> = {};
  const by_team: Record<string, number> = {};
  const teamByConvo = new Map(
    broadcastConvos.map(b => [b.conversation!.id, b.team.id])
  );

  for (const id of convoIds) {
    const state = states.get(id);
    const n = countUnread(byConvo.get(id) ?? [], state?.last_read_at ?? null, viewerId);
    if (n === 0) continue;
    by_conversation[id] = n;
    const teamId = teamByConvo.get(id);
    if (teamId) by_team[teamId] = n;
    if (!state?.muted_at) total += n; // muted threads never feed the badge
  }

  return Response.json({ total, by_conversation, by_team });
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const h = svcHeaders();
  if (!h) return Response.json({ error: 'not_configured' }, { status: 500 });

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const { token, action } = payload as { token?: string; action?: string };

  const viewer = token ? await resolveSubscriber(h, String(token)) : null;
  if (!viewer) return Response.json({ error: 'invalid_session' }, { status: 401 });

  switch (action) {
    case 'send':
      return doSend(h, viewer.id, payload);
    case 'mark-read':
      return doMemberState(h, viewer.id, payload, { last_read_at: new Date().toISOString() });
    case 'mute':
      return doMemberState(h, viewer.id, payload, { muted_at: new Date().toISOString() });
    case 'unmute':
      return doMemberState(h, viewer.id, payload, { muted_at: null });
    case 'delete':
      return doDelete(h, viewer.id, payload);
    default:
      return Response.json({ error: 'unknown_action' }, { status: 400 });
  }
}

/** Viewer's DM sends in the trailing 24h (direct conversations only). */
async function dmsInWindow(h: Svc, viewerId: string): Promise<number> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_messages?author_id=eq.${encodeURIComponent(viewerId)}&created_at=gt.${new Date(Date.now() - DAY_MS).toISOString()}&select=created_at,dc_conversations!inner(kind)&dc_conversations.kind=eq.direct&limit=${MAX_DMS_PER_DAY + 5}`,
    { headers: h, cache: 'no-store' }
  );
  if (!r.ok) return 0;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Direct threads the viewer OPENED in the trailing 24h — a thread counts
 * against the opener (first message author), not the recipient, so being
 * spammed can never consume a victim's own thread budget.
 */
async function threadsOpenedInWindow(h: Svc, viewerId: string): Promise<number> {
  const vid = encodeURIComponent(viewerId);
  const cutoff = new Date(Date.now() - DAY_MS).toISOString();
  const cR = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_conversations?kind=eq.direct&or=(pair_low.eq.${vid},pair_high.eq.${vid})&created_at=gt.${cutoff}&select=id`,
    { headers: h, cache: 'no-store' }
  );
  if (!cR.ok) return 0;
  const convos: Array<{ id: string }> = await cR.json().catch(() => []);
  if (!Array.isArray(convos) || convos.length === 0) return 0;
  const inList = convos.map(c => encodeURIComponent(c.id)).join(',');
  const mR = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_messages?conversation_id=in.(${inList})&select=conversation_id,author_id,created_at&order=created_at.asc&limit=1000`,
    { headers: h, cache: 'no-store' }
  );
  if (!mR.ok) return 0;
  const msgs: Array<{ conversation_id: string; author_id: string }> =
    await mR.json().catch(() => []);
  const firstAuthor = new Map<string, string>();
  for (const m of Array.isArray(msgs) ? msgs : []) {
    if (!firstAuthor.has(m.conversation_id)) firstAuthor.set(m.conversation_id, m.author_id);
  }
  let n = 0;
  for (const c of convos) {
    const fa = firstAuthor.get(c.id);
    if (fa === undefined || fa === viewerId) n++; // empty thread = viewer just opened it
  }
  return n;
}

async function insertMessage(
  h: Svc,
  conversationId: string,
  authorId: string,
  body: string
) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/dc_messages`, {
    method: 'POST',
    headers: { ...h, Prefer: 'return=representation' },
    body: JSON.stringify({ conversation_id: conversationId, author_id: authorId, body }),
  });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

async function doSend(h: Svc, viewerId: string, payload: Record<string, unknown>) {
  const norm = normalizeBody(payload.body);
  if (!norm.ok) {
    return norm.error === 'empty'
      ? Response.json(
          { error: 'empty_body', message: 'Write a message before sending.' },
          { status: 400 }
        )
      : Response.json(
          { error: 'body_too_long', message: 'Messages are capped at 2,000 characters.' },
          { status: 400 }
        );
  }
  const body = norm.body;

  // NOTE: season lock (seasons.locked_at) deliberately does NOT block sending.
  // Messaging is not a roster change — locking the season freezes teams and
  // scores, not conversation. Do not "fix" this into a lock check.

  const teamId = typeof payload.team_id === 'string' ? payload.team_id : null;
  const toId = typeof payload.to_subscriber_id === 'string' ? payload.to_subscriber_id : null;
  const convoId = typeof payload.conversation_id === 'string' ? payload.conversation_id : null;

  // --- broadcast by team_id -------------------------------------------------
  if (teamId) {
    const season = await activeSeason(h);
    if (!season) return Response.json({ error: 'no_active_season' }, { status: 404 });
    // Captain is re-fetched on EVERY send — captaincy rolls when the captain
    // leaves, so a cached or client-supplied value would be a security bug.
    const team = await fetchTeam(h, teamId);
    if (!team || team.captain_id !== viewerId) {
      return Response.json({ error: 'not_captain' }, { status: 403 });
    }
    const convo = await findOrCreateBroadcast(h, teamId, season.id);
    if (!convo) return Response.json({ error: 'send_failed' }, { status: 500 });
    if ((await broadcastsInWindow(h, convo.id)) >= MAX_BROADCASTS_PER_TEAM_PER_DAY) {
      return Response.json({ error: 'rate_limited' }, { status: 429 });
    }
    return finishSend(h, convo.id, viewerId, body);
  }

  // --- direct by recipient --------------------------------------------------
  if (toId) {
    if (toId === viewerId) {
      return Response.json({ error: 'invalid_recipient' }, { status: 400 });
    }
    if (!/^[0-9a-fA-F-]{16,}$/.test(toId)) {
      return Response.json({ error: 'invalid_recipient' }, { status: 400 });
    }
    const rR = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_subscribers?id=eq.${encodeURIComponent(toId)}&select=id,active&limit=1`,
      { headers: h, cache: 'no-store' }
    );
    const rRows = rR.ok ? await rR.json().catch(() => []) : [];
    const recipient = Array.isArray(rRows) ? rRows[0] : null;
    if (!recipient || recipient.active === false) {
      return Response.json({ error: 'recipient_unavailable' }, { status: 403 });
    }
    const blocks = await loadBlocksFor(h, viewerId);
    if (isPairBlocked(blocks, viewerId, toId)) {
      // Never confirm to the sender that they were blocked.
      return Response.json(
        { error: 'not_deliverable', message: "This message can't be delivered." },
        { status: 403 }
      );
    }

    // Rate limits — the new-thread cap only applies when no thread exists yet.
    const { low, high } = orderPair(viewerId, toId);
    const exR = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_conversations?kind=eq.direct&pair_low=eq.${low}&pair_high=eq.${high}&select=id&limit=1`,
      { headers: h, cache: 'no-store' }
    );
    const exRows = exR.ok ? await exR.json().catch(() => []) : [];
    const existing = Array.isArray(exRows) ? exRows[0] : null;
    if (!existing && (await threadsOpenedInWindow(h, viewerId)) >= MAX_NEW_THREADS_PER_DAY) {
      return Response.json({ error: 'thread_limit' }, { status: 429 });
    }
    if ((await dmsInWindow(h, viewerId)) >= MAX_DMS_PER_DAY) {
      return Response.json({ error: 'rate_limited' }, { status: 429 });
    }

    const fR = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_dc_find_or_create_direct`, {
      method: 'POST',
      headers: { ...h, Prefer: 'return=representation' },
      body: JSON.stringify({ p_a: viewerId, p_b: toId }),
    });
    const newConvoId = fR.ok ? await fR.json().catch(() => null) : null;
    if (typeof newConvoId !== 'string') {
      return Response.json({ error: 'send_failed' }, { status: 500 });
    }
    return finishSend(h, newConvoId, viewerId, body);
  }

  // --- existing conversation by id -------------------------------------------
  if (convoId) {
    const convo = await fetchConversation(h, convoId);
    if (!convo) return Response.json({ error: 'not_permitted' }, { status: 403 });

    if (convo.kind === 'direct') {
      if (convo.pair_low !== viewerId && convo.pair_high !== viewerId) {
        return Response.json({ error: 'not_permitted' }, { status: 403 });
      }
      const otherId = convo.pair_low === viewerId ? convo.pair_high! : convo.pair_low!;
      const blocks = await loadBlocksFor(h, viewerId);
      if (isPairBlocked(blocks, viewerId, otherId)) {
        return Response.json(
          { error: 'not_deliverable', message: "This message can't be delivered." },
          { status: 403 }
        );
      }
      if ((await dmsInWindow(h, viewerId)) >= MAX_DMS_PER_DAY) {
        return Response.json({ error: 'rate_limited' }, { status: 429 });
      }
      return finishSend(h, convo.id, viewerId, body);
    }

    // team_broadcast — captain only, re-verified against teams.captain_id NOW.
    const team = convo.team_id ? await fetchTeam(h, convo.team_id) : null;
    if (!team || team.captain_id !== viewerId) {
      return Response.json({ error: 'not_captain' }, { status: 403 });
    }
    if ((await broadcastsInWindow(h, convo.id)) >= MAX_BROADCASTS_PER_TEAM_PER_DAY) {
      return Response.json({ error: 'rate_limited' }, { status: 429 });
    }
    return finishSend(h, convo.id, viewerId, body);
  }

  return Response.json({ error: 'bad_request' }, { status: 400 });
}

async function finishSend(h: Svc, conversationId: string, authorId: string, body: string) {
  const msg = await insertMessage(h, conversationId, authorId, body);
  if (!msg) return Response.json({ error: 'send_failed' }, { status: 500 });
  // The author has read their own send.
  await upsertMemberState(h, conversationId, authorId, {
    last_read_at: new Date().toISOString(),
  });
  return Response.json({
    ok: true,
    conversation_id: conversationId,
    message: { id: msg.id, created_at: msg.created_at },
  });
}

async function doMemberState(
  h: Svc,
  viewerId: string,
  payload: Record<string, unknown>,
  patch: { last_read_at?: string; muted_at?: string | null }
) {
  const convoId = typeof payload.conversation_id === 'string' ? payload.conversation_id : '';
  const auth = await authorizeConversation(h, convoId, viewerId);
  if (!auth.ok) return Response.json({ error: 'not_permitted' }, { status: 403 });
  const ok = await upsertMemberState(h, auth.conversation.id, viewerId, patch);
  if (!ok) return Response.json({ error: 'update_failed' }, { status: 500 });
  return Response.json({ ok: true });
}

async function doDelete(h: Svc, viewerId: string, payload: Record<string, unknown>) {
  const messageId = typeof payload.message_id === 'string' ? payload.message_id : '';
  if (!/^[0-9a-fA-F-]{16,}$/.test(messageId)) {
    return Response.json({ error: 'not_allowed' }, { status: 403 });
  }
  const mR = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_messages?id=eq.${encodeURIComponent(messageId)}&select=id,conversation_id,author_id,deleted_at&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  const mRows = mR.ok ? await mR.json().catch(() => []) : [];
  const msg = Array.isArray(mRows) ? mRows[0] : null;
  if (!msg) return Response.json({ error: 'not_allowed' }, { status: 403 });

  let allowed = msg.author_id === viewerId;
  if (!allowed) {
    // Captain may delete any message in their team's broadcast channel —
    // "captain" meaning the CURRENT captain, re-fetched now.
    const convo = await fetchConversation(h, msg.conversation_id);
    if (convo?.kind === 'team_broadcast' && convo.team_id) {
      const team = await fetchTeam(h, convo.team_id);
      allowed = !!team && team.captain_id === viewerId;
    }
  }
  if (!allowed) return Response.json({ error: 'not_allowed' }, { status: 403 });
  if (msg.deleted_at) return Response.json({ ok: true }); // idempotent

  // Soft delete only — the row must survive for moderation and reports.
  const pR = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_messages?id=eq.${encodeURIComponent(messageId)}`,
    {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({
        deleted_at: new Date().toISOString(),
        deleted_by: viewerId,
      }),
    }
  );
  if (!pR.ok) return Response.json({ error: 'update_failed' }, { status: 500 });
  return Response.json({ ok: true });
}
