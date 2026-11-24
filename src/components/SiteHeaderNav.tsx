"use client";

// ══════════════════════════════════════════════════════════════════════════════
// SiteHeaderNav — the shared Faraday masthead + the Daily Challenge AppBar for
// the standalone Next routes (/account, /leaderboard, …). Behavioural twin of the
// in-app `HeaderIconNav` in DailyChallenge.jsx, but navigation uses real hrefs
// instead of in-app screen state, so it can live on any server-rendered page.
//
// FDY-445 (CC-BRAND-MASTHEAD-1.0): the forest bar is the vendored Faraday
// masthead (src/lib/faraday-masthead — never edit it); the @handle chip sits in
// its context slot; the message dock + the five icon dropdowns moved into the
// <AppBar> row underneath. Every menu item and link target is unchanged.
//
// EDIT MENU TEXT + LINKS in `buildSiteMenus()` below — the single source of truth
// for these pages (mirrors the in-app `buildHeaderMenus`). Icons are inline SVG
// (stroke 1.8, no icon library); styling is the shared `.dc-*` classes injected
// once per document via `useNavStyles`.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import MessageDock from "@/components/messaging/MessageDock";
import { useDcToken } from "@/components/messaging/client";
import { DC_NAV_CSS, DC_GOLD } from "@/components/dcAppBarStyles";
import { EMAIL_STORAGE_KEY } from "@/lib/supabase";
import { Masthead, AppBar } from "@/lib/faraday-masthead/ui/Masthead.tsx";

const mono  = { fontFamily: "'IBM Plex Mono',monospace" } as const;

// The signed-in email the browser already holds (written at sign-in next to the
// dc_session token). Shown in the masthead's context slot; only when a session
// token exists, so a stale email never reads as "signed in". Server snapshot null.
const noSubscribe = () => () => {};
function useDcEmail(token: string | null): string | null {
  const stored = useSyncExternalStore(
    noSubscribe,
    () => { try { return localStorage.getItem(EMAIL_STORAGE_KEY); } catch { return null; } },
    () => null
  );
  return token ? stored : null;
}

type MenuItem =
  | { label: string; href: string; current?: boolean }
  | { label: string; onClick: () => void; current?: boolean }
  | { label: string; disabled: true }
  | { divider: true }
  | { heading: string };

interface Menu {
  id: string;
  icon: "grid" | "help" | "trophy" | "gear" | "hamburger";
  label: string;
  items: MenuItem[];
  /** Gold 6px dot on the trigger (unread messages live behind this menu). */
  badge?: boolean;
  /** Full aria-label when it should say more than `label` (e.g. unread count). */
  ariaLabel?: string;
}

// Inline SVGs for the five triggers — grid · help · trophy · gear · hamburger.
function NavGlyph({ name }: { name: Menu["icon"] }) {
  const common = { viewBox: "0 0 24 24", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "grid") return (
    <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
  );
  if (name === "help") return (
    <svg {...common}><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
  );
  if (name === "trophy") return (
    <svg {...common}><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" /><path d="M7 6H4a2 2 0 0 0 2 4M17 6h3a2 2 0 0 1-2 4" /></svg>
  );
  if (name === "gear") return (
    <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
  );
  return ( // hamburger
    <svg {...common}><path d="M3 6h18M3 12h18M3 18h18" /></svg>
  );
}

// The daily games in locked lobby order, from game_catalog via /api/games
// (CC-DC-GAME-REGISTRY-1.0). This was a hardcoded array of seven that had to be
// kept in sync by hand with the lobby. Each links via the /challenge?game=<type>
// deep-link the lobby honours on mount.
//
// Fetched client-side because this header renders on 19 standalone pages; making
// every one of them thread a prop is worse than one cached request. Until it
// resolves (or if it fails) the All Games menu is empty rather than stale.
function useGameRoster(): string[] {
  const [games, setGames] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/games")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j?.games) return;
        setGames(j.games.map((g: { key: string }) => g.key).filter(Boolean));
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return games;
}

