"use client";

// Reading pane — thread header + message list + composer
// (CC-DC-MESSAGING-1.0; extracted from MessagesApp.tsx in CC-DC-MSG-DOCK-1.0
// so the /messages inbox and the masthead message dock render the identical
// thread UI). All authorization stays server-side; this component only renders
// what /api/messages returned for the session token.

import { useEffect, useRef, useState } from "react";
import { type ThreadDetail, type DirectoryHit, isUnread } from "./client";
import MessageRow from "./MessageRow";

export const MAX_CHARS = 2000;
export const WARN_CHARS = 1800;

export type Target =
  | { kind: "convo"; conversationId: string }
  | { kind: "draft"; recipient: DirectoryHit };

export default function ThreadPane({
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
  alwaysShowBack = false,
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
  /** The dock is narrow even on wide viewports, so it always shows the back
   *  arrow; /messages keeps the original mobile-only behavior (default). */
  alwaysShowBack?: boolean;
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
          className={`rounded px-1 text-forest hover:text-forest/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold${alwaysShowBack ? "" : " min-[900px]:hidden"}`}
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
