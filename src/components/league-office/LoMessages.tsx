"use client";

// League Office — commissioner messaging inbox (CC-LO-MESSAGING-1.0).
//
// Two-pane 1:1 support inbox: the commissioner's DM threads on the left, the
// selected thread + reply composer on the right, and a "New message" flow that
// searches subscribers by handle. Every call hits /api/league-office/messages,
// which re-verifies staff and acts as the resolved commissioner subscriber.

import { useCallback, useEffect, useRef, useState } from "react";

const GOLD = "#c4922a";
const INK = "#141210";
const MUTED = "#6b6257";
const FAINT = "#8d8375";

interface ThreadRow {
  conversation_id: string;
  counterpart_id: string;
  counterpart_handle: string;
  last_message_at: string | null;
  preview: string | null;
  unread: number;
}
interface Message {
  id: string;
  author_id: string;
  author_handle: string;
  body: string;
  created_at: string;
  is_mine: boolean;
}
interface ThreadDetail {
  conversation_id: string;
  counterpart: { id: string; handle: string };
  messages: Message[];
}
interface DirectoryRow {
  id: string;
  handle: string;
}

function fmt(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function LoMessages() {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [commishHandle, setCommishHandle] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    try {
      const r = await fetch("/api/league-office/messages?scope=threads", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setThreads(j.threads ?? []);
        setCommishHandle(j.commissioner?.handle ?? "");
      } else {
        setErr(j.error === "no_commissioner" ? "No commissioner subscriber is configured." : "Could not load messages.");
      }
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  const loadThread = useCallback(async (conversationId: string) => {
    setLoadingDetail(true);
    setSelected(conversationId);
    setComposeOpen(false);
    try {
      const r = await fetch(
        `/api/league-office/messages?scope=thread&conversation_id=${encodeURIComponent(conversationId)}`,
        { cache: "no-store" }
      );
      const j = await r.json().catch(() => ({}));
      setDetail(r.ok ? j.thread : null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [detail]);

  async function send() {
    if (!detail || !draft.trim() || sending) return;
    setSending(true);
    setErr(null);
    try {
      const r = await fetch("/api/league-office/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", conversation_id: detail.conversation_id, body: draft.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setDraft("");
        await loadThread(detail.conversation_id);
        loadThreads();
      } else {
        setErr(j.message || "Send failed.");
      }
    } finally {
      setSending(false);
    }
  }

  async function startNew(toId: string) {
    if (!draft.trim() || sending) return;
    setSending(true);
    setErr(null);
    try {
      const r = await fetch("/api/league-office/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", to_subscriber_id: toId, body: draft.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setDraft("");
        setComposeOpen(false);
        await loadThreads();
        loadThread(j.conversation_id);
      } else {
        setErr(j.message || "Send failed.");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 0, border: "1px solid var(--color-cream-border)", borderRadius: 12, overflow: "hidden", background: "#fff", minHeight: 520 }}>
      {/* Thread list */}
      <div style={{ borderRight: "1px solid var(--color-cream-border)", display: "flex", flexDirection: "column", background: "var(--color-warm-panel)" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--color-cream-border)", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="font-mono" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: FAINT, flex: 1 }}>
            Inbox{commishHandle ? ` · @${commishHandle}` : ""}
          </span>
          <button
            onClick={() => { setComposeOpen(true); setSelected(null); setDetail(null); setDraft(""); setErr(null); }}
            style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 7, border: "none", background: "var(--color-forest)", color: "#f8f5f0", cursor: "pointer" }}
          >
            + New
          </button>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {loadingThreads ? (
            <div style={{ padding: 16, fontSize: 12.5, color: MUTED }}>Loading…</div>
          ) : threads.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12.5, color: MUTED }}>No conversations yet. Start one with “+ New”.</div>
          ) : (
            threads.map((t) => (
              <button
                key={t.conversation_id}
                onClick={() => loadThread(t.conversation_id)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "11px 14px", border: "none", cursor: "pointer",
                  borderBottom: "1px solid var(--color-cream-line)",
                  background: selected === t.conversation_id ? "rgba(196,146,42,.10)" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>@{t.counterpart_handle}</span>
                  {t.unread > 0 ? (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: GOLD, borderRadius: 10, padding: "1px 6px" }}>{t.unread}</span>
                  ) : null}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: FAINT }}>{fmt(t.last_message_at)}</span>
                </div>
                {t.preview ? (
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.preview}</div>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail / composer */}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        {composeOpen ? (
          <NewMessage draft={draft} setDraft={setDraft} onSend={startNew} sending={sending} err={err} onCancel={() => setComposeOpen(false)} />
        ) : !detail ? (
          <div style={{ margin: "auto", color: MUTED, fontSize: 13, padding: 24, textAlign: "center" }}>
            {loadingDetail ? "Loading…" : "Select a conversation, or start a new one."}
          </div>
        ) : (
          <>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-cream-border)" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>@{detail.counterpart.handle}</span>
            </div>
            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8, maxHeight: 400 }}>
              {detail.messages.length === 0 ? (
                <div style={{ color: MUTED, fontSize: 12.5, margin: "auto" }}>No messages yet — say hello.</div>
              ) : (
                detail.messages.map((m) => (
                  <div key={m.id} style={{ alignSelf: m.is_mine ? "flex-end" : "flex-start", maxWidth: "78%" }}>
                    <div style={{
                      fontSize: 13, lineHeight: 1.45, padding: "8px 12px", borderRadius: 12, whiteSpace: "pre-wrap", wordBreak: "break-word",
                      background: m.is_mine ? "var(--color-forest)" : "var(--color-warm-panel)",
                      color: m.is_mine ? "#f8f5f0" : INK,
                      border: m.is_mine ? "none" : "1px solid var(--color-cream-border)",
                    }}>
                      {m.body}
                    </div>
                    <div style={{ fontSize: 9.5, color: FAINT, marginTop: 2, textAlign: m.is_mine ? "right" : "left" }}>
                      {m.is_mine ? "You" : `@${m.author_handle}`} · {fmt(m.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
            {err ? <div style={{ padding: "0 16px", color: "var(--color-brick)", fontSize: 12 }}>{err}</div> : null}
            <div style={{ borderTop: "1px solid var(--color-cream-border)", padding: 12, display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                placeholder="Write a reply…  (⌘/Ctrl+Enter to send)"
                rows={2}
                maxLength={2000}
                style={{ flex: 1, resize: "vertical", fontFamily: "inherit", fontSize: 13, padding: "8px 11px", border: "1px solid var(--color-cream-border)", borderRadius: 8, color: INK, background: "#fff" }}
              />
              <button
                onClick={send}
                disabled={!draft.trim() || sending}
                style={{ fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: 8, border: "none", color: "#fff", cursor: !draft.trim() || sending ? "not-allowed" : "pointer", background: !draft.trim() || sending ? "var(--color-cream-edge)" : "var(--color-forest)" }}
              >
                {sending ? "…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NewMessage({
  draft, setDraft, onSend, sending, err, onCancel,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSend: (toId: string) => void;
  sending: boolean;
  err: string | null;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryRow[]>([]);
  const [picked, setPicked] = useState<DirectoryRow | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/league-office/messages?scope=directory&q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (live) { setResults(j.subscribers ?? []); setSearching(false); }
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: INK, flex: 1 }}>New message</span>
        <button onClick={onCancel} style={{ fontSize: 12, color: MUTED, background: "none", border: "none", cursor: "pointer" }}>Cancel</button>
      </div>

      {picked ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ color: FAINT }}>To:</span>
          <span style={{ fontWeight: 700, color: INK }}>@{picked.handle}</span>
          <button onClick={() => setPicked(null)} style={{ fontSize: 11, color: MUTED, background: "none", border: "none", cursor: "pointer" }}>change</button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search subscribers by handle…"
            autoFocus
            style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "8px 11px", border: "1px solid var(--color-cream-border)", borderRadius: 8, color: INK, background: "#fff" }}
          />
          <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--color-cream-line)", borderRadius: 8 }}>
            {searching && results.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12.5, color: MUTED }}>Searching…</div>
            ) : results.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12.5, color: MUTED }}>No subscribers found.</div>
            ) : (
              results.map((s) => (
                <button key={s.id} onClick={() => setPicked(s)} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: "none", borderBottom: "1px solid var(--color-cream-line)", background: "transparent", cursor: "pointer", fontSize: 13, color: INK }}>
                  @{s.handle}
                </button>
              ))
            )}
          </div>
        </>
      )}

      {picked ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write your message…"
            rows={4}
            maxLength={2000}
            autoFocus
            style={{ width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", fontSize: 13, padding: "8px 11px", border: "1px solid var(--color-cream-border)", borderRadius: 8, color: INK, background: "#fff" }}
          />
          {err ? <div style={{ color: "var(--color-brick)", fontSize: 12 }}>{err}</div> : null}
          <div>
            <button
              onClick={() => onSend(picked.id)}
              disabled={!draft.trim() || sending}
              style={{ fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 8, border: "none", color: "#fff", cursor: !draft.trim() || sending ? "not-allowed" : "pointer", background: !draft.trim() || sending ? "var(--color-cream-edge)" : "var(--color-forest)" }}
            >
              {sending ? "Sending…" : "Send message"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
