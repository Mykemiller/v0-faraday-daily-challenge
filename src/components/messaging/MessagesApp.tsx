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
  msgTime,
  isUnread,
  fetchUnreadTotal,
} from "./client";

const MAX_CHARS = 2000;
const WARN_CHARS = 1800;
const MARK_READ_DELAY_MS = 1500;
const SEARCH_DEBOUNCE_MS = 300;

type Target =
  | { kind: "convo"; conversationId: string }
  | { kind: "draft"; recipient: DirectoryHit };

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

// ── New Message: debounced handle search, keyboard navigable ───────────────
function NewMessageSearch({
  token,
  onPick,
}: {
  token: string;
  onPick: (hit: DirectoryHit) => void;
}) {
  const [q, setQ] = useState("");
  // Results are keyed to the query that produced them — stale results (from a
  // previous query, or after clearing the input) simply stop rendering instead
  // of being reset with setState inside the effect.
  const [result, setResult] = useState<{ q: string; hits: DirectoryHit[] } | null>(null);
  const [sel, setSel] = useState(0);

  const query = q.trim();
  const active = query.length >= 2;
  const searched = active && result?.q === query;
  const hits = searched ? result.hits : [];

  useEffect(() => {
    if (!active) return;
    const id = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/messages/directory?token=${encodeURIComponent(token)}&q=${encodeURIComponent(query)}`
        );
        const j = r.ok ? await r.json() : [];
        setResult({ q: query, hits: Array.isArray(j) ? j : [] });
        setSel(0);
      } catch {
        setResult({ q: query, hits: [] });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [active, query, token]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && hits[sel]) { e.preventDefault(); onPick(hits[sel]); }
  }

  return (
    <div className="border-y border-forest/10 bg-warm-cream/40 px-4 py-3">
      <label htmlFor="dc-msg-search" className="font-mono text-[10px] uppercase tracking-widest text-near-black/45">
        To: search players by handle
      </label>
      <input
        id="dc-msg-search"
        autoFocus
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={onKey}
        placeholder="@handle (min 2 characters)"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls="dc-msg-search-results"
        aria-activedescendant={hits[sel] ? `dc-msg-hit-${hits[sel].subscriber_id}` : undefined}
        className="mt-1.5 w-full rounded border border-forest/20 bg-white px-2.5 py-1.5 font-mono text-sm text-near-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
      />
      <div id="dc-msg-search-results" role="listbox" aria-label="Matching players">
        {hits.map((h, i) => (
          <button
            key={h.subscriber_id}
            id={`dc-msg-hit-${h.subscriber_id}`}
            type="button"
            role="option"
            aria-selected={i === sel}
            onMouseEnter={() => setSel(i)}
            onClick={() => onPick(h)}
            className={`mt-1 block w-full rounded px-2.5 py-1.5 text-left font-mono text-sm text-near-black hover:bg-gold/15 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold ${
              i === sel ? "bg-gold/15" : ""
            }`}
          >
            @{h.handle}
          </button>
        ))}
        {searched && hits.length === 0 && (
          <p className="mt-1.5 text-xs text-near-black/50">No players match that handle.</p>
        )}
      </div>
    </div>
  );
}

// ── Reading pane ───────────────────────────────────────────────────────────
function ThreadPane({
  target,
  detail,
  loading,
  error,
  draft,
  setDraft,
  sending,
  sendErr,
  onSend,
  onBack,
  onToggleMute,
  onBlock,
  onDelete,
  onReport,
  listRef,
}: {
  target: Target;
  detail: ThreadDetail | null;
  loading: boolean;
  error: string;
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  sendErr: string;
  onSend: () => void;
  onBack: () => void;
  onToggleMute: () => void;
  onBlock: () => void;
  onDelete: (id: string) => void;
  onReport: (id: string) => Promise<boolean>;
  listRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmBlock(false);
      }
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);

  const title =
    target.kind === "draft"
      ? `@${target.recipient.handle}`
      : detail?.kind === "team_broadcast"
        ? detail.team?.name ?? "Team"
        : detail?.counterpart
          ? `@${detail.counterpart.handle}`
          : "…";

  const isBroadcast = detail?.kind === "team_broadcast";
  const canCompose =
    target.kind === "draft" || (detail != null && (!isBroadcast || detail.is_captain === true));

  const over = draft.length > MAX_CHARS;
  const counterColor =
    over ? "#9c3b2e" : draft.length > WARN_CHARS ? "#8a6a1e" : "rgba(20,18,16,0.4)";

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-forest/10 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="rounded px-1 text-forest hover:text-forest/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold min-[900px]:hidden"
        >
          ←
        </button>
        <h2 className="min-w-0 flex-1 truncate font-serif text-lg font-bold text-forest">{title}</h2>
        {isBroadcast && detail?.is_captain && detail.remaining_today != null && (
          <span className="font-mono text-[10px] text-near-black/45" title="Broadcasts remaining today">
            {detail.remaining_today} left today
          </span>
        )}

        {detail && (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Conversation options"
              onClick={() => { setMenuOpen(o => !o); setConfirmBlock(false); }}
              className="rounded px-2 py-1 font-mono text-sm text-near-black/55 hover:text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                role="menu"
                aria-label="Conversation options"
                className="absolute right-0 top-full z-10 mt-1 w-52 rounded-lg border border-forest/15 bg-white p-1.5 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { onToggleMute(); setMenuOpen(false); }}
                  className="block w-full rounded px-2.5 py-2 text-left font-mono text-[12px] text-near-black hover:bg-warm-cream focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold"
                >
                  {detail.viewer_state.muted ? "Unmute" : "Mute"} conversation
                </button>
                {detail.kind === "direct" && detail.counterpart && (
                  !confirmBlock ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setConfirmBlock(true)}
                      className="block w-full rounded px-2.5 py-2 text-left font-mono text-[12px] text-brick hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold"
                    >
                      Block @{detail.counterpart.handle}
                    </button>
                  ) : (
                    <div className="px-2.5 py-2">
                      <p className="text-[11px] text-near-black/60">
                        They won&apos;t be told. You&apos;ll stop seeing each other&apos;s messages.
                      </p>
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => { onBlock(); setMenuOpen(false); setConfirmBlock(false); }}
                          className="rounded border border-red-300 bg-red-50 px-2.5 py-1 font-mono text-[11px] text-red-700 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
                        >
                          Confirm block?
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmBlock(false)}
                          className="rounded border border-forest/20 px-2.5 py-1 font-mono text-[11px] text-near-black/60 hover:border-forest/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        aria-live="polite"
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        style={{ maxHeight: "56vh" }}
      >
        {target.kind === "draft" && (
          <p className="text-sm text-near-black/50">
            New conversation with @{target.recipient.handle} — say hello.
          </p>
        )}
        {loading && (
          <div className="space-y-2" aria-hidden>
            <div className="h-10 w-3/4 animate-pulse rounded bg-warm-gray/30" />
            <div className="ml-auto h-10 w-2/3 animate-pulse rounded bg-gold/10" />
          </div>
        )}
        {error && <p className="text-sm text-brick" role="status">{error}</p>}
        {detail?.messages.length === 0 && !loading && (
          <p className="text-sm text-near-black/50">
            {isBroadcast
              ? detail.is_captain
                ? "No messages yet. Send the first one to your team."
                : "Your captain hasn't posted anything yet."
              : "No messages yet."}
          </p>
        )}
        {detail?.messages.map(m => (
          <MessageRow
            key={m.id}
            m={m}
            unread={isUnread(m, detail.viewer_state.last_read_at)}
            onDelete={onDelete}
            onReport={onReport}
          />
        ))}
      </div>

      {/* Composer */}
      {canCompose ? (
        <div className="border-t border-forest/10 px-4 py-3">
          <label htmlFor="dc-msg-composer" className="sr-only">Message</label>
          <textarea
            id="dc-msg-composer"
            value={draft}
            rows={2}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
            }}
            placeholder={isBroadcast ? "Message your team…" : "Message…"}
            className="w-full resize-y rounded border border-forest/20 bg-warm-panel px-2.5 py-2 text-sm text-near-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px]" style={{ color: counterColor }} aria-live="polite">
              {draft.length.toLocaleString()}/{MAX_CHARS.toLocaleString()}
            </span>
            <div className="flex items-center gap-3">
              {sendErr && <span className="text-xs text-brick" role="status">{sendErr}</span>}
              <button
                type="button"
                onClick={onSend}
                disabled={sending || !draft.trim() || over}
                className="rounded bg-gold px-4 py-1.5 font-mono text-[12px] font-semibold text-forest hover:bg-gold/85 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        detail && isBroadcast && (
          <p className="border-t border-forest/10 px-4 py-3 text-xs text-near-black/45">
            Only the team captain can post here.
          </p>
        )
      )}
    </div>
  );
}

// ── One message bubble ─────────────────────────────────────────────────────
function MessageRow({
  m,
  unread,
  onDelete,
  onReport,
}: {
  m: ThreadDetail["messages"][number];
  unread: boolean;
  onDelete: (id: string) => void;
  onReport: (id: string) => Promise<boolean>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reported, setReported] = useState(false);

  return (
    <div className={m.is_mine ? "flex justify-end" : "flex justify-start"}>
      <div className={`max-w-[85%] min-[900px]:max-w-[70%] ${unread ? "border-l-2 border-gold pl-2" : ""}`}>
        <p className="mb-0.5 font-mono text-[10px] text-near-black/45">
          @{m.author_handle} · {msgTime(m.created_at)}
          {unread && (
            <span className="ml-1.5 rounded bg-gold/20 px-1 py-px font-mono text-[8px] font-bold uppercase tracking-widest text-forest">
              new
            </span>
          )}
        </p>
        <div
          className={`rounded-lg px-3 py-2 text-sm text-near-black ${
            m.is_mine ? "bg-gold/10 ring-1 ring-gold/25" : "bg-warm-cream/70"
          }`}
          style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        >
          {m.body}
        </div>
        <div className="mt-0.5 flex gap-2">
          {m.can_delete &&
            (!confirmDelete ? (
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
            ))}
          {!m.is_mine &&
            (reported ? (
              <span className="font-mono text-[10px] text-forest" role="status">Reported ✓</span>
            ) : (
              <button
                type="button"
                onClick={async () => { if (await onReport(m.id)) setReported(true); }}
                className="rounded font-mono text-[10px] text-near-black/35 hover:text-brick focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
              >
                Report
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
