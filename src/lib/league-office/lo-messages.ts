// League Office — commissioner messaging (CC-LO-MESSAGING-1.0).
//
// The League Office side of the existing DC messaging system (CC-DC-MESSAGING-1.0).
// Players already message "The Commissioner" from the message dock; that dock
// resolves the STAFF allowlist email → a dc_subscribers row and DMs it. This
// module is the OTHER end of that thread: it lets staff read and reply to those
// DMs, and start new ones, from inside the console.
//
// KEY DESIGN CALL: there is NO new identity. The commissioner IS a subscriber
// (the STAFF allowlist email → dc_subscribers), so every operation here acts as
// that subscriber id and reuses src/lib/messaging/server.ts wholesale — the same
// authorization, the same block rules, the same tables. That keeps the two ends
// of every thread perfectly consistent (a player's "Commissioner" thread and the
// LO inbox are literally the same dc_conversations row).
//
// Differences from the player /api/messages path, all deliberate:
//  - Identity is resolved from staff auth (requireStaff) + the STAFF allowlist,
//    NOT a dc_session token. Works whether a real staff cookie or the auth
//    kill-switch granted access.
//  - Player rate limits (10 DMs/day, 10 new threads/day) are NOT applied — this
//    is an operator support tool, not a spam vector. Block rules ARE still
//    honored (a player who blocked the commissioner is unreachable here; the
//    commissioner can still reach everyone via Announcements, which bypass blocks).
//  - Only DIRECT threads are surfaced — this is a 1:1 subscriber support inbox,
//    not the team-broadcast channel (that is the captain's tool).

import { STAFF } from "./constants";
import {
  SUPABASE_URL,
  loadBlocksFor,
  authorizeConversation,
  fetchConversation,
  visibleThreads,
  loadMemberStates,
  displayHandle,
} from "@/lib/messaging/server";
import { normalizeBody, countUnread, isPairBlocked } from "@/lib/messaging/rules";

type H = Record<string, string>;

const PREVIEW_CHARS = 120;
const THREAD_PAGE = 100;

const COMMISH_EMAIL =
  Object.keys(STAFF).find((e) => STAFF[e] === "commissioner") ?? null;

export interface Commissioner {
  id: string;
  handle: string;
}

/** The commissioner subscriber, resolved from the STAFF allowlist email (citext)
 *  — never a hardcoded uuid, exactly like the player dock's `scope=commissioner`.
 *  Returns null if no allowlist commissioner is configured or the email has no
 *  (active) subscriber row yet. */
export async function resolveCommissioner(h: H): Promise<Commissioner | null> {
  if (!COMMISH_EMAIL) return null;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_subscribers?email=eq.${encodeURIComponent(COMMISH_EMAIL)}&select=id,handle,email,active&limit=1`,
    { headers: h, cache: "no-store" }
  );
  const rows = r.ok ? await r.json().catch(() => []) : [];
  const sub = Array.isArray(rows) ? rows[0] : null;
  if (!sub || sub.active === false) return null;
  return { id: sub.id, handle: displayHandle(sub) };
}

interface MessageRow {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
}

async function loadMessagesFor(h: H, conversationIds: string[]): Promise<MessageRow[]> {
  if (conversationIds.length === 0) return [];
  const inList = conversationIds.map(encodeURIComponent).join(",");
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_messages?conversation_id=in.(${inList})&deleted_at=is.null&select=id,conversation_id,author_id,body,created_at,deleted_at&order=created_at.desc&limit=1000`,
    { headers: h, cache: "no-store" }
  );
  if (!r.ok) return [];
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

export interface ThreadRow {
  conversation_id: string;
  counterpart_id: string;
  counterpart_handle: string;
  last_message_at: string | null;
  preview: string | null;
  unread: number;
}

/** The commissioner's DIRECT threads, newest-active first. Reuses the exact
 *  authorization source (visibleThreads → pair membership minus blocks). */
