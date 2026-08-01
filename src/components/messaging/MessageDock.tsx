"use client";

// MessageDock — site-wide chat trigger + slide-down panel (CC-DC-MSG-DOCK-1.0).
//
// A chat-bubbles trigger in the masthead opens a dropdown of
// Message my Captain · My Team · A Player · The Commissioner; choosing one
// slides a message dock down from under the masthead (up on close). The dock
// is a pure overlay — no route change, no game-state writes; it renders the
// SAME ThreadPane / MessageRow / NewMessageSearch the /messages inbox uses,
// and every send goes through the existing POST /api/messages actions.
//
// Mounted in BOTH mastheads (SiteHeaderNav.tsx + DailyChallenge.jsx
// HeaderIconNav row), between the @handle chip and the grid icon (D1). The
// gold unread dot lives on THIS trigger now (moved off the gear). Signed-out
// → the component renders nothing (D7).
//
// D2 invariant: the captain entry point re-resolves teams.captain_id
// server-side (GET ?scope=captain) at open AND on every send — captaincy
// rolls on leave, so a client-cached captain id is a correctness bug. The
// dock therefore keeps a dedicated "captain" target whose sends always
// re-resolve before POSTing to_subscriber_id.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ThreadRow,
  type ThreadDetail,
  type DirectoryHit,
  fetchUnreadTotal,
} from "./client";
import ThreadPane, { type Target, MAX_CHARS } from "./ThreadPane";
import NewMessageSearch from "./NewMessageSearch";
import {
  type DockTeam,
  type CommissionerInfo,
  type DockMenu,
  deriveDockMenu,
  JOIN_A_TEAM_HINT,
} from "@/lib/messaging/dock-menu";

const MARK_READ_DELAY_MS = 1500;
const DOCK_ANIM_MS = 200;

const C = { forest: "#1C3424", gold: "#C4922A" } as const;

// ── Injected styles (one copy per document, shared by both mastheads) ────────
// The trigger/dropdown reuse the existing .dc-navwrap/.dc-trigger/.dc-dd
// classes (both mastheads already inject those); everything dock-specific
// lives under .dc-msgdock-* here.
const DOCK_STYLE_ID = "dc-msgdock-styles";
const DOCK_CSS = `
  .dc-msgdock { display:flex; align-items:center; }
  .dc-msgdock .dc-trigger { position:relative; }
  .dc-msgdock-dot { position:absolute; top:1px; right:-3px; width:6px; height:6px;
    border-radius:50%; background:${C.gold}; }
  .dc-msgdock-panel { position:absolute; top:100%; right:0; width:420px; max-width:100vw;
    max-height:70vh; overflow-y:auto; background:#fff;
    border:1px solid rgba(28,52,36,0.18); border-top:none; border-radius:0 0 10px 10px;
    box-shadow:0 18px 40px rgba(20,18,16,0.35); z-index:60;
    animation:dcDockDown ${DOCK_ANIM_MS}ms ease; }
  .dc-msgdock-panel.closing { animation:dcDockUp ${DOCK_ANIM_MS}ms ease forwards; }
  @keyframes dcDockDown { from { transform:translateY(-14px); opacity:0; }
    to { transform:translateY(0); opacity:1; } }
  @keyframes dcDockUp { from { transform:translateY(0); opacity:1; }
    to { transform:translateY(-14px); opacity:0; } }
  @media (max-width:639px){ .dc-msgdock-panel { left:0; right:0; width:auto; border-radius:0; } }
  /* The 6th trigger squeezes the wordmark on narrow phones ("DAILY CHALLENGE"
     wraps, masthead grows). When the dock is mounted (signed-in only), tighten
     the icon row so the header keeps its one-line height. Sibling-scoped so
     signed-out spacing is untouched. */
  @media (max-width:430px){ .dc-msgdock ~ .dc-iconrow { gap:12px !important; } }
  @media (prefers-reduced-motion: reduce){
    .dc-msgdock-panel, .dc-msgdock-panel.closing { animation:none; }
  }
  .dc-msgdock-hint { display:block; font-size:9px; letter-spacing:0.04em;
    color:rgba(238,230,218,0.4); margin-top:2px; }
`;

function useDockStyles() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(DOCK_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = DOCK_STYLE_ID;
    el.textContent = DOCK_CSS;
    document.head.appendChild(el);
  }, []);
}