// ── EDIT MENU TEXT + LINKS HERE ───────────────────────────────────────────────
// Single source of truth for the standalone-page header dropdowns. Each item is
// one of: { label, href } · { label, onClick } · { …, current:true } ·
// { label, disabled:true } · { divider }. The Account menu is auth-conditional.
// `current` marks the active destination for the page this header renders on.
// Mirrors buildHeaderMenus in DailyChallenge.jsx — keep the two in sync.
export function buildSiteMenus({
  authed,
  current,
  onSignOut,
  unreadCount = 0,
  games = [],
}: {
  games?: string[];
  authed: boolean;
  current?: "daily" | "leaderboard" | "account" | "notifications" | "messages";
  onSignOut?: () => void;
  /** Unread message total for the nav badge (CC-DC-MESSAGING-1.0). */
  unreadCount?: number;
}): Menu[] {
  return [
    { id: "games", icon: "grid", label: "All Games", items:
      games.map(g => ({ label: g, href: `/challenge?game=${encodeURIComponent(g)}` })),
    },
    { id: "help", icon: "help", label: "Help & Feedback", items: [
      // Evergreen "Hints" (general how-to-play help) stays as-is — the
      // day-scoped "Hints Today" below is a distinct page (FAR-287).
      // Glossary / Report a Bug / Feedback moved to the gear (Account) menu.
      { label: "Hints",           href: "/help/hints" },
      { label: "Tips and Tricks", href: "/help/tips" },
      { label: "Questions",       href: "/help/questions" },
      { divider: true },
      { heading: "Today's Challenge" },
      { label: "Hints Today",             href: "/challenge/hints" },
      { label: "About Today's Challenge", href: "/challenge/about" },
      { label: "Answers Today",           href: "/challenge/answers" },
      { label: "Faraday's Take",           href: "/challenge/signals" },
    ]},
    { id: "compete", icon: "trophy", label: "Compete", items: [
      { label: "Leaderboard — Today",  href: "/leaderboard", current: current === "leaderboard" },  // TODO: no today-only view yet → season board (shows a Today column)
      { label: "Leaderboard — Season", href: "/leaderboard" },
      { label: "Teams",                href: "/leaderboard?view=teams" },
      { label: "Free Agency",          href: "/free-agency" },
    ]},
    // The gold unread dot moved to the chat-bubbles trigger (CC-DC-MSG-DOCK-1.0
    // D1); the gear keeps its "Messages (n)" item linking to /messages.
    { id: "account", icon: "gear", label: "Account", items: authed ? [
      { label: unreadCount > 0 ? `Messages (${unreadCount})` : "Messages", href: "/messages", current: current === "messages" },
      { label: "Account",  href: "/account", current: current === "account" },
      { label: "Settings", href: "/account" },  // same Account page today — no separate settings page yet
      { label: "Notifications", href: "/account/notifications", current: current === "notifications" },
      { divider: true },
      // Moved here from the "?" Help menu (Myke, 2026-07-03).
      { label: "Glossary",     href: "/help/glossary" },
      { label: "Report a Bug", href: "/help/report-a-bug" },
      { label: "Feedback",     href: "/help/feedback" },
      { divider: true },
      ...(onSignOut ? [{ label: "Sign Out", onClick: onSignOut } as MenuItem] : []),
    ] : [
      { label: "Sign In", href: "/account" },
      { divider: true },
      { label: "Glossary",     href: "/help/glossary" },
      { label: "Report a Bug", href: "/help/report-a-bug" },
      { label: "Feedback",     href: "/help/feedback" },
    ]},
    { id: "menu", icon: "hamburger", label: "More Faraday", items: [
      { label: "About Faraday Intelligence", href: "/about" },
      { label: "Who is Faraday",             href: "/who-is-faraday" },
      { label: "Share / Invite",             href: "/share" },
      { label: "Notifications",              href: "/account/notifications" },
      { label: "Faraday Merchandise",        href: "/merch" },
      { label: "Faraday Academy",            disabled: true },  // reserved for a later phase — no link by design
      { divider: true },
      { label: "Terms / Privacy",            href: "/terms" },
    ]},
  ];
}

