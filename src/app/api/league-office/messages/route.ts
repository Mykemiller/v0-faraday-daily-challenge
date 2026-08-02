// League Office — commissioner messaging endpoint (CC-LO-MESSAGING-1.0).
//
// GET  ?scope=threads                        → the commissioner's DM inbox
// GET  ?scope=thread&conversation_id=…       → one thread (marks it read)
// GET  ?scope=directory&q=…                  → subscribers to start a DM with
// POST { action:"send", conversation_id|to_subscriber_id, body }
// POST { action:"mark-read", conversation_id }
//
// Staff is re-verified on EVERY request (requireStaff — the real fence, same as
// every other /api/league-office route). The operator then acts AS the resolved
// commissioner subscriber; all authorization/block rules are enforced inside
// lo-messages.ts against that subscriber id.

import { requireStaff } from "@/lib/league-office/service";
import {
  resolveCommissioner,
  listThreads,
  readThread,
  sendMessage,
  markRead,
  searchSubscribers,
} from "@/lib/league-office/lo-messages";

export const dynamic = "force-dynamic";

function unauthorized(reason: string) {
  const code = reason === "not-staff" ? 403 : reason === "unconfigured" ? 500 : 401;
  return Response.json({ error: `not_authorized_${reason}` }, { status: code });
}

export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff.ok) return unauthorized(staff.reason);
  const h = staff.s.headers;

  const commish = await resolveCommissioner(h);
  if (!commish) return Response.json({ error: "no_commissioner" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") ?? "threads";

  if (scope === "threads") {
    const threads = await listThreads(h, commish.id);
    return Response.json({ commissioner: commish, threads });
  }
  if (scope === "thread") {
    const conversationId = searchParams.get("conversation_id") ?? "";
    const thread = await readThread(h, commish.id, conversationId);
    if (!thread) return Response.json({ error: "not_permitted" }, { status: 403 });
    return Response.json({ commissioner: commish, thread });
  }
  if (scope === "directory") {
    const rows = await searchSubscribers(h, commish.id, searchParams.get("q") ?? "");
    return Response.json({ subscribers: rows });
  }
  return Response.json({ error: "unknown_scope" }, { status: 400 });
}

export async function POST(request: Request) {
  const staff = await requireStaff();
  if (!staff.ok) return unauthorized(staff.reason);
  const h = staff.s.headers;

  const commish = await resolveCommissioner(h);
  if (!commish) return Response.json({ error: "no_commissioner" }, { status: 404 });

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const { action } = payload as { action?: string };

  if (action === "send") {
    const p = payload as { conversation_id?: string; to_subscriber_id?: string; body?: unknown };
    const res = await sendMessage(h, commish.id, {
      conversationId: p.conversation_id ?? null,
      toSubscriberId: p.to_subscriber_id ?? null,
      body: p.body,
    });
    if (!res.ok) return Response.json({ error: "send_failed", message: res.message }, { status: res.status });
    return Response.json({ ok: true, conversation_id: res.conversationId });
  }

  if (action === "mark-read") {
    const p = payload as { conversation_id?: string };
    if (typeof p.conversation_id !== "string") return Response.json({ error: "bad_request" }, { status: 400 });
    await markRead(h, commish.id, p.conversation_id);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "unknown_action" }, { status: 400 });
}
