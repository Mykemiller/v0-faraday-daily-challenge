"use client";

// TeamBroadcastPanel — "Team Messages" section on the team page
// (CC-DC-MESSAGING-1.0). Captain composes broadcasts; every member reads them.
// Renders nothing for non-members. All authorization is server-side — the
// captain check here only decides whether to SHOW the composer; the API
// re-verifies teams.captain_id on every send.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ThreadDetail,
  type ThreadMessage,
  msgTime,
  isUnread,
} from "./client";

const MAX_CHARS = 2000;
const WARN_CHARS = 1800;
const MARK_READ_DELAY_MS = 1500;

export default function TeamBroadcastPanel({
  teamId,
  token,
  isCaptain,
  isMember,
}: {
  teamId: string;
  token: string | null;
  isCaptain: boolean;
  isMember: boolean;
}) {
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const markReadFired = useRef(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(
        `/api/messages?token=${encodeURIComponent(token)}&scope=thread&team_id=${encodeURIComponent(teamId)}`
      );
      if (!r.ok) throw new Error();
      setDetail(await r.json());
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [token, teamId]);

  useEffect(() => {
    if (isMember && token) load();
  }, [isMember, token, load]);

  // Mark the channel read once, ~1.5s after it renders with content.
  useEffect(() => {
    if (!detail || !token || markReadFired.current) return;
    const id = setTimeout(() => {
      markReadFired.current = true;
      fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "mark-read", conversation_id: detail.conversation_id }),
      }).catch(() => { /* best-effort */ });
    }, MARK_READ_DELAY_MS);
    return () => clearTimeout(id);
  }, [detail, token]);

  // Non-members (and signed-out viewers) see nothing at all.
  if (!isMember || !token) return null;

  async function send() {
    const body = draft.trim();
    if (!body || sending || !token) return;
    if (body.length > MAX_CHARS) {
      setSendErr(`Messages are capped at ${MAX_CHARS.toLocaleString()} characters.`);
      return;
    }
    setSending(true);
    setSendErr("");
    try {
      const r = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "send", team_id: teamId, body }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSendErr(
          (j as { message?: string }).message ||
            (j.error === "rate_limited"
              ? "You've hit today's broadcast limit — try again tomorrow."
              : j.error === "not_captain"
                ? "Only the team captain can post."
                : "Couldn't send. Try again.")
        );
        return;
      }
      setDraft("");
      await load();
    } catch {
      setSendErr("Network error — try again.");
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage(messageId: string) {
    if (!token) return;
    try {
      const r = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "delete", message_id: messageId }),
      });
      if (r.ok) {
        setDetail(d => (d ? { ...d, messages: d.messages.filter(m => m.id !== messageId) } : d));
      }
    } catch { /* leave the row; user can retry */ }
  }

  const over = draft.length > MAX_CHARS;
  const counterColor =
    over ? "#9c3b2e" : draft.length > WARN_CHARS ? "#8a6a1e" : "rgba(20,18,16,0.4)";

  // Newest first — a notice board, not a chat log.
  const newestFirst: ThreadMessage[] = detail ? [...detail.messages].reverse() : [];

  return (
    <section className="mt-9 border-t border-forest/10 pt-6">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-near-black/40">
        Team Messages
      </p>

      {isCaptain && (
        <div className="mb-4 rounded-lg border border-forest/10 bg-white px-4 py-4">
          <label htmlFor="dc-broadcast-composer" className="text-sm font-semibold text-forest">
            Message your team
          </label>
          <textarea
            id="dc-broadcast-composer"
            value={draft}
            rows={2}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Announcement for the whole team…"
            className="mt-2 w-full resize-y rounded border border-forest/20 bg-warm-panel px-2.5 py-2 text-sm text-near-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
          />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px]" style={{ color: counterColor }} aria-live="polite">
              {draft.length.toLocaleString()}/{MAX_CHARS.toLocaleString()}
              {detail?.remaining_today != null && (
                <span className="ml-2 text-near-black/40">· {detail.remaining_today} broadcast{detail.remaining_today === 1 ? "" : "s"} left today</span>
              )}
            </span>
            <div className="flex items-center gap-3">
              {sendErr && <span className="text-xs text-brick" role="status">{sendErr}</span>}
              <button
                type="button"
                onClick={send}
                disabled={sending || !draft.trim() || over}
                className="rounded bg-gold px-4 py-1.5 font-mono text-[12px] font-semibold text-forest hover:bg-gold/85 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                {sending ? "Sending…" : "Send to team"}
              </button>
            </div>
          </div>
        </div>
      )}

      {status === "loading" && (
        <div className="space-y-2" aria-hidden>
          <div className="h-14 animate-pulse rounded bg-warm-gray/30" />
          <div className="h-14 animate-pulse rounded bg-warm-gray/30" />
        </div>
      )}

      {status === "error" && (
        <p className="text-sm text-brick" role="status">
          Couldn&apos;t load team messages.{" "}
          <button type="button" onClick={load} className="underline underline-offset-2">Retry</button>
        </p>
      )}

      {status === "ready" && newestFirst.length === 0 && (
        <p className="text-sm text-near-black/55">
          {isCaptain
            ? "No messages yet. Send the first one to your team."
            : "Your captain hasn't posted anything yet."}
        </p>
      )}

      {status === "ready" && newestFirst.length > 0 && detail && (
        <div className="space-y-2" aria-live="polite">
          {newestFirst.map(m => {
            const unread = isUnread(m, detail.viewer_state.last_read_at);
            return (
              <BroadcastRow key={m.id} m={m} unread={unread} onDelete={deleteMessage} />
            );
          })}
        </div>
      )}
    </section>
  );
}

function BroadcastRow({
  m,
  unread,
  onDelete,
}: {
  m: ThreadMessage;
  unread: boolean;
  onDelete: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className={`rounded-lg border border-forest/10 bg-white px-4 py-3 ${
        unread ? "border-l-4 border-l-gold" : ""
      }`}
    >
      <p className="mb-1 flex items-center gap-2 font-mono text-[10px] text-near-black/45">
        <span>@{m.author_handle} · {msgTime(m.created_at)}</span>
        {unread && (
          <span className="rounded bg-gold/20 px-1.5 py-px font-mono text-[8px] font-bold uppercase tracking-widest text-forest">
            new
          </span>
        )}
      </p>
      <div
        className="text-sm text-near-black"
        style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
      >
        {m.body}
      </div>
      {m.can_delete && (
        <div className="mt-1.5">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded font-mono text-[10px] text-near-black/35 hover:text-brick focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
            >
              Delete
            </button>
          ) : (
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { onDelete(m.id); setConfirmDelete(false); }}
                className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 font-mono text-[10px] text-red-700 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
              >
                Confirm delete?
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded font-mono text-[10px] text-near-black/45 hover:text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
              >
                Cancel
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