const NAV_STYLE_ID = "dc-sitenav-styles";
const NAV_CSS = DC_NAV_CSS;

function useNavStyles() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(NAV_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = NAV_STYLE_ID;
    el.textContent = NAV_CSS;
    document.head.appendChild(el);
  }, []);
}

function IconNav({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function activate(item: MenuItem) {
    setOpen(null);
    if ("onClick" in item && typeof item.onClick === "function") item.onClick();
    else if ("href" in item && item.href) window.location.href = item.href;
  }

  return (
    <div ref={wrapRef} className="dc-iconrow">
      {menus.map((m) => {
        const isOpen = open === m.id;
        return (
          <div key={m.id} className={`dc-navwrap${isOpen ? " open" : ""}`}>
            <button
              type="button"
              className="dc-trigger"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              aria-label={m.ariaLabel ?? m.label}
              title={m.label}
              onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : m.id); }}
            >
              <NavGlyph name={m.icon} />
              {m.badge && <span className="dc-badge-dot" aria-hidden="true" />}
              <span className="dc-caret" aria-hidden="true" />
            </button>
            <div className="dc-dd" role="menu" aria-label={m.label}>
              <div className="dc-dd-label">{m.label}</div>
              {m.items.map((it, i) =>
                "divider" in it ? (
                  <hr key={i} />
                ) : "heading" in it ? (
                  <div key={i} className="dc-dd-label">{it.heading}</div>
                ) : "disabled" in it ? (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    className="dc-dd-item disabled"
                    disabled
                    aria-disabled
                    title="Coming soon"
                  >
                    {it.label}
                  </button>
                ) : (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    className={`dc-dd-item${it.current ? " current" : ""}`}
                    onClick={() => activate(it)}
                  >
                    {it.label}{it.current ? " ·" : ""}
                  </button>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function SiteHeaderNav({
  current,
  authed = false,
  handle,
  onSignOut,
  unreadCount = 0,
  onUnreadChange,
}: {
  current?: "daily" | "leaderboard" | "account" | "notifications" | "messages";
  authed?: boolean;
  handle?: string | null;
  onSignOut?: () => void;
  /** Unread message total — gold dot on the chat trigger + "(n)" on Messages. */
  unreadCount?: number;
  /** Lets the message dock push a fresh unread total back to the page state
   *  after it marks a thread read (CC-DC-MSG-DOCK-1.0). */
  onUnreadChange?: (n: number) => void;
}) {
  useNavStyles();
  const token = useDcToken();
  const games = useGameRoster();
  const menus = buildSiteMenus({ authed, current, onSignOut, unreadCount, games });

  const email = useDcEmail(token);

  return (
    <>
      <Masthead
        appName="Daily Challenge"
        homeHref="/challenge"
        email={email}
        signInHref="/account"
        context={handle ? (
          <span className="dc-ctx">
            <a
              href="/account"
              className="dc-status"
              title="Account"
              style={{ ...mono, fontSize: "clamp(12px,1vw,14px)", fontWeight: 700, color: DC_GOLD, letterSpacing: "0.04em", textDecoration: "none", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", minHeight: 44 }}
            >
              @{handle}
            </a>
          </span>
        ) : undefined}
      />
      <div className="dc-appbar">
        <AppBar label="Daily Challenge" overflow="visible">
          <div className="dc-appbar-row">
            {/* Chat-bubbles trigger + slide-down dock, first in the row, before
                the grid icon (CC-DC-MSG-DOCK-1.0 D1). Renders nothing when
                signed out (D7 — gated on the session token, not `authed`). */}
            <MessageDock token={token} initialUnread={unreadCount} onUnreadChange={onUnreadChange} />
            <IconNav menus={menus} />
          </div>
        </AppBar>
      </div>
    </>
  );
}
