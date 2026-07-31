"use client";

// MessagesApp — the /messages inbox (CC-DC-MESSAGING-1.0).
//
// Two-pane on ≥900px (thread list ~320px left, reading pane right); on mobile
// the list and the open thread are separate full-width views with a back
// arrow. All authorization is server-side — this component only renders what
// /api/messages returns for the session token it's given.
//
// Message bodies are plain text rendered with pre-wrap + overflowWrap:anywhere.
// No HTML rendering of user content anywhere in this tree.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ThreadRow,
  type ThreadDetail,
  type DirectoryHit,
  relTime,
  fetchUnreadTotal,
} from "./client";
import ThreadPane, { type Target, MAX_CHARS } from "./ThreadPane";
import NewMessageSearch from "./NewMessageSearch";

const MARK_READ_DELAY_MS = 1500;

export default function MessagesApp({
  token,
  onUnreadChange,
}: {
  token: string;
  onUnreadChange?: (n: number) => void;
}) {
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [listErr, setListErr] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [detailErr, setDetailErr] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");

  const [newOpen, setNewOpen] = useState(false);

  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const refreshBadge = useCallback(async () => {
    if (!onUnreadChange) return;
    onUnreadChange(await fetchUnreadTotal(token));
  }, [token, onUnreadChange]);

  const loadThreads = useCallback(async () => {
    setListErr(false);
    try {
      const r = await fetch(`/api/messages?token=${encodeURIComponent(token)}&scope=threads`);
      if (!r.ok) throw new Error();
      const j = await r.json();
      setThreads(Array.isArray(j.threads) ? j.threads : []);
    } catch {
      setListErr(true);
      setThreads(t => t ?? []);
    }
  }, [token]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  const loadDetail = useCallback(
    async (conversationId: string) => {
      setLoadingDetail(true);
      setDetailErr("");
      try {
        const r = await fetch(
          `/api/messages?token=${encodeURIComponent(token)}&scope=thread&conversation_id=${encodeURIComponent(conversationId)}`
        );
        if (!r.ok) throw new Error();
        setDetail(await r.json());
      } catch {
        setDetail(null);
        setDetailErr("Couldn't load this conversation.");
      } finally {
        setLoadingDetail(false);
      }
    },
    [token]
  );

  // Open a thread → fetch it, and mark it read after it has been visible ~1.5s.
  useEffect(() => {
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    setDetail(null);
    setSendErr("");
    if (!target) return;
    if (target.kind === "draft") return; // nothing to fetch yet
    const id = target.conversationId;
    loadDetail(id);
    markReadTimer.current = setTimeout(async () => {
      try {
        await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, action: "mark-read", conversation_id: id }),
        });
        setThreads(ts => ts?.map(t => (t.conversation_id === id ? { ...t, unread: 0 } : t)) ?? ts);
        refreshBadge();
      } catch { /* badge refresh is best-effort */ }
    }, MARK_READ_DELAY_MS);
    return () => { if (markReadTimer.current) clearTimeout(markReadTimer.current); };
  }, [target, token, loadDetail, refreshBadge]);

  // Keep the reading pane pinned to the newest message.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [detail?.messages.length]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    if (body.length > MAX_CHARS) {
      setSendErr(`Messages are capped at ${MAX_CHARS.toLocaleString()} characters.`);
      return;
    }
    setSending(true);
    setSendErr("");
    const payload: Record<string, unknown> = { token, action: "send", body };
    if (target?.kind === "draft") payload.to_subscriber_id = target.recipient.subscriber_id;
    else if (target?.kind === "convo") payload.conversation_id = target.conversationId;
    else { setSending(false); return; }
    try {
      const r = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSendErr(
          (j as { message?: string }).message ||
            (j.error === "rate_limited" || j.error === "thread_limit"
              ? "You've hit today's message limit — try again tomorrow."
              : "Couldn't send. Try again.")
        );
        return;
      }
      setDraft("");
      const convoId = (j as { conversation_id?: string }).conversation_id;
      if (convoId) {
        if (target.kind === "draft") setTarget({ kind: "convo", conversationId: convoId });
        else await loadDetail(convoId);
      }
      loadThreads();
    } catch {
      setSendErr("Network error — try again.");
    } finally {
      setSending(false);
    }
  }

  async function post(action: string, extra: Record<string, unknown>): Promise<boolean> {
    try {
      const r = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action, ...extra }),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  async function moderate(action: string, extra: Record<string, unknown>): Promise<boolean> {
    try {
      const r = await fetch("/api/messages/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action, ...extra }),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  async function toggleMute() {
    if (!detail) return;
    const next = !detail.viewer_state.muted;
    setDetail({ ...detail, viewer_state: { ...detail.viewer_state, muted: next } });
    const ok = await post(next ? "mute" : "unmute", { conversation_id: detail.conversation_id });
    if (!ok) setDetail(d => (d ? { ...d, viewer_state: { ...d.viewer_state, muted: !next } } : d));
    setThreads(ts =>
      ts?.map(t => (t.conversation_id === detail.conversation_id ? { ...t, muted: next } : t)) ?? ts
    );
    refreshBadge();
  }

  async function blockCounterpart() {
    if (!detail?.counterpart) return;
    const ok = await moderate("block", { subscriber_id: detail.counterpart.subscriber_id });
    if (ok) {
      // The thread vanishes from both inboxes — back to the list.
      setTarget(null);
      loadThreads();
      refreshBadge();
    }
  }

  async function deleteMessage(messageId: string) {
    if (!detail) return;
    const ok = await post("delete", { message_id: messageId });
    if (ok) {
      setDetail(d => (d ? { ...d, messages: d.messages.filter(m => m.id !== messageId) } : d));
      loadThreads();
    }
  }

  async function reportMessage(messageId: string): Promise<boolean> {
    return moderate("report", { message_id: messageId });
  }

  function openThread(t: ThreadRow) {
    setNewOpen(false);
    setTarget({ kind: "convo", conversationId: t.conversation_id });
  }

  function openDraft(hit: DirectoryHit) {
    setNewOpen(false);
    // If a thread with this player already exists, open it instead of a draft.
    const existing = threads?.find(t => t.kind === "direct" && t.counterpart_handle === hit.handle);
    if (existing) setTarget({ kind: "convo", conversationId: existing.conversation_id });
    else setTarget({ kind: "draft", recipient: hit });
  }

  const threadOpen = target !== null;

  return (
    <div className="mx-auto max-w-5xl px-0 sm:px-5">
      <div className="grid min-[900px]:grid-cols-[320px_1fr] min-[900px]:gap-0 min-[900px]:rounded-lg min-[900px]:border min-[900px]:border-forest/10 min-[900px]:bg-white min-[900px]:shadow-sm">
        {/* ── Thread list ──────────────────────────────────────────────── */}
        <div
          className={`${threadOpen ? "hidden min-[900px]:block" : "block"} min-[900px]:border-r min-[900px]:border-forest/10`}
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <h2 className="font-serif text-lg font-bold text-forest">Conversations</h2>
            <button
              type="button"
              onClick={() => setNewOpen(o => !o)}
              className="rounded bg-gold/15 border border-gold/50 px-3 py-1.5 font-mono text-[11px] text-forest hover:bg-gold/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              {newOpen ? "Close" : "New Message"}
            </button>
          </div>

          {newOpen && (
            <NewMessageSearch token={token} onPick={openDraft} />
          )}

          {threads === null && (
            <div className="space-y-2 px-4 py-2" aria-hidden>
              <div className="h-14 animate-pulse rounded bg-warm-gray/30" />
              <div className="h-14 animate-pulse rounded bg-warm-gray/30" />
              <div className="h-14 animate-pulse rounded bg-warm-gray/30" />
            </div>
          )}

          {threads !== null && listErr && (
            <p className="px-4 py-3 text-sm text-brick" role="status">
              Couldn&apos;t load your inbox.{" "}
              <button type="button" onClick={loadThreads} className="underline underline-offset-2">Retry</button>
            </p>
          )}

          {threads !== null && !listErr && threads.length === 0 && (
            <p className="px-4 py-6 text-sm text-near-black/55">
              No conversations yet. Start one with New Message, or check back after your captain posts.
            </p>
          )}

          <div role="list" aria-label="Conversations">
            {threads?.map(t => {
              const active =
                target?.kind === "convo" && target.conversationId === t.conversation_id;
              return (
                <button
                  key={t.conversation_id}
                  type="button"
                  role="listitem"
                  onClick={() => openThread(t)}
                  className={`block w-full px-4 py-3 text-left transition-colors hover:bg-warm-cream/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold ${
                    active ? "bg-gold/10" : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-forest">
                      {t.title}
                    </span>
                    {t.muted && (
                      <span title="Muted" aria-label="Muted" className="shrink-0 text-near-black/35">
                        <MutedGlyph />
                      </span>
                    )}
                    {t.unread > 0 && (
                      <span className="flex shrink-0 items-center gap-1" aria-label={`${t.unread} unread`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
                        <span className="font-mono text-[10px] font-bold text-gold-dark" style={{ color: "#8a6a1e" }}>
                          {t.unread}
                        </span>
                      </span>
                    )}
                    <span className="shrink-0 font-mono text-[10px] text-near-black/40">
                      {relTime(t.last_message_at)}
                    </span>
                  </span>
                  {t.preview && (
                    <span className="mt-0.5 block truncate text-xs text-near-black/55">{t.preview}</span>
                  )}
                  {t.kind === "team_broadcast" && (
                    <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-widest text-near-black/35">
                      Team channel
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Reading pane ─────────────────────────────────────────────── */}
        <div className={`${threadOpen ? "block" : "hidden min-[900px]:block"} min-h-[420px]`}>
          {!target && (
            <div className="hidden h-full items-center justify-center px-6 py-16 text-center min-[900px]:flex">
              <p className="text-sm text-near-black/45">Select a conversation, or start a new one.</p>
            </div>
          )}

          {target && (
            <ThreadPane
              target={target}
              detail={detail}
              loading={loadingDetail}
              error={detailErr}
              draft={draft}
              setDraft={setDraft}
              sending={sending}
              sendErr={sendErr}
              onSend={send}
              onBack={() => setTarget(null)}
              onToggleMute={toggleMute}
              onBlock={blockCounterpart}
              onDelete={deleteMessage}
              onReport={reportMessage}
              listRef={listRef}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MutedGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18.63 13A17.9 17.9 0 0 1 18 8a6 6 0 0 0-9.33-5" />
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
