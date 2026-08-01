// DC messaging moderation — block / unblock / report (CC-DC-MESSAGING-1.0).
//
// Block semantics (stated once, implemented consistently everywhere):
//   - Stored ONE-directionally (blocker_id → blocked_id), enforced
//     BIDIRECTIONALLY — a block either way silences the pair in both
//     directions (threads vanish from both inboxes, are unreachable by id,
//     and sends fail with a non-revealing error).
//   - Blocks do NOT suppress team broadcasts. Blocking a teammate — even the
//     captain — must never cut a player off from team announcements.
//     visibleThreads/authorizeConversation only apply blocks to direct threads.
//
// Reports snapshot the message body at report time so the evidence survives
// the author soft-deleting the message. The reporter is told { ok: true } and
// nothing else — moderation state is never revealed to players.

import {
  SUPABASE_URL,
  type Svc,
  svcHeaders,
  resolveSubscriber,
  authorizeConversation,
} from '@/lib/messaging/server';

export const dynamic = 'force-dynamic';

const UUID_SHAPE = /^[0-9a-fA-F-]{16,}$/;

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
    case 'block':
      return doBlock(h, viewer.id, payload);
    case 'unblock':
      return doUnblock(h, viewer.id, payload);
    case 'report':
      return doReport(h, viewer.id, payload);
    default:
      return Response.json({ error: 'unknown_action' }, { status: 400 });
  }
}

async function doBlock(h: Svc, viewerId: string, payload: Record<string, unknown>) {
  const targetId = typeof payload.subscriber_id === 'string' ? payload.subscriber_id : '';
  if (!UUID_SHAPE.test(targetId) || targetId === viewerId) {
    return Response.json({ error: 'invalid_target' }, { status: 400 });
  }
  // Idempotent upsert on the (blocker, blocked) PK.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/dc_message_blocks`, {
    method: 'POST',
    headers: { ...h, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ blocker_id: viewerId, blocked_id: targetId }),
  });
  if (!r.ok) return Response.json({ error: 'invalid_target' }, { status: 400 });
  return Response.json({ ok: true });
}

async function doUnblock(h: Svc, viewerId: string, payload: Record<string, unknown>) {
  const targetId = typeof payload.subscriber_id === 'string' ? payload.subscriber_id : '';
  if (!UUID_SHAPE.test(targetId)) {
    return Response.json({ error: 'invalid_target' }, { status: 400 });
  }
  // Idempotent — deleting an absent row is still ok.
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_message_blocks?blocker_id=eq.${encodeURIComponent(viewerId)}&blocked_id=eq.${encodeURIComponent(targetId)}`,
    { method: 'DELETE', headers: h }
  );
  if (!r.ok) return Response.json({ error: 'update_failed' }, { status: 500 });
  return Response.json({ ok: true });
}

async function doReport(h: Svc, viewerId: string, payload: Record<string, unknown>) {
  const messageId = typeof payload.message_id === 'string' ? payload.message_id : '';
  const reason =
    typeof payload.reason === 'string' && payload.reason.trim()
      ? payload.reason.trim().slice(0, 500)
      : null;
  if (!UUID_SHAPE.test(messageId)) {
    return Response.json({ error: 'not_permitted' }, { status: 403 });
  }

  // The reporter must be able to SEE the message: it exists, is not deleted,
  // and its conversation authorizes them. Denials collapse to 403.
  const mR = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_messages?id=eq.${encodeURIComponent(messageId)}&deleted_at=is.null&select=id,conversation_id,author_id,body&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  const mRows = mR.ok ? await mR.json().catch(() => []) : [];
  const msg = Array.isArray(mRows) ? mRows[0] : null;
  if (!msg) return Response.json({ error: 'not_permitted' }, { status: 403 });

  const auth = await authorizeConversation(h, msg.conversation_id, viewerId);
  if (!auth.ok) return Response.json({ error: 'not_permitted' }, { status: 403 });

  // Duplicate report by the same reporter for the same message → ok, no
  // second row (and no signal to the reporter that it was a duplicate).
  const dupR = await fetch(
    `${SUPABASE_URL}/rest/v1/dc_message_reports?message_id=eq.${encodeURIComponent(messageId)}&reporter_id=eq.${encodeURIComponent(viewerId)}&select=id&limit=1`,
    { headers: h, cache: 'no-store' }
  );
  const dupRows = dupR.ok ? await dupR.json().catch(() => []) : [];
  if (Array.isArray(dupRows) && dupRows[0]) return Response.json({ ok: true });

  // body_snapshot is copied AT REPORT TIME — the report must survive the
  // author soft-deleting the message afterwards.
  const iR = await fetch(`${SUPABASE_URL}/rest/v1/dc_message_reports`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      message_id: messageId,
      conversation_id: msg.conversation_id,
      reporter_id: viewerId,
      reported_author_id: msg.author_id,
      body_snapshot: msg.body,
      reason,
    }),
  });
  if (!iR.ok) return Response.json({ error: 'update_failed' }, { status: 500 });
  return Response.json({ ok: true });
}