// Chat-bubbles glyph (speech-bubble pair, stroke 1.8 — mockup layout). Sizing,
// stroke color and fill:none come from the shared .dc-trigger svg rule.
function ChatGlyph() {
  return (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 9a2 2 0 0 1-2 2H6l-3 3V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2z" />
      <path d="M18 9h1a2 2 0 0 1 2 2v9l-3-3h-7a2 2 0 0 1-2-2v-1" />
    </svg>
  );
}

// The dock's own thread target. "captain" is deliberately NOT collapsed into
// "direct": its sends re-resolve the captain server-side every time (D2).
type DockTarget =
  | { kind: "captain"; teamId: string; recipient: { subscriber_id: string; handle: string } | null }
  | { kind: "direct"; recipient: DirectoryHit }
  | { kind: "team"; teamId: string };

type PanelView =
  | { view: "picker-captain" }
  | { view: "picker-team" }
  | { view: "search" }
  | { view: "thread"; origin: PanelView["view"] | null };

interface Boot {
  teams: DockTeam[];
  commissioner: CommissionerInfo;
  threads: ThreadRow[];
  menu: DockMenu;
}

export default function MessageDock({
  token,
  initialUnread,
  onUnreadChange,
}: {
  token: string | null;
  /** Page-owned unread total (SiteHeaderNav pages). Omit to let the dock
   *  fetch its own on mount (the in-app DailyChallenge masthead). */
  initialUnread?: number;
  onUnreadChange?: (n: number) => void;
}) {
  useDockStyles();

  const [menuOpen, setMenuOpen] = useState(false);
  const [boot, setBoot] = useState<Boot | null>(null);
  const [bootErr, setBootErr] = useState(false);

  const [panel, setPanel] = useState<PanelView | null>(null);
  const [closing, setClosing] = useState(false);

  // Thread state (one thread at a time — the dock has no thread list).
  const [dockTarget, setDockTarget] = useState<DockTarget | null>(null);
  const [convoId, setConvoId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailErr, setDetailErr] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");

  const [unread, setUnread] = useState(initialUnread ?? 0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingRef = useRef(false);
  sendingRef.current = sending;
  const panelRef = useRef<PanelView | null>(null);
  panelRef.current = panel;

  // Badge: controlled by the page when initialUnread is provided; otherwise
  // self-fetched once (this is what closes the old "lobby badge mirror"
  // follow-up for the in-app masthead).
  useEffect(() => {
    if (typeof initialUnread === "number") setUnread(initialUnread);
  }, [initialUnread]);
  useEffect(() => {
    if (initialUnread !== undefined || !token) return;
    let cancelled = false;
    fetchUnreadTotal(token).then(n => { if (!cancelled) setUnread(n); });
    return () => { cancelled = true; };
  }, [token, initialUnread]);

  const refreshBadge = useCallback(async () => {
    if (!token) return;
    const n = await fetchUnreadTotal(token);
    setUnread(n);
    onUnreadChange?.(n);
  }, [token, onUnreadChange]);

  // ── Open/close plumbing ────────────────────────────────────────────────────
  const closeDock = useCallback((opts?: { force?: boolean }) => {
    // D5: never close while a send is in flight (a click-away must not eat an
    // unsent message).
    if (sendingRef.current && !opts?.force) return;
    setMenuOpen(false);
    if (!panelRef.current) return;
    setClosing(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setPanel(null);
      setClosing(false);
      setDockTarget(null);
      setConvoId(null);
      setDetail(null);
      setDetailErr("");
      setDraft("");
      setSendErr("");
    }, DOCK_ANIM_MS);
  }, []);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
  }, []);

  // Escape + outside click close the menu and the dock (but not mid-send).
  useEffect(() => {
    if (!menuOpen && !panel) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        closeDock();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMenuOpen(false); closeDock(); }
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, panel, closeDock]);

  // ── Bootstrap (fresh on every menu open — D2: captains are never cached) ──
  const openMenu = useCallback(async () => {
    if (!token) return;
    setMenuOpen(true);
    setBoot(null);
    setBootErr(false);
    try {
      const q = (scope: string) =>
        fetch(`/api/messages?token=${encodeURIComponent(token)}&scope=${scope}`).then(r => {
          if (!r.ok) throw new Error();
          return r.json();
        });
      const [cap, com, thr] = await Promise.all([q("captain"), q("commissioner"), q("threads")]);
      const teams: DockTeam[] = Array.isArray(cap?.teams) ? cap.teams : [];
      const commissioner: CommissionerInfo = com && typeof com === "object" ? com : { available: false };
      const threads: ThreadRow[] = Array.isArray(thr?.threads) ? thr.threads : [];
      setBoot({ teams, commissioner, threads, menu: deriveDockMenu(teams, commissioner) });
    } catch {
      setBootErr(true);
    }
  }, [token]);

  function toggleTrigger() {
    if (panel) { closeDock(); return; }
    if (menuOpen) { setMenuOpen(false); return; }
    openMenu();
  }

  // ── Thread openers ─────────────────────────────────────────────────────────
  const loadDetailByConvo = useCallback(async (conversationId: string) => {
    if (!token) return;
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
  }, [token]);

  function openThreadView(origin: PanelView["view"] | null) {
    setMenuOpen(false);
    setDetail(null);
    setDetailErr("");
    setDraft("");
    setSendErr("");
    setPanel({ view: "thread", origin });
  }

  /** Direct thread with a known recipient (player / commissioner / captain).
   *  Reuses an existing thread when the inbox already has one (same
   *  handle-match convention as MessagesApp.openDraft). */
  function openDirect(
    recipient: { subscriber_id: string; handle: string },
    opts: { captainTeamId?: string; origin?: PanelView["view"] | null } = {}
  ) {
    openThreadView(opts.origin ?? null);
    setDockTarget(
      opts.captainTeamId
        ? { kind: "captain", teamId: opts.captainTeamId, recipient }
        : { kind: "direct", recipient }
    );
    const existing = boot?.threads.find(
      t => t.kind === "direct" && t.counterpart_handle === recipient.handle
    );
    setConvoId(existing ? existing.conversation_id : null);
    if (existing) loadDetailByConvo(existing.conversation_id);
  }

  /** Team broadcast channel — resolved by team_id server-side. */
  async function openTeam(teamId: string, origin: PanelView["view"] | null = null) {
    if (!token) return;
    openThreadView(origin);
    setDockTarget({ kind: "team", teamId });
    setConvoId(null);
    setLoadingDetail(true);
    try {
      const r = await fetch(
        `/api/messages?token=${encodeURIComponent(token)}&scope=thread&team_id=${encodeURIComponent(teamId)}`
      );
      if (!r.ok) throw new Error();
      const j: ThreadDetail = await r.json();
      setDetail(j);
      setConvoId(j.conversation_id);
    } catch {
      setDetail(null);
      setDetailErr("Couldn't load this conversation.");
    } finally {
      setLoadingDetail(false);
    }
  }

  /** D2: the ONLY source of a captain id is this fresh server resolution. */
  const resolveCaptain = useCallback(async (teamId: string) => {
    if (!token) return null;
    try {
      const r = await fetch(`/api/messages?token=${encodeURIComponent(token)}&scope=captain`);
      if (!r.ok) return null;
      const j = await r.json();
      const team: DockTeam | undefined = (Array.isArray(j?.teams) ? j.teams : []).find(
        (t: DockTeam) => t.team_id === teamId
      );
      return team?.captain ?? null;
    } catch {
      return null;
    }
  }, [token]);

  // ── Mark-read: 1.5s after a thread is visible, then refresh the badge ─────
  useEffect(() => {
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    if (!token || !convoId || panel?.view !== "thread") return;
    const id = convoId;
    markReadTimer.current = setTimeout(async () => {
      try {
        await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, action: "mark-read", conversation_id: id }),
        });
        refreshBadge();
      } catch { /* badge refresh is best-effort */ }
    }, MARK_READ_DELAY_MS);
    return () => { if (markReadTimer.current) clearTimeout(markReadTimer.current); };
  }, [token, convoId, panel?.view, refreshBadge]);

  // Keep the pane pinned to the newest message.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [detail?.messages.length]);

  // ── Send (existing POST actions only — no new send paths) ─────────────────
  async function send() {
    if (!token || !dockTarget) return;
    const body = draft.trim();
    if (!body || sending) return;
    if (body.length > MAX_CHARS) {
      setSendErr(`Messages are capped at ${MAX_CHARS.toLocaleString()} characters.`);
      return;
    }
    setSending(true);
    setSendErr("");
    try {
      const payload: Record<string, unknown> = { token, action: "send", body };
      if (dockTarget.kind === "captain") {
        // Re-resolve the captain on EVERY send — if captaincy rolled since the
        // dock opened, the message must reach the NEW captain, never the stale
        // one. The server routes to_subscriber_id to the right pair thread.
        const cap = await resolveCaptain(dockTarget.teamId);
        if (!cap) {
          setSendErr("Your team has no captain right now.");
          return;
        }
        if (cap.subscriber_id !== dockTarget.recipient?.subscriber_id) {
          setDockTarget({ ...dockTarget, recipient: cap });
        }
        payload.to_subscriber_id = cap.subscriber_id;
      } else if (dockTarget.kind === "team") {
        if (!convoId) { setSendErr("Couldn't send. Try again."); return; }
        payload.conversation_id = convoId;
      } else if (convoId) {
        payload.conversation_id = convoId;
      } else {
        payload.to_subscriber_id = dockTarget.recipient.subscriber_id;
      }

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
      const newConvoId = (j as { conversation_id?: string }).conversation_id;
      if (newConvoId) {
        setConvoId(newConvoId);
        await loadDetailByConvo(newConvoId);
      }
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
    refreshBadge();
  }

  async function blockCounterpart() {
    if (!detail?.counterpart) return;
    const ok = await moderate("block", { subscriber_id: detail.counterpart.subscriber_id });
    if (ok) {
      // The thread vanishes from both inboxes — the dock closes with it.
      closeDock({ force: true });
      refreshBadge();
    }
  }

  async function deleteMessage(messageId: string) {
    if (!detail) return;
    const ok = await post("delete", { message_id: messageId });
    if (ok) setDetail(d => (d ? { ...d, messages: d.messages.filter(m => m.id !== messageId) } : d));
  }

  function reportMessage(messageId: string): Promise<boolean> {
    return moderate("report", { message_id: messageId });
  }

  function backFromThread() {
    const origin = panel?.view === "thread" ? panel.origin : null;
    if (origin) {
      setDockTarget(null);
      setConvoId(null);
      setDetail(null);
      setDetailErr("");
      setDraft("");
      setSendErr("");
      setPanel({ view: origin } as PanelView);
    } else {
      closeDock();
    }
  }

  // D7: no session token → no trigger at all.
  if (!token) return null;

  const menu = boot?.menu ?? null;

  // ThreadPane-compatible target for the current dock thread.
  const paneTarget: Target | null = dockTarget
    ? dockTarget.kind === "team"
      ? { kind: "convo", conversationId: convoId ?? "" }
      : convoId
        ? { kind: "convo", conversationId: convoId }
        : {
            kind: "draft",
            recipient: dockTarget.recipient ?? { subscriber_id: "", handle: "…" },
          }
    : null;

  const pickerBtn =
    "block w-full rounded px-3 py-2.5 text-left font-mono text-[12px] text-near-black hover:bg-gold/10 disabled:opacity-45 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold";

  return (
    <div ref={wrapRef} className="dc-msgdock">
      <div className={`dc-navwrap${menuOpen ? " open" : ""}`}>
        <button
          type="button"
          className="dc-trigger"
          aria-haspopup="menu"
          aria-expanded={menuOpen || !!panel}
          aria-label={unread > 0 ? `Messages — ${unread} unread` : "Messages"}
          title="Messages"
          onClick={e => { e.stopPropagation(); toggleTrigger(); }}
        >
          <ChatGlyph />
          {unread > 0 && <span className="dc-msgdock-dot" aria-hidden="true" />}
          <span className="dc-caret" aria-hidden="true" />
        </button>

        <div className="dc-dd" role="menu" aria-label="Messages" style={{ minWidth: "216px" }}>
          <div className="dc-dd-label">Messages</div>
          {menuOpen && bootErr && (
            <div className="dc-dd-item disabled" role="presentation">Couldn&apos;t load — try again.</div>
          )}
          {menuOpen && !boot && !bootErr && (
            <div className="dc-dd-item disabled" role="presentation">Loading…</div>
          )}
          {menu && (
            <>
              {menu.captain.state !== "hidden" && (
                <button
                  type="button"
                  role="menuitem"
                  className={`dc-dd-item${menu.captain.state === "disabled" ? " disabled" : ""}`}
                  disabled={menu.captain.state === "disabled"}
                  aria-disabled={menu.captain.state === "disabled" || undefined}
                  onClick={() => {
                    if (menu.captain.state === "open" && menu.captain.team.captain) {
                      openDirect(menu.captain.team.captain, { captainTeamId: menu.captain.team.team_id });
                    } else if (menu.captain.state === "picker") {
                      setMenuOpen(false);
                      setPanel({ view: "picker-captain" });
                    }
                  }}
                >
                  Message my Captain
                  {menu.captain.state === "disabled" && (
                    <span className="dc-msgdock-hint">{JOIN_A_TEAM_HINT}</span>
                  )}
                </button>
              )}
              {menu.myTeam.state !== "hidden" && (
                <button
                  type="button"
                  role="menuitem"
                  className="dc-dd-item"
                  onClick={() => {
                    if (menu.myTeam.state === "open") openTeam(menu.myTeam.team.team_id);
                    else { setMenuOpen(false); setPanel({ view: "picker-team" }); }
                  }}
                >
                  My Team
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="dc-dd-item"
                onClick={() => { setMenuOpen(false); setPanel({ view: "search" }); }}
              >
                A Player
              </button>
              {menu.commissioner.state !== "hidden" && (
                <button
                  type="button"
                  role="menuitem"
                  className={`dc-dd-item${menu.commissioner.state === "disabled" ? " disabled" : ""}`}
                  disabled={menu.commissioner.state === "disabled"}
                  aria-disabled={menu.commissioner.state === "disabled" || undefined}
                  onClick={() => {
                    if (menu.commissioner.state === "open") openDirect(menu.commissioner.recipient);
                  }}
                >
                  The Commissioner
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {panel && (
        <div className={`dc-msgdock-panel${closing ? " closing" : ""}`} role="dialog" aria-label="Messages">
          {panel.view === "picker-captain" && menu?.captain.state === "picker" && (
            <div className="px-2 py-2">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="font-mono text-[10px] uppercase tracking-widest text-near-black/45">
                  Message my Captain — pick a team
                </span>
                <button
                  type="button"
                  aria-label="Close messages"
                  onClick={() => closeDock()}
                  className="rounded px-1.5 font-mono text-sm text-near-black/50 hover:text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
                >
                  ✕
                </button>
              </div>
              {menu.captain.teams.map(t => (
                <button
                  key={t.team_id}
                  type="button"
                  className={pickerBtn}
                  disabled={!t.captain}
                  onClick={() =>
                    t.captain &&
                    openDirect(t.captain, { captainTeamId: t.team_id, origin: "picker-captain" })
                  }
                >
                  <span className="font-semibold text-forest">{t.team_name ?? "Team"}</span>
                  <span className="ml-2 text-near-black/55">
                    {t.captain ? `@${t.captain.handle}` : "No captain yet"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {panel.view === "picker-team" && menu?.myTeam.state === "picker" && (
            <div className="px-2 py-2">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="font-mono text-[10px] uppercase tracking-widest text-near-black/45">
                  My Team — pick a channel
                </span>
                <button
                  type="button"
                  aria-label="Close messages"
                  onClick={() => closeDock()}
                  className="rounded px-1.5 font-mono text-sm text-near-black/50 hover:text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
                >
                  ✕
                </button>
              </div>
              {menu.myTeam.teams.map(t => (
                <button
                  key={t.team_id}
                  type="button"
                  className={pickerBtn}
                  onClick={() => openTeam(t.team_id, "picker-team")}
                >
                  <span className="font-semibold text-forest">{t.team_name ?? "Team"}</span>
                  <span className="ml-2 font-mono text-[9px] uppercase tracking-widest text-near-black/40">
                    Team channel
                  </span>
                </button>
              ))}
            </div>
          )}

          {panel.view === "search" && (
            <div className="py-1">
              <div className="flex items-center justify-between px-4 pt-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-near-black/45">
                  Message a player
                </span>
                <button
                  type="button"
                  aria-label="Close messages"
                  onClick={() => closeDock()}
                  className="rounded px-1.5 font-mono text-sm text-near-black/50 hover:text-forest focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold"
                >
                  ✕
                </button>
              </div>
              <NewMessageSearch
                token={token}
                onPick={hit => openDirect(hit, { origin: "search" })}
              />
            </div>
          )}

          {panel.view === "thread" && paneTarget && (
            <ThreadPane
              target={paneTarget}
              detail={detail}
              loading={loadingDetail}
              error={detailErr}
              draft={draft}
              setDraft={setDraft}
              sending={sending}
              sendErr={sendErr}
              onSend={send}
              onBack={backFromThread}
              onToggleMute={toggleMute}
              onBlock={blockCounterpart}
              onDelete={deleteMessage}
              onReport={reportMessage}
              listRef={listRef}
              alwaysShowBack
            />
          )}
        </div>
      )}
    </div>
  );
}