export async function listThreads(h: H, commishId: string): Promise<ThreadRow[]> {
  const blocks = await loadBlocksFor(h, commishId);
  const { directs } = await visibleThreads(h, commishId, blocks, { createMissing: false });

  const convoIds = directs.map((c) => c.id);
  const [states, messages] = await Promise.all([
    loadMemberStates(h, commishId, convoIds),
    loadMessagesFor(h, convoIds),
  ]);
  const byConvo = new Map<string, MessageRow[]>();
  for (const m of messages) {
    const list = byConvo.get(m.conversation_id);
    if (list) list.push(m);
    else byConvo.set(m.conversation_id, [m]);
  }

  const counterpartIds = directs
    .map((c) => (c.pair_low === commishId ? c.pair_high : c.pair_low))
    .filter((id): id is string => !!id);
  const handleById = await handlesFor(h, counterpartIds);

  const rows: ThreadRow[] = directs.map((c) => {
    const other = c.pair_low === commishId ? c.pair_high! : c.pair_low!;
    const msgs = byConvo.get(c.id) ?? []; // newest first
    const state = states.get(c.id);
    return {
      conversation_id: c.id,
      counterpart_id: other,
      counterpart_handle: handleById.get(other) ?? "anonymous",
      last_message_at: c.last_message_at,
      preview: msgs[0] ? msgs[0].body.slice(0, PREVIEW_CHARS) : null,
      unread: countUnread(msgs, state?.last_read_at ?? null, commishId),
    };
  });

  return rows.sort((a, b) => {
    if (a.last_message_at === b.last_message_at) return 0;
    if (a.last_message_at === null) return 1;
    if (b.last_message_at === null) return -1;
    return a.last_message_at < b.last_message_at ? 1 : -1;
  });
}

async function handlesFor(h: H, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const inList = unique.map(encodeURIComponent).join(",");
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_subscribers?id=in.(${inList})&select=id,handle,email`,
    { headers: h, cache: "no-store" }
  );
  const rows = r.ok ? await r.json().catch(() => []) : [];
  for (const s of Array.isArray(rows) ? rows : []) map.set(s.id, displayHandle(s));
  return map;
}

export interface ThreadDetail {
  conversation_id: string;
  counterpart: { id: string; handle: string };
  messages: {
    id: string;
    author_id: string;
    author_handle: string;
    body: string;
    created_at: string;
    is_mine: boolean;
  }[];
}

/** One direct thread, authorized as the commissioner. Marks it read. Returns
 *  null on any denial (never leaks whether the conversation exists). */
export async function readThread(
  h: H,
  commishId: string,
  conversationId: string
): Promise<ThreadDetail | null> {
  const auth = await authorizeConversation(h, conversationId, commishId);
  if (!auth.ok || auth.conversation.kind !== "direct") return null;
  const convo = auth.conversation;
  const otherId = convo.pair_low === commishId ? convo.pair_high! : convo.pair_low!;

  const mR = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_messages?conversation_id=eq.${encodeURIComponent(convo.id)}&deleted_at=is.null&select=id,author_id,body,created_at,dc_subscribers!dc_messages_author_id_fkey(handle,email)&order=created_at.desc&limit=${THREAD_PAGE}`,
    { headers: h, cache: "no-store" }
  );
  const raw = mR.ok ? await mR.json().catch(() => []) : [];
  const page = (Array.isArray(raw) ? raw : []).reverse();

  const [handleById] = await Promise.all([handlesFor(h, [otherId])]);
  await markRead(h, commishId, convo.id);

  return {
    conversation_id: convo.id,
    counterpart: { id: otherId, handle: handleById.get(otherId) ?? "anonymous" },
    messages: page.map((m: { id: string; author_id: string; body: string; created_at: string; dc_subscribers?: { handle: string | null; email: string | null } }) => ({
      id: m.id,
      author_id: m.author_id,
      author_handle: displayHandle(m.dc_subscribers),
      body: m.body,
      created_at: m.created_at,
      is_mine: m.author_id === commishId,
    })),
  };
}

export type SendResult =
  | { ok: true; conversationId: string }
  | { ok: false; status: number; message: string };

/** Send as the commissioner — either into an existing conversation, or to a
 *  subscriber by id (find-or-create the direct thread). Honors block rules;
 *  skips the player rate limits (operator tool). */
export async function sendMessage(
  h: H,
  commishId: string,
  input: { conversationId?: string | null; toSubscriberId?: string | null; body: unknown }
): Promise<SendResult> {
  const norm = normalizeBody(input.body);
  if (!norm.ok) {
    return {
      ok: false,
      status: 400,
      message: norm.error === "empty" ? "Write a message before sending." : "Messages are capped at 2,000 characters.",
    };
  }
  const body = norm.body;

  // Resolve the target conversation.
  let conversationId = input.conversationId ?? null;
  let otherId: string | null = null;

  if (conversationId) {
    const convo = await fetchConversation(h, conversationId);
    if (!convo || convo.kind !== "direct") return { ok: false, status: 403, message: "That conversation isn't available." };
    if (convo.pair_low !== commishId && convo.pair_high !== commishId)
      return { ok: false, status: 403, message: "That conversation isn't available." };
    otherId = convo.pair_low === commishId ? convo.pair_high! : convo.pair_low!;
  } else if (input.toSubscriberId) {
    const toId = input.toSubscriberId;
    if (toId === commishId || !/^[0-9a-fA-F-]{16,}$/.test(toId))
      return { ok: false, status: 400, message: "Pick a valid subscriber." };
    const rR = await fetch(
      `${SUPABASE_URL}/rest/v1/dc_subscribers?id=eq.${encodeURIComponent(toId)}&select=id,active&limit=1`,
      { headers: h, cache: "no-store" }
    );
    const rRows = rR.ok ? await rR.json().catch(() => []) : [];
    const recipient = Array.isArray(rRows) ? rRows[0] : null;
    if (!recipient || recipient.active === false)
      return { ok: false, status: 403, message: "That subscriber can't be messaged." };
    otherId = toId;
  } else {
    return { ok: false, status: 400, message: "No recipient." };
  }

  // Block rules apply in both directions — a player who blocked the commissioner
  // is unreachable here (Announcements bypass blocks; this does not).
  const blocks = await loadBlocksFor(h, commishId);
  if (otherId && isPairBlocked(blocks, commishId, otherId))
    return { ok: false, status: 403, message: "This message can't be delivered." };

  // Find-or-create the direct thread if we only had a recipient.
  if (!conversationId && otherId) {
    const fR = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_dc_find_or_create_direct`, {
      method: "POST",
      headers: { ...h, Prefer: "return=representation" },
      body: JSON.stringify({ p_a: commishId, p_b: otherId }),
    });
    const newId = fR.ok ? await fR.json().catch(() => null) : null;
    if (typeof newId !== "string") return { ok: false, status: 500, message: "Could not open the thread." };
    conversationId = newId;
  }
  if (!conversationId) return { ok: false, status: 500, message: "Could not open the thread." };

  const iR = await fetch(`${SUPABASE_URL}/rest/v1/dc_messages`, {
    method: "POST",
    headers: { ...h, Prefer: "return=representation" },
    body: JSON.stringify({ conversation_id: conversationId, author_id: commishId, body }),
  });
  if (!iR.ok) return { ok: false, status: 500, message: "Send failed." };
  await markRead(h, commishId, conversationId);
  return { ok: true, conversationId };
}

/** Upsert the commissioner's read state for a conversation (state only — never
 *  the authorization source). */
export async function markRead(h: H, commishId: string, conversationId: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/dc_conversation_members`, {
    method: "POST",
    headers: { ...h, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      conversation_id: conversationId,
      subscriber_id: commishId,
      last_read_at: new Date().toISOString(),
    }),
  });
}

export interface DirectoryRow {
  id: string;
  handle: string;
}

/** Subscribers the commissioner can start a DM with — handle/email prefix search,
 *  active only, the commissioner themselves excluded. Handle-only output. */
export async function searchSubscribers(
  h: H,
  commishId: string,
  needle: string
): Promise<DirectoryRow[]> {
  const term = needle.trim();
  const filter = term
    ? `&or=(handle.ilike.*${encodeURIComponent(term)}*,email.ilike.*${encodeURIComponent(term)}*)`
    : "";
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_subscribers?select=id,handle,email&active=is.true${filter}&order=handle.asc&limit=25`,
    { headers: h, cache: "no-store" }
  );
  const rows = r.ok ? await r.json().catch(() => []) : [];
  return (Array.isArray(rows) ? rows : [])
    .filter((s: { id: string }) => s.id !== commishId)
    .map((s: { id: string; handle: string | null; email: string | null }) => ({
      id: s.id,
      handle: displayHandle(s),
    }));
}
